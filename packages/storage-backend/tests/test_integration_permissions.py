from __future__ import annotations

from pathlib import Path
import json
import re
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import (
    get_current_user,
    get_mongodb,
    get_permission_service,
    get_user_visible_projects,
)
from src.routes import entities, relations, search, utils
from src.services import database as database_service


class FakeCursor:
    def __init__(self, items: list[dict[str, Any]]):
        self._items = items

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return list(self._items)


class FakeCollection:
    def __init__(self, items: list[dict[str, Any]] | None = None):
        self.items = items or []

    def _match(self, item: dict[str, Any], query: dict[str, Any]) -> bool:
        for key, value in query.items():
            if key == "$or":
                if not any(self._match(item, condition) for condition in value):
                    return False
                continue
            if isinstance(value, dict):
                if "$in" in value:
                    if item.get(key) not in value["$in"]:
                        return False
                    continue
                if "$regex" in value:
                    pattern = value["$regex"]
                    flags = re.I if value.get("$options") == "i" else 0
                    if not re.search(pattern, str(item.get(key, "")), flags=flags):
                        return False
                    continue
            if item.get(key) != value:
                return False
        return True

    def find(self, query: dict[str, Any], _projection: dict[str, int] | None = None) -> FakeCursor:
        items = [item for item in self.items if self._match(item, query)]
        return FakeCursor(items)

    async def find_one(self, query: dict[str, Any], _projection: dict[str, int] | None = None):
        for item in self.items:
            if self._match(item, query):
                return dict(item)
        return None

    async def insert_one(self, payload: dict[str, Any]):
        self.items.append(dict(payload))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False):
        payload = update.get("$set", {})
        for item in self.items:
            if self._match(item, query):
                item.update(payload)
                return {"upserted_id": None, "modified_count": 1}
        if upsert:
            self.items.append({**query, **payload})
            return {"upserted_id": "fake", "modified_count": 0}
        return {"upserted_id": None, "modified_count": 0}

    async def delete_one(self, query: dict[str, Any]):
        deleted = 0
        remaining = []
        for item in self.items:
            if self._match(item, query):
                deleted += 1
            else:
                remaining.append(item)
        self.items = remaining
        return {"deleted_count": deleted}

    async def count_documents(self, query: dict[str, Any]) -> int:
        return len([item for item in self.items if self._match(item, query)])


class FakeDB:
    def __init__(self, collections: dict[str, FakeCollection]):
        self._collections = collections

    def __getitem__(self, name: str) -> FakeCollection:
        return self._collections.setdefault(name, FakeCollection())


class FakeMongoAdapter:
    def __init__(self):
        self.entities = FakeCollection()
        self.relations = FakeCollection()
        self.feats = FakeCollection()
        self.db = FakeDB({"project_permissions": FakeCollection()})

    async def save_entity(self, entity: dict[str, Any]) -> dict[str, Any]:
        existing = await self.get_entity(
            entity["id"], entity.get("source_project"), entity.get("proposal_id")
        )
        if existing:
            await self.entities.update_one(
                {
                    "id": entity["id"],
                    "source_project": entity.get("source_project", ""),
                    "proposal_id": entity.get("proposal_id", ""),
                },
                {"$set": entity},
            )
            return {"id": entity["id"], "upserted": False}
        await self.entities.insert_one(entity)
        return {"id": entity["id"], "upserted": True}

    async def get_entity(
        self, entity_id: str, source_project: str | None, proposal_id: str | None
    ) -> dict[str, Any] | None:
        query: dict[str, Any] = {"id": entity_id}
        if source_project is not None:
            query["source_project"] = source_project
        if proposal_id is not None:
            query["proposal_id"] = proposal_id
        return await self.entities.find_one(query)

    async def list_entities(
        self, query: dict[str, Any], limit: int, offset: int
    ) -> list[dict[str, Any]]:
        items = await self.entities.find(query).to_list(length=None)
        return items[offset : offset + limit]

    async def count_entities(self, query: dict[str, Any]) -> int:
        return await self.entities.count_documents(query)

    async def delete_entity(
        self, entity_id: str, source_project: str | None, proposal_id: str | None
    ) -> int:
        query: dict[str, Any] = {"id": entity_id}
        if source_project is not None:
            query["source_project"] = source_project
        if proposal_id is not None:
            query["proposal_id"] = proposal_id
        result = await self.entities.delete_one(query)
        return result.get("deleted_count", 0)

    async def delete_relations_for_entity(self, entity_id: str, project_id: str | None) -> int:
        count = 0
        remaining = []
        for rel in self.relations.items:
            if rel.get("from_id") == entity_id or rel.get("to_id") == entity_id:
                count += 1
                continue
            remaining.append(rel)
        self.relations.items = remaining
        return count

    async def save_relation(self, relation: dict[str, Any]) -> dict[str, int]:
        for idx, item in enumerate(self.relations.items):
            if item.get("id") == relation.get("id"):
                self.relations.items[idx] = relation
                return {"inserted": 0, "modified": 1}
        self.relations.items.append(relation)
        return {"inserted": 1, "modified": 0}

    async def save_relations(self, relations: list[dict[str, Any]]) -> dict[str, int]:
        inserted = 0
        modified = 0
        for relation in relations:
            result = await self.save_relation(relation)
            inserted += result["inserted"]
            modified += result["modified"]
        return {"inserted": inserted, "modified": modified}


class AllowPermissionService:
    async def check_permission(self, _user_id: str, _project_id: str, _action: str) -> bool:
        return True

    async def get_user_projects(self, _user_id: str) -> list[str]:
        return ["demo"]


class DenyPermissionService:
    async def check_permission(self, _user_id: str, _project_id: str, _action: str) -> bool:
        return False

    async def get_user_projects(self, _user_id: str) -> list[str]:
        return []


class FakeNeo4jAdapter:
    async def save_relation(self, _relation: dict[str, Any]) -> None:
        return None


class FakeMilvusAdapter:
    async def upsert_vector(self, _vector_key: str, _vector: list[float]) -> None:
        return None

    async def delete_vector(self, _vector_key: str) -> None:
        return None


def create_app(monkeypatch, fake_db: FakeMongoAdapter):
    app = FastAPI()
    app.include_router(entities.router, prefix="/entities")
    app.include_router(relations.router, prefix="/relations")
    app.include_router(search.router, prefix="/search")
    app.include_router(utils.router, prefix="/utils")

    async def get_mongo():
        return fake_db

    async def get_neo4j():
        return FakeNeo4jAdapter()

    async def get_milvus():
        return FakeMilvusAdapter()

    monkeypatch.setattr(entities, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(entities, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(relations, "get_neo4j_adapter", get_neo4j)
    monkeypatch.setattr(utils, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(utils, "get_neo4j_adapter", get_neo4j)
    monkeypatch.setattr(utils, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(database_service, "get_mongodb_adapter", get_mongo)

    app.dependency_overrides[get_mongodb] = lambda: fake_db
    app.dependency_overrides[get_current_user] = lambda: "tester"
    app.dependency_overrides[get_permission_service] = lambda: AllowPermissionService()
    app.dependency_overrides[get_user_visible_projects] = lambda: ["demo"]

    return app


def test_read_entity_permission_denied(monkeypatch):
    fake_db = FakeMongoAdapter()
    fake_db.entities.items.append(
        {
            "id": "system-a",
            "type": "system",
            "source_project": "demo",
            "proposal_id": "",
            "data": {"id": "system-a"},
        }
    )
    app = create_app(monkeypatch, fake_db)
    app.dependency_overrides[get_permission_service] = lambda: DenyPermissionService()
    client = TestClient(app)

    response = client.post("/entities/read", json={"id": "system-a"})
    assert response.status_code == 403


def test_relations_save_permission_denied(monkeypatch):
    fake_db = FakeMongoAdapter()
    app = create_app(monkeypatch, fake_db)
    app.dependency_overrides[get_permission_service] = lambda: DenyPermissionService()
    client = TestClient(app)

    response = client.post(
        "/relations/save",
        json={
            "id": "rel-1",
            "from_project": "demo",
            "from_id": "a",
            "to_project": "demo",
            "to_id": "b",
            "rel_type": "DEPENDS_ON",
        },
    )
    assert response.status_code == 403


def test_search_permission_empty(monkeypatch):
    fake_db = FakeMongoAdapter()
    app = create_app(monkeypatch, fake_db)
    app.dependency_overrides[get_permission_service] = lambda: DenyPermissionService()
    app.dependency_overrides[get_user_visible_projects] = lambda: []
    client = TestClient(app)

    response = client.post("/search", json={"query": "System"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["search_mode"] == "permission"
    assert payload["items"] == []


def test_read_entity_include_relations(monkeypatch):
    fake_db = FakeMongoAdapter()
    fake_db.entities.items.append(
        {
            "id": "system-a",
            "type": "system",
            "source_project": "demo",
            "proposal_id": "",
            "data": {"id": "system-a"},
        }
    )
    fake_db.relations.items.append(
        {
            "id": "rel-1",
            "from_project": "demo",
            "from_id": "system-a",
            "to_project": "demo",
            "to_id": "container-b",
            "rel_type": "DEPENDS_ON",
        }
    )
    fake_db.relations.items.append(
        {
            "id": "rel-2",
            "from_project": "demo",
            "from_id": "system-a",
            "to_project": "demo",
            "to_id": "container-c",
            "rel_type": "REFERENCES",
        }
    )
    app = create_app(monkeypatch, fake_db)
    client = TestClient(app)

    response = client.post(
        "/entities/read",
        json={"id": "system-a", "include_relations": True, "filter_relations": {"rel_type": "DEPENDS_ON"}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["entity"]["id"] == "system-a"
    assert len(payload.get("relations", [])) == 1


def test_utils_restore_conflict_error(monkeypatch, tmp_path: Path):
    fake_db = FakeMongoAdapter()
    fake_db.entities.items.append(
        {
            "id": "system-a",
            "type": "system",
            "source_project": "demo",
            "proposal_id": "",
            "data": {"id": "system-a"},
        }
    )
    app = create_app(monkeypatch, fake_db)
    client = TestClient(app)

    backup_payload = {
        "version": "0.3.0",
        "exported_at": "2026-02-01T00:00:00Z",
        "entities": [
            {
                "id": "system-a",
                "type": "system",
                "source_project": "demo",
                "proposal_id": "",
                "data": {"id": "system-a"},
            }
        ],
        "relations": [],
        "feats": [],
    }
    relative_dir = Path(".tmp") / "tests"
    safe_dir = Path.cwd() / relative_dir
    safe_dir.mkdir(parents=True, exist_ok=True)
    relative_path = relative_dir / f"backup-{tmp_path.name}.json"
    backup_path = Path.cwd() / relative_path
    backup_path.write_text(json.dumps(backup_payload), encoding="utf-8")

    response = client.post(
        "/utils/restore",
        json={"input": str(relative_path), "conflict_policy": "error"},
    )
    assert response.status_code == 409
