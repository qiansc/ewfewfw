from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Any

from ..adapters.mongodb import MongoDBAdapter
from ..models.permission import ProjectPermission, Role


class PermissionService:
    def __init__(self, mongodb: MongoDBAdapter, allow_empty: bool | None = None):
        self.permissions = mongodb.db["project_permissions"]
        if allow_empty is None:
            allow_empty = os.getenv("C4A_PERMISSION_ALLOW_EMPTY", "true").lower() in {
                "1",
                "true",
                "yes",
                "on",
            }
        self.allow_empty = allow_empty

    async def check_permission(
        self, user_id: str, project_id: str, action: str
    ) -> bool:
        if self.allow_empty:
            total = await self.permissions.count_documents({})
            if total == 0:
                return True
            project_total = await self.permissions.count_documents(
                {"project_id": project_id}
            )
            if project_total == 0:
                return True

        permission = await self.permissions.find_one(
            {
                "user_id": user_id,
                "project_id": project_id,
            }
        )

        if not permission:
            return False

        role = permission.get("role")

        if action == "read":
            return role in ["admin", "writer", "reader"]
        if action == "write":
            return role in ["admin", "writer"]
        if action == "approve":
            return role == "admin"

        return False

    async def check_read(self, user_id: str, project_id: str) -> bool:
        return await self.check_permission(user_id, project_id, "read")

    async def check_write(self, user_id: str, project_id: str) -> bool:
        return await self.check_permission(user_id, project_id, "write")

    async def check_approve(self, user_id: str, project_id: str) -> bool:
        return await self.check_permission(user_id, project_id, "approve")

    async def list_permissions(self, project_id: str) -> list[dict[str, Any]]:
        cursor = self.permissions.find({"project_id": project_id})
        return await cursor.to_list(length=None)

    async def get_user_projects(self, user_id: str) -> list[str]:
        cursor = self.permissions.find({"user_id": user_id})
        permissions = await cursor.to_list(length=None)
        return [permission["project_id"] for permission in permissions]

    async def grant_permission(
        self,
        project_id: str,
        user_id: str,
        role: Role,
        granted_by: str | None = None,
    ) -> dict[str, Any]:
        permission = ProjectPermission(
            project_id=project_id,
            user_id=user_id,
            role=role,
            granted_at=datetime.now(timezone.utc),
            granted_by=granted_by,
        )
        payload = permission.model_dump()
        await self.permissions.update_one(
            {"project_id": project_id, "user_id": user_id},
            {"$set": payload},
            upsert=True,
        )
        return payload

    async def revoke_permission(self, project_id: str, user_id: str) -> bool:
        result = await self.permissions.delete_one(
            {"project_id": project_id, "user_id": user_id}
        )
        return result.deleted_count > 0

    async def check_cross_project_publish(
        self, user_id: str, project_ids: list[str]
    ) -> dict[str, Any]:
        results: dict[str, Any] = {"allowed": True, "missing": []}

        for project_id in project_ids:
            has_permission = await self.check_permission(
                user_id, project_id, "approve"
            )
            if not has_permission:
                results["allowed"] = False
                results["missing"].append(project_id)

        return results
