"""Neo4j client for graph operations."""

from typing import Any

from neo4j import GraphDatabase, Driver

from ..utils import logger, NODE_LABELS


class Neo4jClient:
    """Synchronous Neo4j client for C4A."""

    def __init__(self, uri: str, user: str, password: str) -> None:
        """Initialize Neo4j client."""
        self.driver: Driver = GraphDatabase.driver(uri, auth=(user, password))
        logger.info("Neo4j client initialized")

    def upsert_node(
        self, collection: str, doc_id: str, properties: dict[str, Any]
    ) -> None:
        """
        Create or update a node.

        Args:
            collection: Collection name (maps to node label)
            doc_id: Node ID
            properties: Node properties
        """
        label = NODE_LABELS.get(collection, "Unknown")

        # Filter out complex nested objects for Neo4j
        flat_props = {
            k: v for k, v in properties.items()
            if isinstance(v, (str, int, float, bool)) or v is None
        }

        # Add common properties
        flat_props["id"] = doc_id

        # Extract name/description from nested structures
        for key in ["system", "container", "component", "adr", "contract"]:
            if nested := properties.get(key):
                if isinstance(nested, dict):
                    if name := nested.get("name"):
                        flat_props["name"] = name
                    if desc := nested.get("description"):
                        flat_props["description"] = desc

        with self.driver.session() as session:
            session.run(
                f"""
                MERGE (n:{label} {{id: $id}})
                SET n += $props
                """,
                id=doc_id,
                props=flat_props,
            )

        logger.info(f"Neo4j upsert node: {label}/{doc_id}")

    def create_relationship(
        self,
        from_id: str,
        to_id: str,
        rel_type: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        """
        Create a relationship between nodes.

        Args:
            from_id: Source node ID
            to_id: Target node ID
            rel_type: Relationship type (e.g., DEPENDS_ON, CALLS)
            properties: Relationship properties
        """
        props = properties or {}

        with self.driver.session() as session:
            session.run(
                f"""
                MATCH (a {{id: $from_id}})
                MATCH (b {{id: $to_id}})
                MERGE (a)-[r:{rel_type}]->(b)
                SET r += $props
                """,
                from_id=from_id,
                to_id=to_id,
                props=props,
            )

        logger.info(f"Neo4j create relationship: {from_id} -[{rel_type}]-> {to_id}")

    def delete_node(self, doc_id: str) -> bool:
        """
        Delete a node and its relationships.

        Args:
            doc_id: Node ID

        Returns:
            True if deleted
        """
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (n {id: $id})
                DETACH DELETE n
                RETURN count(n) as deleted
                """,
                id=doc_id,
            )
            record = result.single()
            deleted = record["deleted"] > 0 if record else False

        if deleted:
            logger.info(f"Neo4j delete node: {doc_id}")
        return deleted

    def query_deps(
        self, doc_id: str, direction: str = "both", depth: int = 1
    ) -> list[dict[str, Any]]:
        """
        Query dependencies.

        Args:
            doc_id: Starting node ID
            direction: "upstream", "downstream", or "both"
            depth: Maximum traversal depth

        Returns:
            List of dependent nodes
        """
        if direction == "downstream":
            query = f"""
            MATCH (n {{id: $id}})-[:DEPENDS_ON|CALLS*1..{depth}]->(dep)
            RETURN DISTINCT dep.id AS id, dep.name AS name, labels(dep) AS type
            """
        elif direction == "upstream":
            query = f"""
            MATCH (n {{id: $id}})<-[:DEPENDS_ON|CALLS*1..{depth}]-(dep)
            RETURN DISTINCT dep.id AS id, dep.name AS name, labels(dep) AS type
            """
        else:  # both
            query = f"""
            MATCH (n {{id: $id}})-[:DEPENDS_ON|CALLS*1..{depth}]-(dep)
            RETURN DISTINCT dep.id AS id, dep.name AS name, labels(dep) AS type
            """

        with self.driver.session() as session:
            result = session.run(query, id=doc_id)
            return [
                {
                    "id": record["id"],
                    "name": record["name"],
                    "type": record["type"][0] if record["type"] else None,
                }
                for record in result
            ]

    def query_impact(self, doc_id: str, depth: int = 3) -> list[dict[str, Any]]:
        """
        Analyze impact (who depends on me).

        Args:
            doc_id: Node ID
            depth: Maximum traversal depth

        Returns:
            List of affected nodes with distance
        """
        query = f"""
        MATCH path = (n {{id: $id}})<-[:DEPENDS_ON|CALLS*1..{depth}]-(affected)
        RETURN DISTINCT
            affected.id AS id,
            affected.name AS name,
            labels(affected) AS type,
            length(path) AS distance
        ORDER BY distance
        """

        with self.driver.session() as session:
            result = session.run(query, id=doc_id)
            return [
                {
                    "id": record["id"],
                    "name": record["name"],
                    "type": record["type"][0] if record["type"] else None,
                    "distance": record["distance"],
                }
                for record in result
            ]

    def execute_cypher(
        self, query: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """
        Execute a raw Cypher query.

        Args:
            query: Cypher query string
            params: Query parameters

        Returns:
            Query results as list of dicts
        """
        with self.driver.session() as session:
            result = session.run(query, params or {})
            return [dict(record) for record in result]

    def close(self) -> None:
        """Close the Neo4j connection."""
        self.driver.close()
        logger.info("Neo4j client closed")
