"""asyncpg 连接池与参数化查询封装（裸驱动，无 ORM）。"""
from __future__ import annotations

import asyncpg
from typing import Any, Sequence


class Database:
    """薄封装：create_pool 基本参数（§10.11 已复核），统一 acquire/fetch/execute 入口。"""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: asyncpg.Pool | None = None

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("database pool not connected")
        return self._pool

    async def connect(self) -> None:
        if self._pool is not None:
            return
        self._pool = await asyncpg.create_pool(
            self._dsn,
            min_size=1,
            max_size=5,
            command_timeout=30,
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def acquire(self) -> asyncpg.pool.PoolAcquireContext:
        return self.pool.acquire()

    async def fetch(self, sql: str, *args: Any) -> list[asyncpg.Record]:
        async with self.pool.acquire() as conn:
            return await conn.fetch(sql, *args)

    async def fetchrow(self, sql: str, *args: Any) -> asyncpg.Record | None:
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(sql, *args)

    async def fetchval(self, sql: str, *args: Any) -> Any:
        async with self.pool.acquire() as conn:
            return await conn.fetchval(sql, *args)

    async def execute(self, sql: str, *args: Sequence[Any]) -> str:
        async with self.pool.acquire() as conn:
            return await conn.execute(sql, *args)
