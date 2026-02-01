from __future__ import annotations

import asyncio
from typing import Any

from pymongo.errors import PyMongoError

from ..adapters.milvus import MilvusAdapter
from ..adapters.mongodb import MongoDBAdapter
from ..adapters.neo4j import Neo4jAdapter
from ..config import load_settings
from .embedding import EmbeddingService

_mongo_adapter: MongoDBAdapter | None = None
_neo4j_adapter: Neo4jAdapter | None = None
_milvus_adapter: MilvusAdapter | None = None


async def init_services() -> None:
    settings = load_settings()
    global _mongo_adapter, _neo4j_adapter, _milvus_adapter

    if _mongo_adapter is None:
        _mongo_adapter = MongoDBAdapter(settings.mongodb_uri)
        await _mongo_adapter.init_indexes()

    if _neo4j_adapter is None:
        _neo4j_adapter = Neo4jAdapter(
            settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password
        )

    if _milvus_adapter is None:
        uri = f"http://{settings.milvus_host}:{settings.milvus_port}"
        _milvus_adapter = MilvusAdapter(uri=uri, dimension=EmbeddingService.get_dimension())
        await _milvus_adapter.init_collection()


async def close_services() -> None:
    global _mongo_adapter, _neo4j_adapter, _milvus_adapter

    if _mongo_adapter is not None:
        await _mongo_adapter.close()
        _mongo_adapter = None

    if _neo4j_adapter is not None:
        await _neo4j_adapter.close()
        _neo4j_adapter = None

    _milvus_adapter = None


async def get_mongodb_adapter() -> MongoDBAdapter:
    if _mongo_adapter is None:
        await init_services()
    assert _mongo_adapter is not None
    return _mongo_adapter


async def get_neo4j_adapter() -> Neo4jAdapter:
    if _neo4j_adapter is None:
        await init_services()
    assert _neo4j_adapter is not None
    return _neo4j_adapter


async def get_milvus_adapter() -> MilvusAdapter:
    if _milvus_adapter is None:
        await init_services()
    assert _milvus_adapter is not None
    return _milvus_adapter


async def check_mongodb() -> bool:
    try:
        adapter = await get_mongodb_adapter()
        await adapter.db.command("ping")
        return True
    except PyMongoError:
        return False


async def check_neo4j() -> bool:
    try:
        adapter = await get_neo4j_adapter()
        async with adapter.driver.session() as session:
            await session.run("RETURN 1")
        return True
    except Exception:
        return False


async def check_milvus() -> bool:
    try:
        adapter = await get_milvus_adapter()
        await asyncio.to_thread(adapter.client.list_collections)
        return True
    except Exception:
        return False
