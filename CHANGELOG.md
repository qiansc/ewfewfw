# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [0.3.0] - 2026-02-02

### Added
- Server mode support (MongoDB + Neo4j + Milvus)
- Feat lifecycle management
- Skills system (/c4a:feat, /c4a:specify, /c4a:plan, /c4a:implement, /c4a:analyze)
- Data-Ops modules (transaction, workflow, sync, reference)
- Developer CLI (cli-dev)
- Security tools (DSL injection protection, path safety checks)

### Changed
- Refactored storage layer to the StorageAdapter interface
- Renamed MCP tools (legacy_* -> c4a_store_*)
- Unified configuration system into .c4a/config.yaml

### Removed
- Legacy MCP interfaces
- mcp-dsl package (merged into storage)

### Fixed
- Concurrent modification warnings
- Reference integrity checks
