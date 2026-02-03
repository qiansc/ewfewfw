from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..dependencies import get_current_user, get_permission_service
from ..services.database import (
    get_milvus_adapter,
    get_mongodb_adapter,
    get_neo4j_adapter,
)
from ..services.embedding import EmbeddingService
from ..services.permission import PermissionService
from ..utils.hash import compute_hash
from ..utils.vector import generate_vector_key

router = APIRouter()

VALID_FEAT_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["approved", "archived"],
    "approved": ["published"],
    "published": ["deprecated", "archived"],
    "deprecated": ["archived"],
    "archived": [],
}


def is_valid_feat_status_transition(from_status: str, to_status: str) -> bool:
    return to_status in VALID_FEAT_STATUS_TRANSITIONS.get(from_status, [])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FeatLifecycleRequest(BaseModel):
    action: Literal["create", "transition", "delete"]
    feat_id: str
    metadata: dict[str, Any] | None = None
    to_status: str | None = None
    sync_checklist: bool | None = None
    force_publish: bool | None = None
    expected_content_hash: str | None = None


class FeatMergeRequest(BaseModel):
    feat_id: str
    strategy: Literal["auto", "manual"]
    conflict_resolution: list[dict[str, Any]] | None = None


class ChecklistPatch(BaseModel):
    task_id: str
    updates: dict[str, Any]


class ChecklistItem(BaseModel):
    id: str
    title: str | None = None
    status: str | None = None
    type: str | None = None
    entity_id: str | None = None
    assignee: str | None = None
    completed_at: str | None = None
    blocked_reason: str | None = None


class ChecklistRequest(BaseModel):
    action: Literal["generate", "get", "patch", "clear"]
    feat_id: str
    source: str | None = None
    expected_version: str | None = None
    items: list[ChecklistItem] | None = None
    patches: list[ChecklistPatch] | None = None
    validate_: bool | None = Field(default=None, alias="validate")


class WorkflowStepRequest(BaseModel):
    feat_id: str
    step_id: str
    status: str | None = None
    metadata: dict[str, Any] | None = None


def _collect_project_ids_from_metadata(metadata: Any) -> list[str]:
    if not isinstance(metadata, dict):
        return []
    project_ids = metadata.get("project_ids")
    if isinstance(project_ids, list):
        return [project_id for project_id in project_ids if isinstance(project_id, str)]
    project_id = metadata.get("project_id")
    if isinstance(project_id, str):
        return [project_id]
    return []


async def _collect_feat_project_ids(
    adapter: Any,
    feat_id: str,
    feat_doc: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> list[str]:
    projects: set[str] = set()

    if feat_doc:
        project_ids = feat_doc.get("project_ids")
        if isinstance(project_ids, list):
            projects.update([pid for pid in project_ids if isinstance(pid, str)])
        project_id = feat_doc.get("project_id")
        if isinstance(project_id, str):
            projects.add(project_id)
        projects.update(_collect_project_ids_from_metadata(feat_doc.get("metadata")))

    if metadata:
        projects.update(_collect_project_ids_from_metadata(metadata))

    try:
        entity_projects = await adapter.entities.distinct(
            "source_project", {"proposal_id": feat_id}
        )
        projects.update([pid for pid in entity_projects if isinstance(pid, str)])
    except Exception:
        pass

    return list(projects)


async def _require_write_for_projects(
    permission_service: PermissionService, user_id: str, project_ids: list[str]
) -> None:
    for project_id in project_ids:
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


async def _require_approve_for_projects(
    permission_service: PermissionService, user_id: str, project_ids: list[str]
) -> None:
    result = await permission_service.check_cross_project_publish(user_id, project_ids)
    if not result.get("allowed", True):
        missing = result.get("missing", [])
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-002",
                "message": "无批准权限",
                "user_id": user_id,
                "project_id": ",".join(missing),
            },
        )


def _entity_snapshot(entity: dict[str, Any]) -> dict[str, Any]:
    data = entity.get("data")
    if isinstance(data, dict):
        return data
    return entity


async def _list_feat_entities(adapter: Any, feat_id: str) -> list[dict[str, Any]]:
    normalized_feat_id = feat_id.strip()
    cursor = adapter.entities.find({"proposal_id": normalized_feat_id}, {"_id": 0})
    entities = await cursor.to_list(length=None)
    if entities:
        return entities
    # 兼容历史数据：proposal_id 写在 data/metadata 中
    legacy_query = {
        "$or": [
            {"data.proposal_id": normalized_feat_id},
            {"data.metadata.proposal_id": normalized_feat_id},
            {"metadata.proposal_id": normalized_feat_id},
        ]
    }
    cursor = adapter.entities.find(legacy_query, {"_id": 0})
    legacy_entities = await cursor.to_list(length=None)
    if not legacy_entities:
        return []
    for entity in legacy_entities:
        update_filter: dict[str, Any] = {"id": entity.get("id")}
        if entity.get("source_project") is not None:
            update_filter["source_project"] = entity.get("source_project")
        update_filter["$or"] = [
            {"proposal_id": {"$in": [None, "", normalized_feat_id]}},
            {"data.proposal_id": normalized_feat_id},
            {"data.metadata.proposal_id": normalized_feat_id},
            {"metadata.proposal_id": normalized_feat_id},
        ]
        await adapter.entities.update_one(
            update_filter, {"$set": {"proposal_id": normalized_feat_id}}
        )
        entity["proposal_id"] = normalized_feat_id
    return legacy_entities


async def _list_feat_relations(adapter: Any, feat_id: str) -> list[dict[str, Any]]:
    normalized_feat_id = feat_id.strip()
    cursor = adapter.relations.find({"proposal_id": normalized_feat_id}, {"_id": 0})
    return await cursor.to_list(length=None)


def _compute_feat_content_hash(entities: list[dict[str, Any]]) -> str:
    parts = [
        f"{entity.get('source_project','')}|{entity.get('id','')}|{entity.get('content_hash','')}"
        for entity in entities
    ]
    payload = json.dumps(sorted(parts), ensure_ascii=False)
    return compute_hash(payload)


async def _detect_feat_conflicts(adapter: Any, feat_id: str) -> list[dict[str, Any]]:
    feat_entities = await _list_feat_entities(adapter, feat_id)
    conflicts: list[dict[str, Any]] = []

    for entity in feat_entities:
        main = await adapter.get_entity(entity.get("id"), entity.get("source_project"), "")
        if not main:
            continue
        if main.get("type") != entity.get("type"):
            conflicts.append(
                {
                    "entity_id": entity.get("id"),
                    "conflict_type": "type",
                    "main_branch": _entity_snapshot(main),
                    "feat_branch": _entity_snapshot(entity),
                    "suggested_resolution": "keep_feat",
                }
            )
            continue
        if main.get("content_hash") != entity.get("content_hash"):
            conflicts.append(
                {
                    "entity_id": entity.get("id"),
                    "conflict_type": "content",
                    "main_branch": _entity_snapshot(main),
                    "feat_branch": _entity_snapshot(entity),
                    "suggested_resolution": "keep_feat",
                }
            )

    return conflicts


async def _sync_entity_indexes(
    adapter: Any, entity_doc: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    sync_status: dict[str, Any] = {"neo4j": "synced", "milvus": "synced"}
    warnings: list[dict[str, Any]] = []

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
        vector_key = generate_vector_key(
            entity_doc.get("source_project", ""),
            entity_doc.get("id", ""),
            entity_doc.get("proposal_id", ""),
        )
        embedder = EmbeddingService.get_provider()
        vector = await embedder.embed(entity_doc.get("search_text", ""))
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
        {
            "id": entity_doc.get("id"),
            "source_project": entity_doc.get("source_project", ""),
            "proposal_id": entity_doc.get("proposal_id", ""),
        },
        {"$set": {"sync_status": sync_status}},
    )
    return sync_status, warnings


async def _delete_feat_vector(entity_doc: dict[str, Any], feat_id: str) -> None:
    try:
        milvus = await get_milvus_adapter()
        vector_key = generate_vector_key(
            entity_doc.get("source_project", ""),
            entity_doc.get("id", ""),
            feat_id,
        )
        await milvus.delete_vector(vector_key)
    except Exception:
        return


async def _merge_feat_relations(adapter: Any, feat_id: str, now: str) -> None:
    relations = await _list_feat_relations(adapter, feat_id)
    for relation in relations:
        if relation.get("status") == "deleted":
            await adapter.relations.delete_one({"id": relation.get("id")})
            try:
                neo4j = await get_neo4j_adapter()
                await neo4j.delete_relation(relation.get("id"))
            except Exception:
                pass
            continue
        relation["proposal_id"] = ""
        relation["updated_at"] = now
        await adapter.relations.update_one(
            {"id": relation.get("id")},
            {"$set": relation},
            upsert=True,
        )
        try:
            neo4j = await get_neo4j_adapter()
            await neo4j.save_relation(relation)
        except Exception:
            pass


async def _merge_feat_entities(
    adapter: Any,
    feat_id: str,
    entities: list[dict[str, Any]],
) -> list[str]:
    now = now_iso()
    merged_ids: list[str] = []
    normalized_feat_id = feat_id.strip()
    for entity in entities:
        merged = dict(entity)
        merged["proposal_id"] = ""
        merged["status"] = "published"
        merged["updated_at"] = now
        entity_id = entity.get("id")
        source_project = entity.get("source_project", "")
        await adapter.entities.delete_one(
            {"id": entity_id, "source_project": source_project, "proposal_id": ""}
        )
        update_result = await adapter.entities.update_one(
            {
                "id": entity_id,
                "source_project": source_project,
                "proposal_id": normalized_feat_id,
            },
            {"$set": merged},
        )
        matched_count = (
            update_result.get("matched_count", update_result.get("modified_count", 0))
            if isinstance(update_result, dict)
            else getattr(update_result, "matched_count", 0)
        )
        if matched_count == 0:
            await adapter.save_entity(merged)
        await _sync_entity_indexes(adapter, merged)
        await _delete_feat_vector(entity, normalized_feat_id)
        merged_ids.append(str(entity_id))

    await _merge_feat_relations(adapter, feat_id, now)
    return merged_ids


def _normalize_expected_version(value: str | None) -> str | None:
    if value is None:
        return None
    return value or None


def _build_checklist_conflict_response(
    feat_id: str,
    current_version: str | None,
    conflicting_tasks: list[str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "success": False,
        "feat_id": feat_id,
        "error": "CHECKLIST_CONFLICT",
        "message": "Checklist 已被其他会话更新，请先执行 get 获取最新内容",
        "current_version": current_version,
    }
    if conflicting_tasks:
        payload["conflicting_tasks"] = conflicting_tasks
    return payload


def _build_checklist_conflict(
    feat_id: str,
    current_version: str | None,
    expected_version: str | None,
    conflicting_tasks: list[str] | None = None,
) -> dict[str, Any] | None:
    if expected_version is None:
        return None
    if expected_version == (current_version or None):
        return None
    return _build_checklist_conflict_response(
        feat_id, current_version, conflicting_tasks
    )


def _build_checklist_update_filter(
    feat_id: str, current_version: str | None
) -> dict[str, Any]:
    if current_version is None:
        return {"id": feat_id, "checklist.version": None}
    return {"id": feat_id, "checklist.version": current_version}


def _extract_checklist_version(doc: dict[str, Any] | None) -> str | None:
    if not doc:
        return None
    checklist = doc.get("checklist")
    if isinstance(checklist, dict):
        return checklist.get("version")
    return None


@router.post("/lifecycle")
async def feat_lifecycle(
    params: FeatLifecycleRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    feats = adapter.feats
    feat = await feats.find_one({"id": params.feat_id}, {"_id": 0})

    if params.action == "create":
        project_ids = await _collect_feat_project_ids(
            adapter, params.feat_id, feat_doc=None, metadata=params.metadata
        )
        if project_ids:
            await _require_write_for_projects(permission_service, user_id, project_ids)
        if feat:
            return {"success": False, "feat_id": params.feat_id, "error": "feat already exists"}
        now = now_iso()
        payload = {
            "id": params.feat_id,
            "status": "draft",
            "metadata": params.metadata or {},
            "created_at": now,
            "updated_at": now,
            "checklist": None,
            "workflow_steps": {},
        }
        await feats.insert_one(payload)
        return {"success": True, "feat_id": params.feat_id, "status": "draft"}

    if feat is None:
        return {"success": False, "feat_id": params.feat_id, "error": "feat not found"}

    if params.action == "transition":
        project_ids = await _collect_feat_project_ids(adapter, params.feat_id, feat_doc=feat)
        if not params.to_status:
            return {
                "success": False,
                "feat_id": params.feat_id,
                "error": "MISSING_STATUS",
                "message": "to_status is required for transition action",
            }
        to_status = params.to_status
        from_status = feat.get("status", "draft")

        if not is_valid_feat_status_transition(from_status, to_status):
            return {
                "success": False,
                "feat_id": params.feat_id,
                "from_status": from_status,
                "error": "INVALID_TRANSITION",
                "message": f"Cannot transition from {from_status} to {to_status}",
            }

        if to_status == "published":
            if project_ids:
                await _require_approve_for_projects(permission_service, user_id, project_ids)
            if params.expected_content_hash:
                feat_entities = await _list_feat_entities(adapter, params.feat_id)
                actual_hash = _compute_feat_content_hash(feat_entities)
                if actual_hash != params.expected_content_hash:
                    return {
                        "success": False,
                        "feat_id": params.feat_id,
                        "from_status": from_status,
                        "error": "content_hash_mismatch",
                        "message": "本地存在未同步的修改，请先执行 c4a sync",
                        "expected_hash": params.expected_content_hash,
                        "actual_hash": actual_hash,
                    }

            if not params.force_publish:
                conflicts = await _detect_feat_conflicts(adapter, params.feat_id)
                if conflicts:
                    return {
                        "success": False,
                        "feat_id": params.feat_id,
                        "from_status": from_status,
                        "error": "merge_conflict",
                        "message": "发布前需要先解决冲突",
                        "conflicts": conflicts,
                    }

            feat_entities = await _list_feat_entities(adapter, params.feat_id)
            merged = await _merge_feat_entities(adapter, params.feat_id, feat_entities)
            remaining = await _list_feat_entities(adapter, params.feat_id)
            if remaining:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "C4A-BIZ-004",
                        "message": "发布合并未完成",
                        "details": {
                            "feat_id": params.feat_id,
                            "remaining_ids": [item.get("id") for item in remaining],
                            "merged_ids": merged,
                        },
                        "timestamp": now_iso(),
                        "recoverable_actions": [
                            {
                                "action": "retry",
                                "label": "重试合并",
                                "params": {"feat_id": params.feat_id, "strategy": "auto"},
                            }
                        ],
                    },
                )
            await feats.update_one(
                {"id": params.feat_id},
                {"$set": {"status": to_status, "updated_at": now_iso(), "checklist": None}},
            )
            return {
                "success": True,
                "feat_id": params.feat_id,
                "from_status": from_status,
                "to_status": to_status,
                "status": to_status,
                "merge_result": {"merged": merged, "conflicts": []},
            }

        if project_ids:
            await _require_write_for_projects(permission_service, user_id, project_ids)
        await feats.update_one(
            {"id": params.feat_id},
            {"$set": {"status": to_status, "updated_at": now_iso()}},
        )
        return {
            "success": True,
            "feat_id": params.feat_id,
            "from_status": from_status,
            "to_status": to_status,
            "status": to_status,
        }

    if params.action == "delete":
        project_ids = await _collect_feat_project_ids(adapter, params.feat_id, feat_doc=feat)
        if project_ids:
            await _require_write_for_projects(permission_service, user_id, project_ids)
        await feats.delete_one({"id": params.feat_id})
        return {"success": True, "feat_id": params.feat_id, "deleted": True}

    raise HTTPException(status_code=400, detail="Unsupported action")


@router.post("/merge")
async def feat_merge(
    params: FeatMergeRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    feat = await adapter.feats.find_one({"id": params.feat_id}, {"_id": 0})
    if not feat:
        return {
            "success": False,
            "feat_id": params.feat_id,
            "error": "FEAT_NOT_FOUND",
            "message": f"Feat {params.feat_id} not found",
        }
    project_ids = await _collect_feat_project_ids(adapter, params.feat_id, feat_doc=feat)
    if project_ids:
        await _require_approve_for_projects(permission_service, user_id, project_ids)

    feat_entities = await _list_feat_entities(adapter, params.feat_id)
    feat_entity_map = {str(entity.get("id")): entity for entity in feat_entities}
    conflicts = await _detect_feat_conflicts(adapter, params.feat_id)

    if params.strategy == "auto":
        if conflicts:
            return {"success": False, "merged": [], "conflicts": conflicts}
        merged = await _merge_feat_entities(adapter, params.feat_id, feat_entities)
        await adapter.feats.update_one(
            {"id": params.feat_id},
            {"$set": {"checklist": None, "updated_at": now_iso()}},
        )
        return {"success": True, "merged": merged, "conflicts": []}

    resolution_list = params.conflict_resolution or []
    resolution_map = {
        str(item.get("entity_id")): str(item.get("resolution")) for item in resolution_list
    }

    unresolved = [conflict for conflict in conflicts if conflict.get("entity_id") not in resolution_map]
    if unresolved:
        return {"success": False, "merged": [], "conflicts": unresolved}

    for entity_id, resolution in resolution_map.items():
        if resolution == "keep_main":
            entity = feat_entity_map.get(entity_id)
            if entity:
                await adapter.entities.delete_one(
                    {
                        "id": entity.get("id"),
                        "source_project": entity.get("source_project", ""),
                        "proposal_id": params.feat_id,
                    }
                )
                await _delete_feat_vector(entity, params.feat_id)

    remaining_entities = [
        entity
        for entity in feat_entities
        if resolution_map.get(str(entity.get("id"))) != "keep_main"
    ]
    merged = await _merge_feat_entities(adapter, params.feat_id, remaining_entities)
    await adapter.feats.update_one(
        {"id": params.feat_id},
        {"$set": {"checklist": None, "updated_at": now_iso()}},
    )
    return {"success": True, "merged": merged, "conflicts": []}


@router.post("/checklist")
async def feat_checklist(
    params: ChecklistRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    feats = adapter.feats
    feat = await feats.find_one({"id": params.feat_id})
    if not feat:
        return {"success": False, "feat_id": params.feat_id, "error": "feat not found"}
    project_ids = await _collect_feat_project_ids(adapter, params.feat_id, feat_doc=feat)
    if project_ids:
        await _require_write_for_projects(permission_service, user_id, project_ids)

    checklist = feat.get("checklist")
    expected_version = _normalize_expected_version(params.expected_version)
    current_version = checklist.get("version") if isinstance(checklist, dict) else None

    if params.action == "generate":
        conflict = _build_checklist_conflict(
            params.feat_id, current_version, expected_version
        )
        if conflict:
            return conflict
        items = [item.model_dump() for item in (params.items or [])]
        version = uuid4().hex
        checklist = {
            "version": version,
            "metadata": {
                "feat_id": params.feat_id,
                "generated_at": now_iso(),
                "source": params.source,
            },
            "updated_at": now_iso(),
            "items": items,
        }
        update_result = await feats.update_one(
            _build_checklist_update_filter(params.feat_id, current_version),
            {"$set": {"checklist": checklist}},
        )
        matched = getattr(update_result, "matched_count", 0)
        if matched == 0:
            latest = await feats.find_one({"id": params.feat_id}, {"checklist": 1})
            latest_version = _extract_checklist_version(latest)
            return _build_checklist_conflict_response(
                params.feat_id, latest_version
            )
        return {"success": True, "feat_id": params.feat_id, "checklist": checklist}

    if params.action == "get":
        if not checklist:
            return {"success": False, "feat_id": params.feat_id, "error": "checklist not found"}
        return {"success": True, "feat_id": params.feat_id, "checklist": checklist}

    if params.action == "clear":
        conflict = _build_checklist_conflict(
            params.feat_id, current_version, expected_version
        )
        if conflict:
            return conflict
        update_result = await feats.update_one(
            _build_checklist_update_filter(params.feat_id, current_version),
            {"$set": {"checklist": None}},
        )
        matched = getattr(update_result, "matched_count", 0)
        if matched == 0:
            latest = await feats.find_one({"id": params.feat_id}, {"checklist": 1})
            latest_version = _extract_checklist_version(latest)
            return _build_checklist_conflict_response(
                params.feat_id, latest_version
            )
        return {"success": True, "feat_id": params.feat_id, "cleared": True}

    if params.action == "patch":
        if not checklist:
            return {"success": False, "feat_id": params.feat_id, "error": "checklist not found"}
        conflict = _build_checklist_conflict(
            params.feat_id,
            current_version,
            expected_version,
            [patch.task_id for patch in (params.patches or [])],
        )
        if conflict:
            return conflict
        patches = params.patches or []
        items = {item["id"]: item for item in checklist.get("items", [])}
        updated_tasks = []
        for patch in patches:
            existing = items.get(patch.task_id, {"id": patch.task_id})
            existing.update(patch.updates)
            items[patch.task_id] = existing
            updated_tasks.append(
                {"task_id": patch.task_id, "fields_updated": list(patch.updates.keys())}
            )
        checklist["version"] = uuid4().hex
        checklist["items"] = list(items.values())
        checklist["updated_at"] = now_iso()
        update_result = await feats.update_one(
            _build_checklist_update_filter(params.feat_id, current_version),
            {"$set": {"checklist": checklist}},
        )
        matched = getattr(update_result, "matched_count", 0)
        if matched == 0:
            latest = await feats.find_one({"id": params.feat_id}, {"checklist": 1})
            latest_version = _extract_checklist_version(latest)
            return _build_checklist_conflict_response(
                params.feat_id,
                latest_version,
                [patch.task_id for patch in (params.patches or [])],
            )
        return {
            "success": True,
            "feat_id": params.feat_id,
            "patched_at": checklist["updated_at"],
            "patched_tasks": updated_tasks,
            "updated_checklist": checklist,
        }

    raise HTTPException(status_code=400, detail="Unsupported action")


@router.post("/workflow-step")
async def update_workflow_step(
    params: WorkflowStepRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    feats = adapter.feats
    feat = await feats.find_one({"id": params.feat_id})
    if not feat:
        return {
            "success": False,
            "feat_id": params.feat_id,
            "step_id": params.step_id,
            "error": "feat_not_found",
        }
    project_ids = await _collect_feat_project_ids(adapter, params.feat_id, feat_doc=feat)
    if project_ids:
        await _require_write_for_projects(permission_service, user_id, project_ids)

    steps = feat.get("workflow_steps") or {}
    step = steps.get(params.step_id, {})
    if params.status:
        step["status"] = params.status
    if params.metadata:
        step["metadata"] = params.metadata
    step["updated_at"] = now_iso()
    steps[params.step_id] = step

    await feats.update_one({"id": params.feat_id}, {"$set": {"workflow_steps": steps}})
    return {
        "success": True,
        "feat_id": params.feat_id,
        "step_id": params.step_id,
        "status": step.get("status"),
        "updated_at": step.get("updated_at"),
        "updated_fields": ["status", "metadata"],
    }
