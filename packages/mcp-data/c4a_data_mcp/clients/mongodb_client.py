"""MongoDB client for document storage."""

from datetime import datetime, UTC
from typing import Any

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from ..utils import logger


class MongoDBClient:
    """Synchronous MongoDB client for C4A."""

    def __init__(self, uri: str, database: str = "c4a") -> None:
        """Initialize MongoDB client."""
        self.client: MongoClient[dict[str, Any]] = MongoClient(uri)
        self.db: Database[dict[str, Any]] = self.client[database]
        logger.info(f"MongoDB client initialized: {database}")

    def _get_collection(self, collection: str) -> Collection[dict[str, Any]]:
        """Get collection with c4a_ prefix."""
        return self.db[f"c4a_{collection}"]

    def upsert(
        self, collection: str, doc_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Insert or update a document.

        Args:
            collection: Collection name (without c4a_ prefix)
            doc_id: Document ID
            data: Document data

        Returns:
            Updated document with metadata
        """
        coll = self._get_collection(collection)
        now = datetime.now(UTC)

        # Prepare document
        doc = {
            **data,
            "_id": doc_id,
            "id": doc_id,
            "updated_at": now.isoformat(),
        }

        # Check if document exists to preserve created_at
        existing = coll.find_one({"_id": doc_id})
        if existing:
            doc["created_at"] = existing.get("created_at", now.isoformat())
        else:
            doc["created_at"] = now.isoformat()

        # Upsert
        coll.replace_one({"_id": doc_id}, doc, upsert=True)

        logger.info(f"MongoDB upsert: {collection}/{doc_id}")
        return doc

    def find_one(self, collection: str, query: dict[str, Any]) -> dict[str, Any] | None:
        """
        Find a single document.

        Args:
            collection: Collection name
            query: MongoDB query

        Returns:
            Document or None
        """
        coll = self._get_collection(collection)

        # Convert id to _id if present
        if "id" in query and "_id" not in query:
            query = {**query, "_id": query.pop("id")}

        result = coll.find_one(query)
        if result:
            result.pop("_id", None)  # Remove MongoDB internal _id
        return result

    def find(
        self,
        collection: str,
        query: dict[str, Any] | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Find multiple documents.

        Args:
            collection: Collection name
            query: MongoDB query (optional)
            limit: Maximum number of results

        Returns:
            List of documents
        """
        coll = self._get_collection(collection)
        query = query or {}

        # Convert id to _id if present
        if "id" in query and "_id" not in query:
            query = {**query, "_id": query.pop("id")}

        results = list(coll.find(query).limit(limit))

        # Remove MongoDB internal _id
        for doc in results:
            doc.pop("_id", None)

        return results

    def delete_one(self, collection: str, doc_id: str) -> bool:
        """
        Delete a document by ID.

        Args:
            collection: Collection name
            doc_id: Document ID

        Returns:
            True if deleted, False if not found
        """
        coll = self._get_collection(collection)
        result = coll.delete_one({"_id": doc_id})
        deleted = result.deleted_count > 0

        if deleted:
            logger.info(f"MongoDB delete: {collection}/{doc_id}")
        else:
            logger.warning(f"MongoDB delete not found: {collection}/{doc_id}")

        return deleted

    def close(self) -> None:
        """Close the MongoDB connection."""
        self.client.close()
        logger.info("MongoDB client closed")
