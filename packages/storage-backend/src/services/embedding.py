from __future__ import annotations

import os
from abc import ABC, abstractmethod

import httpx

from ..config import load_settings


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        raise NotImplementedError

    @property
    @abstractmethod
    def dimension(self) -> int:
        raise NotImplementedError


class OllamaEmbedding(EmbeddingProvider):
    def __init__(self, host: str | None = None, model: str = "nomic-embed-text") -> None:
        settings = load_settings()
        default_host = os.getenv("OLLAMA_HOST", settings.ollama_base_url)
        self.host = host or default_host
        self.model = model

    async def embed(self, text: str) -> list[float]:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.host}/api/embeddings",
                json={"model": self.model, "prompt": text},
                timeout=30,
            )
            response.raise_for_status()
            return response.json()["embedding"]

    @property
    def dimension(self) -> int:
        return 768


class OpenAIEmbedding(EmbeddingProvider):
    def __init__(self, api_key: str | None = None, model: str = "text-embedding-3-small") -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
        self.model = model

    async def embed(self, text: str) -> list[float]:
        response = await self.client.embeddings.create(model=self.model, input=text)
        return response.data[0].embedding

    @property
    def dimension(self) -> int:
        return 1536


class EmbeddingService:
    _instance: EmbeddingProvider | None = None

    @classmethod
    def get_provider(cls) -> EmbeddingProvider:
        if cls._instance is None:
            if os.getenv("OPENAI_API_KEY"):
                cls._instance = OpenAIEmbedding()
            else:
                cls._instance = OllamaEmbedding()
        return cls._instance

    @classmethod
    def get_dimension(cls) -> int:
        return cls.get_provider().dimension
