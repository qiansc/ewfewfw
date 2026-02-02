from __future__ import annotations

from types import SimpleNamespace
import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from src.models.permission import Role
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
async def test_check_permission_roles():
    collection = FakeCollection(
        [
            {"project_id": "demo", "user_id": "alice", "role": "writer"},
            {"project_id": "demo", "user_id": "bob", "role": "reader"},
            {"project_id": "demo", "user_id": "carol", "role": "admin"},
        ]
    )
    service = PermissionService(FakeMongoDBAdapter(collection))

    assert await service.check_permission("alice", "demo", "read") is True
    assert await service.check_permission("alice", "demo", "write") is True
    assert await service.check_permission("alice", "demo", "approve") is False
    assert await service.check_permission("bob", "demo", "read") is True
    assert await service.check_permission("bob", "demo", "write") is False
    assert await service.check_permission("carol", "demo", "approve") is True
    assert await service.check_permission("nobody", "demo", "read") is False


@pytest.mark.asyncio
async def test_grant_and_revoke_permission():
    collection = FakeCollection(
        [
            {"project_id": "demo", "user_id": "bob", "role": "reader"},
        ]
    )
    service = PermissionService(FakeMongoDBAdapter(collection))

    created = await service.grant_permission("demo", "alice", Role.WRITER, "admin")
    assert created["project_id"] == "demo"
    assert created["user_id"] == "alice"

    assert await service.check_permission("alice", "demo", "write") is True
    assert await service.revoke_permission("demo", "alice") is True
    assert await service.check_permission("alice", "demo", "write") is False


@pytest.mark.asyncio
async def test_list_and_user_projects():
    collection = FakeCollection(
        [
            {"project_id": "demo", "user_id": "alice", "role": "writer"},
            {"project_id": "infra", "user_id": "alice", "role": "reader"},
        ]
    )
    service = PermissionService(FakeMongoDBAdapter(collection))

    permissions = await service.list_permissions("demo")
    assert len(permissions) == 1
    projects = await service.get_user_projects("alice")
    assert set(projects) == {"demo", "infra"}


@pytest.mark.asyncio
async def test_cross_project_publish_check():
    collection = FakeCollection(
        [
            {"project_id": "demo", "user_id": "alice", "role": "admin"},
            {"project_id": "infra", "user_id": "alice", "role": "writer"},
        ]
    )
    service = PermissionService(FakeMongoDBAdapter(collection))
    result = await service.check_cross_project_publish("alice", ["demo", "infra"])

    assert result["allowed"] is False
    assert result["missing"] == ["infra"]


@pytest.mark.asyncio
async def test_allow_project_without_permissions(monkeypatch):
    monkeypatch.setenv("C4A_PERMISSION_ALLOW_EMPTY", "true")
    collection = FakeCollection(
        [
            {"project_id": "demo", "user_id": "alice", "role": "admin"},
        ]
    )
    service = PermissionService(FakeMongoDBAdapter(collection))
    assert await service.check_permission("bob", "new-project", "write") is True


@pytest.mark.asyncio
async def test_disallow_project_without_permissions(monkeypatch):
    monkeypatch.setenv("C4A_PERMISSION_ALLOW_EMPTY", "false")
    collection = FakeCollection(
        [
            {"project_id": "demo", "user_id": "alice", "role": "admin"},
        ]
    )
    service = PermissionService(FakeMongoDBAdapter(collection))
    assert await service.check_permission("bob", "new-project", "write") is False
