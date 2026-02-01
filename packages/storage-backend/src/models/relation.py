from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class RelationInput(BaseModel):
    id: str
    proposal_id: str | None = Field(default="")
    from_project: str | None = Field(default="")
    from_id: str
    to_project: str | None = Field(default="")
    to_id: str
    rel_type: str
    status: Literal["active", "deleted"] = "active"
    properties: dict[str, Any] | None = None

    @field_validator("proposal_id", "from_project", "to_project", mode="before")
    @classmethod
    def normalize_empty(cls, value: str | None) -> str:
        return value or ""


class RelationSaveResponse(BaseModel):
    success: bool
    inserted: int = 0
    modified: int = 0
