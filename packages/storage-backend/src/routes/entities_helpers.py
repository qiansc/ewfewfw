from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import HTTPException

from .entities_models import SaveRequest

try:  # optional dependency
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(text: str | None) -> str:
    return text or ""


def normalize_proposal_id(value: str | None) -> str:
    if not value:
        return ""
    return value.strip()


def normalize_source_project(value: str | None) -> str:
    if not value:
        return ""
    return value.strip()


def pick_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def to_kebab_case(value: str) -> str:
    result = value.strip().lower()
    result = re.sub(r"[\s_]+", "-", result)
    result = re.sub(r"[^a-z0-9-]", "", result)
    result = re.sub(r"-+", "-", result)
    result = result.strip("-")
    return result


def extract_sequence_from_id(entity_id: str, prefix: str) -> str | None:
    if not entity_id.startswith(f"{prefix}-"):
        return None
    rest = entity_id[len(prefix) + 1 :]
    if prefix in {"adr", "feat"}:
        match = re.match(r"^([a-z]\d{3})(?:-.+)?$", rest)
        return match.group(1) if match else None
    match = re.match(r"^([a-z]\d{3})$", rest)
    return match.group(1) if match else None


def compare_sequence(a: str, b: str) -> int:
    if a[0] != b[0]:
        return ord(a[0]) - ord(b[0])
    return int(a[1:]) - int(b[1:])


def increment_sequence(seq: str) -> str:
    if not re.match(r"^[a-z]\d{3}$", seq):
        raise ValueError(f"Invalid sequence format: {seq}")
    letter = seq[0]
    num = int(seq[1:])
    if num < 999:
        return f"{letter}{num + 1:03d}"
    if letter == "z":
        raise ValueError("Sequence overflow: reached z999")
    return f"{chr(ord(letter) + 1)}001"


def get_initial_sequence() -> str:
    return "a001"


async def get_next_sequence(adapter: Any, source_project: str, prefix: str) -> str:
    query: dict[str, Any] = {
        "id": {"$regex": f"^{prefix}-"},
        "source_project": source_project,
    }
    cursor = adapter.entities.find(query, {"id": 1})
    docs = await cursor.to_list(length=None)
    max_sequence: str | None = None
    for doc in docs:
        entity_id = doc.get("id")
        if not isinstance(entity_id, str):
            continue
        sequence = extract_sequence_from_id(entity_id, prefix)
        if not sequence:
            continue
        if not max_sequence or compare_sequence(sequence, max_sequence) > 0:
            max_sequence = sequence
    return increment_sequence(max_sequence) if max_sequence else get_initial_sequence()


def get_name_for_auto_id(entity_type: str, data: dict[str, Any]) -> str | None:
    root_name = pick_string(data.get("name"))
    if root_name:
        return root_name
    block = data.get(entity_type)
    if isinstance(block, dict):
        block_name = pick_string(block.get("name"))
        if block_name:
            return block_name
        if entity_type == "adr":
            title = pick_string(block.get("title"))
            if title:
                return title
    if entity_type == "adr":
        return pick_string(data.get("title"))
    return None


def resolve_sor_perspective(sor_type: str | None) -> Literal["business", "technical"] | None:
    if not sor_type:
        return None
    business_types = {
        "business_rule",
        "business_data",
        "report",
        "communication",
        "user_interface",
        "kpi",
    }
    technical_types = {"non_functional", "utility", "message"}
    if sor_type in business_types:
        return "business"
    if sor_type in technical_types:
        return "technical"
    return None


def get_perspective_for_auto_id(
    entity_type: str, data: dict[str, Any]
) -> Literal["business", "technical"] | None:
    direct = pick_string(data.get("perspective"))
    if direct in {"business", "technical"}:
        return direct  # type: ignore[return-value]
    if entity_type == "process":
        block = data.get("process") if isinstance(data.get("process"), dict) else None
        process_type = pick_string(block.get("process_type") if block else data.get("process_type"))
        if process_type in {"business", "technical"}:
            return process_type  # type: ignore[return-value]
    if entity_type == "sor":
        block = data.get("sor") if isinstance(data.get("sor"), dict) else None
        sor_type = pick_string(block.get("sor_type") if block else data.get("sor_type"))
        return resolve_sor_perspective(sor_type)
    return None


def apply_generated_id(entity_type: str, data: dict[str, Any], entity_id: str) -> None:
    if not isinstance(data.get("id"), str):
        data["id"] = entity_id
    block = data.get(entity_type)
    if isinstance(block, dict) and not isinstance(block.get("id"), str):
        block["id"] = entity_id


async def generate_auto_id(
    adapter: Any,
    source_project: str,
    entity_type: str,
    data: dict[str, Any],
) -> str | None:
    name = get_name_for_auto_id(entity_type, data)
    if not name:
        return None
    if entity_type in {"system", "container", "component", "product", "contract"}:
        return to_kebab_case(name)
    if entity_type == "adr":
        sequence = await get_next_sequence(adapter, source_project, "adr")
        slug = to_kebab_case(name)
        return f"adr-{sequence}-{slug}" if slug else f"adr-{sequence}"
    if entity_type == "process":
        perspective = get_perspective_for_auto_id("process", data)
        if not perspective:
            return None
        prefix = "prc-b" if perspective == "business" else "prc-t"
        sequence = await get_next_sequence(adapter, source_project, prefix)
        return f"{prefix}-{sequence}"
    if entity_type == "sor":
        perspective = get_perspective_for_auto_id("sor", data)
        if not perspective:
            return None
        prefix = "sor-b" if perspective == "business" else "sor-t"
        sequence = await get_next_sequence(adapter, source_project, prefix)
        return f"{prefix}-{sequence}"
    return None


def _normalize_relation_type(value: str | None, fallback: str = "DEPENDS_ON") -> str:
    if not value:
        return fallback
    return value.upper().replace("-", "_")


def _extract_entity_id(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, dict):
        entity_id = value.get("id")
        if isinstance(entity_id, str) and entity_id:
            return entity_id
    return None


def _normalize_properties(props: dict[str, Any] | None) -> dict[str, Any] | None:
    if not props:
        return None
    normalized = {key: value for key, value in props.items() if value is not None}
    return normalized or None


def _build_relation_id(
    proposal_id: str,
    from_project: str,
    from_id: str,
    to_project: str,
    to_id: str,
    rel_type: str,
) -> str:
    key = f"{proposal_id}|{from_project}|{from_id}|{to_project}|{to_id}|{rel_type}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


_RE_SCOPE = re.compile(r"^scope:([^/]+)/(.+)$")
_RE_REPO_PROJECT = re.compile(r"^repo:([^/]+/[^/]+)/project:([^/]+)/(.+)$")
_RE_REPO = re.compile(r"^repo:([^/]+/[^/]+)/(.+)$")
_RE_PROJECT = re.compile(r"^project:([^/]+)/(.+)$")


def _parse_reference_target(ref: str, source_project: str) -> tuple[str, str, dict[str, Any] | None]:
    target_repo: str | None = None
    target_project: str | None = None
    target_scope: str | None = None
    target_id = ref

    match = _RE_SCOPE.match(ref)
    if match:
        target_scope = match.group(1)
        target_id = match.group(2)
    else:
        match = _RE_REPO_PROJECT.match(ref)
        if match:
            target_repo = match.group(1)
            target_project = match.group(2)
            target_id = match.group(3)
        else:
            match = _RE_REPO.match(ref)
            if match:
                target_repo = match.group(1)
                target_id = match.group(2)
            else:
                match = _RE_PROJECT.match(ref)
                if match:
                    target_project = match.group(1)
                    target_id = match.group(2)

    properties: dict[str, Any] = {}
    if target_repo:
        properties["target_repo"] = target_repo
    if target_project:
        properties["target_project"] = target_project
    if target_scope:
        properties["target_scope"] = target_scope

    if target_project is not None:
        to_project = target_project
    elif target_scope or target_repo:
        to_project = ""
    else:
        to_project = source_project

    return target_id, to_project, _normalize_properties(properties)


def _extract_reference_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    refs: list[str] = []
    for item in value:
        if isinstance(item, str) and item:
            refs.append(item)
            continue
        if isinstance(item, dict):
            ref_value = item.get("ref") or item.get("reference") or item.get("id")
            if isinstance(ref_value, str) and ref_value:
                refs.append(ref_value)
    return refs


def _find_references(data: dict[str, Any], entity_type: str) -> list[str]:
    refs = set(_extract_reference_list(data.get("references")))
    entity_key = {
        "system": "system",
        "container": "container",
        "component": "component",
        "product": "product",
        "process": "process",
        "sor": "sor",
        "adr": "adr",
        "contract": "contract",
    }.get(entity_type)
    if entity_key and isinstance(data.get(entity_key), dict):
        refs.update(_extract_reference_list(data[entity_key].get("references")))
    return list(refs)


def _diff_fields(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
    prefix: str = "",
) -> list[str]:
    if previous is None:
        return []
    diffs: list[str] = []
    keys = set(previous.keys()) | set(current.keys())
    for key in keys:
        path = f"{prefix}.{key}" if prefix else key
        prev_value = previous.get(key)
        next_value = current.get(key)
        if isinstance(prev_value, dict) and isinstance(next_value, dict):
            diffs.extend(_diff_fields(prev_value, next_value, path))
            continue
        if prev_value != next_value:
            diffs.append(path)
    return diffs


def _parse_relations(
    data: dict[str, Any],
    entity_type: str,
    source_project: str,
    entity_id: str,
    proposal_id: str,
) -> list[dict[str, Any]]:
    relations: list[dict[str, Any]] = []
    relation_keys: set[str] = set()
    handled_relationships = False

    def push_relation(
        from_project: str,
        from_id: str,
        to_project: str,
        to_id: str,
        rel_type: str,
        props: dict[str, Any] | None = None,
    ) -> None:
        key = f"{from_project}|{from_id}|{to_project}|{to_id}|{rel_type}"
        if key in relation_keys:
            return
        relation_keys.add(key)
        relations.append(
            {
                "id": _build_relation_id(
                    proposal_id, from_project, from_id, to_project, to_id, rel_type
                ),
                "proposal_id": proposal_id,
                "from_project": from_project,
                "from_id": from_id,
                "to_project": to_project,
                "to_id": to_id,
                "rel_type": rel_type,
                "status": "active",
                "properties": _normalize_properties(props),
            }
        )

    def add_outgoing(target_ref: str, rel_type: str, props: dict[str, Any] | None = None) -> None:
        target_id, to_project, target_props = _parse_reference_target(target_ref, source_project)
        merged = {**(target_props or {}), **(props or {})}
        push_relation(source_project, entity_id, to_project, target_id, rel_type, merged)

    def add_incoming(source_ref: str, rel_type: str, props: dict[str, Any] | None = None) -> None:
        source_id, from_project, source_props = _parse_reference_target(source_ref, source_project)
        merged = {**(source_props or {}), **(props or {})}
        push_relation(from_project, source_id, source_project, entity_id, rel_type, merged)

    relationships = data.get("relationships")

    if entity_type == "system" and isinstance(relationships, dict):
        handled_relationships = True
        dependencies = relationships.get("dependencies") or []
        for dep in dependencies:
            target = dep if isinstance(dep, str) else _extract_entity_id(dep)
            if not target:
                continue
            props = dep if isinstance(dep, dict) else None
            add_outgoing(
                target,
                "DEPENDS_ON",
                {
                    "description": props.get("description") if props else None,
                    "technology": props.get("technology") if props else None,
                    "criticality": props.get("criticality") if props else None,
                    "external": props.get("external") if props else None,
                    "external_info": props.get("external_info") if props else None,
                },
            )

        consumers = relationships.get("consumers") or []
        for consumer in consumers:
            source = consumer if isinstance(consumer, str) else _extract_entity_id(consumer)
            if not source:
                continue
            props = consumer if isinstance(consumer, dict) else None
            add_incoming(
                source,
                "DEPENDS_ON",
                {
                    "origin": "system_consumers",
                    "consumer_type": props.get("type") if props else None,
                    "description": props.get("description") if props else None,
                },
            )

    if entity_type in {"container", "component"} and isinstance(relationships, list):
        handled_relationships = True
        for rel in relationships:
            if isinstance(rel, str):
                add_outgoing(rel, "DEPENDS_ON")
                continue
            if not isinstance(rel, dict):
                continue
            target = rel.get("to") or rel.get("target")
            if not isinstance(target, str) or not target:
                continue
            extra: dict[str, Any] = {
                "description": rel.get("description"),
            }
            if entity_type == "container":
                extra.update(
                    {
                        "technology": rel.get("technology"),
                        "async": rel.get("async"),
                        "external": rel.get("external"),
                        "external_info": rel.get("external_info"),
                    }
                )
            add_outgoing(target, "DEPENDS_ON", extra)

    if entity_type == "container":
        system_id = (
            data.get("system_id")
            or data.get("system")
            or _extract_entity_id(data.get("system"))
        )
        if isinstance(system_id, dict):
            system_id = _extract_entity_id(system_id)
        if isinstance(system_id, str) and system_id:
            add_incoming(system_id, "CONTAINS")

    if entity_type == "component":
        container_id = (
            data.get("container_id")
            or data.get("container")
            or _extract_entity_id(data.get("container"))
        )
        if isinstance(container_id, dict):
            container_id = _extract_entity_id(container_id)
        if isinstance(container_id, str) and container_id:
            add_incoming(container_id, "CONTAINS")

    system_data = data.get("system") if isinstance(data.get("system"), dict) else None
    sor_data = data.get("sor") if isinstance(data.get("sor"), dict) else None
    corresponds_to = None
    if isinstance(system_data, dict):
        corresponds_to = system_data.get("corresponds_to")
    if not corresponds_to and isinstance(sor_data, dict):
        corresponds_to = sor_data.get("corresponds_to")
    if isinstance(corresponds_to, str) and corresponds_to:
        add_outgoing(corresponds_to, "CORRESPONDS")

    if not handled_relationships and isinstance(relationships, list):
        for rel in relationships:
            if not isinstance(rel, dict):
                continue
            target = rel.get("target") or rel.get("to")
            if not isinstance(target, str) or not target:
                continue
            rel_type = _normalize_relation_type(rel.get("type"), "DEPENDS_ON")
            add_outgoing(target, rel_type, rel.get("properties"))

    if not handled_relationships and isinstance(relationships, dict):
        for rel_type_key, targets in relationships.items():
            if not isinstance(targets, list):
                continue
            rel_type = _normalize_relation_type(rel_type_key, "DEPENDS_ON")
            for target in targets:
                if isinstance(target, str) and target:
                    add_outgoing(target, rel_type)

    for ref in _find_references(data, entity_type):
        add_outgoing(ref, "REFERENCES")

    return relations


def extract_data(params: SaveRequest) -> dict[str, Any]:
    if params.data is not None and params.content is not None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-002",
                "message": "必须提供 data 或 content 其中之一（不能同时提供）",
                "details": {"field": "data/content"},
            },
        )
    if params.data is None and params.content is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-002",
                "message": "必须提供 data 或 content 其中之一（不能同时缺省）",
                "details": {"field": "data/content"},
            },
        )
    if params.content is not None and params.format is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "C4A-INPUT-003",
                "message": "使用 content 时必须同时指定 format",
                "details": {"field": "format"},
            },
        )
    if params.data is not None:
        return params.data
    if params.content is None:
        raise HTTPException(status_code=400, detail="Either data or content must be provided")
    fmt = params.format or "yaml"
    return load_content(params.content, fmt)


def load_content(content: str, fmt: str) -> dict[str, Any]:
    if fmt == "json":
        return json.loads(content)
    if fmt == "yaml":
        if yaml is None:
            raise HTTPException(status_code=400, detail="YAML parser is not available")
        return yaml.safe_load(content) or {}
    raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")


def dump_content(data: dict[str, Any], fmt: str) -> str:
    if fmt == "json":
        return json.dumps(data, ensure_ascii=False, indent=2)
    if fmt == "yaml":
        if yaml is None:
            raise HTTPException(status_code=400, detail="YAML parser is not available")
        return yaml.safe_dump(data, allow_unicode=True)
    raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")


def build_search_text(entity_id: str, entity_type: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"{entity_id} {entity_type} {payload}"


def to_entity_response(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc["id"],
        "type": doc["type"],
        "kind": doc.get("kind"),
        "scope": doc.get("scope"),
        "perspective": doc.get("perspective"),
        "data": doc.get("data") or {},
        "proposal_id": doc.get("proposal_id") or None,
        "metadata": {
            "source_project": doc.get("source_project", ""),
            "source_repo": doc.get("source_repo"),
            "external_url": doc.get("external_url"),
            "status": doc.get("status", "draft"),
            "content_hash": doc.get("content_hash", ""),
            "created_at": doc.get("created_at", ""),
            "updated_at": doc.get("updated_at", ""),
            "created_by": doc.get("created_by"),
            "updated_by": doc.get("updated_by"),
        },
    }


async def _has_related_adr(
    adapter: Any,
    entity_id: str,
    source_project: str,
    proposal_id: str,
) -> bool:
    relation_query: dict[str, Any] = {
        "from_id": entity_id,
        "from_project": source_project,
        "rel_type": "REFERENCES",
        "proposal_id": proposal_id,
        "$or": [{"status": {"$exists": False}}, {"status": {"$ne": "deleted"}}],
    }
    cursor = adapter.relations.find(relation_query, {"to_id": 1, "to_project": 1, "proposal_id": 1})
    relations = await cursor.to_list(length=None)
    for rel in relations:
        target_id = rel.get("to_id")
        if not isinstance(target_id, str) or not target_id:
            continue
        target_project = rel.get("to_project") or source_project
        target_proposal = rel.get("proposal_id") or proposal_id
        adr = await adapter.entities.find_one(
            {
                "id": target_id,
                "source_project": target_project,
                "proposal_id": target_proposal,
                "type": "adr",
            },
            {"_id": 0, "id": 1},
        )
        if adr:
            return True
    return False
