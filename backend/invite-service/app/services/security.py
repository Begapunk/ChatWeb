"""安全原语：邀请码生成/哈希、常量时间比较（P0-3）。

日志红线：本模块任何函数都不产生可被日志记录的敏感输出；调用方负责。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid

TAG_LENGTH = 10  # 码前段长度（hex）


def generate_code() -> tuple[str, str, str]:
    """生成一枚新邀请码。

    Returns:
        (code, tag, salt_b64)：明文码 `{tag}-{secret}`（仅生成响应中出现一次）、
        定位用 tag、逐码独立 salt（base64 of 16 bytes）。
        code_hash 由调用方经 hash_code 计算（需要 pepper）。
    """
    tag = uuid.uuid4().hex[:TAG_LENGTH]
    secret = secrets.token_urlsafe(16)  # 22 字符 base64url，128bit 熵
    salt = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
    return f"{tag}-{secret}", tag, salt


def hash_code(code: str, salt_b64: str, pepper: str) -> str:
    """code_hash = hex sha256(salt ‖ pepper ‖ code)。

    与 DESIGN-M1 §3.2 字面公式的差异（多 pepper）记录于 DESIGN-M1-CHECKS.md 偏差 3：
    pepper 参与哈希使仅泄露 DB 行也无法离线校验/爆破码。
    """
    salt_bytes = base64.b64decode(salt_b64)
    digest = hashlib.sha256(salt_bytes + pepper.encode("utf-8") + code.encode("utf-8"))
    return digest.hexdigest()


def codes_match(expected_hash: str, provided_hash: str) -> bool:
    """码哈希常量时间比较。"""
    return hmac.compare_digest(expected_hash, provided_hash)


def admin_key_matches(provided: str, expected: str) -> bool:
    """管理密钥校验：先 sha256 归一长度，再常量时间比较（不泄露长度信息）。"""
    provided_digest = hashlib.sha256(provided.encode("utf-8")).hexdigest()
    expected_digest = hashlib.sha256(expected.encode("utf-8")).hexdigest()
    return hmac.compare_digest(provided_digest, expected_digest)
