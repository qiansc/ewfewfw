from __future__ import annotations

import os
from dataclasses import dataclass


def _parse_bool_env(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    mongodb_uri: str = os.getenv("STORAGE_MONGODB_URI", "mongodb://mongodb:27017/c4a")
    neo4j_uri: str = os.getenv("STORAGE_NEO4J_URI", "bolt://neo4j:7687")
    neo4j_user: str = os.getenv("STORAGE_NEO4J_USER", "neo4j")
    neo4j_password: str = os.getenv("STORAGE_NEO4J_PASSWORD", "c4a_password")
    milvus_host: str = os.getenv("STORAGE_MILVUS_HOST", "milvus")
    milvus_port: int = int(os.getenv("STORAGE_MILVUS_PORT", "19530"))
    ollama_base_url: str = os.getenv("STORAGE_OLLAMA_URL", "http://ollama:11434")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY") or None
    permission_allow_empty: bool = _parse_bool_env(
        os.getenv("C4A_PERMISSION_ALLOW_EMPTY"), True
    )


def load_settings() -> Settings:
    return Settings()
