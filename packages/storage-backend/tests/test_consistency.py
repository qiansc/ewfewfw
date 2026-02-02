from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import get_current_user, get_permission_service
from src.routes import entities, utils


class FakePermissionService:
    async def check_permission(self, user_id: str, project_id: str, action: str) -> bool:
        return True


class FakeUpdateResult:
    def __init__(self, upserted_id: str | None = None) -> None:
        self.upserted_id = upserted_id


class FakeCursor:
    def __init__(self, items: list[dict[str, Any]]) -> None:
        self._items = items

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self._items


class FakeEntitiesCollection:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self._data = data

    def _matches(self, item: dict[str, Any], query: dict[str, Any]) -> bool:
        for key, value in query.items():
            if item.get(key) != value:
                return False
        return True

    async def update_one(
        self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False
    ) -> FakeUpdateResult:
        for idx, item in enumerate(self._data):
            if self._matches(item, query):
                self._data[idx] = {**item, **update.get("$set", {})}
                return FakeUpdateResult()
        if upsert:
            self._data.append(update.get("$set", {}))
            return FakeUpdateResult(upserted_id="new")
        return FakeUpdateResult()

    def find(self, query: dict[str, Any], projection: dict[str, int] | None = None) -> FakeCursor:
        items: list[dict[str, Any]] = []
        for item in self._data:
            if not self._matches(item, query):
                continue
            if projection:
                projected: dict[str, Any] = {}
                for key, include in projection.items():
                    if include and key in item:
                        projected[key] = item[key]
                items.append(projected)
            else:
                items.append(item)
        return FakeCursor(items)

    async def distinct(self, field: str) -> list[str]:
        return list({item.get(field, "") for item in self._data})


class FakeMongoAdapter:
    def __init__(self) -> None:
        self.entities_data: list[dict[str, Any]] = []
        self.entities = FakeEntitiesCollection(self.entities_data)

    async def save_entity(self, entity: dict[str, Any]) -> dict[str, Any]:
        await self.entities.update_one(
            {
                "id": entity["id"],
                "source_project": entity.get("source_project", ""),
                "proposal_id": entity.get("proposal_id", ""),
            },
            {"$set": entity},
            upsert=True,
        )
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

    async def delete_relations_from_entity(
        self, _entity_id: str, _project_id: str, _proposal_id: str
    ) -> int:
        return 0


class FakeNeo4jAdapter:
    def __init__(self, state: dict[str, bool]) -> None:
        self._state = state

    async def upsert_entity(self, entity: dict[str, Any]) -> None:
        if self._state.get("fail"):
            raise RuntimeError("neo4j boom")

    async def delete_relations_from_entity(
        self, _entity_id: str, _project_id: str, _proposal_id: str
    ) -> None:
        if self._state.get("fail"):
            raise RuntimeError("neo4j boom")


class FakeMilvusAdapter:
    def __init__(self, state: dict[str, bool]) -> None:
        self._state = state

    async def upsert_vector(self, vector_id: str, vector: list[float]) -> None:
        if self._state.get("fail"):
            raise RuntimeError("milvus boom")


class FakeEmbedder:
    async def embed(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(entities.router, prefix="/entities")
    app.include_router(utils.router, prefix="/utils")
    return app


def test_sync_status_and_check_consistency(monkeypatch):
    app = create_app()
    fake_db = FakeMongoAdapter()
    neo4j_state = {"fail": False}
    milvus_state = {"fail": False}

    async def get_mongo():
        return fake_db

    async def get_neo4j():
        return FakeNeo4jAdapter(neo4j_state)

    async def get_milvus():
        return FakeMilvusAdapter(milvus_state)

    monkeypatch.setattr(entities, "get_mongodb_adapter", get_mongo)
    monkeypatch.setattr(entities, "get_neo4j_adapter", get_neo4j)
    monkeypatch.setattr(entities, "get_milvus_adapter", get_milvus)
    monkeypatch.setattr(entities.EmbeddingService, "get_provider", lambda: FakeEmbedder())
    monkeypatch.setattr(utils, "get_mongodb_adapter", get_mongo)

    app.dependency_overrides[get_permission_service] = lambda: FakePermissionService()
    app.dependency_overrides[get_current_user] = lambda: "tester"

    client = TestClient(app)

    response = client.post(
        "/entities/save",
        json={
            "type": "system",
            "data": {"id": "demo", "name": "Demo"},
            "source_project": "demo",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"]["neo4j"] == "synced"
    assert payload["sync_status"]["milvus"] == "synced"

    neo4j_state["fail"] = True
    milvus_state["fail"] = True

    response = client.post(
        "/entities/save",
        json={
            "type": "system",
            "data": {"id": "demo-fail", "name": "Demo Fail"},
            "source_project": "demo",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["sync_status"]["neo4j"] == "pending"
    assert payload["sync_status"]["milvus"] == "pending"
    assert "neo4j_error" in payload["sync_status"]
    assert "milvus_error" in payload["sync_status"]

    fake_db.entities_data.append(
        {
            "id": "demo-bad",
            "sync_status": {"neo4j": "failed", "milvus": "synced"},
        }
    )

    response = client.post("/utils/check-consistency", json={})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert payload["synced"] == 1
    assert payload["pending"] == 1
    assert payload["failed"] == 1
    assert payload["no_status"] == 0
    ids = {item["id"] for item in payload["details"]}
    assert ids == {"demo-fail", "demo-bad"}
