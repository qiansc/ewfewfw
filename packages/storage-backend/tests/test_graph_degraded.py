from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import get_user_visible_projects
from src.routes import graph


class FakeNeo4jAdapter:
    async def query_deps(self, entity_id: str, project_id: str, direction: str, depth: int):
        raise RuntimeError("neo4j boom")

    async def query_impact(self, entity_id: str, project_id: str, depth: int):
        raise RuntimeError("neo4j boom")


class FakeMongoAdapter:
    async def get_entity(self, entity_id: str, project_id: str | None, proposal_id: str | None):
        return {"type": "system"}


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(graph.router, prefix="/graph")
    return app


def test_deps_returns_degraded_on_neo4j_failure(monkeypatch):
    app = create_app()

    async def get_neo4j():
        return FakeNeo4jAdapter()

    async def get_mongo():
        return FakeMongoAdapter()

    monkeypatch.setattr(graph, "get_neo4j_adapter", get_neo4j)
    monkeypatch.setattr(graph, "get_mongodb_adapter", get_mongo)

    app.dependency_overrides[get_user_visible_projects] = lambda: ["demo"]

    client = TestClient(app)
    response = client.post(
        "/graph/deps",
        json={"id": "svc", "source_project": "demo", "direction": "downstream", "depth": 2},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["degraded"] is True
    assert payload["degraded_reason"] == "NEO4J_QUERY_FAILED"
    assert payload["nodes"] == []
    assert "neo4j boom" in payload["degraded_message"]


def test_impact_returns_degraded_on_neo4j_failure(monkeypatch):
    app = create_app()

    async def get_neo4j():
        return FakeNeo4jAdapter()

    async def get_mongo():
        return FakeMongoAdapter()

    monkeypatch.setattr(graph, "get_neo4j_adapter", get_neo4j)
    monkeypatch.setattr(graph, "get_mongodb_adapter", get_mongo)

    app.dependency_overrides[get_user_visible_projects] = lambda: ["demo"]

    client = TestClient(app)
    response = client.post(
        "/graph/impact",
        json={"id": "svc", "source_project": "demo", "depth": 2},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["degraded"] is True
    assert payload["degraded_reason"] == "NEO4J_QUERY_FAILED"
    assert payload["nodes"] == []
    assert "neo4j boom" in payload["degraded_message"]
