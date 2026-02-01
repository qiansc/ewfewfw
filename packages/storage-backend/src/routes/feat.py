from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.database import get_mongodb_adapter

router = APIRouter()


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


class ChecklistRequest(BaseModel):
    action: Literal["generate", "get", "patch", "clear"]
    feat_id: str
    source: str | None = None
    patches: list[ChecklistPatch] | None = None
    validate: bool | None = None


class WorkflowStepRequest(BaseModel):
    feat_id: str
    step_id: str
    status: str | None = None
    metadata: dict[str, Any] | None = None


@router.post("/lifecycle")
async def feat_lifecycle(params: FeatLifecycleRequest) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    feats = adapter.feats
    feat = await feats.find_one({"id": params.feat_id}, {"_id": 0})

    if params.action == "create":
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
        to_status = params.to_status or feat.get("status", "draft")
        await feats.update_one(
            {"id": params.feat_id},
            {"$set": {"status": to_status, "updated_at": now_iso()}},
        )
        return {
            "success": True,
            "feat_id": params.feat_id,
            "from_status": feat.get("status"),
            "to_status": to_status,
            "status": to_status,
        }

    if params.action == "delete":
        await feats.delete_one({"id": params.feat_id})
        return {"success": True, "feat_id": params.feat_id, "deleted": True}

    raise HTTPException(status_code=400, detail="Unsupported action")


@router.post("/merge")
async def feat_merge(params: FeatMergeRequest) -> dict[str, Any]:
    return {"success": True, "merged": [], "conflicts": []}


@router.post("/checklist")
async def feat_checklist(params: ChecklistRequest) -> dict[str, Any]:
    adapter = await get_mongodb_adapter()
    feats = adapter.feats
    feat = await feats.find_one({"id": params.feat_id})
    if not feat:
        return {"success": False, "feat_id": params.feat_id, "error": "feat not found"}

    checklist = feat.get("checklist")

    if params.action == "generate":
        checklist = {
            "version": uuid4().hex,
            "metadata": {"feat_id": params.feat_id, "generated_at": now_iso()},
            "updated_at": now_iso(),
            "items": [],
        }
        await feats.update_one({"id": params.feat_id}, {"$set": {"checklist": checklist}})
        return {"success": True, "feat_id": params.feat_id, "checklist": checklist}

    if params.action == "get":
        if not checklist:
            return {"success": False, "feat_id": params.feat_id, "error": "checklist not found"}
        return {"success": True, "feat_id": params.feat_id, "checklist": checklist}

    if params.action == "clear":
        await feats.update_one({"id": params.feat_id}, {"$set": {"checklist": None}})
        return {"success": True, "feat_id": params.feat_id, "cleared": True}

    if params.action == "patch":
        if not checklist:
            return {"success": False, "feat_id": params.feat_id, "error": "checklist not found"}
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
        checklist["items"] = list(items.values())
        checklist["updated_at"] = now_iso()
        await feats.update_one({"id": params.feat_id}, {"$set": {"checklist": checklist}})
        return {
            "success": True,
            "feat_id": params.feat_id,
            "patched_at": checklist["updated_at"],
            "patched_tasks": updated_tasks,
            "updated_checklist": checklist,
        }

    raise HTTPException(status_code=400, detail="Unsupported action")


@router.post("/workflow-step")
async def update_workflow_step(params: WorkflowStepRequest) -> dict[str, Any]:
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
