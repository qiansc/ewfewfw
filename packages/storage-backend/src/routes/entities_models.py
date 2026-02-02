from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

VALID_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["approved", "archived"],
    "approved": ["published"],
    "published": ["deprecated"],
    "deprecated": ["archived"],
    "archived": [],
}


def is_valid_status_transition(from_status: str, to_status: str) -> bool:
    return to_status in VALID_STATUS_TRANSITIONS.get(from_status, [])


class AdrPolicyRequest(BaseModel):
    enforce: bool | None = None
    scope: list[Literal["system", "container", "component"]] | None = None
    on_missing: Literal["error", "warning", "ignore"] | None = None


class SaveRequest(BaseModel):
    type: str
    data: dict[str, Any] | None = None
    content: str | None = None
    format: Literal["yaml", "json"] | None = None
    id: str | None = None
    source_project: str | None = None
    proposal_id: str | None = None
    enforce_adr: bool | None = None
    adr_policy: AdrPolicyRequest | None = None
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
