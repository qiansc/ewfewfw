from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..dependencies import get_current_user, get_permission_service
from ..services.permission import PermissionService

router = APIRouter()


async def _require_write_permission_for_all_projects(
    user_id: str,
    permission_service: PermissionService,
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
    from ..services.database import get_mongodb_adapter

    adapter = await get_mongodb_adapter()
    project_ids = await adapter.entities.distinct("source_project")
    denied = []
    for project_id in project_ids:
        if not project_id:
            continue
        allowed = await permission_service.check_permission(user_id, project_id, "write")
        if not allowed:
            denied.append(project_id)
    if denied:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-001",
                "message": "无写权限",
                "user_id": user_id,
                "project_id": ",".join(denied),
            },
        )


class SyncRequest(BaseModel):
    direction: Literal["import", "export"]
    path: str | None = None
    mode: Literal["incremental", "full"] | None = None
    status_filter: Literal["published", "approved", "all"] | None = None
    format: Literal["yaml", "json"] | None = None
    conflict_policy: Literal["warn", "skip", "override", "prompt"] | None = None


class LocalFileInfo(BaseModel):
    path: str
    entity_id: str
    type: str
    content_hash: str
    updated_at: str
    proposal_id: str | None = None
    content: str | None = None


class PlanSyncRequest(BaseModel):
    local_manifest: dict[str, list[LocalFileInfo]]
    snapshot: dict[str, Any] | None = None
    options: dict[str, Any] | None = None
    execute: bool | None = None


@router.post("")
async def sync(
    _: SyncRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    await _require_write_permission_for_all_projects(user_id, permission_service)
    return {
        "success": True,
        "stats": {
            "scanned": 0,
            "created": 0,
            "updated": 0,
            "skipped": 0,
            "conflicted": 0,
            "failed": 0,
        },
        "details": [],
        "conflicts": [],
    }


@router.post("/plan")
async def plan_sync(
    params: PlanSyncRequest,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> dict[str, Any]:
    await _require_write_permission_for_all_projects(user_id, permission_service)
    from ..services.database import get_mongodb_adapter

    adapter = await get_mongodb_adapter()
    files = params.local_manifest.get("files", [])
    conflict_policy = (params.options or {}).get("conflict_policy", "warn")

    to_upload = []
    conflicts = []
    unchanged = []

    for file in files:
        proposal_id = file.proposal_id or ""
        remote = await adapter.get_entity(file.entity_id, None, proposal_id)
        if not remote:
            to_upload.append(
                {
                    "op": "upload",
                    "entity_id": file.entity_id,
                    "type": file.type,
                    "path": file.path,
                    "content": file.content,
                    "content_hash": file.content_hash,
                }
            )
            continue

        remote_hash = remote.get("content_hash")
        if remote_hash == file.content_hash:
            unchanged.append(file.entity_id)
            continue

        if conflict_policy == "override":
            to_upload.append(
                {
                    "op": "upload",
                    "entity_id": file.entity_id,
                    "type": file.type,
                    "path": file.path,
                    "content": file.content,
                    "content_hash": file.content_hash,
                    "expected_hash": remote_hash,
                }
            )
        elif conflict_policy == "skip":
            unchanged.append(file.entity_id)
        else:
            conflicts.append(
                {
                    "entity_id": file.entity_id,
                    "conflict_type": "both_modified",
                    "local_hash": file.content_hash,
                    "remote_hash": remote_hash,
                }
            )

    return {
        "plan": {
            "to_upload": to_upload,
            "to_download": [],
            "to_delete_local": [],
            "to_delete_remote": [],
            "conflicts": conflicts,
            "unchanged": unchanged,
        },
        "executed": False,
    }
