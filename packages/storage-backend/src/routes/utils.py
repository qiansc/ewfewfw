from __future__ import annotations

import io
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..dependencies import get_current_user, get_permission_service
from ..services.database import get_milvus_adapter, get_mongodb_adapter, get_neo4j_adapter
from ..services.embedding import EmbeddingService
from ..services.permission import PermissionService
from ..utils.hash import compute_content_hash
from ..utils.vector import generate_vector_key

router = APIRouter()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BackupRequest(BaseModel):
    output: str
    status_filter: Literal["published", "approved", "all"] | None = None
    format: Literal["tar.gz", "json"] | None = None
    include_metadata: bool | None = None


class RestoreRequest(BaseModel):
    input: str
    conflict_policy: Literal["skip", "override", "merge", "error"] | None = None
    validate_checksums: bool | None = None


class RepairRequest(BaseModel):
    scope: Literal["all", "neo4j", "milvus"] | None = None
    dry_run: bool | None = None
    entity_ids: list[str] | None = None


class CheckConsistencyRequest(BaseModel):
    project_id: str | None = None


class ValidateRequest(BaseModel):
    proposal_id: str | None = None
    checks: list[str] | None = None
    options: dict[str, Any] | None = None


def _normalize_proposal_id(value: str | None) -> str:
    return value or ""


def _select_effective_entities(
    docs: list[dict[str, Any]], proposal_id: str | None
) -> list[dict[str, Any]]:
    """Merge main/feat entities: feat version overrides main by (project,id,type)."""
    target = _normalize_proposal_id(proposal_id)
    merged: dict[tuple[str, str, str], dict[str, Any]] = {}
    for doc in docs:
        pid = _normalize_proposal_id(doc.get("proposal_id"))
        if target and pid not in {target, ""}:
            continue
        if not target and pid != "":
            continue
        key = (doc.get("source_project", ""), doc.get("id", ""), doc.get("type", ""))
        if pid == "":
            merged.setdefault(key, doc)
        else:
            merged[key] = doc
    return list(merged.values())


def _infer_perspective(entity: dict[str, Any]) -> str | None:
    data = entity.get("data") or {}
    if isinstance(data, dict):
        if isinstance(data.get("perspective"), str):
            return data.get("perspective")
        if isinstance(data.get("process_type"), str):
            return data.get("process_type")
    if isinstance(entity.get("perspective"), str):
        return entity.get("perspective")
    return None


def _build_check_result(status: str, message: str, **kwargs: Any) -> dict[str, Any]:
    payload = {"status": status, "message": message}
    payload.update(kwargs)
    return payload


def _append_suggestion(
    suggestions: list[str], suggestion: str | None, index: int
) -> int:
    if suggestion:
        suggestions.append(f"{index}. {suggestion}")
        return index + 1
    return index


def _write_backup_file(path: str, payload: dict[str, Any], fmt: str) -> int:
    encoded = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    if fmt == "json":
        with open(path, "wb") as fh:
            fh.write(encoded)
        return len(encoded)

    if fmt == "tar.gz":
        with tarfile.open(path, "w:gz") as tar:
            info = tarfile.TarInfo("backup.json")
            info.size = len(encoded)
            tar.addfile(info, io.BytesIO(encoded))
        return len(encoded)

    raise ValueError(f"Unsupported format: {fmt}")


def _read_backup_file(path: str) -> dict[str, Any]:
    if path.endswith(".tar.gz"):
        with tarfile.open(path, "r:gz") as tar:
            member = tar.getmember("backup.json")
            content = tar.extractfile(member)
            if content is None:
                raise ValueError("backup.json not found in archive")
            return json.loads(content.read().decode("utf-8"))
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _normalize_projects(projects: list[str | None]) -> list[str]:
    return [project for project in projects if project]


def _validate_safe_path(input_path: str, root: Path) -> Path:
    candidate = Path(input_path)
    if candidate.is_absolute():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-007",
                "message": "不允许绝对路径",
                "details": {"path": input_path},
            },
        )
    if ".." in candidate.parts:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-007",
                "message": "不允许父目录引用",
                "details": {"path": input_path},
            },
        )
    resolved = (root / candidate).resolve()
    root_resolved = root.resolve()
    if root_resolved != resolved and root_resolved not in resolved.parents:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-006",
                "message": "路径必须在项目根目录内",
                "details": {"path": input_path},
            },
        )
    return resolved


async def _require_permission_for_projects(
    permission_service: PermissionService,
    user_id: str,
    project_ids: list[str],
    action: Literal["read", "write", "approve"],
) -> None:
    if user_id == "anonymous":
        try:
            total = await permission_service.permissions.count_documents({})
        except Exception:
            total = 0
        if total > 0:
            raise HTTPException(
                status_code=403,
                detail={"code": "C4A-PERM-003", "message": "无读权限"},
            )

    denied: list[str] = []
    for project_id in project_ids:
        allowed = await permission_service.check_permission(user_id, project_id, action)
        if not allowed:
            denied.append(project_id)

    if denied:
        code = "C4A-PERM-003" if action == "read" else "C4A-PERM-001"
        message = "无读权限" if action == "read" else "无写权限"
        if action == "approve":
            code = "C4A-PERM-002"
            message = "无批准权限"
        raise HTTPException(
            status_code=403,
            detail={
                "code": code,
                "message": message,
                "user_id": user_id,
                "project_id": ",".join(denied),
            },
        )


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _is_download_path_allowed(path: Path) -> bool:
    allowed_dirs = [
        Path("/tmp"),
        Path("/var/tmp"),
        Path("/private/tmp"),
        Path("/private/var/tmp"),
    ]
    for base in allowed_dirs:
        try:
            if path.is_relative_to(base):
                return True
        except AttributeError:
            if str(path).startswith(str(base)):
                return True
    return False


@router.post("/backup")
async def backup(
    params: BackupRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    output_path = _validate_safe_path(params.output, Path.cwd())
    fmt = params.format or ("tar.gz" if params.output.endswith(".tar.gz") else "json")

    project_ids = await adapter.entities.distinct("source_project")
    await _require_permission_for_projects(
        permission_service, user_id, _normalize_projects(project_ids), "read"
    )

    entities = await adapter.entities.find({}, {"_id": 0}).to_list(length=None)
    relations = await adapter.relations.find({}, {"_id": 0}).to_list(length=None)
    feats = await adapter.feats.find({}, {"_id": 0}).to_list(length=None)

    payload = {
        "version": "0.3.0",
        "exported_at": now_iso(),
        "entities": entities,
        "relations": relations,
        "feats": feats,
        "stats": {
            "entities": len(entities),
            "relations": len(relations),
            "vectors": 0,
        },
    }

    try:
        size = _write_backup_file(str(output_path), payload, fmt)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "success": True,
        "file": str(output_path),
        "size": size,
        "format_version": payload["version"],
        "stats": payload["stats"],
    }


@router.get("/download")
async def download(
    path: str,
    user_id: str = Depends(get_current_user),
) -> FileResponse:
    if user_id == "anonymous":
        raise HTTPException(
            status_code=403,
            detail={"code": "C4A-PERM-003", "message": "无读权限"},
        )
    target = Path(path).resolve()
    if not _is_download_path_allowed(target):
        raise HTTPException(status_code=400, detail="path is not allowed")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(target, filename=target.name)


@router.post("/restore")
async def restore(
    params: RestoreRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    input_path = _validate_safe_path(params.input, Path.cwd())
    try:
        payload = _read_backup_file(str(input_path))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    adapter = await get_mongodb_adapter()
    neo4j = await get_neo4j_adapter()
    conflicts: list[dict[str, Any]] = []

    policy = params.conflict_policy or "override"
    entities = payload.get("entities", [])
    relations = payload.get("relations", [])
    feats = payload.get("feats", [])

    projects_to_check = _normalize_projects(
        [entity.get("source_project") for entity in entities]
    )
    await _require_permission_for_projects(
        permission_service, user_id, list(sorted(set(projects_to_check))), "write"
    )

    for entity in entities:
        if params.validate_checksums and entity.get("content_hash"):
            payload_hash = compute_content_hash(entity.get("data") or {})
            if payload_hash != entity.get("content_hash"):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "C4A-MIGRATE-002",
                        "message": "备份数据校验失败",
                        "details": {
                            "entity_id": entity.get("id"),
                            "expected": entity.get("content_hash"),
                            "actual": payload_hash,
                        },
                    },
                )

        existing = await adapter.get_entity(
            entity["id"], entity.get("source_project"), entity.get("proposal_id")
        )
        if existing and policy == "skip":
            conflicts.append(
                {
                    "entity_id": entity["id"],
                    "reason": "exists",
                    "resolution": "skip",
                }
            )
            continue
        if existing and policy == "error":
            raise HTTPException(
                status_code=409,
                detail={"entity_id": entity["id"], "reason": "exists"},
            )
        if existing and policy == "merge":
            incoming_ts = _parse_iso(entity.get("updated_at"))
            existing_ts = _parse_iso(existing.get("updated_at"))
            if existing_ts and incoming_ts and existing_ts > incoming_ts:
                conflicts.append(
                    {
                        "entity_id": entity["id"],
                        "reason": "stale",
                        "resolution": "skip",
                    }
                )
                continue
        await adapter.save_entity(entity)

    if relations:
        await adapter.save_relations(relations)
        for relation in relations:
            try:
                await neo4j.save_relation(relation)
            except Exception:
                continue

    for feat in feats:
        await adapter.feats.update_one({"id": feat["id"]}, {"$set": feat}, upsert=True)

    stats = {
        "entities": len(entities),
        "relations": len(relations),
        "vectors": 0,
    }

    return {
        "success": True,
        "format_version": payload.get("version"),
        "compatible": True,
        "stats": stats,
        "conflicts": conflicts,
    }


@router.post("/repair")
async def repair(
    params: RepairRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    project_ids = await adapter.entities.distinct("source_project")
    await _require_permission_for_projects(
        permission_service, user_id, _normalize_projects(project_ids), "write"
    )
    neo4j = await get_neo4j_adapter()
    milvus = await get_milvus_adapter()
    scope = params.scope or "all"
    dry_run = params.dry_run or False
    entity_ids = params.entity_ids

    stats = {"neo4j_fixed": 0, "milvus_fixed": 0, "failed": 0}
    inconsistencies: list[dict[str, Any]] = []

    if scope in {"all", "neo4j"}:
        relations = await adapter.relations.find({}, {"_id": 0}).to_list(length=None)
        for relation in relations:
            try:
                if not dry_run:
                    await neo4j.save_relation(relation)
                stats["neo4j_fixed"] += 1
            except Exception as exc:
                stats["failed"] += 1
                inconsistencies.append(
                    {
                        "entity_id": relation.get("id", ""),
                        "issue": f"neo4j_sync_failed: {exc}",
                        "fixed": False,
                    }
                )

    if scope in {"all", "milvus"}:
        query: dict[str, Any] = {}
        if entity_ids:
            query["id"] = {"$in": entity_ids}
        entities = await adapter.entities.find(query, {"_id": 0}).to_list(length=None)
        embedder = EmbeddingService.get_provider()
        for entity in entities:
            try:
                if dry_run:
                    stats["milvus_fixed"] += 1
                    continue
                vector_key = generate_vector_key(
                    entity.get("source_project", ""),
                    entity["id"],
                    entity.get("proposal_id") or None,
                )
                vector = await embedder.embed(entity.get("search_text") or "")
                await milvus.upsert_vector(vector_key, vector)
                stats["milvus_fixed"] += 1
            except Exception as exc:
                stats["failed"] += 1
                inconsistencies.append(
                    {
                        "entity_id": entity.get("id", ""),
                        "issue": f"milvus_sync_failed: {exc}",
                        "fixed": False,
                    }
                )

    scanned = stats["neo4j_fixed"] + stats["milvus_fixed"] + stats["failed"]
    return {
        "success": True,
        "scanned": scanned,
        "inconsistencies": inconsistencies,
        "stats": stats,
    }


@router.post("/check-consistency")
async def check_consistency(
    params: CheckConsistencyRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    query: dict[str, Any] = {}
    if params.project_id:
        query["source_project"] = params.project_id
        await _require_permission_for_projects(
            permission_service, user_id, [params.project_id], "read"
        )
    else:
        project_ids = await adapter.entities.distinct("source_project")
        await _require_permission_for_projects(
            permission_service, user_id, _normalize_projects(project_ids), "read"
        )

    entities = await adapter.entities.find(query, {"id": 1, "sync_status": 1}).to_list(
        length=None
    )
    result: dict[str, Any] = {
        "total": len(entities),
        "synced": 0,
        "pending": 0,
        "failed": 0,
        "no_status": 0,
        "details": [],
    }

    for entity in entities:
        status = entity.get("sync_status")
        if not status:
            result["no_status"] += 1
            continue

        neo4j_status = status.get("neo4j", "unknown")
        milvus_status = status.get("milvus", "unknown")

        neo4j_ok = neo4j_status == "synced"
        milvus_ok = milvus_status == "synced"
        has_failed = neo4j_status == "failed" or milvus_status == "failed"

        if neo4j_ok and milvus_ok:
            result["synced"] += 1
        elif has_failed:
            result["failed"] += 1
            result["details"].append(
                {
                    "id": entity.get("id", ""),
                    "neo4j": neo4j_status,
                    "milvus": milvus_status,
                }
            )
        else:
            result["pending"] += 1
            result["details"].append(
                {
                    "id": entity.get("id", ""),
                    "neo4j": neo4j_status,
                    "milvus": milvus_status,
                }
            )

    return result


@router.post("/validate")
async def validate(
    params: ValidateRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    project_ids = await adapter.entities.distinct("source_project")
    await _require_permission_for_projects(
        permission_service, user_id, _normalize_projects(project_ids), "read"
    )

    proposal_id = params.proposal_id
    target_pid = _normalize_proposal_id(proposal_id)

    checks = params.checks or [
        "functional_spec",
        "technical_spec",
        "contracts",
        "references",
        "adr_completeness",
        "checklist",
    ]

    query: dict[str, Any] = {"proposal_id": target_pid} if target_pid == "" else {
        "proposal_id": {"$in": [target_pid, ""]}
    }
    docs = await adapter.entities.find(query, {"_id": 0}).to_list(length=None)
    entities = _select_effective_entities(docs, proposal_id)
    entity_map = {
        (e.get("source_project", ""), e.get("id", "")): e for e in entities
    }

    by_type: dict[str, list[dict[str, Any]]] = {}
    for entity in entities:
        by_type.setdefault(entity.get("type", ""), []).append(entity)

    check_results: dict[str, Any] = {}
    suggestions: list[str] = []
    suggestion_index = 1

    for check in checks:
        if check == "structure":
            check_results[check] = _build_check_result("passed", "结构检查通过")
            continue

        if check == "relations":
            relation_query: dict[str, Any] = (
                {"proposal_id": {"$in": [target_pid, ""]}} if target_pid else {"proposal_id": ""}
            )
            relations = await adapter.relations.find(relation_query, {"_id": 0}).to_list(
                length=None
            )
            check_results[check] = _build_check_result(
                "passed",
                "关系检查通过" if relations else "关系为空，未发现异常",
                relation_count=len(relations),
            )
            continue

        if check == "functional_spec":
            products = by_type.get("product", [])
            processes = [
                p
                for p in by_type.get("process", [])
                if _infer_perspective(p) in {None, "business"}
            ]
            sors = [
                s
                for s in by_type.get("sor", [])
                if _infer_perspective(s) in {None, "business"}
            ]
            if products or processes or sors:
                check_results[check] = _build_check_result(
                    "passed", "Functional Spec 存在"
                )
            else:
                suggestion = "补充 Product / Business Process / Business SoR"
                check_results[check] = _build_check_result(
                    "warning",
                    "未检测到 Functional Spec 实体",
                    warnings=[
                        {
                            "code": "MISSING_FUNCTIONAL_SPEC",
                            "message": "缺少业务侧规格实体",
                            "suggestion": suggestion,
                        }
                    ],
                )
                suggestion_index = _append_suggestion(
                    suggestions, suggestion, suggestion_index
                )
            continue

        if check == "technical_spec":
            systems = by_type.get("system", [])
            containers = by_type.get("container", [])
            components = by_type.get("component", [])
            errors: list[dict[str, Any]] = []
            for container in containers:
                data = container.get("data") or {}
                if not isinstance(data, dict):
                    data = {}
                if not data.get("system_id"):
                    errors.append(
                        {
                            "code": "MISSING_SYSTEM_REF",
                            "entity_id": container.get("id"),
                            "message": "Container 未关联 System",
                            "suggestion": "设置 data.system_id",
                        }
                    )
            for component in components:
                data = component.get("data") or {}
                if not isinstance(data, dict):
                    data = {}
                if not data.get("container_id"):
                    errors.append(
                        {
                            "code": "MISSING_CONTAINER_REF",
                            "entity_id": component.get("id"),
                            "message": "Component 未关联 Container",
                            "suggestion": "设置 data.container_id",
                        }
                    )
            if systems or containers or components:
                if errors:
                    for err in errors:
                        suggestion_index = _append_suggestion(
                            suggestions, err.get("suggestion"), suggestion_index
                        )
                    check_results[check] = _build_check_result(
                        "error",
                        "Technical Spec 完整性检查失败",
                        errors=errors,
                    )
                else:
                    check_results[check] = _build_check_result(
                        "passed", "Technical Spec 完整"
                    )
            else:
                suggestion = "补充 System/Container/Component 定义"
                check_results[check] = _build_check_result(
                    "error",
                    "未检测到 Technical Spec 实体",
                    errors=[
                        {
                            "code": "MISSING_TECH_SPEC",
                            "message": "缺少技术侧规格实体",
                            "suggestion": suggestion,
                        }
                    ],
                )
                suggestion_index = _append_suggestion(
                    suggestions, suggestion, suggestion_index
                )
            continue

        if check == "contracts":
            contracts = by_type.get("contract", [])
            components = by_type.get("component", [])
            if not contracts and components:
                suggestion = "补充 Contract 实体并关联 Component"
                check_results[check] = _build_check_result(
                    "warning",
                    "契约完备度检查有警告",
                    warnings=[
                        {
                            "code": "MISSING_CONTRACT",
                            "message": "检测到组件但未发现契约",
                            "suggestion": suggestion,
                        }
                    ],
                )
                suggestion_index = _append_suggestion(
                    suggestions, suggestion, suggestion_index
                )
            else:
                check_results[check] = _build_check_result(
                    "passed", "契约检查通过"
                )
            continue

        if check == "references":
            relation_query: dict[str, Any] = (
                {"proposal_id": {"$in": [target_pid, ""]}} if target_pid else {"proposal_id": ""}
            )
            relations = await adapter.relations.find(relation_query, {"_id": 0}).to_list(
                length=None
            )
            dangling: list[dict[str, Any]] = []
            if relations:
                for rel in relations:
                    if rel.get("rel_type") != "REFERENCES":
                        continue
                    target_key = (
                        rel.get("to_project", ""),
                        rel.get("to_id", ""),
                    )
                    if target_key not in entity_map:
                        dangling.append(
                            {
                                "code": "DANGLING_REFERENCE",
                                "entity_id": rel.get("from_id"),
                                "message": "引用目标不存在",
                                "details": {
                                    "to_project": rel.get("to_project"),
                                    "to_id": rel.get("to_id"),
                                },
                            }
                        )
            if not relations:
                check_results[check] = _build_check_result(
                    "warning",
                    "relations 为空，无法校验引用",
                    warnings=[
                        {
                            "code": "RELATIONS_EMPTY",
                            "message": "关系数据缺失",
                            "suggestion": "先执行修复或补齐关系解析",
                        }
                    ],
                )
            elif dangling:
                check_results[check] = _build_check_result(
                    "warning",
                    "存在悬空引用",
                    dangling_count=len(dangling),
                    warnings=dangling,
                )
            else:
                check_results[check] = _build_check_result(
                    "passed", "DSL 引用正确", dangling_count=0
                )
            continue

        if check == "adr_completeness":
            adrs = by_type.get("adr", [])
            warnings: list[dict[str, Any]] = []
            for adr in adrs:
                data = adr.get("data") or {}
                if not isinstance(data, dict):
                    data = {}
                if not data.get("status"):
                    warnings.append(
                        {
                            "code": "ADR_MISSING_STATUS",
                            "entity_id": adr.get("id"),
                            "message": "ADR 缺少 status 字段",
                            "suggestion": "补充 ADR.status",
                        }
                    )
                if not data.get("context") or not data.get("decision"):
                    warnings.append(
                        {
                            "code": "ADR_INCOMPLETE",
                            "entity_id": adr.get("id"),
                            "message": "ADR 缺少 context 或 decision",
                            "suggestion": "补充 ADR.context/decision",
                        }
                    )
            if not adrs and target_pid:
                suggestion = "创建 ADR 记录架构变更"
                warnings.append(
                    {
                        "code": "MISSING_ADR",
                        "message": "未检测到 ADR",
                        "suggestion": suggestion,
                    }
                )
                suggestion_index = _append_suggestion(
                    suggestions, suggestion, suggestion_index
                )
            if warnings:
                for warn in warnings:
                    suggestion_index = _append_suggestion(
                        suggestions, warn.get("suggestion"), suggestion_index
                    )
                check_results[check] = _build_check_result(
                    "warning",
                    "ADR 完备度检查存在警告",
                    warnings=warnings,
                )
            else:
                check_results[check] = _build_check_result(
                    "passed", "ADR 完备度检查通过"
                )
            continue

        if check == "checklist":
            checklist = None
            if target_pid:
                feat = await adapter.feats.find_one({"id": target_pid}, {"_id": 0})
                checklist = feat.get("checklist") if feat else None
            if not checklist:
                check_results[check] = _build_check_result(
                    "warning",
                    "未找到 checklist",
                    warnings=[
                        {
                            "code": "CHECKLIST_MISSING",
                            "message": "feat 未生成 checklist",
                            "suggestion": "执行 c4a_store_feat_checklist(generate)",
                        }
                    ],
                )
            else:
                items = checklist.get("items") or []
                total = len(items)
                completed = len(
                    [
                        item
                        for item in items
                        if item.get("status") in {"done", "completed", "success"}
                    ]
                )
                blocked = [
                    item
                    for item in items
                    if item.get("status") == "blocked" or item.get("blocked_reason")
                ]
                percentage = int((completed / total) * 100) if total else 0
                check_results[check] = _build_check_result(
                    "passed",
                    "Checklist 已生成",
                    progress={
                        "completed": completed,
                        "total": total,
                        "percentage": percentage,
                    },
                    blocked=blocked,
                )
            continue

        check_results[check] = _build_check_result(
            "warning", f"未知检查项: {check}"
        )

    passed = sum(1 for result in check_results.values() if result["status"] == "passed")
    warnings = sum(1 for result in check_results.values() if result["status"] == "warning")
    errors = sum(1 for result in check_results.values() if result["status"] == "error")
    if errors > 0:
        status = "failed"
    elif warnings > 0:
        status = "warnings"
    else:
        status = "passed"

    return {
        "success": True,
        "proposal_id": proposal_id,
        "summary": {
            "passed": passed,
            "warnings": warnings,
            "errors": errors,
            "status": status,
        },
        "checks": check_results,
        "suggestions": suggestions,
    }
