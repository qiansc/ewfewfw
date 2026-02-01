from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from uuid import uuid4
from urllib import error, request


@dataclass
class RunnerConfig:
    base_url: str
    user_id: str
    admin_id: str
    timeout: int


def _request(
    config: RunnerConfig,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    url = f"{config.base_url}{path}"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if headers:
        for key, value in headers.items():
            req.add_header(key, value)
    try:
        with request.urlopen(req, timeout=config.timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {path} failed {exc.code}: {body}") from exc


def _try_grant_permission(config: RunnerConfig, project_id: str, user_id: str) -> None:
    try:
        _request(
            config,
            "POST",
            "/permissions/",
            {
                "project_id": project_id,
                "user_id": user_id,
                "role": "admin",
            },
            headers={"X-User-ID": config.admin_id},
        )
    except Exception:
        # Best-effort: permissions may already exist or admin may not be privileged.
        pass


def run(config: RunnerConfig) -> None:
    health = _request(config, "GET", "/health")
    if health.get("status") != "ok":
        raise RuntimeError(f"health check failed: {health}")

    _try_grant_permission(config, "demo", config.user_id)

    suffix = uuid4().hex[:8]
    system_id = f"system-{suffix}"
    container_id = f"container-{suffix}"
    relation_id = f"rel-{suffix}"
    backup_path = f"/tmp/c4a-backup-{suffix}.json"

    headers = {"X-User-ID": config.user_id}

    _request(
        config,
        "POST",
        "/entities/save",
        {
            "type": "system",
            "data": {"id": system_id, "name": f"System {suffix}"},
            "source_project": "demo",
        },
        headers=headers,
    )
    _request(
        config,
        "POST",
        "/entities/save",
        {
            "type": "container",
            "data": {"id": container_id, "name": f"Container {suffix}"},
            "source_project": "demo",
        },
        headers=headers,
    )

    _request(
        config,
        "POST",
        "/relations/save",
        {
            "id": relation_id,
            "from_project": "demo",
            "from_id": system_id,
            "to_project": "demo",
            "to_id": container_id,
            "rel_type": "DEPENDS_ON",
            "status": "active",
            "properties": {"note": "integration"},
        },
        headers=headers,
    )

    read_payload = _request(
        config, "POST", "/entities/read", {"id": system_id}, headers=headers
    )
    if read_payload.get("entity", {}).get("id") != system_id:
        raise RuntimeError(f"read entity mismatch: {read_payload}")

    list_payload = _request(
        config,
        "POST",
        "/entities/list",
        {"project_id": "demo", "limit": 10},
        headers=headers,
    )
    if list_payload.get("pagination", {}).get("total", 0) < 2:
        raise RuntimeError(f"list entities unexpected: {list_payload}")

    search_payload = _request(
        config,
        "POST",
        "/search",
        {"query": f"System {suffix}"},
        headers=headers,
    )
    if not search_payload.get("items"):
        raise RuntimeError(f"search returned empty: {search_payload}")

    _request(
        config,
        "POST",
        "/graph/deps",
        {"id": system_id, "source_project": "demo", "depth": 2},
        headers=headers,
    )
    _request(
        config,
        "POST",
        "/graph/impact",
        {"id": container_id, "source_project": "demo", "depth": 2},
        headers=headers,
    )

    _request(config, "POST", "/feat/lifecycle", {"action": "create", "feat_id": f"feat-{suffix}"})
    _request(
        config,
        "POST",
        "/feat/checklist",
        {"action": "generate", "feat_id": f"feat-{suffix}"},
    )
    _request(
        config,
        "POST",
        "/feat/workflow-step",
        {
            "feat_id": f"feat-{suffix}",
            "step_id": "step-1",
            "status": "done",
        },
    )
    _request(
        config,
        "POST",
        "/feat/lifecycle",
        {"action": "transition", "feat_id": f"feat-{suffix}", "to_status": "approved"},
    )

    _request(
        config,
        "POST",
        "/utils/backup",
        {"output": backup_path, "format": "json"},
    )
    _request(
        config,
        "POST",
        "/utils/validate",
        {"checks": ["structure", "relations"]},
    )
    _request(
        config,
        "POST",
        "/utils/repair",
        {"scope": "milvus", "dry_run": True},
    )
    _request(
        config,
        "POST",
        "/utils/restore",
        {"input": backup_path, "conflict_policy": "override"},
    )

    _request(
        config,
        "POST",
        "/sync",
        {"direction": "export", "mode": "incremental"},
    )
    _request(
        config,
        "POST",
        "/sync/plan",
        {
            "local_manifest": {
                "files": [
                    {
                        "path": f"business/demo/{system_id}.c4a.yaml",
                        "entity_id": system_id,
                        "type": "system",
                        "content_hash": "hash-1",
                        "updated_at": "2026-02-01T00:00:00Z",
                        "proposal_id": None,
                        "content": f"id: {system_id}\n",
                    }
                ]
            },
            "options": {"conflict_policy": "warn"},
            "execute": False,
        },
    )

    _request(config, "POST", "/entities/delete", {"id": system_id}, headers=headers)
    _request(config, "POST", "/entities/delete", {"id": container_id}, headers=headers)

    print("integration regression ok")


def parse_args() -> RunnerConfig:
    parser = argparse.ArgumentParser(description="C4A storage-backend integration regression")
    parser.add_argument(
        "--base-url",
        default=os.getenv("C4A_STORAGE_BACKEND_URL", "http://localhost:8055"),
    )
    parser.add_argument(
        "--user-id",
        default=os.getenv("C4A_TEST_USER_ID", "tester"),
    )
    parser.add_argument(
        "--admin-id",
        default=os.getenv("C4A_ADMIN_USER_ID", "admin"),
    )
    parser.add_argument("--timeout", type=int, default=10)
    args = parser.parse_args()
    return RunnerConfig(
        base_url=args.base_url,
        user_id=args.user_id,
        admin_id=args.admin_id,
        timeout=args.timeout,
    )


if __name__ == "__main__":
    try:
        run(parse_args())
    except Exception as exc:
        print(f"integration regression failed: {exc}", file=sys.stderr)
        sys.exit(1)
