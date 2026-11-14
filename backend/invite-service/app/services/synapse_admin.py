"""Synapse Admin/Client API 封装（httpx async）。

已核事实（docs/DESIGN-M1-CHECKS.md §10.1/10.2/10.3/10.12）：
  - Admin API 鉴权：`Authorization: Bearer <access_token>`（管理员账号 token）
  - GET /_synapse/admin/v2/users?guests=false&deactivated=false → {users, next_token?, total}
  - POST /_synapse/admin/v1/registration_tokens/new {uses_allowed, expiry_time(ms)}
  - shared-secret 管理注册：GET nonce → HMAC-SHA1(nonce\\0user\\0pass\\0admin) → POST
日志红线：任何响应中的 access_token/注册令牌绝不入日志；SynapseApiError 的
字符串形式只含 status + errcode，不含 message（可能含敏感上下文）。
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_ENCRYPTION_ALGORITHM = "m.megolm.v1.aes-sha2"
_HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class SynapseApiError(Exception):
    """Synapse 返回的非 2xx 响应或网络失败。

    Attributes:
        status: HTTP 状态码（网络失败为 0）。
        errcode: Matrix 错误码（如 M_FORBIDDEN）；网络失败为 "M_UNREACHABLE"。
        message: 原始 message（仅内部判断用，不进日志/审计）。
    """

    def __init__(self, status: int, errcode: str, message: str = "") -> None:
        super().__init__(f"synapse error {status} {errcode}")
        self.status = status
        self.errcode = errcode
        self.message = message

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"synapse error {self.status} {self.errcode}"


class MatrixAdminClient:
    """以服务内管理员账号身份调用 Synapse。

    access_token 仅存内存；401/M_UNKNOWN_TOKEN 自动重登录一次。
    """

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        registration_shared_secret: str,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._username = username
        self._password = password
        self._shared_secret = registration_shared_secret
        self._http = httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
        self._access_token: str | None = None
        self.user_id: str | None = None  # 管理员 MXID（登录后可知）

    @property
    def username(self) -> str:
        return self._username

    async def aclose(self) -> None:
        await self._http.aclose()

    # ---- low-level ----

    def _headers(self, token: str | None) -> dict[str, str]:
        headers: dict[str, str] = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        token: str | None = None,
    ) -> httpx.Response:
        url = f"{self._base_url}{path}"
        try:
            response = await self._http.request(
                method,
                url,
                json=json_body,
                params=params,
                headers=self._headers(token),
            )
        except httpx.HTTPError as exc:
            raise SynapseApiError(0, "M_UNREACHABLE", type(exc).__name__) from exc
        return response

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> dict[str, Any]:
        if response.status_code >= 400:
            errcode = "M_UNKNOWN"
            message = ""
            try:
                body = response.json()
                errcode = str(body.get("errcode", errcode))
                message = str(body.get("error", ""))
            except ValueError:
                pass
            raise SynapseApiError(response.status_code, errcode, message)
        try:
            return response.json()
        except ValueError as exc:
            raise SynapseApiError(response.status_code, "M_NOT_JSON", "") from exc

    # ---- auth ----

    async def login(self) -> None:
        """m.login.password 换取 access_token（仅内存）。"""
        response = await self._request(
            "POST",
            "/_matrix/client/v3/login",
            json_body={
                "type": "m.login.password",
                "identifier": {"type": "m.id.user", "user": self._username},
                "password": self._password,
            },
        )
        body = self._raise_for_status(response)
        token = body.get("access_token")
        user_id = body.get("user_id")
        if not token or not user_id:
            raise SynapseApiError(response.status_code, "M_MISSING_TOKEN", "")
        self._access_token = token
        self.user_id = user_id

    async def _authed_request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        """带管理员 token 请求；401/M_UNKNOWN_TOKEN 时重登录一次再重试。"""
        if not self._access_token:
            await self.login()
        response = await self._request(method, path, token=self._access_token, **kwargs)
        if response.status_code == 401:
            await self.login()
            response = await self._request(method, path, token=self._access_token, **kwargs)
        return self._raise_for_status(response)

    # ---- shared-secret admin registration (bootstrap only, M0-verified flow) ----

    async def register_shared_secret_admin(self, username: str, password: str) -> dict[str, Any]:
        """用 registration_shared_secret 创建管理员（一次性自举；MAC 流程移植自 m0 实测代码）。"""
        nonce_response = await self._request("GET", "/_synapse/admin/v1/register")
        nonce_body = self._raise_for_status(nonce_response)
        nonce = nonce_body.get("nonce", "")
        mac = hmac.new(
            self._shared_secret.encode("utf-8"),
            f"{nonce}\0{username}\0{password}\0admin".encode("utf-8"),
            hashlib.sha1,
        ).hexdigest()
        response = await self._request(
            "POST",
            "/_synapse/admin/v1/register",
            json_body={"nonce": nonce, "username": username, "password": password, "admin": True, "mac": mac},
        )
        return self._raise_for_status(response)

    # ---- users (quota calibration & polling; §10.3 verified) ----

    async def list_users(self) -> list[dict[str, Any]]:
        """全量拉取非访客、非停用本地用户（≤4 人规模，单页足够；仍按 next_token 兜底分页）。"""
        users: list[dict[str, Any]] = []
        from_token: str | None = None
        while True:
            params: dict[str, Any] = {"guests": "false", "deactivated": "false", "limit": 100}
            if from_token is not None:
                params["from"] = from_token
            body = await self._authed_request("GET", "/_synapse/admin/v2/users", params=params)
            users.extend(body.get("users", []))
            from_token = body.get("next_token")
            if not from_token:
                return users

    async def count_active_users(self) -> int:
        """名额校准用：非访客、非停用用户总数（响应 total 字段，§10.3 官方示例核实）。"""
        body = await self._authed_request(
            "GET",
            "/_synapse/admin/v2/users",
            params={"guests": "false", "deactivated": "false", "limit": 1},
        )
        total = body.get("total")
        if not isinstance(total, int):
            raise SynapseApiError(200, "M_BAD_RESPONSE", "users endpoint missing total")
        return total

    # ---- registration tokens (P0-4; §10.2 verified) ----

    async def create_registration_token(self, uses_allowed: int, expiry_time_ms: int) -> dict[str, Any]:
        """发放注册令牌（uses_allowed=1 为一次性语义的第二道兜底，R2.2）。"""
        return await self._authed_request(
            "POST",
            "/_synapse/admin/v1/registration_tokens/new",
            json_body={"uses_allowed": uses_allowed, "expiry_time": expiry_time_ms},
        )

    # ---- rooms (bootstrap & invites; standard client API) ----

    async def create_encrypted_room(self, name: str) -> str:
        """创建固定加密房间：private + private_chat（join_rules=invite）+ Megolm 加密初始状态。"""
        body = await self._authed_request(
            "POST",
            "/_matrix/client/v3/createRoom",
            json_body={
                "name": name,
                "visibility": "private",
                "preset": "private_chat",
                "initial_state": [
                    {
                        "type": "m.room.encryption",
                        "state_key": "",
                        "content": {"algorithm": _ENCRYPTION_ALGORITHM},
                    }
                ],
            },
        )
        room_id = body.get("room_id")
        if not room_id:
            raise SynapseApiError(200, "M_BAD_RESPONSE", "createRoom missing room_id")
        return str(room_id)

    async def invite_to_room(self, room_id: str, user_id: str) -> None:
        """管理员账号向 user_id 发起房间邀请（幂等：重复邀请/已是成员按错误码判别）。"""
        await self._authed_request(
            "POST",
            f"/_matrix/client/v3/rooms/{room_id}/invite",
            json_body={"user_id": user_id},
        )

    @staticmethod
    def now_ms() -> int:
        return int(time.time() * 1000)
