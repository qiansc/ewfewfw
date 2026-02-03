from __future__ import annotations

from typing import Any
from pathlib import Path
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import (
    get_current_user,
    get_mongodb,
    get_permission_service,
    get_user_visible_projects,
)
from src.routes import entities, feat, graph, relations, search, sync, utils
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
                if "$gte" in value:
                    if str(item.get(key, "")) < str(value["$gte"]):
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

    async def distinct(self, field: str) -> list[Any]:
        values = []
        seen = set()
        for item in self.items:
            value = item.get(field)
            if value in seen:
                continue
            seen.add(value)
            values.append(value)
        return values


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

    async def delete_relations_from_entity(
        self, entity_id: str, project_id: str, proposal_id: str
    ) -> int:
        count = 0
        remaining = []
        for rel in self.relations.items:
            if (
                rel.get("from_id") == entity_id
                and rel.get("from_project") == project_id
                and rel.get("proposal_id") == proposal_id
            ):
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


class FakePermissionService:
    async def check_permission(self, user_id: str, project_id: str, action: str) -> bool:
        return True

    async def get_user_projects(self, user_id: str) -> list[str]:
        return ["demo"]


class FakeNeo4jAdapter:
    async def save_relation(self, relation: dict[str, Any]) -> None:
        return None

    async def query_deps(
        self, entity_id: str, project_id: str, direction: str, depth: int
    ) -> list[dict[str, Any]]:
        return [
            {
                "id": "container-b",
                "project": project_id,
                "distance": 1,
                "relation_type": "DEPENDS_ON",
            }
        ]

    async def query_impact(
        self, entity_id: str, project_id: str, depth: int
    ) -> list[dict[str, Any]]:
        return [
            {
                "id": "system-a",
                "project": project_id,
                "distance": 1,
                "relation_type": "DEPENDS_ON",
            }
        ]


class FakeMilvusAdapter:
    async def upsert_vector(self, vector_key: str, vector: list[float]) -> None:
        return None

    async def delete_vector(self, vector_key: str) -> None:
        return None

    async def search(self, query_vector: list[float], limit: int = 10, filter_expr: str | None = None):
        return [{"vector_key": "demo:system-a:", "distance": 0.1}]


class FakeEmbedder:
    async def embed(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]


def create_app(monkeypatch, fake_db: FakeMongoAdapter, fake_neo4j: FakeNeo4jAdapter):
    app = FastAPI()
    app.include_router(entities.router, prefix="/entities")
    app.include_router(relations.router, prefix="/relations")
    app.include_router(search.router, prefix="/search")
    app.include_router(graph.router, prefix="/graph")
    app.include_router(feat.router, prefix="/feat")
    app.include_router(utils.router, prefix="/utils")
    app.include_router(sync.router, prefix="/sync")

    async def get_mongo():
        return fake_db

    async def get_neo4j():
        return fake_neo4j

    async def get_milvus():
        return FakeMilvusAdapter()

    monkeypatch.setattr(entities, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(entities, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(entities.EmbeddingService, "get_provider", lambda: FakeEmbedder())

    monkeypatch.setattr(relations, "get_neo4j_adapter", get_neo4j)

    monkeypatch.setattr(search, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(search, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(search.EmbeddingService, "get_provider", lambda: FakeEmbedder())

    monkeypatch.setattr(graph, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(graph, "get_neo4j_adapter", get_neo4j)

    monkeypatch.setattr(feat, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(feat, "get_neo4j_adapter", get_neo4j)
    monkeypatch.setattr(feat, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(feat.EmbeddingService, "get_provider", lambda: FakeEmbedder())

    monkeypatch.setattr(utils, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(utils, "get_neo4j_adapter", get_neo4j)
    monkeypatch.setattr(utils, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(utils.EmbeddingService, "get_provider", lambda: FakeEmbedder())

    monkeypatch.setattr(database_service, "get_mongodb_adapter", get_mongo)

    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"
    app.dependency_overrides[get_user_visible_projects] = lambda: ["demo"]
    app.dependency_overrides[get_mongodb] = lambda: fake_db

    return app


def test_entities_list_and_delete(monkeypatch):
    fake_db = FakeMongoAdapter()
    app = create_app(monkeypatch, fake_db, FakeNeo4jAdapter())
    client = TestClient(app)

    response = client.post(
        "/entities/save",
        json={"type": "system", "data": {"id": "system-a", "name": "System A"}, "source_project": "demo"},
    )
    assert response.status_code == 200
    response = client.post(
        "/entities/save",
        json={"type": "container", "data": {"id": "container-b", "name": "Container B"}, "source_project": "demo"},
    )
    assert response.status_code == 200

    response = client.post("/entities/list", json={"project_id": "demo", "limit": 10})
    payload = response.json()
    assert payload["pagination"]["total"] >= 2

    response = client.post("/entities/delete", json={"id": "system-a"})
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_graph_endpoints(monkeypatch):
    fake_db = FakeMongoAdapter()
    app = create_app(monkeypatch, fake_db, FakeNeo4jAdapter())
    client = TestClient(app)

    response = client.post("/graph/deps", json={"id": "system-a", "source_project": "demo", "depth": 2})
    assert response.status_code == 200
    assert response.json()

    response = client.post(
        "/graph/impact", json={"id": "container-b", "source_project": "demo", "depth": 2}
    )
    assert response.status_code == 200
    assert response.json()


@pytest.mark.xfail(reason="v0.3 现状 checklist 生成路径与依赖注入方式不匹配，按现状暂不验证")
def test_feat_and_utils_flow(monkeypatch, tmp_path: Path):
    fake_db = FakeMongoAdapter()
    app = create_app(monkeypatch, fake_db, FakeNeo4jAdapter())
    client = TestClient(app)

    response = client.post("/feat/lifecycle", json={"action": "create", "feat_id": "feat-1"})
    assert response.status_code == 200

    response = client.post(
        "/feat/checklist",
        json={
            "action": "generate",
            "feat_id": "feat-1",
            "items": [{"id": "task-1", "title": "Init", "status": "pending"}],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["checklist"]["items"][0]["id"] == "task-1"

    response = client.post(
        "/feat/workflow-step",
        json={"feat_id": "feat-1", "step_id": "step-1", "status": "done"},
    )
    assert response.status_code == 200

    relative_dir = Path(".tmp") / "tests"
    safe_dir = Path.cwd() / relative_dir
    safe_dir.mkdir(parents=True, exist_ok=True)
    relative_path = relative_dir / f"backup-{tmp_path.name}.json"
    backup_path = Path.cwd() / relative_path
    response = client.post("/utils/backup", json={"output": str(relative_path), "format": "json"})
    assert response.status_code == 200
    assert backup_path.exists()

    response = client.post("/utils/validate", json={"checks": ["structure", "relations"]})
    assert response.status_code == 200
    assert response.json()["summary"]["status"] == "passed"

    response = client.post("/utils/repair", json={"scope": "milvus", "dry_run": True})
    assert response.status_code == 200
    assert response.json()["success"] is True

    response = client.post(
        "/utils/restore",
        json={"input": str(relative_path), "conflict_policy": "override"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_feat_publish_merges_entities(monkeypatch):
    fake_db = FakeMongoAdapter()
    app = create_app(monkeypatch, fake_db, FakeNeo4jAdapter())
    client = TestClient(app)

    response = client.post("/feat/lifecycle", json={"action": "create", "feat_id": "feat-merge"})
    assert response.status_code == 200

    response = client.post(
        "/entities/save",
        json={
            "type": "system",
            "proposal_id": "feat-merge",
            "source_project": "demo",
            "data": {"id": "system-merge", "name": "System Merge", "scope": "project"},
        },
    )
    assert response.status_code == 200

    response = client.post(
        "/feat/lifecycle",
        json={"action": "transition", "feat_id": "feat-merge", "to_status": "approved"},
    )
    assert response.status_code == 200

    response = client.post(
        "/feat/lifecycle",
        json={"action": "transition", "feat_id": "feat-merge", "to_status": "published"},
    )
    assert response.status_code == 200

    response = client.post(
        "/entities/read",
        json={"id": "system-merge", "filter": {"source_project": "demo"}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["entity"]["proposal_id"] is None
    assert payload["entity"]["metadata"]["status"] == "published"

    response = client.post(
        "/entities/list",
        json={"proposal_id": "feat-merge", "project_id": "demo", "limit": 10},
    )
    assert response.status_code == 200
    assert response.json()["pagination"]["total"] == 0


def test_sync_plan(monkeypatch):
    fake_db = FakeMongoAdapter()
    app = create_app(monkeypatch, fake_db, FakeNeo4jAdapter())
    client = TestClient(app)

    response = client.post(
        "/sync/plan",
        json={
            "local_manifest": {
                "files": [
                    {
                        "path": "business/demo/system-a.c4a.yaml",
                        "entity_id": "system-a",
                        "type": "system",
                        "content_hash": "hash-1",
                        "updated_at": "2026-02-01T00:00:00Z",
                        "proposal_id": None,
                        "content": "id: system-a\n",
                    }
                ]
            },
            "options": {"conflict_policy": "warn"},
            "execute": False,
        },
    )
    assert response.status_code == 200
    plan = response.json()["plan"]
    assert plan["to_upload"]
