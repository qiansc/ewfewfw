from __future__ import annotations

from types import SimpleNamespace
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from src.dependencies import get_permission_service, init_services, reset_services
from src.middleware.auth import AuthMiddleware
from src.models.permission import Role
from src.routes import permissions
from src.services.permission import PermissionService


class FakeCursor:
    def __init__(self, items: list[dict]):
        self._items = items

    async def to_list(self, length: int | None = None) -> list[dict]:
        return list(self._items)


class FakeCollection:
    def __init__(self, items: list[dict] | None = None):
        self.items = items or []

    async def find_one(self, query: dict) -> dict | None:
        for item in self.items:
            if all(item.get(key) == value for key, value in query.items()):
                return dict(item)
        return None

    async def count_documents(self, query: dict) -> int:
        if not query:
            return len(self.items)
        total = 0
        for item in self.items:
            if all(item.get(key) == value for key, value in query.items()):
                total += 1
        return total

    def find(self, query: dict) -> FakeCursor:
        filtered = []
        for item in self.items:
            if all(item.get(key) == value for key, value in query.items()):
                filtered.append(dict(item))
        return FakeCursor(filtered)

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        payload = update.get("$set", {})
        for item in self.items:
            if all(item.get(key) == value for key, value in query.items()):
                item.update(payload)
                return SimpleNamespace(upserted_id=None, modified_count=1)
        if upsert:
            self.items.append({**query, **payload})
            return SimpleNamespace(upserted_id="fake", modified_count=0)
        return SimpleNamespace(upserted_id=None, modified_count=0)

    async def delete_one(self, query: dict):
        deleted = 0
        remaining = []
        for item in self.items:
            if all(item.get(key) == value for key, value in query.items()):
                deleted += 1
            else:
                remaining.append(item)
        self.items = remaining
        return SimpleNamespace(deleted_count=deleted)


class FakeDB:
    def __init__(self, collection: FakeCollection):
        self.collection = collection

    def __getitem__(self, _name: str) -> FakeCollection:
        return self.collection


class FakeMongoDBAdapter:
    def __init__(self, collection: FakeCollection):
        self.db = FakeDB(collection)


@pytest.mark.asyncio
async def test_permission_endpoints_grant_list_check_revoke():
    collection = FakeCollection()
    init_services(FakeMongoDBAdapter(collection))

    try:
        service = get_permission_service()
        assert isinstance(service, PermissionService)
        await service.grant_permission("demo", "admin", Role.ADMIN, "system")

        app = FastAPI()
        app.add_middleware(AuthMiddleware)
        app.include_router(permissions.router, prefix="/permissions")

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/permissions/",
                json={"project_id": "demo", "user_id": "bob", "role": "writer"},
                headers={"X-User-ID": "admin"},
            )
            assert response.status_code == 200
            assert response.json()["success"] is True

            response = await client.get("/permissions/demo", headers={"X-User-ID": "admin"})
            payload = response.json()
            assert len(payload["permissions"]) == 2

            response = await client.post(
                "/permissions/check",
                json={"project_id": "demo", "user_id": "bob", "action": "write"},
                headers={"X-User-ID": "bob"},
            )
            assert response.json()["allowed"] is True

            response = await client.delete(
                "/permissions/",
                params={"project_id": "demo", "user_id": "bob"},
                headers={"X-User-ID": "admin"},
            )
            assert response.json()["removed"] is True
    finally:
        reset_services()
