"""名额事务锁与口径校准（P0-5 / PRD Q4）。

口径：自维护 seats_used 为事务权威 + Synapse 实时用户数校准（取 max）。
锁序恒定：先 invite_codes 行锁，后 quota_counters(单行) 锁 —— 无死锁环。
"""
from __future__ import annotations

import logging

import asyncpg

from app.services.synapse_admin import MatrixAdminClient, SynapseApiError

logger = logging.getLogger(__name__)


class QuotaExhausted(Exception):
    """名额已满（调用方应 ROLLBACK 并返回 409 quota_exhausted，码不消耗）。"""


async def reserve_seat(conn: asyncpg.Connection, admin: MatrixAdminClient) -> int:
    """在调用方事务内：锁 quota 行 → 校准 → 判定 → 预占一席。

    必须在已持有 invite_codes 行锁的事务中调用（锁序约束）。
    Returns:
        预占后的 seats_used。
    Raises:
        QuotaExhausted: effective >= max_members（事务将由调用方回滚）。
        SynapseApiError: Synapse 计数不可得（事务回滚，返回 internal_error）。
    """
    row = await conn.fetchrow(
        "SELECT max_members, seats_used FROM quota_counters WHERE id = 1 FOR UPDATE"
    )
    if row is None:
        # 自举保证存在；防御性兜底
        raise QuotaExhausted("quota row missing (bootstrap not run)")

    synapse_count = await admin.count_active_users()
    seats = max(row["seats_used"], synapse_count)
    if synapse_count > row["seats_used"]:
        # 漂移自愈：令牌已发未落库 / 持 shared secret 绕过发码直接建号
        logger.warning(
            "quota drift detected: seats_used=%d synapse_count=%d -> calibrated",
            row["seats_used"],
            synapse_count,
        )
        await conn.execute(
            "UPDATE quota_counters SET seats_used = $1 WHERE id = 1", synapse_count
        )

    if seats >= row["max_members"]:
        raise QuotaExhausted(
            f"effective={seats} max={row['max_members']}"
        )

    new_seats = seats + 1
    await conn.execute("UPDATE quota_counters SET seats_used = $1 WHERE id = 1", new_seats)
    return new_seats


async def get_quota(db, admin: MatrixAdminClient) -> dict[str, int]:
    """管理端点视图：本地计数 + Synapse 实时计数 + effective（只读，不改库）。"""
    row = await db.fetchrow("SELECT max_members, seats_used FROM quota_counters WHERE id = 1")
    if row is None:
        return {"max_members": 0, "seats_used": 0, "synapse_count": 0, "effective": 0}
    try:
        synapse_count = await admin.count_active_users()
    except SynapseApiError:
        synapse_count = -1  # Synapse 暂不可达：视图降级，不误报
    effective = max(row["seats_used"], synapse_count) if synapse_count >= 0 else row["seats_used"]
    return {
        "max_members": row["max_members"],
        "seats_used": row["seats_used"],
        "synapse_count": synapse_count,
        "effective": effective,
    }
