"""Milvus client for vector search."""

from typing import Any

from pymilvus import (
    connections,
    Collection,
    FieldSchema,
    CollectionSchema,
    DataType,
    utility,
)

from ..utils import logger


COLLECTION_NAME_PREFIX = "c4a_knowledge"


class MilvusClient:
    """Milvus client for C4A vector search."""

    def __init__(self, uri: str, dimension: int = 1536) -> None:
        """Initialize Milvus client.

        Args:
            uri: Milvus server URI (http://host:port)
            dimension: Embedding vector dimension (default 1536 for OpenAI)
        """
        # Parse URI to get host and port
        # Format: http://host:port
        uri_clean = uri.replace("http://", "").replace("https://", "")
        parts = uri_clean.split(":")
        host = parts[0]
        port = int(parts[1]) if len(parts) > 1 else 19530

        self.dimension = dimension
        self.collection_name = f"{COLLECTION_NAME_PREFIX}_{dimension}d"
        self._loaded = False  # Track if collection is loaded into memory

        connections.connect("default", host=host, port=port)

        # Check for existing collections with different dimensions
        existing_collections = [
            name
            for name in utility.list_collections()
            if name.startswith(COLLECTION_NAME_PREFIX) and name != self.collection_name
        ]
        if existing_collections:
            logger.warning(
                f"Found existing collections with different dimensions: {existing_collections}. "
                f"Using collection: {self.collection_name}. "
                f"Data in other collections will not be accessible."
            )

        self.collection = self._ensure_collection()
        logger.info(
            f"Milvus client initialized: {host}:{port} (collection: {self.collection_name})"
        )

    def _ensure_loaded(self) -> None:
        """Ensure collection is loaded into memory.

        Milvus collections need to be loaded before they can be searched.
        This method only loads once to avoid repeated load calls.
        """
        if not self._loaded:
            self.collection.load()
            self._loaded = True
            logger.debug(f"Milvus collection loaded: {self.collection_name}")

    def _ensure_collection(self) -> Collection:
        """Ensure the collection exists with proper schema."""
        if utility.has_collection(self.collection_name):
            return Collection(self.collection_name)

        # Create schema
        fields = [
            FieldSchema(
                name="id",
                dtype=DataType.VARCHAR,
                max_length=256,
                is_primary=True,
            ),
            FieldSchema(
                name="doc_type",
                dtype=DataType.VARCHAR,
                max_length=50,
            ),
            FieldSchema(
                name="embedding",
                dtype=DataType.FLOAT_VECTOR,
                dim=self.dimension,
            ),
        ]

        schema = CollectionSchema(
            fields,
            description=f"C4A knowledge embeddings ({self.dimension}d)",
        )
        collection = Collection(self.collection_name, schema)

        # Create index
        index_params = {
            "metric_type": "COSINE",
            "index_type": "IVF_FLAT",
            "params": {"nlist": 1024},
        }
        collection.create_index("embedding", index_params)

        logger.info(f"Created Milvus collection: {self.collection_name}")
        return collection

    def upsert(self, doc_id: str, doc_type: str, embedding: list[float]) -> None:
        """
        Insert or update a vector.

        Args:
            doc_id: Document ID
            doc_type: Document type (systems, containers, etc.)
            embedding: Vector embedding
        """
        # Delete existing if present (no flush - let Milvus manage automatically)
        self.delete(doc_id)

        # Insert new (no flush - let Milvus manage automatically)
        self.collection.insert(
            [
                [doc_id],
                [doc_type],
                [embedding],
            ]
        )

        # ⚠️ 注意：移除了 flush() 调用以提升性能
        # Milvus 会自动管理数据落盘，无需手动 flush
        # 如需立即持久化，可调用 self.flush()

        logger.info(f"Milvus upsert: {doc_type}/{doc_id}")

    def _ensure_loaded(self) -> None:
        """Ensure collection is loaded into memory.

        Milvus collections need to be loaded before they can be searched.
        This method only loads once to avoid repeated load calls.
        """
        if not self._loaded:
            self.collection.load()
            self._loaded = True
            logger.debug(f"Milvus collection loaded: {self.collection_name}")

    def search(
        self,
        query_vector: list[float],
        doc_types: list[str] | None = None,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Search for similar vectors.

        Args:
            query_vector: Query embedding
            doc_types: Optional list of doc types to filter
            top_k: Number of results

        Returns:
            List of search results with id, score, doc_type
        """
        # Load collection only if not already loaded
        self._ensure_loaded()

        # Build filter expression
        expr = None
        if doc_types:
            types_str = ", ".join(f'"{t}"' for t in doc_types)
            expr = f"doc_type in [{types_str}]"

        # Search
        results = self.collection.search(
            data=[query_vector],
            anns_field="embedding",
            param={"metric_type": "COSINE", "params": {"nprobe": 10}},
            limit=top_k,
            expr=expr,
            output_fields=["id", "doc_type"],
        )

        # Format results
        output = []
        for hits in results:
            for hit in hits:
                output.append(
                    {
                        "id": hit.id,
                        "score": hit.score,
                        "doc_type": hit.entity.get("doc_type"),
                    }
                )

        return output

    def delete(self, doc_id: str) -> bool:
        """
        Delete a vector by ID.

        Args:
            doc_id: Document ID

        Returns:
            True if delete was attempted
        """
        try:
            self.collection.delete(f'id == "{doc_id}"')
            # ⚠️ 注意：移除了 flush() 调用以提升性能
            # Milvus 会自动管理数据落盘，无需手动 flush
            # 如需立即持久化，可调用 self.flush()
            logger.info(f"Milvus delete: {doc_id}")
            return True
        except Exception as e:
            logger.warning(f"Milvus delete failed: {doc_id} - {e}")
            return False

    def flush(self) -> None:
        """
        Manually flush data to disk.

        Note: This is typically not needed as Milvus manages data persistence
        automatically. Only call this if you need to ensure immediate persistence
        (e.g., before application shutdown).
        """
        self.collection.flush()
        logger.info("Milvus flush: data persisted to disk")

    def close(self) -> None:
        """Close the Milvus connection."""
        connections.disconnect("default")
        logger.info("Milvus client closed")
