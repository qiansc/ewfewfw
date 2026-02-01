from __future__ import annotations

import pytest

from src.adapters.neo4j import Neo4jAdapter


@pytest.mark.asyncio
async def test_neo4j_rejects_invalid_relation_type():
    adapter = Neo4jAdapter("bolt://localhost:7687", "neo4j", "password")
    with pytest.raises(ValueError):
        await adapter.save_relation(
            {
                "rel_type": "INVALID",
                "from_id": "a",
                "from_project": "p",
                "to_id": "b",
                "to_project": "p",
                "proposal_id": "",
                "properties": {},
                "status": "active",
            }
        )
