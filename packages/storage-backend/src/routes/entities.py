from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..dependencies import (
    get_current_user,
    get_permission_service,
    get_user_visible_projects,
)
from ..services.permission import PermissionService
from ..services.database import get_milvus_adapter, get_mongodb_adapter, get_neo4j_adapter
from ..services.embedding import EmbeddingService
from ..utils.hash import compute_content_hash
from ..utils.vector import generate_vector_key

try:  # optional dependency
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

router = APIRouter()


class SaveRequest(BaseModel):
    type: str
    data: dict[str, Any] | None = None
    content: str | None = None
    format: Literal["yaml", "json"] | None = None
    id: str | None = None
    source_project: str | None = None
    proposal_id: str | None = None
    enforce_adr: bool | None = None
    skip_adr_check: bool | None = None
    ignore_concurrent_warning: bool | None = None
    force_save: bool | None = None


class ReadRequest(BaseModel):
    id: str | None = None
    format: Literal["object", "yaml", "json"] | None = None
    proposal_id: str | list[str] | None = None
    filter: dict[str, Any] | None = None
    limit: int | None = None
    include_relations: bool | None = None
    filter_relations: dict[str, Any] | None = None


class ListRequest(BaseModel):
    filter: dict[str, Any] | None = None
    type: str | None = None
    project_id: str | None = None
    proposal_id: str | None = None
    status: str | None = None
    updated_after: str | None = None
    limit: int | None = None
    offset: int | None = None
    group_by: Literal["type", "status"] | None = None
    count_only: bool | None = None


class DeleteRequest(BaseModel):
    id: str
    proposal_id: str | None = None
    force: bool | None = None


class ReadHistoryRequest(BaseModel):
    entity_id: str | None = None
    feat_id: str | None = None
    limit: int | None = None
    order: Literal["asc", "desc"] | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(text: str | None) -> str:
    return text or ""


def normalize_proposal_id(value: str | None) -> str:
    return value or ""


def normalize_source_project(value: str | None) -> str:
    return value or ""


def extract_data(params: SaveRequest) -> dict[str, Any]:
    if params.data is not None:
        return params.data
    if params.content is None:
        raise HTTPException(status_code=400, detail="Either data or content must be provided")
    fmt = params.format or "yaml"
    if fmt == "json":
        return json.loads(params.content)
    if fmt == "yaml":
        if yaml is None:
            raise HTTPException(status_code=400, detail="YAML parser is not available")
        return yaml.safe_load(params.content) or {}
    raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")


def build_search_text(entity_id: str, entity_type: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"{entity_id} {entity_type} {payload}"


def to_entity_response(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc["id"],
        "type": doc["type"],
        "kind": doc.get("kind"),
        "scope": doc.get("scope"),
        "perspective": doc.get("perspective"),
        "data": doc.get("data") or {},
        "proposal_id": doc.get("proposal_id") or None,
        "metadata": {
            "source_project": doc.get("source_project", ""),
            "source_repo": doc.get("source_repo"),
            "external_url": doc.get("external_url"),
            "status": doc.get("status", "draft"),
            "content_hash": doc.get("content_hash", ""),
            "created_at": doc.get("created_at", ""),
            "updated_at": doc.get("updated_at", ""),
            "created_by": doc.get("created_by"),
            "updated_by": doc.get("updated_by"),
        },
    }


@router.post("/save")
async def save_entity(
    params: SaveRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    data = extract_data(params)
    entity_id = params.id or data.get("id")
    if not entity_id:
        raise HTTPException(status_code=400, detail="Entity ID is required")

    source_project = normalize_source_project(params.source_project or data.get("source_project"))
    if not source_project and isinstance(data.get("metadata"), dict):
        source_project = normalize_source_project(data["metadata"].get("source_project"))
    if not source_project:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-001",
                "message": "缺少 project_id",
                "details": {"field": "project_id"},
            },
        )
    allowed = await permission_service.check_permission(user_id, source_project, "write")
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-001",
                "message": "无写权限",
                "user_id": user_id,
                "project_id": source_project,
            },
        )
    proposal_id = normalize_proposal_id(params.proposal_id or data.get("proposal_id"))

    status = data.get("status")
    if status is None and isinstance(data.get("metadata"), dict):
        status = data["metadata"].get("status")
    if status is None:
        status = "draft" if proposal_id else "published"

    adapter = await get_mongodb_adapter()
    existing = await adapter.get_entity(entity_id, source_project, proposal_id)

    created_at = existing.get("created_at") if existing else now_iso()
    updated_at = now_iso()

    entity_doc = {
        "id": entity_id,
        "type": params.type,
        "kind": data.get("kind"),
        "scope": data.get("scope"),
        "perspective": data.get("perspective"),
        "data": data,
        "proposal_id": proposal_id,
        "source_project": source_project,
        "source_repo": data.get("source_repo"),
        "external_url": data.get("external_url"),
        "status": status,
        "content_hash": compute_content_hash(data),
        "created_at": created_at,
        "updated_at": updated_at,
        "created_by": data.get("created_by"),
        "updated_by": data.get("updated_by"),
        "search_text": build_search_text(entity_id, params.type, data),
    }

    await adapter.save_entity(entity_doc)

    warnings: list[dict[str, Any]] = []
    sync_status: dict[str, Any] = {"neo4j": "synced", "milvus": "synced"}
    try:
        neo4j = await get_neo4j_adapter()
        await neo4j.upsert_entity(entity_doc)
    except Exception as exc:  # pragma: no cover - 图数据库异常不影响 MongoDB 权威写入
        sync_status["neo4j"] = "pending"
        sync_status["neo4j_error"] = str(exc)
        warnings.append(
            {
                "code": "NEO4J_SYNC_FAILED",
                "message": "图数据库同步失败",
                "severity": "warning",
                "details": {"error": str(exc)},
            }
        )
    try:
        vector_key = generate_vector_key(source_project, entity_id, proposal_id)
        embedder = EmbeddingService.get_provider()
        vector = await embedder.embed(entity_doc["search_text"])
        milvus = await get_milvus_adapter()
        await milvus.upsert_vector(vector_key, vector)
    except Exception as exc:  # pragma: no cover - 向量服务可降级
        sync_status["milvus"] = "pending"
        sync_status["milvus_error"] = str(exc)
        warnings.append(
            {
                "code": "VECTOR_INDEX_FAILED",
                "message": "向量索引更新失败",
                "severity": "warning",
                "details": {"error": str(exc)},
            }
        )

    await adapter.entities.update_one(
        {"id": entity_id, "source_project": source_project, "proposal_id": proposal_id},
        {"$set": {"sync_status": sync_status}},
    )

    return {
        "success": True,
        "id": entity_id,
        "status": status,
        "content_hash": entity_doc["content_hash"],
        "warnings": warnings,
        "sync_status": sync_status,
    }


@router.post("/read")
async def read_entity(
    params: ReadRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any] | None:
    adapter = await get_mongodb_adapter()
    proposal_ids: list[str] = []
    if isinstance(params.proposal_id, list):
        proposal_ids = [normalize_proposal_id(item) for item in params.proposal_id]
    elif params.proposal_id is not None:
        proposal_ids = [normalize_proposal_id(params.proposal_id)]
    else:
        proposal_ids = [""]

    if params.id is None:
        raise HTTPException(status_code=400, detail="id is required")

    entity_doc = None
    source_project = (
        normalize_source_project(params.filter.get("source_project"))
        if params.filter and params.filter.get("source_project") is not None
        else None
    )

    for proposal_id in proposal_ids:
        entity_doc = await adapter.get_entity(params.id, source_project, proposal_id)
        if entity_doc:
            break

    if entity_doc is None:
        return None
    source_project = entity_doc.get("source_project", "")
    allowed = await permission_service.check_permission(user_id, source_project, "read")
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-003",
                "message": "无读权限",
                "user_id": user_id,
                "project_id": source_project,
            },
        )

    if params.format in {"yaml", "json"}:
        data = entity_doc.get("data") or {}
        if params.format == "json":
            content = json.dumps(data, ensure_ascii=False, indent=2)
        else:
            if yaml is None:
                raise HTTPException(status_code=400, detail="YAML parser is not available")
            content = yaml.safe_dump(data, allow_unicode=True)
        return {
            "id": entity_doc["id"],
            "type": entity_doc["type"],
            "status": entity_doc.get("status", "draft"),
            "content": content,
            "format": params.format,
        }

    response: dict[str, Any] = {"entity": to_entity_response(entity_doc)}
    if params.include_relations:
        relation_query: dict[str, Any] = {
            "$or": [
                {"from_id": entity_doc["id"], "from_project": entity_doc["source_project"]},
                {"to_id": entity_doc["id"], "to_project": entity_doc["source_project"]},
            ]
        }
        if params.filter_relations:
            relation_query.update(params.filter_relations)
        cursor = adapter.relations.find(relation_query, {"_id": 0})
        relations = await cursor.to_list(length=None)
        for rel in relations:
            rel["proposal_id"] = rel.get("proposal_id") or None
        response["relations"] = relations
    return response


@router.post("/list")
async def list_entities(
    params: ListRequest,
    project_ids: list[str] = Depends(get_user_visible_projects),
) -> dict[str, Any]:
    allow_all = "*" in project_ids
    if not project_ids and not allow_all:
        if params.count_only:
            return {"total": 0}
        return {
            "items": [],
            "pagination": {"total": 0, "offset": 0, "limit": params.limit or 50, "has_more": False},
        }
    adapter = await get_mongodb_adapter()
    query: dict[str, Any] = params.filter.copy() if params.filter else {}

    if params.type and params.type != "all":
        query["type"] = params.type
    if params.project_id is not None:
        target_project = normalize_source_project(params.project_id)
        if not allow_all and target_project not in project_ids:
            if params.count_only:
                return {"total": 0}
            return {
                "items": [],
                "pagination": {
                    "total": 0,
                    "offset": params.offset or 0,
                    "limit": params.limit or 50,
                    "has_more": False,
                },
            }
        query["source_project"] = target_project
    else:
        if not allow_all:
            query["source_project"] = {"$in": project_ids}
    if params.proposal_id is not None:
        query["proposal_id"] = normalize_proposal_id(params.proposal_id)
    if params.status is not None:
        query["status"] = params.status
    if params.updated_after is not None:
        query["updated_at"] = {"$gte": params.updated_after}

    if params.count_only:
        total = await adapter.count_entities(query)
        return {"total": total}

    limit = params.limit or 50
    offset = params.offset or 0
    docs = await adapter.list_entities(query, limit, offset)
    items = [
        {
            "id": doc["id"],
            "type": doc["type"],
            "status": doc.get("status", "draft"),
            "updated_at": doc.get("updated_at", ""),
            "content_hash": doc.get("content_hash", ""),
            "source_project": doc.get("source_project", ""),
            "proposal_id": doc.get("proposal_id") or None,
        }
        for doc in docs
    ]
    total = await adapter.count_entities(query)
    result: dict[str, Any] = {
        "items": items,
        "pagination": {
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < total,
        },
    }

    if params.group_by:
        counts: dict[str, int] = {}
        key = params.group_by
        for item in items:
            value = item.get(key) or "unknown"
            counts[value] = counts.get(value, 0) + 1
        result["groups"] = {group: {"count": count} for group, count in counts.items()}

    return result


@router.post("/delete")
async def delete_entity(
    params: DeleteRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    proposal_id = normalize_proposal_id(params.proposal_id)
    candidates = await adapter.list_entities(
        {"id": params.id, "proposal_id": proposal_id},
        limit=50,
        offset=0,
    )
    if not candidates:
        return {
            "success": False,
            "id": params.id,
            "deleted_relations": 0,
            "soft_deleted": False,
            "warnings": [],
        }
    for doc in candidates:
        project_id = doc.get("source_project", "")
        allowed = await permission_service.check_permission(user_id, project_id, "write")
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "C4A-PERM-001",
                    "message": "无写权限",
                    "user_id": user_id,
                    "project_id": project_id,
                },
            )

    deleted = 0
    try:
        milvus = await get_milvus_adapter()
        for doc in candidates:
            vector_key = generate_vector_key(
                doc.get("source_project", ""), doc["id"], doc.get("proposal_id")
            )
            await milvus.delete_vector(vector_key)
    except Exception:
        pass
    deleted_relations = 0
    try:
        neo4j = await get_neo4j_adapter()
    except Exception:
        neo4j = None
    for doc in candidates:
        deleted += await adapter.delete_entity(
            params.id, doc.get("source_project", ""), proposal_id
        )
        deleted_relations += await adapter.delete_relations_for_entity(
            params.id, doc.get("source_project")
        )
        if neo4j:
            try:
                await neo4j.delete_entity(doc.get("id"), doc.get("source_project", ""))
            except Exception:
                pass
    return {
        "success": deleted > 0,
        "id": params.id,
        "deleted_relations": deleted_relations,
        "soft_deleted": False,
        "warnings": [],
    }


@router.post("/read-history")
async def read_history(_: ReadHistoryRequest) -> dict[str, Any]:
    return {"success": True, "items": [], "total": 0}
