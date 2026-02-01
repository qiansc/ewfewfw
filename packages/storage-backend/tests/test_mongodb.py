from __future__ import annotations

from src.adapters.mongodb import MongoDBAdapter


def test_resolve_database_from_uri():
    adapter = MongoDBAdapter("mongodb://localhost:27017/c4a-test")
    assert adapter.database == "c4a-test"
