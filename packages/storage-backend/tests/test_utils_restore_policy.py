from __future__ import annotations

from typing import Any
from pathlib import Path
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import get_current_user, get_permission_service
from src.routes import utils
from src.utils.hash import compute_content_hash


class FakePermissionsCollection:
    async def count_documents(self, _query: dict) -> int:
        return 0


class FakePermissionService:
    def __init__(self) -> None:
        self.permissions = FakePermissionsCollection()

    async def check_permission(self, _user_id: str, _project_id: str, _action: str) -> bool:
        return True


class FakeNeo4jAdapter:
    async def save_relation(self, _relation: dict[str, Any]) -> None:
        return None


class FakeFeatCollection:
    async def update_one(self, _query: dict[str, Any], _update: dict[str, Any], upsert: bool = False):
        return {"upserted": upsert}


class FakeMongoAdapter:
    def __init__(self, existing: dict[str, Any] | None = None):
        self.entities: dict[tuple[str, str | None, str | None], dict[str, Any]] = {}
        if existing:
            key = (existing["id"], existing.get("source_project"), existing.get("proposal_id"))
            self.entities[key] = dict(existing)
        self.saved: list[dict[str, Any]] = []
        self.saved_relations: list[dict[str, Any]] = []
        self.feats = FakeFeatCollection()

    async def get_entity(
        self, entity_id: str, source_project: str | None, proposal_id: str | None
    ) -> dict[str, Any] | None:
        return self.entities.get((entity_id, source_project, proposal_id))

    async def save_entity(self, entity: dict[str, Any]) -> dict[str, Any]:
        key = (entity["id"], entity.get("source_project"), entity.get("proposal_id"))
        self.entities[key] = dict(entity)
        self.saved.append(dict(entity))
        return {"id": entity["id"], "upserted": True}

    async def save_relations(self, relations: list[dict[str, Any]]) -> dict[str, int]:
        self.saved_relations.extend(relations)
        return {"inserted": len(relations), "modified": 0}


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(utils.router, prefix="/utils")
    return app


def write_backup_file(path: Path, entity: dict[str, Any]) -> None:
    payload = {
        "version": "0.3.0",
        "exported_at": "2024-01-01T00:00:00Z",
        "entities": [entity],
        "relations": [],
        "feats": [],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def build_entity(entity_id: str, updated_at: str, project_id: str = "demo") -> dict[str, Any]:
    data = {"id": entity_id, "name": f"Entity {entity_id}", "source_project": project_id}
    return {
        "id": entity_id,
        "type": "system",
        "source_project": project_id,
        "proposal_id": "",
        "data": data,
        "status": "published",
        "search_text": data["name"],
        "content_hash": compute_content_hash(data),
        "created_at": updated_at,
        "updated_at": updated_at,
    }


def test_restore_merge_skips_stale_entity(monkeypatch, tmp_path):
    existing = build_entity("sys-1", "2024-02-01T00:00:00Z")
    fake_db = FakeMongoAdapter(existing)

    async def get_mongo():
        return fake_db

    async def get_neo4j():
        return FakeNeo4jAdapter()

    monkeypatch.setattr(utils, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(utils, "get_neo4j_adapter", get_neo4j)

    app = create_app()
    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"

    incoming = build_entity("sys-1", "2024-01-01T00:00:00Z")
    backup_path = tmp_path / "backup.json"
    write_backup_file(backup_path, incoming)

    client = TestClient(app)
    response = client.post(
        "/utils/restore",
        json={
            "input": str(backup_path),
            "conflict_policy": "merge",
            "validate_checksums": True,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["conflicts"][0]["resolution"] == "skip"
    assert fake_db.saved == []


def test_restore_override_saves_entity(monkeypatch, tmp_path):
    existing = build_entity("sys-2", "2024-01-01T00:00:00Z")
    fake_db = FakeMongoAdapter(existing)

    async def get_mongo():
        return fake_db

    async def get_neo4j():
        return FakeNeo4jAdapter()

    monkeypatch.setattr(utils, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(utils, "get_neo4j_adapter", get_neo4j)

    app = create_app()
    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"

    incoming = build_entity("sys-2", "2024-03-01T00:00:00Z")
    backup_path = tmp_path / "backup.json"
    write_backup_file(backup_path, incoming)

    client = TestClient(app)
    response = client.post(
        "/utils/restore",
        json={"input": str(backup_path), "conflict_policy": "override"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert len(fake_db.saved) == 1


def test_restore_validate_checksums_rejects(monkeypatch, tmp_path):
    fake_db = FakeMongoAdapter()

    async def get_mongo():
        return fake_db

    async def get_neo4j():
        return FakeNeo4jAdapter()

    monkeypatch.setattr(utils, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(utils, "get_neo4j_adapter", get_neo4j)

    app = create_app()
    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"

    incoming = build_entity("sys-3", "2024-01-01T00:00:00Z")
    incoming["content_hash"] = "invalid"
    backup_path = tmp_path / "backup.json"
    write_backup_file(backup_path, incoming)

    client = TestClient(app)
    response = client.post(
        "/utils/restore",
        json={
            "input": str(backup_path),
            "conflict_policy": "override",
            "validate_checksums": True,
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "C4A-MIGRATE-002"
    assert fake_db.saved == []
