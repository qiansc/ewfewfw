from __future__ import annotations

from src.services.embedding import EmbeddingService, OllamaEmbedding, OpenAIEmbedding


def reset_embedding_service() -> None:
    EmbeddingService._instance = None


def test_embedding_service_defaults_to_ollama(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    reset_embedding_service()

    provider = EmbeddingService.get_provider()
    assert isinstance(provider, OllamaEmbedding)
    assert provider.dimension == 768
    assert EmbeddingService.get_dimension() == 768


def test_embedding_service_uses_openai_when_key_set(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    reset_embedding_service()

    provider = EmbeddingService.get_provider()
    assert isinstance(provider, OpenAIEmbedding)
    assert provider.dimension == 1536
    assert EmbeddingService.get_dimension() == 1536
