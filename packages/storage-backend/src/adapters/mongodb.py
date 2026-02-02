from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import IndexModel, UpdateOne
from pymongo.uri_parser import parse_uri


class MongoDBAdapter:
    def __init__(self, uri: str, database: str | None = None) -> None:
        self.client = AsyncIOMotorClient(uri)
        self.database = database or self._resolve_database(uri)
        self.db = self.client[self.database]
        self.entities = self.db["entities"]
        self.relations = self.db["relations"]
        self.metadata = self.db["metadata"]
        self.feats = self.db["feats"]
        self.permissions = self.db["project_permissions"]
        self.entity_history = self.db["entity_history"]

    @staticmethod
    def _resolve_database(uri: str) -> str:
        parsed = parse_uri(uri)
        return parsed.get("database") or "c4a"

    async def close(self) -> None:
        self.client.close()

    async def init_indexes(self) -> None:
        await self.entities.create_indexes(
            [
                IndexModel(
                    [("id", 1), ("source_project", 1), ("proposal_id", 1)], unique=True
                ),
                IndexModel([("type", 1)]),
                IndexModel([("source_project", 1)]),
            ]
        )

        await self.relations.create_indexes(
            [
                IndexModel([("id", 1)], unique=True),
                IndexModel([("from_project", 1), ("from_id", 1)]),
                IndexModel([("to_project", 1), ("to_id", 1)]),
                IndexModel([("rel_type", 1)]),
                IndexModel([("proposal_id", 1)]),
            ]
        )

        await self.permissions.create_indexes(
            [
                IndexModel([("project_id", 1), ("user_id", 1)], unique=True),
                IndexModel([("user_id", 1)]),
                IndexModel([("project_id", 1)]),
            ]
        )

        await self.entity_history.create_indexes(
            [
                IndexModel([("entity_id", 1), ("changed_at", -1)]),
                IndexModel([("feat_id", 1), ("changed_at", -1)]),
            ]
        )

    async def save_relation(self, relation: dict[str, Any]) -> dict[str, int]:
        result = await self.save_relations([relation])
        return result

    async def save_entity(self, entity: dict[str, Any]) -> dict[str, Any]:
        result = await self.entities.update_one(
            {
                "id": entity["id"],
                "source_project": entity.get("source_project", ""),
                "proposal_id": entity.get("proposal_id", ""),
            },
            {"$set": entity},
            upsert=True,
        )
        return {"id": entity["id"], "upserted": result.upserted_id is not None}

    async def get_entity(
        self,
        entity_id: str,
        source_project: str | None,
        proposal_id: str | None,
    ) -> dict[str, Any] | None:
        query: dict[str, Any] = {"id": entity_id}
        if source_project is not None:
            query["source_project"] = source_project
        if proposal_id is not None:
            query["proposal_id"] = proposal_id
        return await self.entities.find_one(query, {"_id": 0})

    async def list_entities(
        self, query: dict[str, Any], limit: int, offset: int
    ) -> list[dict[str, Any]]:
        cursor = self.entities.find(query, {"_id": 0}).skip(offset).limit(limit)
        return await cursor.to_list(length=None)

    async def count_entities(self, query: dict[str, Any]) -> int:
        return await self.entities.count_documents(query)

    async def delete_entity(
        self, entity_id: str, source_project: str | None, proposal_id: str | None
    ) -> int:
        query: dict[str, Any] = {"id": entity_id}
        if source_project is not None:
            query["source_project"] = source_project
        if proposal_id is not None:
            query["proposal_id"] = proposal_id
        result = await self.entities.delete_many(query)
        return result.deleted_count

    async def delete_relations_for_entity(
        self, entity_id: str, project_id: str | None
    ) -> int:
        if project_id is None:
            query = {"$or": [{"from_id": entity_id}, {"to_id": entity_id}]}
        else:
            query = {
                "$or": [
                    {"from_id": entity_id, "from_project": project_id},
                    {"to_id": entity_id, "to_project": project_id},
                ]
            }
        result = await self.relations.delete_many(query)
        return result.deleted_count

    async def delete_relations_from_entity(
        self, entity_id: str, project_id: str, proposal_id: str
    ) -> int:
        result = await self.relations.delete_many(
            {
                "from_id": entity_id,
                "from_project": project_id,
                "proposal_id": proposal_id,
            }
        )
        return result.deleted_count

    async def save_relations(self, relations: list[dict[str, Any]]) -> dict[str, int]:
        if not relations:
            return {"inserted": 0, "modified": 0}

        operations = [
            UpdateOne(
                {"id": relation["id"]},
                {"$set": relation},
                upsert=True,
            )
            for relation in relations
        ]
        result = await self.relations.bulk_write(operations)
        return {
            "inserted": result.upserted_count,
            "modified": result.modified_count,
        }

    async def insert_entity_history(self, record: dict[str, Any]) -> None:
        await self.entity_history.insert_one(record)

    async def list_entity_history(
        self, query: dict[str, Any], limit: int, order: int
    ) -> list[dict[str, Any]]:
        cursor = (
            self.entity_history.find(query, {"_id": 0})
            .sort("changed_at", order)
            .limit(limit)
        )
        return await cursor.to_list(length=None)

    async def count_entity_history(self, query: dict[str, Any]) -> int:
        return await self.entity_history.count_documents(query)

    async def delete_relation(self, relation_id: str) -> int:
        result = await self.relations.delete_one({"id": relation_id})
        return result.deleted_count

    async def get_relations_by_entity(
        self, entity_id: str, project_id: str
    ) -> list[dict[str, Any]]:
        cursor = self.relations.find(
            {
                "$or": [
                    {"from_id": entity_id, "from_project": project_id},
                    {"to_id": entity_id, "to_project": project_id},
                ]
            }
        )
        return await cursor.to_list(length=None)
