"""席位统计（**不再做名额上限判定**）。

用户决策（2026-11-14）：彻底移除「四人名额上限」。邀请码是唯一准入控制
（管理员手动发码、一次性、仅存 salt+pepper 哈希、过期、尝试次数），但不再限制
总注册人数。本模块只维护 quota_counters.seats_used 作为**可观测统计**。

- 锁序恒定：先 invite_codes 行锁，后 quota_counters(单行) 锁 —— 无死锁环；
- 口径：effective = max(自维护 seats_used, Synapse 非停用用户数)，仅统计用；
- 表 max_members 列保留（兼容已有数据库、避免破坏性迁移），但**代码不再读取，
  不参与任何准入判定**；管理端点返回 max_members=null / unlimited=true。
"""
from __future__ import annotations

import logging

import asyncpg

from app.services.synapse_admin import MatrixAdminClient, SynapseApiError

logger = logging.getLogger(__name__)


async def record_seat_usage(conn: asyncpg.Connection, admin: MatrixAdminClient) -> int:
    """在调用方事务内：锁 quota 行 → 校准统计 → 记一次成功发令牌。

    必须在已持有 invite_codes 行锁的事务中调用（锁序约束）。
    **不再做上限判定、不再抛 QuotaExhausted**（名额限制已彻底移除）。

    Returns:
        更新后的 seats_used（纯统计值）。
    Raises:
        SynapseApiError: Synapse 计数不可得（事务回滚，返回 internal_error）。
    """
    row = await conn.fetchrow(
        "SELECT seats_used FROM quota_counters WHERE id = 1 FOR UPDATE"
    )
    if row is None:
        # 自举保证存在；防御性兜底（max_members 仅为兼容旧列，不参与判定）
        await conn.execute(
            "INSERT INTO quota_counters (id, max_members, seats_used) "
            "VALUES (1, 4, 1) ON CONFLICT (id) DO NOTHING"
        )
        return 1

    synapse_count = await admin.count_active_users()
    seats = max(row["seats_used"], synapse_count)
    if synapse_count > row["seats_used"]:
        # 漂移自愈（仅统计口径）：令牌已发未落库 / 持 shared secret 直接建号
        logger.warning(
            "seat stats drift: seats_used=%d synapse_count=%d -> calibrated (stat only)",
            row["seats_used"],
            synapse_count,
        )
    new_seats = seats + 1
    await conn.execute("UPDATE quota_counters SET seats_used = $1 WHERE id = 1", new_seats)
    return new_seats


async def get_quota(db, admin: MatrixAdminClient) -> dict:
    """管理端点视图：纯统计；unlimited=true 明确表示无名额上限（只读，不改库）。"""
    row = await db.fetchrow("SELECT seats_used FROM quota_counters WHERE id = 1")
    if row is None:
        return {
            "unlimited": True, "max_members": None,
            "seats_used": 0, "synapse_count": 0, "effective": 0,
        }
    try:
        synapse_count = await admin.count_active_users()
    except SynapseApiError:
        synapse_count = -1  # Synapse 暂不可达：视图降级，不误报
    effective = max(row["seats_used"], synapse_count) if synapse_count >= 0 else row["seats_used"]
    return {
        "unlimited": True,
        "max_members": None,
        "seats_used": row["seats_used"],
        "synapse_count": synapse_count,
        "effective": effective,
    }
