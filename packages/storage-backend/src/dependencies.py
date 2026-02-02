from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import Body, Depends, HTTPException, Request

from .adapters.mongodb import MongoDBAdapter
from .config import load_settings
from .models.permission import PermissionGrant
from .services.permission import PermissionService

_mongodb: MongoDBAdapter | None = None
_permission_service: PermissionService | None = None


def init_services(mongodb: MongoDBAdapter) -> None:
    global _mongodb, _permission_service
    _mongodb = mongodb
    settings = load_settings()
    _permission_service = PermissionService(
        mongodb, allow_empty=settings.permission_allow_empty
    )


def reset_services() -> None:
    global _mongodb, _permission_service
    _mongodb = None
    _permission_service = None


def get_permission_service() -> PermissionService:
    if _permission_service is None:
        raise RuntimeError("Services not initialized")
    return _permission_service


def get_mongodb() -> MongoDBAdapter:
    if _mongodb is None:
        raise RuntimeError("Services not initialized")
    return _mongodb


async def get_current_user(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        user_id = request.headers.get("X-User-ID", "anonymous")
    return user_id


def _extract_metadata_project(metadata: Any) -> str | None:
    if not metadata:
        return None
    if isinstance(metadata, dict):
        return metadata.get("source_project")
    return getattr(metadata, "source_project", None)


def _normalize_project_ids(projects: Iterable[str | None]) -> list[str]:
    return [project for project in projects if project]


def _raise_missing_project() -> None:
    raise HTTPException(
        status_code=400,
        detail={
            "code": "C4A-INPUT-001",
            "message": "缺少 project_id",
            "details": {"field": "project_id"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


async def require_write_permission(
    project_id: str,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> str:
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
    return user_id


async def require_approve_permission(
    project_id: str,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> str:
    allowed = await permission_service.check_permission(user_id, project_id, "approve")
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-002",
                "message": "无批准权限",
                "user_id": user_id,
                "project_id": project_id,
            },
        )
    return user_id


async def check_entity_permission(
    entity: Any = Body(...),
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> str:
    project_id = getattr(entity, "source_project", None)
    if not project_id and isinstance(entity, dict):
        project_id = entity.get("source_project")
    if not project_id:
        project_id = _extract_metadata_project(getattr(entity, "metadata", None))
    if not project_id and isinstance(entity, dict):
        project_id = _extract_metadata_project(entity.get("metadata"))

    if not project_id:
        _raise_missing_project()

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
    return user_id


async def check_relation_permission(
    relation: Any = Body(...),
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> str:
    from_project = getattr(relation, "from_project", None)
    to_project = getattr(relation, "to_project", None)
    if isinstance(relation, dict):
        from_project = relation.get("from_project", from_project)
        to_project = relation.get("to_project", to_project)

    projects = _normalize_project_ids([from_project, to_project])
    if not projects:
        _raise_missing_project()

    denied = []
    for project_id in projects:
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
    return user_id


async def check_read_permission(
    project_id: str,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> str:
    if user_id == "anonymous":
        raise HTTPException(
            status_code=403,
            detail={"code": "C4A-PERM-003", "message": "无读权限"},
        )

    allowed = await permission_service.check_permission(user_id, project_id, "read")
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={"code": "C4A-PERM-003", "message": "无读权限"},
        )
    return user_id


async def get_user_visible_projects(
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
    mongodb: MongoDBAdapter = Depends(get_mongodb),
) -> list[str]:
    if user_id == "anonymous":
        total = await mongodb.permissions.count_documents({})
        if total == 0:
            return ["*"]
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-003",
                "message": "无读权限",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
    total = await mongodb.permissions.count_documents({})
    if total == 0:
        return ["*"]
    return await permission_service.get_user_projects(user_id)


async def require_approve_permission_from_body(
    request: Request,
    user_id: str = Depends(get_current_user),
    permission_service: PermissionService = Depends(get_permission_service),
) -> str:
    try:
        payload: Any = await request.json()
    except Exception:
        payload = {}
    project_id = getattr(payload, "project_id", None)
    if not project_id and isinstance(payload, dict):
        project_id = payload.get("project_id")
    if not project_id:
        _raise_missing_project()
    allowed = await permission_service.check_permission(user_id, project_id, "approve")
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "C4A-PERM-002",
                "message": "无批准权限",
                "user_id": user_id,
                "project_id": project_id,
            },
        )
    return user_id
