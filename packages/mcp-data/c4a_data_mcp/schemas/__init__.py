"""Input/Output schemas for MCP tools."""

from pydantic import BaseModel, Field
from typing import Any


class SaveInput(BaseModel):
    """Input schema for c4a_db_save_entity."""

    collection: str = Field(
        description="Collection name: systems, containers, components, adrs, contracts"
    )
    data: dict[str, Any] = Field(description="Document data to save")
    id: str | None = Field(default=None, description="Document ID (omit for create)")


class GetInput(BaseModel):
    """Input schema for c4a_db_get_entity."""

    collection: str = Field(description="Collection name")
    query: dict[str, Any] = Field(
        description='Query filter: {"id": "xxx"} or {"filter": {...}, "limit": 10}'
    )


class DeleteInput(BaseModel):
    """Input schema for c4a_db_delete_entity."""

    collection: str = Field(description="Collection name")
    id: str = Field(description="Document ID to delete")


class SearchInput(BaseModel):
    """Input schema for c4a_db_search_semantic."""

    query: str = Field(description="Natural language search query")
    scope: str | None = Field(
        default=None, description="Limit scope: systems, adrs, all"
    )


class DepsInput(BaseModel):
    """Input schema for c4a_db_query_deps."""

    id: str = Field(description="Entity ID to query dependencies for")
    direction: str = Field(
        default="both", description="Direction: upstream, downstream, both"
    )
    depth: int = Field(default=1, ge=1, le=5, description="Traversal depth (1-5)")


class ImpactInput(BaseModel):
    """Input schema for c4a_db_query_impact."""

    id: str = Field(description="Entity ID to analyze impact for")
    change_type: str | None = Field(
        default=None, description="Change type: upgrade, deprecate, remove"
    )


class CypherInput(BaseModel):
    """Input schema for c4a_db_exec_cypher."""

    query: str = Field(description="Raw Cypher query")
    params: dict[str, Any] | None = Field(default=None, description="Query parameters")
