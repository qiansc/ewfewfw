from __future__ import annotations

from pathlib import Path
import tempfile

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.dependencies import get_current_user
from src.routes import utils


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(utils.router, prefix="/utils")
    return app


def test_download_allows_tmp_path(monkeypatch):
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: "tester"

    with tempfile.NamedTemporaryFile(dir="/tmp", delete=False) as fh:
        fh.write(b"hello")
        tmp_path = Path(fh.name)

    try:
        client = TestClient(app)
        response = client.get("/utils/download", params={"path": str(tmp_path)})
        assert response.status_code == 200
        assert response.content == b"hello"
    finally:
        tmp_path.unlink(missing_ok=True)


def test_download_rejects_non_tmp_path(tmp_path):
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: "tester"

    target = tmp_path / "demo.txt"
    target.write_text("demo", encoding="utf-8")

    client = TestClient(app)
    response = client.get("/utils/download", params={"path": str(target)})
    assert response.status_code == 400


def test_download_rejects_anonymous_user():
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: "anonymous"

    client = TestClient(app)
    response = client.get("/utils/download", params={"path": "/tmp/any.tar.gz"})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "C4A-PERM-003"
