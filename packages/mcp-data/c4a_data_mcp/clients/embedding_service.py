"""Embedding service abstraction layer.

Supports multiple embedding providers:
- OpenAI (text-embedding-3-small, 1536 dimensions)
- Ollama (nomic-embed-text, 768 dimensions)

Priority: OPENAI_API_KEY > OLLAMA_HOST > None
"""

import os
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any

from ..utils import logger, extract_text_for_embedding


class EmbeddingService(ABC):
    """Abstract base class for embedding services."""

    @property
    @abstractmethod
    def dimensions(self) -> int:
        """Return the embedding vector dimensions."""
        pass

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """Generate embedding for text."""
        pass

    def embed_document(self, data: dict[str, Any]) -> list[float]:
        """Generate embedding for a C4A document."""
        text = extract_text_for_embedding(data)
        return self.embed(text)

    def clear_cache(self) -> None:
        """Clear embedding cache if applicable.

        This is a no-op for base class. Implementations can override
        to provide cache clearing functionality.
        """
        pass


class OpenAIEmbedding(EmbeddingService):
    """OpenAI Embedding implementation."""

    def __init__(
        self,
        api_key: str,
        base_url: str | None = None,
        model: str = "text-embedding-3-small",
    ) -> None:
        """Initialize OpenAI embedding client."""
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model = model
        self._dimensions = 1536
        self._cache: dict[str, list[float]] = {}
        self._cache_max_size = 1000
        self._cache_hits = 0
        self._cache_misses = 0
        logger.info(f"OpenAI Embedding initialized: {model} ({self._dimensions}d)")

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed(self, text: str) -> list[float]:
        """Generate embedding using OpenAI API.

        Uses LRU cache to avoid regenerating embeddings for identical queries.
        Cache size: 1000 queries (~1MB memory).

        Raises:
            ValueError: If text is empty or whitespace-only
        """
        text = text.strip()
        if not text:
            raise ValueError("Cannot embed empty text")

        # Check cache
        if text in self._cache:
            self._cache_hits += 1
            return self._cache[text]

        # Cache miss - generate embedding
        self._cache_misses += 1
        response = self.client.embeddings.create(
            input=text,
            model=self.model,
        )
        embedding = response.data[0].embedding

        # Add to cache (with LRU eviction)
        if len(self._cache) >= self._cache_max_size:
            # Remove oldest entry (first key)
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]
        self._cache[text] = embedding

        return embedding

    def clear_cache(self) -> None:
        """Clear embedding cache and reset statistics."""
        cache_size = len(self._cache)
        total_requests = self._cache_hits + self._cache_misses
        hit_rate = (self._cache_hits / total_requests * 100) if total_requests > 0 else 0

        logger.info(
            f"Embedding cache cleared: {cache_size} entries, "
            f"hit rate: {hit_rate:.1f}% "
            f"({self._cache_hits} hits, {self._cache_misses} misses)"
        )
        self._cache.clear()
        self._cache_hits = 0
        self._cache_misses = 0


class OllamaEmbedding(EmbeddingService):
    """Ollama Embedding implementation with connection pooling."""

    # Default dimensions for common models
    MODEL_DIMENSIONS: dict[str, int] = {
        "nomic-embed-text": 768,
        "mxbai-embed-large": 1024,
        "all-minilm": 384,
    }

    def __init__(
        self,
        host: str = "http://localhost:11434",
        model: str = "nomic-embed-text",
        timeout: float = 60.0,
    ) -> None:
        """Initialize Ollama embedding client with connection pooling.

        Args:
            host: Ollama server URL
            model: Embedding model name
            timeout: Request timeout in seconds (default 60s for slower machines)
        """
        import httpx

        self.host = host.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._dimensions = self.MODEL_DIMENSIONS.get(model, 768)

        # Create persistent HTTP client with connection pooling
        # This reuses TCP connections across requests, reducing latency
        self._client = httpx.Client(
            base_url=self.host,
            timeout=httpx.Timeout(timeout, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )

        logger.info(f"Ollama Embedding initialized: {model} ({self._dimensions}d) @ {host}")

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed(self, text: str) -> list[float]:
        """Generate embedding using Ollama API.

        Uses LRU cache to avoid regenerating embeddings for identical queries.
        Cache size: 1000 queries (~1MB memory).

        Raises:
            ValueError: If text is empty or whitespace-only
            ConnectionError: If Ollama service is unavailable
        """
        import httpx

        text = text.strip()
        if not text:
            raise ValueError("Cannot embed empty text")

        # Check cache
        if hasattr(self, "_cache") and text in self._cache:
            self._cache_hits += 1
            return self._cache[text]

        # Initialize cache on first use
        if not hasattr(self, "_cache"):
            self._cache = {}
            self._cache_max_size = 1000
            self._cache_hits = 0
            self._cache_misses = 0

        # Cache miss - generate embedding
        self._cache_misses += 1

        try:
            response = self._client.post(
                "/api/embeddings",
                json={"model": self.model, "prompt": text},
            )
            response.raise_for_status()
            embedding = response.json()["embedding"]

            # Validate dimension on first call
            actual_dim = len(embedding)
            if actual_dim != self._dimensions:
                logger.warning(
                    f"Ollama model {self.model} returned {actual_dim}d vector, "
                    f"expected {self._dimensions}d. Updating dimension."
                )
                self._dimensions = actual_dim

            # Add to cache (with LRU eviction)
            if len(self._cache) >= self._cache_max_size:
                # Remove oldest entry (first key)
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
            self._cache[text] = embedding

            return embedding
        except httpx.HTTPError as e:
            raise ConnectionError(f"Ollama service unavailable: {e}") from e

    def clear_cache(self) -> None:
        """Clear embedding cache and reset statistics."""
        if not hasattr(self, "_cache"):
            return

        cache_size = len(self._cache)
        total_requests = self._cache_hits + self._cache_misses
        hit_rate = (self._cache_hits / total_requests * 100) if total_requests > 0 else 0

        logger.info(
            f"Embedding cache cleared: {cache_size} entries, "
            f"hit rate: {hit_rate:.1f}% "
            f"({self._cache_hits} hits, {self._cache_misses} misses)"
        )
        self._cache.clear()
        self._cache_hits = 0
        self._cache_misses = 0

    def close(self) -> None:
        """Close the HTTP client and release connections."""
        self._client.close()


class EmbeddingUnavailableError(Exception):
    """Raised when no embedding service is configured."""

    pass


def create_embedding_service() -> EmbeddingService | None:
    """Factory function to create embedding service based on configuration.

    Priority:
    1. OPENAI_API_KEY set -> OpenAIEmbedding
    2. OLLAMA_HOST set -> OllamaEmbedding
    3. Neither set -> None

    Returns:
        EmbeddingService instance or None if no service configured
    """
    # Priority 1: OpenAI
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        return OpenAIEmbedding(
            api_key=openai_key,
            base_url=os.getenv("OPENAI_BASE_URL"),
            model=os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
        )

    # Priority 2: Ollama
    ollama_host = os.getenv("OLLAMA_HOST")
    if ollama_host:
        return OllamaEmbedding(
            host=ollama_host,
            model=os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text"),
        )

    # No embedding service configured
    logger.warning(
        "No embedding service configured. "
        "Set OPENAI_API_KEY or OLLAMA_HOST to enable vector search."
    )
    return None
