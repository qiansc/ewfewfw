from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Role(str, Enum):
    ADMIN = "admin"
    WRITER = "writer"
    READER = "reader"


class ProjectPermission(BaseModel):
    project_id: str
    user_id: str
    role: Role
    granted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    granted_by: str | None = None


class PermissionCheck(BaseModel):
    user_id: str
    project_id: str
    action: Literal["read", "write", "approve"]


class PermissionGrant(BaseModel):
    project_id: str
    user_id: str
    role: Role
    granted_by: str | None = None


class PermissionRevoke(BaseModel):
    project_id: str
    user_id: str
