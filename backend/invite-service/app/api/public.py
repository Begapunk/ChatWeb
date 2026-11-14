"""公共端点（经 Caddy /invite-api/* 暴露）：verify + 纯文本状态（P2-2）。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.services.invite import InviteError, verify_code

logger = logging.getLogger(__name__)

router = APIRouter()


class VerifyRequest(BaseModel):
    code: str = Field(min_length=1, max_length=128)


@router.post("/invite-api/v1/verify")
async def verify(body: VerifyRequest, request: Request) -> JSONResponse:
    state = request.app.state
    try:
        result = await verify_code(state.db, state.cfg, state.admin, body.code)
    except InviteError as exc:
        # 业务失败：不记 INFO 以上日志（避免高频探测刷屏）；审计已在服务层落库
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.code, "message": exc.message},
        )
    return JSONResponse(
        status_code=200,
        content={
            "registration_token": result.registration_token,
            "token_expires_at": result.token_expires_at,
        },
    )


@router.get("/invite-api/v1/status")
async def status() -> PlainTextResponse:
    """P2-2 健康面板：纯文本一行，不泄露内部信息。"""
    return PlainTextResponse("invite-service: ok\n", media_type="text/plain")
