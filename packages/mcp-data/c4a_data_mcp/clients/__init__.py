"""Storage clients for MongoDB, Neo4j, and Milvus."""

from .mongodb_client import MongoDBClient
from .neo4j_client import Neo4jClient
from .milvus_client import MilvusClient
from .embedder import Embedder  # Deprecated, kept for backward compatibility
from .embedding_service import (
    EmbeddingService,
    OpenAIEmbedding,
    OllamaEmbedding,
    EmbeddingUnavailableError,
    create_embedding_service,
)

__all__ = [
    "MongoDBClient",
    "Neo4jClient",
    "MilvusClient",
    "Embedder",
    "EmbeddingService",
    "OpenAIEmbedding",
    "OllamaEmbedding",
    "EmbeddingUnavailableError",
    "create_embedding_service",
]
