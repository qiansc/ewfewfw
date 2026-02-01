from __future__ import annotations

from src.adapters.milvus import MilvusAdapter


def test_milvus_adapter_config():
    adapter = MilvusAdapter("http://localhost:19530", collection="test_vectors", dimension=768)
    assert adapter.collection == "test_vectors"
    assert adapter.dimension == 768
