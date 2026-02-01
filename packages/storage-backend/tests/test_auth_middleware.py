from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from src.middleware.auth import AuthMiddleware


@pytest.mark.asyncio
async def test_auth_middleware_uses_header():
    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get("/who")
    async def who(request: Request):
        return {"user_id": request.state.user_id}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/who", headers={"X-User-ID": "alice"})

    assert response.json() == {"user_id": "alice"}


@pytest.mark.asyncio
async def test_auth_middleware_defaults_to_anonymous():
    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get("/who")
    async def who(request: Request):
        return {"user_id": request.state.user_id}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/who")

    assert response.json() == {"user_id": "anonymous"}
