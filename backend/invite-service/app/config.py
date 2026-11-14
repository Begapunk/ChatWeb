"""集中读取与启动期校验全部环境变量（缺失即 fail-fast）。

与根 .env.example / docker-compose.yml 的注入矩阵一一对应
（全局一致性审查项：.env.example ↔ config.py 变量一一对应）。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


class ConfigError(RuntimeError):
    """配置缺失/非法（启动期抛出，服务拒绝启动）。"""


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"missing required env: {name}")
    return value


def _int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 1_000_000) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"env {name} must be an integer, got {raw!r}") from exc
    if not (minimum <= value <= maximum):
        raise ConfigError(f"env {name} out of range [{minimum}, {maximum}]: {value}")
    return value


@dataclass(frozen=True)
class Settings:
    """邀请服务运行配置（全部来自环境变量）。"""

    invite_db_url: str = field(default_factory=lambda: _require("INVITE_DB_URL"))
    synapse_base_url: str = field(
        default_factory=lambda: os.environ.get("SYNAPSE_INTERNAL_URL", "http://synapse:8008").rstrip("/")
    )
    synapse_admin_username: str = field(default_factory=lambda: _require("SYNAPSE_ADMIN_USERNAME"))
    synapse_admin_password: str = field(default_factory=lambda: _require("SYNAPSE_ADMIN_PASSWORD"))
    registration_shared_secret: str = field(
        default_factory=lambda: _require("SYNAPSE_REGISTRATION_SHARED_SECRET")
    )
    admin_api_key: str = field(default_factory=lambda: _require("INVITE_ADMIN_API_KEY"))
    hash_pepper: str = field(default_factory=lambda: _require("INVITE_HASH_PEPPER"))
    max_members: int = field(default_factory=lambda: _int_env("AETHER_MAX_MEMBERS", 4))
    code_ttl_seconds: int = field(
        default_factory=lambda: _int_env("INVITE_CODE_TTL_SECONDS", 259200)
    )
    max_attempts: int = field(default_factory=lambda: _int_env("INVITE_MAX_ATTEMPTS", 5))
    token_ttl_minutes: int = field(default_factory=lambda: _int_env("INVITE_TOKEN_TTL_MINUTES", 60))
    poll_seconds: float = field(
        default_factory=lambda: _int_env("INVITE_POLL_SECONDS", 5, minimum=1, maximum=3600)
    )

    def __post_init__(self) -> None:
        if len(self.admin_api_key) < 32:
            raise ConfigError("INVITE_ADMIN_API_KEY must be at least 32 characters")
        if len(self.hash_pepper) < 32:
            raise ConfigError("INVITE_HASH_PEPPER must be at least 32 bytes")
        if not self.invite_db_url.startswith(("postgresql://", "postgres://")):
            raise ConfigError(
                "INVITE_DB_URL must be a plain postgresql:// DSN "
                "(no SQLAlchemy dialect prefixes such as postgresql+asyncpg://)"
            )


def load_settings() -> Settings:
    """构造 Settings；任何配置问题都会在服务启动时立即暴露。"""
    return Settings()
