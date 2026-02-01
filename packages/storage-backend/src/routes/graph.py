from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..dependencies import get_user_visible_projects
from ..services.database import get_mongodb_adapter, get_neo4j_adapter

router = APIRouter()


class DepsRequest(BaseModel):
    id: str
    source_project: str | None = None
    direction: Literal["upstream", "downstream", "both"] | None = None
    depth: int | None = None
    proposal_id: str | None = None


class ImpactRequest(BaseModel):
    id: str
    source_project: str | None = None
    change_type: str | None = None
    depth: int | None = None
    proposal_id: str | None = None


async def resolve_entity_type(
    mongodb, entity_id: str, project_id: str | None, proposal_id: str | None
) -> str:
    entity = await mongodb.get_entity(entity_id, project_id, proposal_id)
    if entity is None:
        return "system"
    return entity.get("type", "system")


@router.post("/deps")
async def query_deps(
    params: DepsRequest,
    project_ids: list[str] = Depends(get_user_visible_projects),
) -> dict[str, Any]:
    if not project_ids:
        return {"nodes": [], "degraded": False}
    if not params.source_project:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-001",
                "message": "缺少 project_id",
                "details": {"field": "source_project"},
            },
        )
    if params.source_project not in project_ids:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-003",
                "message": "无读权限",
                "project_id": params.source_project,
            },
        )
    neo4j = await get_neo4j_adapter()
    mongodb = await get_mongodb_adapter()
    direction = params.direction or "downstream"
    depth = params.depth or 2
    project_id = params.source_project
    try:
        records = await neo4j.query_deps(params.id, project_id, direction, depth)
    except Exception as exc:
        return {
            "nodes": [],
            "degraded": True,
            "degraded_reason": "NEO4J_QUERY_FAILED",
            "degraded_message": str(exc),
        }

    nodes: list[dict[str, Any]] = []
    for record in records:
        node_project = record.get("project") or ""
        if node_project and node_project not in project_ids:
            continue
        node_id = record.get("id")
        entity_type = await resolve_entity_type(
            mongodb, node_id, node_project, params.proposal_id or None
        )
        nodes.append(
            {
                "id": node_id,
                "source_project": node_project,
                "type": entity_type,
                "distance": record.get("distance", 1),
                "relation_type": record.get("relation_type", "DEPENDS_ON"),
            }
        )
    return {"nodes": nodes, "degraded": False}


@router.post("/impact")
async def query_impact(
    params: ImpactRequest,
    project_ids: list[str] = Depends(get_user_visible_projects),
) -> dict[str, Any]:
    if not project_ids:
        return {"nodes": [], "degraded": False}
    if not params.source_project:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-001",
                "message": "缺少 project_id",
                "details": {"field": "source_project"},
            },
        )
    if params.source_project not in project_ids:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-003",
                "message": "无读权限",
                "project_id": params.source_project,
            },
        )
    neo4j = await get_neo4j_adapter()
    mongodb = await get_mongodb_adapter()
    depth = params.depth or 2
    project_id = params.source_project
    try:
        records = await neo4j.query_impact(params.id, project_id, depth)
    except Exception as exc:
        return {
            "nodes": [],
            "degraded": True,
            "degraded_reason": "NEO4J_QUERY_FAILED",
            "degraded_message": str(exc),
        }

    nodes: list[dict[str, Any]] = []
    for record in records:
        node_project = record.get("project") or ""
        if node_project and node_project not in project_ids:
            continue
        node_id = record.get("id")
        entity_type = await resolve_entity_type(
            mongodb, node_id, node_project, params.proposal_id or None
        )
        distance = record.get("distance", 1)
        nodes.append(
            {
                "id": node_id,
                "source_project": node_project,
                "type": entity_type,
                "distance": distance,
                "impact_level": "direct" if distance == 1 else "indirect",
                "reason": params.change_type or "dependency",
            }
        )
    return {"nodes": nodes, "degraded": False}
