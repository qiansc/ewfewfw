from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import (
    get_current_user,
    get_permission_service,
    require_approve_permission,
)
from ..models.permission import PermissionCheck, PermissionGrant
from ..services.permission import PermissionService

router = APIRouter()


@router.post("/check")
async def check_permission(
    check: PermissionCheck,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
):
    if check.user_id != user_id:
        allowed = await permission_service.check_permission(
            user_id, check.project_id, "approve"
        )
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "C4A-PERM-002",
                    "message": "无批准权限",
                    "user_id": user_id,
                    "project_id": check.project_id,
                },
            )
    allowed = await permission_service.check_permission(
        check.user_id, check.project_id, check.action
    )
    return {"allowed": allowed}


@router.get("/{project_id}")
async def get_project_permissions(
    project_id: str,
    _user_id: str = Depends(require_approve_permission),
    permission_service: PermissionService = Depends(get_permission_service),
):
    permissions = await permission_service.list_permissions(project_id)
    return {"permissions": permissions}


@router.post("/")
async def grant_permission(
    grant: PermissionGrant,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
):
    allowed = await permission_service.check_permission(
        user_id, grant.project_id, "approve"
    )
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-002",
                "message": "无批准权限",
                "user_id": user_id,
                "project_id": grant.project_id,
            },
        )
    permission = await permission_service.grant_permission(
        grant.project_id,
        grant.user_id,
        grant.role,
        grant.granted_by or user_id,
    )
    return {"success": True, "permission": permission}


@router.delete("/")
async def revoke_permission(
    project_id: str,
    user_id: str,
    _actor_id: str = Depends(require_approve_permission),
    permission_service: PermissionService = Depends(get_permission_service),
):
    removed = await permission_service.revoke_permission(project_id, user_id)
    return {"success": True, "removed": removed}
