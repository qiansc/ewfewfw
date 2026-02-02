from __future__ import annotations

import json
from typing import Any

from neo4j import AsyncGraphDatabase


class Neo4jAdapter:
    ALLOWED_REL_TYPES = {
        "DEPENDS_ON",
        "CONTAINS",
        "REFERENCES",
        "IMPLEMENTS",
        "CORRESPONDS",
        "DERIVES",
    }

    def __init__(self, uri: str, user: str, password: str) -> None:
        self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))

    async def close(self) -> None:
        await self.driver.close()

    async def save_relation(self, relation: dict[str, Any]) -> None:
        rel_type = relation["rel_type"]
        if rel_type not in self.ALLOWED_REL_TYPES:
            raise ValueError(f"Invalid relation type: {rel_type}")

        properties = relation.get("properties")
        if properties is not None and not isinstance(properties, str):
            relation = dict(relation)
            relation["properties"] = json.dumps(properties, ensure_ascii=False)

        async with self.driver.session() as session:
            query = f"""
                MERGE (from:Entity {{id: $from_id, project: $from_project}})
                MERGE (to:Entity {{id: $to_id, project: $to_project}})
                MERGE (from)-[r:{rel_type}]->(to)
                SET r.id = $id,
                    r.proposal_id = $proposal_id,
                    r.properties = $properties,
                    r.status = $status
            """
            await session.run(query, **relation)

    async def upsert_entity(self, entity: dict[str, Any]) -> None:
        async with self.driver.session() as session:
            await session.run(
                """
                MERGE (e:Entity {id: $id, project: $project})
                SET e.type = $type,
                    e.status = $status,
                    e.updated_at = $updated_at
                """,
                id=entity.get("id"),
                project=entity.get("source_project", ""),
                type=entity.get("type"),
                status=entity.get("status"),
                updated_at=entity.get("updated_at"),
            )

    async def delete_entity(self, entity_id: str, project_id: str) -> None:
        async with self.driver.session() as session:
            await session.run(
                """
                MATCH (e:Entity {id: $id, project: $project})
                DETACH DELETE e
                """,
                id=entity_id,
                project=project_id,
            )

    async def delete_relations_from_entity(
        self, entity_id: str, project_id: str, proposal_id: str
    ) -> None:
        async with self.driver.session() as session:
            await session.run(
                """
                MATCH (from:Entity {id: $id, project: $project})-[r]->()
                WHERE r.proposal_id = $proposal_id
                DELETE r
                """,
                id=entity_id,
                project=project_id,
                proposal_id=proposal_id,
            )

    async def delete_relation(self, relation_id: str) -> int:
        async with self.driver.session() as session:
            result = await session.run(
                """
                MATCH ()-[r {id: $id}]-()
                WITH r
                DELETE r
                RETURN count(r) as deleted
                """,
                id=relation_id,
            )
            record = await result.single()
            if record is None:
                return 0
            return int(record.get("deleted", 0))

    async def query_deps(
        self,
        entity_id: str,
        project_id: str,
        direction: str,
        depth: int,
    ) -> list[dict[str, Any]]:
        if not 1 <= depth <= 10:
            raise ValueError(f"Depth must be between 1 and 10, got {depth}")

        if direction not in {"upstream", "downstream", "both"}:
            raise ValueError(f"Invalid direction: {direction}")

        async with self.driver.session() as session:
            results: list[dict[str, Any]] = []

            if direction in {"downstream", "both"}:
                query = f"""
                    MATCH path = (start:Entity {{id: $entity_id, project: $project_id}})
                        -[:DEPENDS_ON*1..{depth}]->(dep)
                    WITH dep, length(path) as distance
                    RETURN dep.id as id, dep.project as project, distance as distance,
                           'DEPENDS_ON' as relation_type
                """
                records = await session.run(query, entity_id=entity_id, project_id=project_id)
                results.extend([record.data() async for record in records])

            if direction in {"upstream", "both"}:
                query = f"""
                    MATCH path = (dep:Entity)-[:DEPENDS_ON*1..{depth}]
                        ->(start:Entity {{id: $entity_id, project: $project_id}})
                    WITH dep, length(path) as distance
                    RETURN dep.id as id, dep.project as project, distance as distance,
                           'DEPENDS_ON' as relation_type
                """
                records = await session.run(query, entity_id=entity_id, project_id=project_id)
                results.extend([record.data() async for record in records])

            return results

    async def query_impact(
        self, entity_id: str, project_id: str, depth: int
    ) -> list[dict[str, Any]]:
        if not 1 <= depth <= 10:
            raise ValueError(f"Depth must be between 1 and 10, got {depth}")

        async with self.driver.session() as session:
            query = f"""
                MATCH path = (start:Entity {{id: $entity_id, project: $project_id}})
                    <-[:DEPENDS_ON*1..{depth}]-(impact)
                WITH impact, length(path) as distance
                RETURN impact.id as id, impact.project as project, distance as distance
            """
            records = await session.run(query, entity_id=entity_id, project_id=project_id)
            return [record.data() async for record in records]
