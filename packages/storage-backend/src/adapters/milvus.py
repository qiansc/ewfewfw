from __future__ import annotations

import asyncio
import time
from typing import Any

from pymilvus import DataType, MilvusClient, connections, utility

from ..utils.vector import vector_id_from_key


class MilvusAdapter:
    def __init__(self, uri: str, collection: str = "c4a_vectors", dimension: int = 768) -> None:
        self._uri = uri
        self._client: MilvusClient | None = None
        self.collection = collection
        self.dimension = dimension
        self._utility_alias = "c4a"
        self._utility_connected = False

    @property
    def client(self) -> MilvusClient:
        if self._client is None:
            self._client = MilvusClient(uri=self._uri)
        return self._client

    async def init_collection(self) -> None:
        await asyncio.to_thread(self._init_collection_sync)

    def _init_collection_sync(self) -> None:
        if self.client.has_collection(self.collection):
            try:
                info = self.client.describe_collection(self.collection)
                fields = {field.get("name") for field in info.get("fields", [])}
                if "vector_key" in fields and "id" in fields:
                    self._ensure_index()
                    self._ensure_loaded()
                    return
            except Exception:
                return
            self.client.drop_collection(self.collection)

        schema = self.client.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field(
            field_name="id",
            datatype=DataType.INT64,
            is_primary=True,
            auto_id=False,
        )
        schema.add_field(
            field_name="vector_key",
            datatype=DataType.VARCHAR,
            max_length=512,
        )
        schema.add_field(
            field_name="vector",
            datatype=DataType.FLOAT_VECTOR,
            dim=self.dimension,
        )
        self.client.create_collection(
            collection_name=self.collection,
            schema=schema,
            metric_type="COSINE",
        )
        self._ensure_index()
        self._ensure_loaded()

    def _ensure_index(self) -> None:
        try:
            indexes = self.client.list_indexes(self.collection)
            for index in indexes:
                if isinstance(index, dict) and index.get("field_name") == "vector":
                    return
                if isinstance(index, str) and index == "vector":
                    return
        except Exception:
            pass
        try:
            index_params = self.client.prepare_index_params(
                field_name="vector",
                index_type="HNSW",
                metric_type="COSINE",
                params={"M": 16, "efConstruction": 200},
            )
            self.client.create_index(self.collection, index_params)
        except Exception:
            pass

    def _ensure_loaded(self) -> None:
        try:
            if not self._try_load_with_client():
                self._try_load_with_utility()
            self._wait_loaded()
        except Exception:
            pass

    def _try_load_with_client(self) -> bool:
        load_fn = getattr(self.client, "load_collection", None)
        if load_fn is None:
            return False
        try:
            load_fn(collection_name=self.collection, timeout=30)
        except TypeError:
            load_fn(self.collection)
        return True

    def _ensure_utility_connection(self) -> bool:
        if self._utility_connected:
            return True
        try:
            connections.connect(alias=self._utility_alias, uri=self._uri)
            self._utility_connected = True
        except Exception:
            self._utility_connected = False
        return self._utility_connected

    def _try_load_with_utility(self) -> None:
        if not self._ensure_utility_connection():
            return
        try:
            utility.load_collection(self.collection, using=self._utility_alias)
        except TypeError:
            utility.load_collection(self.collection)

    def _wait_loaded(self) -> None:
        refresh_fn = getattr(self.client, "refresh_load", None)
        if refresh_fn:
            try:
                refresh_fn(self.collection)
            except Exception:
                pass

        is_loaded_fn = getattr(self.client, "_is_collection_loaded", None)
        if is_loaded_fn:
            for _ in range(10):
                try:
                    if is_loaded_fn(self.collection):
                        return
                except Exception:
                    break
                time.sleep(0.2)

        wait_fn = getattr(self.client, "wait_for_loading", None)
        if wait_fn:
            try:
                wait_fn(self.collection)
                return
            except Exception:
                pass

        if self._ensure_utility_connection():
            try:
                utility.wait_for_loading(self.collection, using=self._utility_alias)
                return
            except Exception:
                pass

        state_fn = getattr(self.client, "get_load_state", None)
        if state_fn:
            for _ in range(5):
                try:
                    state = state_fn(self.collection)
                except Exception:
                    break
                if "Loaded" in str(state):
                    return
                time.sleep(0.2)
            return

        if self._ensure_utility_connection():
            for _ in range(5):
                try:
                    state = utility.get_load_state(self.collection, using=self._utility_alias)
                except Exception:
                    break
                if "Loaded" in str(state):
                    return
                time.sleep(0.2)
            return

        time.sleep(0.2)

    async def upsert_vector(self, vector_key: str, vector: list[float]) -> None:
        await asyncio.to_thread(self._upsert_vector_sync, vector_key, vector)

    def _upsert_vector_sync(self, vector_key: str, vector: list[float]) -> None:
        vector_id = vector_id_from_key(vector_key)
        self.client.upsert(
            collection_name=self.collection,
            data=[{"id": vector_id, "vector_key": vector_key, "vector": vector}],
        )

    async def delete_vector(self, vector_key: str) -> None:
        vector_id = vector_id_from_key(vector_key)
        await asyncio.to_thread(self.client.delete, self.collection, [vector_id])

    async def search(
        self, query_vector: list[float], limit: int = 10, filter_expr: str | None = None
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            self._search_sync, query_vector, limit, filter_expr
        )

    def _search_sync(
        self, query_vector: list[float], limit: int, filter_expr: str | None = None
    ) -> list[dict[str, Any]]:
        self._ensure_loaded()
        results = self.client.search(
            collection_name=self.collection,
            data=[query_vector],
            limit=limit,
            filter=filter_expr,
            output_fields=["vector_key"],
        )
        if not results:
            return []
        return results[0]
