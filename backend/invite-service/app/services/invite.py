"""邀请码校验编排：原子状态迁移 + 席位统计（DESIGN-M1 §3.3/§3.4，PRD §4 状态机）。

**名额上限已按用户决策（2026-11-14）彻底移除**：不再有 quota_exhausted 拒绝路径。
邀请码本身（一次性/过期/尝试次数/哈希）是唯一准入控制。

事务模型（手工 commit/rollback，因失败路径需持久化 attempts/EXPIRED 迁移后再报错）：
  - 业务规则失败（invalid/expired/blocked/used）：先写簿记 → COMMIT → 抛 InviteError
  - Synapse 调用失败：ROLLBACK（码保持 UNUSED，attempts 不增，可重试）
  - 成功：条件 UPDATE 转 USED（rowcount=1 强校验）→ 记录席位统计 → 审计 → COMMIT
日志红线：任何路径都不记录明文码/令牌。
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg

from app.config import Settings
from app.services import security
from app.services.quota import record_seat_usage
from app.services.synapse_admin import MatrixAdminClient, SynapseApiError

logger = logging.getLogger(__name__)

_CODE_RE = re.compile(r"^[0-9a-f]{10}-[A-Za-z0-9_-]{16,64}$")


class InviteError(Exception):
    """业务失败（映射为 API 错误响应）。"""

    def __init__(self, status_code: int, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}")
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass
class VerifySuccess:
    registration_token: str
    token_expires_at: str


def _iso_from_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


async def _audit(conn: asyncpg.Connection, event_type: str, code_id, result: str) -> None:
    await conn.execute(
        "INSERT INTO audit_events (event_type, code_id, result) VALUES ($1, $2, $3)",
        event_type,
        code_id,
        result,
    )


async def _fail(conn: asyncpg.Connection, tx: asyncpg.transaction, error: InviteError,
                event_type: str = "verify.fail", code_id=None) -> InviteError:
    """持久化失败审计后提交事务，返回待抛出的 InviteError。"""
    await _audit(conn, event_type, code_id, error.code)
    await tx.commit()
    return error


async def verify_code(db, cfg: Settings, admin: MatrixAdminClient, code_input: str) -> VerifySuccess:
    """POST /invite-api/v1/verify 的核心编排（全流程见模块 docstring）。"""
    code = (code_input or "").strip()
    if not _CODE_RE.match(code):
        # 格式非法：tag 无法归属任何码，仅记全局审计（PRD §4/C 语义之外）
        async with db.acquire() as conn:
            async with conn.transaction():
                await _audit(conn, "verify.fail", None, "invalid")
        raise InviteError(400, "invalid", "邀请码格式不正确")

    tag = code.split("-", 1)[0]

    async with db.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            row = await conn.fetchrow(
                """
                SELECT id, salt, code_hash, status, expires_at, attempts, max_attempts
                FROM invite_codes WHERE tag = $1 FOR UPDATE
                """,
                tag,
            )
            now = datetime.now(timezone.utc)

            if row is None:
                raise await _fail(conn, tx, InviteError(400, "invalid", "邀请码不存在"))

            # ---- 终态判定（先于尝试计数，PRD B）----
            if row["status"] == "USED":
                raise await _fail(conn, tx, InviteError(400, "used", "邀请码已被使用"))
            if row["status"] == "EXPIRED":
                raise await _fail(conn, tx, InviteError(400, "expired", "邀请码已过期"))
            if row["status"] == "BLOCKED":
                raise await _fail(conn, tx, InviteError(400, "blocked", "尝试次数已达上限"))
            if row["status"] == "REVOKED":
                # 错误码枚举无 revoked；对外按不存在处理（CHECKS 偏差 5）
                raise await _fail(conn, tx, InviteError(400, "invalid", "邀请码不存在"))

            # ---- 过期迁移（UNUSED → EXPIRED 终态；attempts 不增加）----
            if row["expires_at"] <= now:
                await conn.execute(
                    "UPDATE invite_codes SET status = 'EXPIRED' WHERE id = $1 AND status = 'UNUSED'",
                    row["id"],
                )
                raise await _fail(conn, tx, InviteError(400, "expired", "邀请码已过期"),
                                  code_id=row["id"])

            # ---- 哈希校验（失败计数仅对 UNUSED 且 tag 可归属的码，PRD C）----
            provided_hash = security.hash_code(code, row["salt"], cfg.hash_pepper)
            if not security.codes_match(row["code_hash"], provided_hash):
                new_attempts = row["attempts"] + 1
                becomes_blocked = new_attempts >= row["max_attempts"]
                await conn.execute(
                    """
                    UPDATE invite_codes
                    SET attempts = $2,
                        status = CASE WHEN $3 THEN 'BLOCKED' ELSE status END
                    WHERE id = $1 AND status = 'UNUSED'
                    """,
                    row["id"],
                    new_attempts,
                    becomes_blocked,
                )
                error = InviteError(400, "blocked", "尝试次数已达上限") if becomes_blocked \
                    else InviteError(400, "invalid", "邀请码校验失败")
                raise await _fail(conn, tx, error, code_id=row["id"])

            # ---- 哈希匹配且 UNUSED：记录席位统计 + 发令牌（无名额上限）----
            try:
                await record_seat_usage(conn, admin)
                expiry_ms = admin.now_ms() + cfg.token_ttl_minutes * 60 * 1000
                token_body = await admin.create_registration_token(
                    uses_allowed=1, expiry_time_ms=expiry_ms
                )
            except SynapseApiError as exc:
                # 发码失败：码不消耗、可重试
                await tx.rollback()
                logger.error("synapse token issuance failed: %s", exc)
                raise InviteError(500, "internal_error", "服务暂时不可用，请稍后重试") from None

            registration_token = token_body.get("token")
            if not registration_token:
                await tx.rollback()
                logger.error("synapse token response missing token field")
                raise InviteError(500, "internal_error", "服务暂时不可用，请稍后重试")

            # ---- 一次性转 USED（条件 UPDATE，rowcount=1 才算成功）----
            status_result = await conn.execute(
                "UPDATE invite_codes SET status = 'USED', used_at = now() WHERE id = $1 AND status = 'UNUSED'",
                row["id"],
            )
            if status_result.split()[-1] != "1":
                await tx.rollback()
                raise InviteError(400, "used", "邀请码已被使用")

            await _audit(conn, "verify.ok", row["id"], "ok")
            await _audit(conn, "token.issued", row["id"], "ok")
            await tx.commit()

            expires_ms = token_body.get("expiry_time") or expiry_ms
            return VerifySuccess(
                registration_token=str(registration_token),
                token_expires_at=_iso_from_ms(int(expires_ms)),
            )
        except InviteError:
            # _fail 路径已完成 commit；直接上抛
            raise
        except Exception:
            await tx.rollback()
            raise
