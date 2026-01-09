"""Configuration management for C4A Data MCP Server."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv, find_dotenv


def _find_project_root() -> str:
    """Find project root by locating .env file.

    Priority:
    1. C4A_PROJECT_ROOT environment variable (if set)
    2. Directory containing .env file (found by dotenv)
    3. Current working directory (fallback)
    """
    # Priority 1: Explicit environment variable
    explicit_root = os.getenv("C4A_PROJECT_ROOT")
    if explicit_root:
        return explicit_root

    # Priority 2: Find .env file and use its parent directory
    dotenv_path = find_dotenv(usecwd=True)
    if dotenv_path:
        return str(Path(dotenv_path).parent)

    # Priority 3: Fallback to current directory
    return "."


@dataclass
class Config:
    """MCP Server configuration."""

    mongodb_uri: str
    neo4j_uri: str
    neo4j_user: str
    neo4j_password: str
    milvus_uri: str
    debug: bool
    project_root: str


def get_config() -> Config:
    """Load configuration from environment variables.

    Note: Embedding service configuration (OPENAI_API_KEY, OLLAMA_HOST, etc.)
    is handled internally by the embedding_service module.
    """
    load_dotenv()

    return Config(
        mongodb_uri=os.getenv("MONGODB_URI", "mongodb://localhost:27017/c4a"),
        neo4j_uri=os.getenv("NEO4J_URI", "bolt://localhost:7687"),
        neo4j_user=os.getenv("NEO4J_USER", "neo4j"),
        neo4j_password=os.getenv("NEO4J_PASSWORD", "c4a_password"),
        milvus_uri=os.getenv("MILVUS_URI", "http://localhost:19530"),
        debug=os.getenv("DEBUG", "false").lower() == "true",
        project_root=_find_project_root(),
    )
