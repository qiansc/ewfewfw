from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import (
    get_current_user,
    get_mongodb,
    get_permission_service,
    get_user_visible_projects,
)
from src.routes import entities, relations, search


class FakeEntitiesCollection:
    def __init__(self, items: list[dict[str, Any]]):
        self.items = items

    async def update_one(self, query: dict[str, Any], update: dict[str, Any]) -> dict[str, int]:
        for item in self.items:
            if item.get("id") != query.get("id"):
                continue
            if item.get("source_project") != query.get("source_project"):
                continue
            if item.get("proposal_id") != query.get("proposal_id"):
                continue
            if "$set" in update:
                item.update(update["$set"])
            return {"matched_count": 1, "modified_count": 1}
        return {"matched_count": 0, "modified_count": 0}


class FakeMongoAdapter:
    def __init__(self):
        self.entities_data: list[dict[str, Any]] = []
        self.relations_data: list[dict[str, Any]] = []
        self.entities = FakeEntitiesCollection(self.entities_data)

    async def save_entity(self, entity: dict[str, Any]) -> dict[str, Any]:
        self.entities_data[:] = [
            item
            for item in self.entities_data
            if not (
                item["id"] == entity["id"]
                and item.get("source_project") == entity.get("source_project")
                and item.get("proposal_id") == entity.get("proposal_id")
            )
        ]
        self.entities_data.append(entity)
        return {"id": entity["id"], "upserted": True}

    async def get_entity(
        self, entity_id: str, source_project: str | None, proposal_id: str | None
    ) -> dict[str, Any] | None:
        for item in self.entities_data:
            if item["id"] != entity_id:
                continue
            if source_project is not None and item.get("source_project") != source_project:
                continue
            if proposal_id is not None and item.get("proposal_id") != proposal_id:
                continue
            return item
        return None

    async def list_entities(
        self, query: dict[str, Any], limit: int, offset: int
    ) -> list[dict[str, Any]]:
        items = self.entities_data
        if "type" in query:
            items = [item for item in items if item.get("type") == query["type"]]
        if "proposal_id" in query:
            items = [item for item in items if item.get("proposal_id") == query["proposal_id"]]
        if "search_text" in query:
            keyword = query["search_text"]["$regex"].lower()
            items = [
                item for item in items if keyword in (item.get("search_text") or "").lower()
            ]
        return items[offset : offset + limit]

    async def count_entities(self, query: dict[str, Any]) -> int:
        return len(await self.list_entities(query, 1000, 0))

    async def delete_entity(
        self, entity_id: str, source_project: str | None, proposal_id: str | None
    ) -> int:
        before = len(self.entities_data)
        self.entities_data = [
            item
            for item in self.entities_data
            if not (
                item["id"] == entity_id
                and (source_project is None or item.get("source_project") == source_project)
                and (proposal_id is None or item.get("proposal_id") == proposal_id)
            )
        ]
        return before - len(self.entities_data)

    async def delete_relations_for_entity(self, entity_id: str, project_id: str | None) -> int:
        before = len(self.relations_data)
        self.relations_data = [
            item
            for item in self.relations_data
            if item.get("from_id") != entity_id and item.get("to_id") != entity_id
        ]
        return before - len(self.relations_data)

    async def delete_relations_from_entity(
        self, entity_id: str, project_id: str, proposal_id: str
    ) -> int:
        before = len(self.relations_data)
        self.relations_data = [
            item
            for item in self.relations_data
            if not (
                item.get("from_id") == entity_id
                and item.get("from_project") == project_id
                and item.get("proposal_id") == proposal_id
            )
        ]
        return before - len(self.relations_data)

    async def save_relation(self, relation: dict[str, Any]) -> dict[str, int]:
        inserted = 0
        modified = 0
        for idx, item in enumerate(self.relations_data):
            if item["id"] == relation["id"]:
                self.relations_data[idx] = relation
                modified = 1
                break
        else:
            self.relations_data.append(relation)
            inserted = 1
        return {"inserted": inserted, "modified": modified}


class FakePermissionService:
    async def check_permission(self, user_id: str, project_id: str, action: str) -> bool:
        return True


class FakeNeo4jAdapter:
    async def save_relation(self, relation: dict[str, Any]) -> None:
        return None


class FakeMilvusAdapter:
    async def upsert_vector(self, vector_id: str, vector: list[float]) -> None:
        return None

    async def delete_vector(self, vector_id: str) -> None:
        return None


class FakeEmbedder:
    async def embed(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]


def create_app():
    app = FastAPI()
    app.include_router(entities.router, prefix="/entities")
    app.include_router(relations.router, prefix="/relations")
    app.include_router(search.router, prefix="/search")
    return app


def test_entities_save_and_read(monkeypatch):
    app = create_app()
    fake_db = FakeMongoAdapter()

    async def get_mongo():
        return fake_db

    async def get_milvus():
        return FakeMilvusAdapter()

    monkeypatch.setattr(entities, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(entities, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(entities.EmbeddingService, "get_provider", lambda: FakeEmbedder())

    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"

    client = TestClient(app)
    response = client.post(
        "/entities/save",
        json={"type": "system", "data": {"id": "demo", "name": "Demo"}, "source_project": "demo"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True

    response = client.post("/entities/read", json={"id": "demo"})
    assert response.status_code == 200
    assert response.json()["entity"]["id"] == "demo"


def test_relations_save(monkeypatch):
    app = create_app()
    fake_db = FakeMongoAdapter()

    monkeypatch.setattr(relations, "get_neo4j_adapter", lambda: FakeNeo4jAdapter())

    app.dependency_overrides[get_mongodb] = lambda: fake_db
    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"

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
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_search_like_fallback(monkeypatch):
    app = create_app()
    fake_db = FakeMongoAdapter()
    fake_db.entities_data.append(
        {
            "id": "system-a",
            "type": "system",
            "source_project": "demo",
            "proposal_id": "",
            "search_text": "System A",
            "status": "published",
            "content_hash": "hash",
            "updated_at": "now",
        }
    )
    async def get_mongo():
        return fake_db

    async def get_milvus():
        return FakeMilvusAdapter()

    monkeypatch.setattr(search, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(search.EmbeddingService, "get_provider", lambda: FakeEmbedder())
    monkeypatch.setattr(search, "get_milvus_adapter", get_milvus)

    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"
    app.dependency_overrides[get_user_visible_projects] = lambda: ["demo"]

    client = TestClient(app)
    response = client.post("/search", json={"query": "System"})
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) >= 1


def test_search_vector_hits(monkeypatch):
    app = create_app()
    fake_db = FakeMongoAdapter()
    fake_db.entities_data.append(
        {
            "id": "system-a",
            "type": "system",
            "source_project": "demo",
            "proposal_id": "",
            "search_text": "System A",
            "status": "published",
            "content_hash": "hash",
            "updated_at": "now",
        }
    )

    class VectorMilvusAdapter:
        async def search(self, _vector: list[float], limit: int = 10, filter_expr: str | None = None):
            return [{"entity": {"vector_key": "demo:system-a:"}, "distance": 0.12}]

    async def get_mongo():
        return fake_db

    async def get_milvus():
        return VectorMilvusAdapter()

    monkeypatch.setattr(search, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(search.EmbeddingService, "get_provider", lambda: FakeEmbedder())
    monkeypatch.setattr(search, "get_milvus_adapter", get_milvus)

    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"
    app.dependency_overrides[get_user_visible_projects] = lambda: ["demo"]

    client = TestClient(app)
    response = client.post("/search", json={"query": "System"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["degraded"] is False
    assert payload["search_mode"] == "vector"
    assert payload["items"][0]["id"] == "system-a"
