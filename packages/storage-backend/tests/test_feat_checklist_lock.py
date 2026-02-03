from __future__ import annotations

from typing import Any
from copy import deepcopy
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import get_current_user, get_mongodb, get_permission_service
from src.routes import feat


class FakePermissionService:
    async def check_permission(self, user_id: str, project_id: str, action: str) -> bool:
        return True


class UpdateResult:
    def __init__(self, matched_count: int, modified_count: int):
        self.matched_count = matched_count
        self.modified_count = modified_count


class DotCollection:
    def __init__(self, items: list[dict[str, Any]] | None = None):
        self.items = items or []

    def _lookup(self, item: dict[str, Any], key: str) -> Any:
        if "." not in key:
            return item.get(key)
        current: Any = item
        for part in key.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current

    def _match(self, item: dict[str, Any], query: dict[str, Any]) -> bool:
        for key, value in query.items():
            if item.get(key) == value:
                continue
            if self._lookup(item, key) == value:
                continue
            return False
        return True

    async def find_one(self, query: dict[str, Any], _projection: dict[str, int] | None = None):
        for item in self.items:
            if self._match(item, query):
                return deepcopy(item)
        return None

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False):
        payload = update.get("$set", {})
        for item in self.items:
            if self._match(item, query):
                item.update(payload)
                return UpdateResult(matched_count=1, modified_count=1)
        if upsert:
            self.items.append({**query, **payload})
            return UpdateResult(matched_count=0, modified_count=0)
        return UpdateResult(matched_count=0, modified_count=0)

    async def distinct(self, field: str, _query: dict[str, Any] | None = None) -> list[Any]:
        seen: set[Any] = set()
        values: list[Any] = []
        for item in self.items:
            value = item.get(field)
            if value in seen:
                continue
            seen.add(value)
            values.append(value)
        return values


class FakeMongoAdapter:
    def __init__(self, feats: list[dict[str, Any]]):
        self.feats = DotCollection(feats)
        self.entities = DotCollection([])


def create_app(fake_db: FakeMongoAdapter) -> FastAPI:
    app = FastAPI()
    app.include_router(feat.router, prefix="/feat")

    async def get_mongo():
        return fake_db

    feat.get_mongodb_adapter = get_mongo
    app.dependency_overrides[get_mongodb] = get_mongo
    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"
    return app


def test_checklist_expected_version_conflict_on_generate():
    feats = [
        {
            "id": "feat-1",
            "checklist": {"version": "v1", "items": []},
        }
    ]
    client = TestClient(create_app(FakeMongoAdapter(feats)))

    response = client.post(
        "/feat/checklist",
        json={
            "action": "generate",
            "feat_id": "feat-1",
            "expected_version": "v0",
            "items": [],
        },
    )

    payload = response.json()
    assert payload["success"] is False
    assert payload["error"] == "CHECKLIST_CONFLICT"
    assert payload["current_version"] == "v1"


def test_checklist_patch_updates_version_with_expected_version():
    feats = [
        {
            "id": "feat-1",
            "checklist": {
                "version": "v1",
                "items": [{"id": "task-1", "title": "t", "status": "pending"}],
            },
        }
    ]
    client = TestClient(create_app(FakeMongoAdapter(feats)))

    response = client.post(
        "/feat/checklist",
        json={
            "action": "patch",
            "feat_id": "feat-1",
            "expected_version": "v1",
            "patches": [{"task_id": "task-1", "updates": {"status": "completed"}}],
        },
    )

    payload = response.json()
    assert payload["success"] is True
    updated = payload["updated_checklist"]
    assert updated["version"] != "v1"
    assert updated["items"][0]["status"] == "completed"


def test_checklist_patch_conflict_with_stale_version():
    feats = [
        {
            "id": "feat-1",
            "checklist": {
                "version": "v2",
                "items": [{"id": "task-1", "title": "t", "status": "pending"}],
            },
        }
    ]
    client = TestClient(create_app(FakeMongoAdapter(feats)))

    response = client.post(
        "/feat/checklist",
        json={
            "action": "patch",
            "feat_id": "feat-1",
            "expected_version": "v1",
            "patches": [{"task_id": "task-1", "updates": {"status": "completed"}}],
        },
    )

    payload = response.json()
    assert payload["success"] is False
    assert payload["error"] == "CHECKLIST_CONFLICT"
    assert payload["current_version"] == "v2"
    assert payload["conflicting_tasks"] == ["task-1"]
