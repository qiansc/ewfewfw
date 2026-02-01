from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..dependencies import get_user_visible_projects
from ..services.database import get_milvus_adapter, get_mongodb_adapter
from ..services.embedding import EmbeddingService
from ..utils.vector import parse_vector_key

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    scope: str | None = None
    proposal_id: str | None = None
    limit: int | None = None
    offset: int | None = None


@router.post("")
async def search(
    params: SearchRequest,
    project_ids: list[str] = Depends(get_user_visible_projects),
) -> dict[str, Any]:
    allow_all = "*" in project_ids
    if not project_ids and not allow_all:
        return {
            "items": [],
            "degraded": False,
            "search_mode": "permission",
            "total": 0,
            "has_more": False,
        }
    adapter = await get_mongodb_adapter()
    limit = params.limit or 10
    offset = params.offset or 0
    vector_items: list[dict[str, Any]] = []
    degraded_reason: str | None = None
    degraded_message: str | None = None
    search_mode = "vector"
    try:
        embedder = EmbeddingService.get_provider()
        vector = await embedder.embed(params.query)
        milvus = await get_milvus_adapter()
        hits = await milvus.search(vector, limit=max(limit * 3, limit))
        for hit in hits:
            vector_key = None
            if isinstance(hit, dict):
                vector_key = hit.get("vector_key")
                if not vector_key:
                    entity_fields = hit.get("entity")
                    if isinstance(entity_fields, dict):
                        vector_key = entity_fields.get("vector_key")
                if not vector_key:
                    vector_key = hit.get("id")
            else:
                vector_key = getattr(hit, "vector_key", None)
                if not vector_key:
                    entity_fields = getattr(hit, "entity", None)
                    if isinstance(entity_fields, dict):
                        vector_key = entity_fields.get("vector_key")
                if not vector_key:
                    vector_key = getattr(hit, "id", None)
            if not vector_key:
                continue
            try:
                parsed = parse_vector_key(vector_key)
            except Exception:
                continue
            if params.proposal_id is not None:
                if (parsed.get("proposal_id") or "") != (params.proposal_id or ""):
                    continue
            entity = await adapter.get_entity(
                parsed["entity_id"],
                parsed.get("source_project"),
                parsed.get("proposal_id") or "",
            )
            if not entity:
                continue
            if params.scope and params.scope != "all":
                if entity.get("type") != params.scope:
                    continue
            if not allow_all and entity.get("source_project") not in project_ids:
                continue
            score_value = 0.0
            if isinstance(hit, dict):
                score_value = float(hit.get("score") or hit.get("distance") or 0.0)
            else:
                score_value = float(getattr(hit, "score", None) or getattr(hit, "distance", 0.0))

            vector_items.append(
                {
                    "id": entity["id"],
                    "type": entity["type"],
                    "score": score_value,
                    "snippet": (entity.get("search_text") or "")[:120],
                    "metadata": {
                        "source_project": entity.get("source_project", ""),
                        "status": entity.get("status", "draft"),
                        "content_hash": entity.get("content_hash", ""),
                        "updated_at": entity.get("updated_at", ""),
                    },
                }
            )
            if len(vector_items) >= limit:
                break
    except Exception as exc:
        degraded_reason = "VECTOR_SEARCH_FAILED"
        degraded_message = str(exc)
        search_mode = "like"

    if vector_items:
        return {
            "items": vector_items,
            "degraded": False,
            "search_mode": "vector",
            "total": len(vector_items),
            "has_more": False,
        }

    if degraded_reason is None:
        degraded_reason = "NO_VECTOR_RESULTS"
        degraded_message = "Vector search returned empty results, using LIKE fallback."

    query: dict[str, Any] = {"search_text": {"$regex": params.query, "$options": "i"}}
    if params.scope and params.scope != "all":
        query["type"] = params.scope
    if params.proposal_id is not None:
        query["proposal_id"] = params.proposal_id or ""
    if not allow_all:
        query["source_project"] = {"$in": project_ids}

    total = await adapter.count_entities(query)
    docs = await adapter.list_entities(query, limit, offset)
    items = [
        {
            "id": doc["id"],
            "type": doc["type"],
            "score": 1.0,
            "snippet": (doc.get("search_text") or "")[:120],
            "metadata": {
                "source_project": doc.get("source_project", ""),
                "status": doc.get("status", "draft"),
                "content_hash": doc.get("content_hash", ""),
                "updated_at": doc.get("updated_at", ""),
            },
        }
        for doc in docs
    ]

    return {
        "items": items,
        "degraded": True,
        "degraded_reason": degraded_reason,
        "degraded_message": degraded_message,
        "search_mode": search_mode,
        "total": total,
        "has_more": offset + limit < total,
    }
