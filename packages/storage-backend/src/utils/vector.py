from __future__ import annotations

import hashlib


def generate_vector_key(source_project: str, entity_id: str, proposal_id: str | None) -> str:
    return f"{source_project}:{entity_id}:{proposal_id or ''}"


def parse_vector_key(vector_key: str) -> dict[str, str | None]:
    parts = vector_key.split(":")
    if len(parts) < 3:
        raise ValueError(f"Invalid vector key format: {vector_key}")
    return {
        "source_project": parts[0],
        "entity_id": parts[1],
        "proposal_id": parts[2] or None,
    }


def vector_id_from_key(vector_key: str) -> int:
    digest = hashlib.sha256(vector_key.encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big", signed=False)
    return value % (2**63)
