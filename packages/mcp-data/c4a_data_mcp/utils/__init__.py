"""Utility functions and helpers."""

import logging
from typing import Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger("c4a-data-mcp")


# Graph schema constants
NODE_LABELS: dict[str, str] = {
    "systems": "System",
    "containers": "Container",
    "components": "Component",
    "adrs": "ADR",
    "contracts": "ApiContract",
}

VALID_COLLECTIONS = {"systems", "containers", "components", "adrs", "contracts"}


class C4ADataError(Exception):
    """Base exception for C4A Data errors."""

    code: str = "UNKNOWN_ERROR"


class ValidationError(C4ADataError):
    """Input validation error."""

    code = "VALIDATION_ERROR"


class NotFoundError(C4ADataError):
    """Resource not found error."""

    code = "NOT_FOUND"


class ConnectionError(C4ADataError):
    """Database connection error."""

    code = "CONNECTION_ERROR"


class SyncError(C4ADataError):
    """Data synchronization error."""

    code = "SYNC_ERROR"


def validate_collection(collection: str) -> None:
    """Validate collection name."""
    if collection not in VALID_COLLECTIONS:
        raise ValidationError(
            f"Invalid collection: {collection}. "
            f"Must be one of: {', '.join(sorted(VALID_COLLECTIONS))}"
        )


def extract_text_for_embedding(data: dict[str, Any]) -> str:
    """Extract text from document for embedding."""
    parts: list[str] = []

    # Name and description
    if name := data.get("name"):
        parts.append(str(name))
    if desc := data.get("description"):
        parts.append(str(desc))

    # Nested entity info
    for key in ["system", "container", "component", "adr", "contract"]:
        if nested := data.get(key):
            if nested_name := nested.get("name"):
                parts.append(str(nested_name))
            if nested_desc := nested.get("description"):
                parts.append(str(nested_desc))

    # Knowledge
    if knowledge := data.get("knowledge"):
        if how := knowledge.get("how"):
            if isinstance(how, dict):
                if how_desc := how.get("description"):
                    parts.append(str(how_desc))

    # Tags
    if tags := data.get("tags"):
        if isinstance(tags, list):
            parts.extend(str(t) for t in tags)

    return " ".join(parts) if parts else ""
