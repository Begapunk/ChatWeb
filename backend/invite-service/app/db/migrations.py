"""简单版本表迁移 runner：按文件名序号执行 db/migrations/*.sql，每个迁移单事务。

设计决策（DESIGN-M1 §1.2）：不用 Alembic——表少、SQL 显式可评审、单人小服务。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

import asyncpg

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_NAME_RE = re.compile(r"^(\d+)_([a-z0-9_]+)\.sql$")


async def run_migrations(pool: asyncpg.Pool) -> None:
    """启动时按序执行未应用的迁移；已应用的跳过（幂等）。"""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version    integer PRIMARY KEY,
              name       text NOT NULL,
              applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {
            rec["version"]
            for rec in await conn.fetch("SELECT version FROM schema_migrations")
        }

    files: list[tuple[int, str, Path]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = _NAME_RE.match(path.name)
        if not match:
            raise RuntimeError(f"invalid migration filename: {path.name} (expected NNNN_name.sql)")
        files.append((int(match.group(1)), match.group(2), path))

    for version, name, path in files:
        if version in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
                    version,
                    name,
                )
        logger.info("migration applied: %04d_%s", version, name)
