"""管理端点（X-Admin-Key；不经 Caddy，仅容器内网/宿主回环可达，P0-7 / PRD Q1(b)）。

安全：常量时间密钥比较（sha256 归一 + hmac.compare_digest）；
失败统一 401 {"error":"unauthorized"}，审计仅记次数。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import Settings
from app.services import security
from app.services.invite import InviteError
from app.services.quota import get_quota

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_TTL_HOURS = 24 * 365
MAX_ATTEMPTS_LIMIT = 100
MAX_NOTE_LENGTH = 200


class AdminAuthError(Exception):
    """X-Admin-Key 校验失败（main.py 注册统一 401 响应）。"""


async def require_admin(request: Request) -> None:
    """校验 X-Admin-Key（从 request.headers 读取，常量时间比较）。"""
    x_admin_key = request.headers.get("X-Admin-Key")
    cfg: Settings = request.app.state.cfg
    if not x_admin_key or not security.admin_key_matches(x_admin_key, cfg.admin_api_key):
        # 审计仅记事件，不含任何密钥材料
        try:
            await request.app.state.db.execute(
                "INSERT INTO audit_events (event_type, code_id, result) VALUES ('admin.unauthorized', NULL, 'unauthorized')"
            )
        except Exception:  # noqa: BLE001 - 审计失败不影响拒绝
            logger.error("failed to record unauthorized admin attempt")
        raise AdminAuthError()


@router.post("/admin/v1/codes", status_code=201, dependencies=[])
async def create_code(request: Request, body: dict) -> JSONResponse:
    """生成邀请码：明文码仅在本响应出现一次（PRD Q5：裸码 + 文档 URL 模板）。"""
    await require_admin(request)
    cfg: Settings = request.app.state.cfg
    db = request.app.state.db

    ttl_hours = body.get("ttl_hours")
    max_attempts = body.get("max_attempts")
    note = body.get("note")

    if ttl_hours is not None and not (isinstance(ttl_hours, int) and 1 <= ttl_hours <= MAX_TTL_HOURS):
        raise InviteError(422, "invalid_param", "ttl_hours 必须为 1–%d 的整数" % MAX_TTL_HOURS)
    if max_attempts is not None and not (isinstance(max_attempts, int) and 1 <= max_attempts <= MAX_ATTEMPTS_LIMIT):
        raise InviteError(422, "invalid_param", "max_attempts 必须为 1–%d 的整数" % MAX_ATTEMPTS_LIMIT)
    if note is not None and (not isinstance(note, str) or len(note) > MAX_NOTE_LENGTH):
        raise InviteError(422, "invalid_param", "note 必须为不超过 %d 字符的文本" % MAX_NOTE_LENGTH)

    ttl_seconds = ttl_hours * 3600 if ttl_hours is not None else cfg.code_ttl_seconds
    final_max_attempts = max_attempts if max_attempts is not None else cfg.max_attempts
    metadata = json.dumps({"note": (note or "").strip(), "created_by": "admin-api"}, ensure_ascii=False)

    code, tag, salt = security.generate_code()
    code_hash = security.hash_code(code, salt, cfg.hash_pepper)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)

    async with db.acquire() as conn:
        async with conn.transaction():
            code_id = await conn.fetchval(
                """
                INSERT INTO invite_codes (tag, salt, code_hash, expires_at, max_attempts, metadata)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                RETURNING id
                """,
                tag, salt, code_hash, expires_at, final_max_attempts, metadata,
            )
            await conn.execute(
                "INSERT INTO audit_events (event_type, code_id, result) VALUES ('code.created', $1, 'ok')",
                code_id,
            )

    return JSONResponse(
        status_code=201,
        content={
            "code_id": str(code_id),
            "code": code,  # 明文仅此一次
            "expires_at": expires_at.isoformat().replace("+00:00", "Z"),
            "max_attempts": final_max_attempts,
        },
    )


@router.get("/admin/v1/codes/{code_id}")
async def get_code(code_id: UUID, request: Request) -> JSONResponse:
    """码详情：无明文（任何查询响应都不含明文码）。"""
    await require_admin(request)
    db = request.app.state.db
    row = await db.fetchrow(
        """
        SELECT id, tag, status, attempts, max_attempts, expires_at, created_at, used_at, metadata
        FROM invite_codes WHERE id = $1
        """,
        code_id,
    )
    if row is None:
        raise InviteError(404, "not_found", "邀请码不存在")
    return JSONResponse(
        status_code=200,
        content={
            "code_id": str(row["id"]),
            "tag": row["tag"],
            "status": row["status"],
            "attempts": row["attempts"],
            "max_attempts": row["max_attempts"],
            "expires_at": row["expires_at"].isoformat().replace("+00:00", "Z"),
            "created_at": row["created_at"].isoformat().replace("+00:00", "Z"),
            "used_at": row["used_at"].isoformat().replace("+00:00", "Z") if row["used_at"] else None,
            "metadata": row["metadata"],
        },
    )


@router.post("/admin/v1/codes/{code_id}/revoke")
async def revoke_code(code_id: UUID, request: Request) -> JSONResponse:
    """作废邀请码（P1-1）：仅 UNUSED 可作废 → REVOKED。"""
    await require_admin(request)
    db = request.app.state.db
    result = await db.execute(
        "UPDATE invite_codes SET status = 'REVOKED' WHERE id = $1 AND status = 'UNUSED'",
        code_id,
    )
    if result.split()[-1] == "1":
        async with db.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO audit_events (event_type, code_id, result) VALUES ('code.revoked', $1, 'ok')",
                    code_id,
                )
        return JSONResponse(status_code=200, content={"ok": True})
    exists = await db.fetchval("SELECT 1 FROM invite_codes WHERE id = $1", code_id)
    if exists is None:
        raise InviteError(404, "not_found", "邀请码不存在")
    raise InviteError(409, "invalid_state", "仅未使用（UNUSED）的邀请码可作废")


@router.get("/admin/v1/quota")
async def quota(request: Request) -> JSONResponse:
    await require_admin(request)
    state = request.app.state
    return JSONResponse(status_code=200, content=await get_quota(state.db, state.admin))


@router.get("/admin/v1/rooms")
async def rooms(request: Request) -> JSONResponse:
    await require_admin(request)
    rows = await request.app.state.db.fetch("SELECT room_id, kind FROM rooms ORDER BY kind")
    return JSONResponse(
        status_code=200,
        content={"rooms": [{"room_id": r["room_id"], "kind": r["kind"]} for r in rows]},
    )
