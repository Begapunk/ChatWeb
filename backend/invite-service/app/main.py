"""FastAPI 应用工厂 + lifespan（建池→迁移→自举→轮询任务）。

日志红线（铁律）：本服务任何日志/审计不含——邀请码明文、注册令牌、
access_token、管理密钥、密码。异常 traceback 由 uvicorn 输出，已确保
请求体不进入日志（access log 仅 method/path/status）。
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse

from app.api import admin as admin_api
from app.api import public as public_api
from app.api.admin import AdminAuthError
from app.config import Settings, load_settings
from app.db.migrations import run_migrations
from app.db.pool import Database
from app.services.invite import InviteError
from app.services.room_invite import RoomInviteService, ensure_bootstrap
from app.services.synapse_admin import MatrixAdminClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


def _error(code: str, message: str | None = None, status_code: int = 400) -> JSONResponse:
    content: dict[str, str] = {"error": code}
    if message:
        content["message"] = message
    return JSONResponse(status_code=status_code, content=content)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg: Settings = load_settings()
    db = Database(cfg.invite_db_url)
    await db.connect()

    app.state.cfg = cfg
    app.state.db = db

    # 迁移（版本表 runner，幂等）
    await run_migrations(db.pool)

    # 管理员客户端 + 自举（管理员/固定加密房间/名额行，幂等）
    admin_client = MatrixAdminClient(
        base_url=cfg.synapse_base_url,
        username=cfg.synapse_admin_username,
        password=cfg.synapse_admin_password,
        registration_shared_secret=cfg.registration_shared_secret,
    )
    app.state.admin = admin_client
    await ensure_bootstrap(db, cfg, admin_client)

    # 新用户轮询入房任务
    inviter = RoomInviteService(db, cfg, admin_client)
    inviter.start()
    app.state.inviter = inviter
    logger.info("invite-service started (poll=%ss, max_members=%d)", cfg.poll_seconds, cfg.max_members)

    try:
        yield
    finally:
        await inviter.stop()
        await admin_client.aclose()
        await db.close()
        logger.info("invite-service stopped")


def create_app() -> FastAPI:
    """应用工厂。文档端点（/docs 等）一律关闭：不对任何网络面暴露。"""
    app = FastAPI(
        title="aether-invite-service",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    # ---- 统一错误体 {"error": enum, "message"?: 人话} ----
    @app.exception_handler(InviteError)
    async def invite_error_handler(request: Request, exc: InviteError) -> JSONResponse:
        return _error(exc.code, exc.message or None, exc.status_code)

    @app.exception_handler(AdminAuthError)
    async def admin_auth_error_handler(request: Request, exc: AdminAuthError) -> JSONResponse:
        return _error("unauthorized", status_code=401)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error("invalid_param", "请求参数不合法", 422)

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        # 500 不含堆栈/SQL；细节只在服务日志
        logger.error("unhandled error on %s %s: %s", request.method, request.url.path, type(exc).__name__)
        return _error("internal_error", "服务内部错误", 500)

    app.include_router(public_api.router)
    app.include_router(admin_api.router)

    # ---- compose 健康检查（不鉴权、不泄内部信息）----
    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> PlainTextResponse:
        return PlainTextResponse("ok", media_type="text/plain")

    return app


app = create_app()
