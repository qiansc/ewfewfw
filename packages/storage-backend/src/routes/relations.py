from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..adapters.mongodb import MongoDBAdapter
from ..adapters.neo4j import Neo4jAdapter
from ..config import load_settings
from ..dependencies import get_current_user, get_mongodb, get_permission_service
from ..models.relation import RelationInput, RelationSaveResponse
from ..services.permission import PermissionService

router = APIRouter()

_neo4j_adapter: Neo4jAdapter | None = None


def get_neo4j_adapter() -> Neo4jAdapter:
    global _neo4j_adapter
    if _neo4j_adapter is None:
        settings = load_settings()
        _neo4j_adapter = Neo4jAdapter(
            settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password
        )
    return _neo4j_adapter


@router.post("/save", response_model=RelationSaveResponse)
async def save_relation(
    payload: RelationInput,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
    mongodb: MongoDBAdapter = Depends(get_mongodb),
) -> RelationSaveResponse:
    relation = payload.model_dump()
    now = datetime.now(timezone.utc).isoformat()
    relation.setdefault("created_at", now)
    relation["updated_at"] = now
    allowed = True
    for project_id in [relation.get("from_project"), relation.get("to_project")]:
        if project_id:
            allowed = await permission_service.check_permission(
                user_id, project_id, "write"
            )
            if not allowed:
                break
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-001",
                "message": "无写权限",
                "user_id": user_id,
                "project_id": relation.get("from_project") or relation.get("to_project"),
            },
        )
    try:
        result = await mongodb.save_relation(relation)
    except Exception as exc:  # pragma: no cover - 直连数据库异常
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        neo4j = get_neo4j_adapter()
        await neo4j.save_relation(relation)
    except Exception as exc:  # pragma: no cover - 图数据库异常不影响 MongoDB 权威写入
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return RelationSaveResponse(
        success=True,
        inserted=result["inserted"],
        modified=result["modified"],
    )


@router.delete("/{relation_id}")
async def delete_relation(
    relation_id: str,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
    mongodb: MongoDBAdapter = Depends(get_mongodb),
) -> dict[str, Any]:
    relation = await mongodb.relations.find_one({"id": relation_id}, {"_id": 0})
    if not relation:
        return {"success": False, "deleted": 0}
    allowed = True
    for project_id in [relation.get("from_project"), relation.get("to_project")]:
        if project_id:
            allowed = await permission_service.check_permission(
                user_id, project_id, "write"
            )
            if not allowed:
                break
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-001",
                "message": "无写权限",
                "user_id": user_id,
                "project_id": relation.get("from_project") or relation.get("to_project"),
            },
        )
    deleted = await mongodb.delete_relation(relation_id)
    try:
        neo4j = get_neo4j_adapter()
        await neo4j.delete_relation(relation_id)
    except Exception:
        pass
    return {"success": deleted > 0, "deleted": deleted}
