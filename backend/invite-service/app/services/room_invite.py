"""自举（管理员/固定加密房间/名额行）+ 新用户轮询入房 + invite 重试（P0-6，PRD Q3 方案 b）。

幂等性：任务表 UNIQUE(user_id, room_id) + Matrix invite 重发无副作用 + 轮询对已 DONE 用户不建任务。
日志红线：错误只记错误码/类型，不记响应体；任何令牌/密码不入日志。
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from app.config import Settings
from app.db.pool import Database
from app.services.synapse_admin import MatrixAdminClient, SynapseApiError

logger = logging.getLogger(__name__)

INVITE_MAX_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 5
BACKOFF_CAP_SECONDS = 300


async def ensure_bootstrap(db: Database, cfg: Settings, admin: MatrixAdminClient) -> None:
    """启动自举（幂等，DESIGN-M1 §3.5）：

    1. quota_counters 行不存在则插入（max_members=env，seats_used=0）；
    2. 管理员登录；不存在则以 shared-secret 管理注册创建，seats_used 校准为 ≥1；
    3. rooms 为空则创建 1 个 group + 1 个 private 固定加密房间并入库。
    """
    async with db.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO quota_counters (id, max_members, seats_used)
            VALUES (1, $1, 0) ON CONFLICT (id) DO NOTHING
            """,
            cfg.max_members,
        )

    # ---- 管理员账号 ----
    registered_now = False
    try:
        await admin.login()
    except SynapseApiError as exc:
        logger.info("admin login unavailable (%s); attempting first-run registration", exc)
        try:
            await admin.register_shared_secret_admin(
                cfg.synapse_admin_username, cfg.synapse_admin_password
            )
            registered_now = True
            await admin.login()
        except SynapseApiError as reg_exc:
            if reg_exc.errcode in ("M_USER_IN_USE", "M_UNKNOWN"):
                raise RuntimeError(
                    "admin account exists but login failed; fix SYNAPSE_ADMIN_PASSWORD "
                    "(error code: " + reg_exc.errcode + ")"
                ) from reg_exc
            raise

    # ---- 名额校准（管理员占第 1 席；漂移自愈）----
    synapse_count = await admin.count_active_users()
    async with db.acquire() as conn:
        async with conn.transaction():
            seats = await conn.fetchval(
                "SELECT seats_used FROM quota_counters WHERE id = 1 FOR UPDATE"
            )
            target = max(seats or 0, synapse_count, 1)
            if target != seats:
                await conn.execute(
                    "UPDATE quota_counters SET seats_used = $1 WHERE id = 1", target
                )
            if registered_now:
                await conn.execute(
                    "INSERT INTO audit_events (event_type, code_id, result) VALUES ('bootstrap.admin_created', NULL, 'ok')"
                )

    # ---- 固定加密房间 ----
    rooms = await db.fetch("SELECT room_id, kind FROM rooms")
    if rooms:
        logger.info("bootstrap: %d fixed room(s) already present", len(rooms))
    else:
        group_room = await admin.create_encrypted_room("Aether 群聊")
        private_room = await admin.create_encrypted_room("Aether 私聊")
        async with db.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO rooms (room_id, kind) VALUES ($1, 'group'), ($2, 'private')",
                    group_room,
                    private_room,
                )
                await conn.execute(
                    "INSERT INTO audit_events (event_type, code_id, result) VALUES ('bootstrap.room_created', NULL, 'ok')"
                )
        logger.info("bootstrap: fixed encrypted rooms created")

    logger.info(
        "bootstrap complete (seats_used=%d, synapse_count=%d, max_members=%d)",
        target,
        synapse_count,
        cfg.max_members,
    )


class RoomInviteService:
    """轮询新用户并为每个固定房间幂等生成/执行 invite 任务。"""

    def __init__(self, db: Database, cfg: Settings, admin: MatrixAdminClient) -> None:
        self._db = db
        self._cfg = cfg
        self._admin = admin
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="room-invite-poller")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - 轮询永不退出
                logger.error("invite poll cycle failed: %s", type(exc).__name__)
            await asyncio.sleep(self._cfg.poll_seconds)

    async def poll_once(self) -> None:
        """一个轮询周期：发现新用户建任务 → 处理 PENDING 任务（含退避重试）。"""
        users: list[dict[str, Any]] = await self._admin.list_users()

        async with self._db.acquire() as conn:
            known = {
                rec["user_id"]
                for rec in await conn.fetch("SELECT DISTINCT user_id FROM room_invite_jobs")
            }
            rooms = await conn.fetch("SELECT room_id FROM rooms")

            admin_mxid = self._admin.user_id or ""
            fresh_users = [
                u for u in users
                if not u.get("admin")
                and u.get("name") != admin_mxid
                and not u.get("user_type")  # 排除 bot/support 等特殊账号
                and u.get("name") not in known
            ]
            for user in fresh_users:
                for room in rooms:
                    await conn.execute(
                        """
                        INSERT INTO room_invite_jobs (user_id, room_id)
                        VALUES ($1, $2) ON CONFLICT (user_id, room_id) DO NOTHING
                        """,
                        user["name"],
                        room["room_id"],
                    )
            if fresh_users:
                logger.info(
                    "invite jobs created for %d new user(s)", len(fresh_users)
                )

        # ---- 处理 PENDING 任务 ----
        jobs = await self._db.fetch(
            """
            SELECT id, user_id, room_id, attempts, last_attempt_at
            FROM room_invite_jobs WHERE status = 'PENDING' ORDER BY id
            """
        )
        now = datetime.now(timezone.utc)
        for job in jobs:
            if job["attempts"] > 0 and job["last_attempt_at"] is not None:
                backoff = min(
                    BACKOFF_BASE_SECONDS * (2 ** (job["attempts"] - 1)),
                    BACKOFF_CAP_SECONDS,
                )
                if now - job["last_attempt_at"] < timedelta(seconds=backoff):
                    continue  # 退避窗口内，跳过本轮
            await self._process_job(job)

    async def _process_job(self, job: asyncpg.Record) -> None:
        job_id: int = job["id"]
        try:
            await self._admin.invite_to_room(job["room_id"], job["user_id"])
            await self._finish_job(job_id, "DONE", None, "invite.done")
            return
        except SynapseApiError as exc:
            errcode = exc.errcode
            message = exc.message or ""
            # 「已是成员/已被邀请」语义 → 等价成功（幂等）
            if errcode == "M_FORBIDDEN" and "already" in message.lower():
                await self._finish_job(job_id, "DONE", None, "invite.done")
                return
        except Exception as exc:  # noqa: BLE001 - 网络等未知失败统一按可重试处理
            logger.error("invite job %d unexpected failure: %s", job_id, type(exc).__name__)
            errcode = "M_UNREACHABLE"

        attempts = job["attempts"] + 1
        if attempts >= INVITE_MAX_ATTEMPTS:
            await self._finish_job(job_id, "FAILED", errcode, "invite.failed", attempts)
            logger.error("invite job %d failed permanently (code=%s)", job_id, errcode)
        else:
            await self._finish_job(job_id, "PENDING", errcode, "invite.retry", attempts)
            logger.warning(
                "invite job %d attempt %d failed (code=%s); backing off",
                job_id,
                attempts,
                errcode,
            )

    async def _finish_job(
        self,
        job_id: int,
        status: str,
        error_code: str | None,
        audit_event: str,
        attempts: int | None = None,
    ) -> None:
        async with self._db.acquire() as conn:
            async with conn.transaction():
                if attempts is None:
                    await conn.execute(
                        "UPDATE room_invite_jobs SET status = $2, last_attempt_at = now(), last_error_code = $3 WHERE id = $1",
                        job_id,
                        status,
                        error_code,
                    )
                else:
                    await conn.execute(
                        """
                        UPDATE room_invite_jobs
                        SET status = $2, attempts = $3, last_attempt_at = now(), last_error_code = $4
                        WHERE id = $1
                        """,
                        job_id,
                        status,
                        attempts,
                        error_code,
                    )
                result = "ok" if status == "DONE" else (error_code or "error")
                await conn.execute(
                    "INSERT INTO audit_events (event_type, code_id, result) VALUES ($1, NULL, $2)",
                    audit_event,
                    result,
                )
