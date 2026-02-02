from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import (
    get_current_user,
    get_permission_service,
    get_user_visible_projects,
)
from ..services.permission import PermissionService
from ..utils.hash import compute_content_hash
from ..utils.vector import generate_vector_key
from . import entities as entities_module
from .entities_helpers import (
    _diff_fields,
    _has_related_adr,
    _parse_relations,
    apply_generated_id,
    build_search_text,
    dump_content,
    extract_data,
    generate_auto_id,
    normalize_proposal_id,
    normalize_source_project,
    now_iso,
    to_entity_response,
)
from .entities_models import (
    DeleteRequest,
    ListRequest,
    ReadHistoryRequest,
    ReadRequest,
    SaveRequest,
    is_valid_status_transition,
)

router = APIRouter()


@router.post("/save")
async def save_entity(
    params: SaveRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    data = extract_data(params)
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
                "timestamp": now_iso(),
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

    requested_status = data.get("status")
    if requested_status is None and isinstance(data.get("metadata"), dict):
        requested_status = data["metadata"].get("status")

    adapter = await entities_module.get_mongodb_adapter()
    entity_id = params.id or data.get("id")
    if not entity_id:
        entity_id = await generate_auto_id(adapter, source_project, params.type, data)
    if not entity_id:
        raise HTTPException(status_code=400, detail="Entity ID is required")
    apply_generated_id(params.type, data, entity_id)
    existing = await adapter.get_entity(entity_id, source_project, proposal_id)
    existing_data = existing.get("data") if existing else None
    existing_status = existing.get("status") if existing else None
    status = requested_status or existing_status or ("draft" if proposal_id else "published")

    if existing_status and status != existing_status:
        if not is_valid_status_transition(existing_status, status):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "C4A-BIZ-001",
                    "message": "非法状态流转",
                    "details": {
                        "from_status": existing_status,
                        "to_status": status,
                        "suggestion": "按 draft → approved → published → deprecated → archived 顺序流转",
                    },
                    "timestamp": now_iso(),
                },
            )

    content_hash = compute_content_hash(data)
    adr_check: dict[str, Any] | None = None
    adr_scope = params.adr_policy.scope if params.adr_policy and params.adr_policy.scope else [
        "system",
        "container",
        "component",
    ]
    should_check_adr = (
        not params.skip_adr_check
        and status == "published"
        and params.type in {"system", "container", "component"}
        and (
            params.enforce_adr
            or (params.adr_policy and params.adr_policy.enforce and params.type in adr_scope)
        )
    )
    if should_check_adr:
        on_missing = (
            params.adr_policy.on_missing
            if params.adr_policy and params.adr_policy.on_missing
            else ("error" if params.enforce_adr else "warning")
        )
        if on_missing != "ignore":
            has_adr = await _has_related_adr(adapter, entity_id, source_project, proposal_id)
            if not has_adr:
                if on_missing == "error":
                    return {
                        "success": False,
                        "id": entity_id,
                        "status": status,
                        "content_hash": content_hash,
                        "error": {
                            "code": "C4A-STORE-ADR-001",
                            "message": "发布 system/container/component 需要关联 ADR",
                            "details": {
                                "entity_id": entity_id,
                                "entity_type": params.type,
                                "missing_adr": True,
                                "suggestion": "请先创建 ADR 记录架构决策，然后通过 REFERENCES 关系关联",
                            },
                        },
                    }
                adr_check = {
                    "required": True,
                    "passed": False,
                    "missing_adr": True,
                    "message": "警告：此实体缺少关联的 ADR，建议补充架构决策记录",
                }
            else:
                adr_check = {"required": True, "passed": True}
    if (
        not proposal_id
        and existing_status == "published"
        and status == "published"
        and existing
        and existing.get("content_hash") != content_hash
        and not params.force_save
    ):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "C4A-BIZ-001",
                "message": "published 状态不可直接修改，请通过 feat 变更",
                "details": {"suggestion": "创建 feat 分支修改并发布，或先流转为 deprecated"},
                "timestamp": now_iso(),
            },
        )

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
        "content_hash": content_hash,
        "created_at": created_at,
        "updated_at": updated_at,
        "created_by": data.get("created_by"),
        "updated_by": data.get("updated_by"),
        "search_text": build_search_text(entity_id, params.type, data),
    }

    await adapter.save_entity(entity_doc)

    relations = _parse_relations(data, params.type, source_project, entity_id, proposal_id)
    await adapter.delete_relations_from_entity(entity_id, source_project, proposal_id)
    if relations:
        await adapter.save_relations(relations)

    history_record = {
        "entity_id": entity_id,
        "feat_id": proposal_id or None,
        "action": "create" if existing is None else "update",
        "changed_fields": _diff_fields(existing_data, data) or None,
        "changed_by": user_id,
        "changed_at": updated_at,
        "source_project": source_project,
        "proposal_id": proposal_id,
        "entity_type": params.type,
    }
    if hasattr(adapter, "insert_entity_history"):
        await adapter.insert_entity_history(history_record)

    warnings: list[dict[str, Any]] = []
    sync_status: dict[str, Any] = {"neo4j": "synced", "milvus": "synced"}
    try:
        neo4j = await entities_module.get_neo4j_adapter()
        await neo4j.upsert_entity(entity_doc)
        await neo4j.delete_relations_from_entity(entity_id, source_project, proposal_id)
        for relation in relations:
            await neo4j.save_relation(relation)
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
        embedder = entities_module.EmbeddingService.get_provider()
        vector = await embedder.embed(entity_doc["search_text"])
        milvus = await entities_module.get_milvus_adapter()
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

    response: dict[str, Any] = {
        "success": True,
        "id": entity_id,
        "status": status,
        "content_hash": entity_doc["content_hash"],
        "warnings": warnings,
        "sync_status": sync_status,
    }
    if adr_check is not None:
        response["adr_check"] = adr_check
    return response


@router.post("/read")
async def read_entity(
    params: ReadRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any] | None:
    adapter = await entities_module.get_mongodb_adapter()
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
        content = dump_content(data, params.format)
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
    adapter = await entities_module.get_mongodb_adapter()
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
    adapter = await entities_module.get_mongodb_adapter()
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
    soft_deleted = False
    now = now_iso()
    try:
        milvus = await entities_module.get_milvus_adapter()
        for doc in candidates:
            vector_key = generate_vector_key(
                doc.get("source_project", ""), doc["id"], doc.get("proposal_id")
            )
            await milvus.delete_vector(vector_key)
    except Exception:
        pass
    deleted_relations = 0
    try:
        neo4j = await entities_module.get_neo4j_adapter()
    except Exception:
        neo4j = None
    for doc in candidates:
        source_project = doc.get("source_project", "")
        if proposal_id != "":
            main_doc = await adapter.get_entity(params.id, source_project, "")
        else:
            main_doc = None

        if proposal_id != "" and main_doc:
            # feat 删除主分支已存在实体 → 软删除（status=archived）
            data = doc.get("data") or {}
            if isinstance(data, dict):
                if data.get("status") is not None:
                    data["status"] = "archived"
                metadata = data.get("metadata")
                if isinstance(metadata, dict):
                    metadata["status"] = "archived"
                    data["metadata"] = metadata
            await adapter.entities.update_one(
                {
                    "id": params.id,
                    "source_project": source_project,
                    "proposal_id": proposal_id,
                },
                {
                    "$set": {
                        "status": "archived",
                        "data": data,
                        "updated_at": now,
                    }
                },
            )
            soft_deleted = True
            continue

        deleted += await adapter.delete_entity(params.id, source_project, proposal_id)
        deleted_relations += await adapter.delete_relations_for_entity(
            params.id, source_project
        )
        if neo4j:
            try:
                await neo4j.delete_entity(doc.get("id"), source_project)
            except Exception:
                pass
    return {
        "success": deleted > 0 or soft_deleted,
        "id": params.id,
        "deleted_relations": deleted_relations,
        "soft_deleted": soft_deleted,
        "warnings": [],
    }


@router.post("/read-history")
async def read_history(params: ReadHistoryRequest) -> dict[str, Any]:
    adapter = await entities_module.get_mongodb_adapter()
    query: dict[str, Any] = {}
    if params.entity_id:
        query["entity_id"] = params.entity_id
    if params.feat_id is not None:
        query["feat_id"] = normalize_proposal_id(params.feat_id)

    limit = params.limit or 100
    order = -1 if (params.order or "desc") == "desc" else 1
    records = await adapter.list_entity_history(query, limit, order)

    items = []
    for record in records:
        action = record.get("action")
        if action not in {"create", "update", "delete", "archive"}:
            action = "update"
        items.append(
            {
                "entity_id": record.get("entity_id"),
                "feat_id": record.get("feat_id"),
                "action": action,
                "changed_fields": record.get("changed_fields") or None,
                "changed_by": record.get("changed_by") or None,
                "changed_at": record.get("changed_at"),
            }
        )

    total = await adapter.count_entity_history(query)
    return {"success": True, "items": items, "total": total}
