"""Embedder using OpenAI API."""

from typing import Any

from openai import OpenAI

from ..utils import logger, extract_text_for_embedding


class Embedder:
    """Generate embeddings using OpenAI API."""

    def __init__(
        self,
        api_key: str,
        base_url: str | None = None,
        model: str = "text-embedding-3-small",
    ) -> None:
        """Initialize embedder."""
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model = model
        logger.info(f"Embedder initialized: {model}")

    def embed(self, text: str) -> list[float]:
        """
        Generate embedding for text.

        Args:
            text: Input text

        Returns:
            Embedding vector (1536 dimensions for text-embedding-3-small)
        """
        if not text.strip():
            # Return zero vector for empty text
            return [0.0] * 1536

        response = self.client.embeddings.create(
            input=text,
            model=self.model,
        )

        return response.data[0].embedding

    def embed_document(self, data: dict[str, Any]) -> list[float]:
        """
        Generate embedding for a C4A document.

        Args:
            data: Document data

        Returns:
            Embedding vector
        """
        text = extract_text_for_embedding(data)
        return self.embed(text)
