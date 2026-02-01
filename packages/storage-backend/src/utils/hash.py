from __future__ import annotations

import hashlib
import json
from typing import Any

EXCLUDE_FIELDS = {
    "created_at",
    "updated_at",
    "content_hash",
    "proposal_id",
    "_id",
    "__v",
}


def compute_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def normalize_for_hash(value: Any) -> Any:
    if value is None:
        return None

    if isinstance(value, list):
        return [normalize_for_hash(item) for item in value]

    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key in sorted(value.keys()):
            if key in EXCLUDE_FIELDS:
                continue
            child = value.get(key)
            if child is not None:
                normalized[key] = normalize_for_hash(child)
        return normalized

    return value


def compute_content_hash(entity: dict[str, Any]) -> str:
    normalized = normalize_for_hash(entity)
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    return compute_hash(payload)
