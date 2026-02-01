from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        user_id = request.headers.get("X-User-ID")

        if not user_id:
            user_id = "anonymous"

        request.state.user_id = user_id
        response = await call_next(request)
        return response
