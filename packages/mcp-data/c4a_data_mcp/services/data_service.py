"""
Data Service Layer

协调 MongoDB、Neo4j、Milvus 三库的同步逻辑。
"""

from typing import Any
from uuid import uuid4

from ..clients import MongoDBClient, Neo4jClient, MilvusClient
from ..clients.embedding_service import (
    EmbeddingService,
    create_embedding_service,
    EmbeddingUnavailableError,
)
from ..utils import logger, validate_collection, NODE_LABELS


class DataService:
    """Unified data service for C4A with tri-storage sync."""

    def __init__(
        self,
        mongodb_uri: str,
        neo4j_uri: str,
        neo4j_user: str,
        neo4j_password: str,
        milvus_uri: str,
    ) -> None:
        """Initialize data service with all storage clients."""
        self.mongodb = MongoDBClient(mongodb_uri)
        self.neo4j = Neo4jClient(neo4j_uri, neo4j_user, neo4j_password)

        # Initialize embedding service (may be None if not configured)
        self.embedder: EmbeddingService | None = create_embedding_service()

        # Initialize Milvus only if embedding service is available
        if self.embedder:
            self.milvus: MilvusClient | None = MilvusClient(
                milvus_uri, dimension=self.embedder.dimensions
            )
            logger.info(
                f"DataService initialized with {self.embedder.__class__.__name__} "
                f"({self.embedder.dimensions}d)"
            )
        else:
            self.milvus = None
            logger.warning(
                "DataService initialized without embedding service. "
                "Vector search (c4a_db_search_semantic) will be unavailable."
            )

    async def save(
        self, collection: str, data: dict[str, Any], doc_id: str | None = None
    ) -> dict[str, Any]:
        """
        保存/更新文档，自动同步三库。

        流程:
        1. 检查 Embedding 服务是否可用
        2. MongoDB: Upsert 主文档
        3. Neo4j: 创建/更新节点 + 关系
        4. Milvus: 生成并索引向量

        Args:
            collection: Collection name (systems, containers, etc.)
            data: Document data
            doc_id: Optional document ID (generated if not provided)

        Returns:
            Result with id and sync status

        Raises:
            EmbeddingUnavailableError: If no embedding service is configured
        """
        validate_collection(collection)

        # Check embedding service availability
        if not self.embedder or not self.milvus:
            raise EmbeddingUnavailableError(
                "Cannot save: No embedding service configured. "
                "Please set OPENAI_API_KEY or OLLAMA_HOST to enable data storage."
            )

        # Generate ID if not provided
        final_id = doc_id or data.get("id") or f"{collection}_{uuid4().hex[:8]}"
        data["id"] = final_id

        # Step 1: MongoDB Upsert (required)
        saved_doc = self.mongodb.upsert(collection, final_id, data)

        # Step 2: Neo4j Sync (best-effort)
        graph_synced = True
        try:
            self.neo4j.upsert_node(collection, final_id, data)
            self._sync_relationships(collection, final_id, data)
        except Exception as e:
            logger.warning(f"Neo4j sync failed: {e}")
            graph_synced = False

        # Step 3: Milvus Indexing
        vector_indexed = True
        try:
            embedding = self.embedder.embed_document(data)
            self.milvus.upsert(final_id, collection, embedding)
        except Exception as e:
            logger.warning(f"Milvus indexing failed: {e}")
            vector_indexed = False

        return {
            "id": final_id,
            "status": "saved",
            "graph_synced": graph_synced,
            "vector_indexed": vector_indexed,
        }

    def _ensure_external_node(
        self, dep: dict[str, Any], default_collection: str
    ) -> None:
        """Ensure external node exists in Neo4j (graph only, not MongoDB/Milvus).

        External nodes are lightweight placeholders for dependencies outside
        the system boundary. They only exist in Neo4j for relationship queries.

        When a real DSL file is synced later (with external: false or omitted),
        the node properties will be updated via MERGE, effectively "upgrading"
        the external node to a full internal node.

        Args:
            dep: Dependency definition with id, description, external flag
            default_collection: Collection name to infer node label (systems/containers)
        """
        if not dep.get("external"):
            return

        node_id = dep.get("id")
        if not node_id:
            return

        self.neo4j.upsert_node(
            collection=default_collection,
            doc_id=node_id,
            properties={
                "name": dep.get("name", node_id),
                "description": dep.get("description", f"External {default_collection[:-1]}"),
                "external": True,
            },
        )
        logger.debug(f"Ensured external node: {default_collection}/{node_id}")

    def _sync_relationships(
        self, collection: str, doc_id: str, data: dict[str, Any]
    ) -> None:
        """Extract and sync relationships to Neo4j.

        Handles:
        1. Hierarchical CONTAINS relationships:
           - system_id → System CONTAINS Container
           - container_id → Container CONTAINS Component
        2. Explicit relationships field (dependencies, calls)
           - For external dependencies, auto-creates placeholder nodes
        3. Nested components array
        """
        # =================================================================
        # 1. Hierarchical CONTAINS relationships (parent contains child)
        # =================================================================

        # Container belongs to System: System -[CONTAINS]-> Container
        system_id = data.get("system_id")
        if system_id and collection == "containers":
            self.neo4j.create_relationship(
                from_id=system_id,
                to_id=doc_id,
                rel_type="CONTAINS",
            )
            logger.debug(f"Created CONTAINS: {system_id} -> {doc_id}")

        # Component belongs to Container: Container -[CONTAINS]-> Component
        container_id = data.get("container_id")
        if container_id and collection == "components":
            self.neo4j.create_relationship(
                from_id=container_id,
                to_id=doc_id,
                rel_type="CONTAINS",
            )
            logger.debug(f"Created CONTAINS: {container_id} -> {doc_id}")

        # =================================================================
        # 2. Explicit relationships field
        # =================================================================
        relationships = data.get("relationships", {})

        if isinstance(relationships, dict):
            # System format: { dependencies: [...] }
            for dep in relationships.get("dependencies", []):
                if isinstance(dep, dict) and "id" in dep:
                    # Ensure external node exists before creating relationship
                    self._ensure_external_node(dep, "systems")

                    self.neo4j.create_relationship(
                        from_id=doc_id,
                        to_id=dep["id"],
                        rel_type="DEPENDS_ON",
                        properties={
                            "technology": dep.get("technology"),
                            "criticality": dep.get("criticality", "medium"),
                        },
                    )

        elif isinstance(relationships, list):
            # Container/Component format: [{ to: ..., external: ... }]
            for rel in relationships:
                if isinstance(rel, dict) and "to" in rel:
                    # Ensure external node exists before creating relationship
                    if rel.get("external"):
                        self._ensure_external_node(
                            {"id": rel["to"], "description": rel.get("description"), "external": True},
                            "containers",
                        )

                    rel_type = "CALLS" if rel.get("async") else "DEPENDS_ON"
                    self.neo4j.create_relationship(
                        from_id=doc_id,
                        to_id=rel["to"],
                        rel_type=rel_type,
                        properties={
                            "technology": rel.get("technology"),
                            "description": rel.get("description"),
                        },
                    )

        # =================================================================
        # 3. Nested components array (legacy format)
        # =================================================================
        for component_id in data.get("components", []):
            if isinstance(component_id, str):
                self.neo4j.create_relationship(
                    from_id=doc_id,
                    to_id=component_id,
                    rel_type="CONTAINS",
                )

    async def get(
        self, collection: str, query: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """
        从 MongoDB 查询文档。

        Args:
            collection: Collection name
            query: Query dict. Supports:
                - {"id": "..."}: Get by ID
                - {"filter": {...}, "limit": N}: Query with filter

        Returns:
            List of matching documents
        """
        validate_collection(collection)

        # Parse query format
        if "id" in query:
            doc = self.mongodb.find_one(collection, {"id": query["id"]})
            return [doc] if doc else []

        filter_query = query.get("filter", {})
        limit = query.get("limit", 100)

        return self.mongodb.find(collection, filter_query, limit)

    async def delete(self, collection: str, doc_id: str) -> dict[str, str]:
        """
        删除文档，级联清理三库。

        Args:
            collection: Collection name
            doc_id: Document ID

        Returns:
            Delete status
        """
        validate_collection(collection)

        # Step 1: MongoDB Delete (required)
        mongo_deleted = self.mongodb.delete_one(collection, doc_id)

        # Step 2: Neo4j Delete (best-effort)
        graph_deleted = True
        try:
            self.neo4j.delete_node(doc_id)
        except Exception as e:
            logger.warning(f"Neo4j delete failed: {e}")
            graph_deleted = False

        # Step 3: Milvus Delete (best-effort, skip if no embedding service)
        vector_deleted = True
        if self.milvus:
            try:
                self.milvus.delete(doc_id)
            except Exception as e:
                logger.warning(f"Milvus delete failed: {e}")
                vector_deleted = False
        else:
            vector_deleted = False

        return {
            "id": doc_id,
            "status": "deleted" if mongo_deleted else "not_found",
            "graph_deleted": str(graph_deleted),
            "vector_deleted": str(vector_deleted),
        }

    async def search(
        self, query: str, scope: str | None = None, limit: int = 10
    ) -> list[dict[str, Any]]:
        """
        语义搜索（使用 Milvus）。

        Args:
            query: Natural language query
            scope: Optional scope filter (systems, adrs, all)
            limit: Maximum results

        Returns:
            List of matching documents with scores

        Raises:
            EmbeddingUnavailableError: If no embedding service is configured
        """
        # Check embedding service availability
        if not self.embedder or not self.milvus:
            raise EmbeddingUnavailableError(
                "Vector search unavailable: No embedding service configured. "
                "Please set OPENAI_API_KEY or OLLAMA_HOST to enable semantic search."
            )

        # Generate query embedding
        query_embedding = self.embedder.embed(query)

        # Search in Milvus
        doc_types = None
        if scope and scope != "all":
            doc_types = [scope]

        vector_results = self.milvus.search(query_embedding, doc_types, limit)

        # Fetch full documents from MongoDB
        results = []
        for vr in vector_results:
            # Determine collection from doc_type
            collection = vr.get("doc_type")
            if collection:
                doc = self.mongodb.find_one(collection, {"id": vr["id"]})
                if doc:
                    results.append({
                        **doc,
                        "_score": vr["score"],
                    })

        return results

    async def deps(
        self, doc_id: str, direction: str = "both", depth: int = 1
    ) -> list[dict[str, Any]]:
        """
        依赖查询（使用 Neo4j）。

        Args:
            doc_id: Starting node ID
            direction: "upstream", "downstream", or "both"
            depth: Maximum traversal depth (1-5)

        Returns:
            List of dependent nodes
        """
        return self.neo4j.query_deps(doc_id, direction, min(depth, 5))

    async def impact(
        self, doc_id: str, change_type: str | None = None, depth: int = 3
    ) -> list[dict[str, Any]]:
        """
        影响分析（使用 Neo4j）。

        Args:
            doc_id: Node ID to analyze
            change_type: Type of change (upgrade, deprecate, remove)
            depth: Maximum traversal depth

        Returns:
            List of affected nodes with distance
        """
        results = self.neo4j.query_impact(doc_id, min(depth, 5))

        # Enrich with change type context if provided
        if change_type:
            for r in results:
                r["change_type"] = change_type

        return results

    async def cypher(
        self, query: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """
        原生 Cypher 查询。

        Args:
            query: Cypher query string
            params: Query parameters

        Returns:
            Query results
        """
        return self.neo4j.execute_cypher(query, params)

    def _normalize_yaml_values(self, obj: Any) -> Any:
        """
        递归处理 YAML 解析后的对象，将 datetime.date 等特殊类型转换为字符串。

        PyYAML 的 safe_load 会自动将 "2026-01-07" 这样的日期字符串解析为 datetime.date 对象，
        但后续 JSON 序列化时会出错。此方法确保所有值都是可序列化的。
        """
        import datetime

        if isinstance(obj, dict):
            return {k: self._normalize_yaml_values(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._normalize_yaml_values(item) for item in obj]
        elif isinstance(obj, datetime.date):
            return obj.isoformat()
        elif isinstance(obj, datetime.datetime):
            return obj.isoformat()
        else:
            return obj

    async def sync_file(
        self,
        file_path: str,
        project_path: str = ".",
    ) -> dict[str, Any]:
        """
        同步单个 DSL 文件到三库。

        Args:
            file_path: DSL 文件路径（相对于项目根目录）
            project_path: 项目根目录

        Returns:
            同步结果，包含 id、type、action、status
        """
        import yaml
        from pathlib import Path

        full_path = Path(project_path) / file_path
        if not full_path.exists():
            return {
                "success": False,
                "error": f"文件不存在: {file_path}",
            }

        try:
            with open(full_path, "r", encoding="utf-8") as f:
                content = yaml.safe_load(f)

            # 处理 datetime.date 等特殊类型
            content = self._normalize_yaml_values(content)

            if not content or not isinstance(content, dict):
                return {
                    "success": False,
                    "error": f"无效的 YAML 内容: {file_path}",
                }

            dsl_type = content.get("type")
            if not dsl_type:
                return {
                    "success": False,
                    "error": f"缺少 type 字段: {file_path}",
                }

            # 映射 type 到数据键名（处理 software-system 等复合类型）
            type_to_key = {
                "software-system": "system",
                "system": "system",
                "container": "container",
                "component": "component",
                "adr": "adr",
            }
            data_key = type_to_key.get(dsl_type, dsl_type)

            # 标准化 dsl_type（用于集合映射）
            normalized_type = data_key  # software-system -> system

            # 提取 ID
            type_data = content.get(data_key, {})
            doc_id = type_data.get("id")
            if normalized_type == "adr":
                doc_id = type_data.get("id") or type_data.get("title")
            if not doc_id:
                return {
                    "success": False,
                    "error": f"缺少 id 字段: {file_path}",
                }

            # 确定集合名
            collection_map = {
                "system": "systems",
                "container": "containers",
                "component": "components",
                "adr": "adrs",
            }
            collection = collection_map.get(normalized_type)
            if not collection:
                return {
                    "success": False,
                    "error": f"未知的 DSL 类型: {dsl_type}",
                }

            # 检查是否已存在
            existing = self.mongodb.find_one(collection, {"id": doc_id})
            action = "updated" if existing else "created"

            # 准备同步数据
            sync_data = {
                "id": doc_id,
                "dsl_type": dsl_type,
                "source_path": file_path,
                **content,
            }

            # 调用 save 方法同步到三库
            result = await self.save(collection, sync_data, doc_id)

            return {
                "success": True,
                "id": doc_id,
                "type": dsl_type,
                "action": action,
                "collection": collection,
                "graph_synced": result.get("graph_synced", False),
                "vector_indexed": result.get("vector_indexed", False),
            }

        except Exception as e:
            logger.warning(f"Sync failed for {file_path}: {e}")
            return {
                "success": False,
                "error": str(e),
                "file_path": file_path,
            }

    async def sync(
        self,
        scope: str = "published",
        path: str | None = None,
        type_filter: str = "all",
        mode: str = "incremental",
        conflict_policy: str = "skip",
        project_path: str = ".",
    ) -> dict[str, Any]:
        """
        将本地 .c4a/ 目录的 DSL 文件批量同步到三库。

        Args:
            scope: 同步范围 (published, approved, all, path)
            path: 指定路径 (当 scope="path" 时使用)
            type_filter: 按类型筛选 (system, container, component, adr, all)
            mode: 同步模式 (incremental, full)
            conflict_policy: 冲突处理策略 (skip, error, override)
            project_path: 项目根目录

        Returns:
            同步结果统计和详情
        """
        import yaml
        from pathlib import Path

        c4a_root = Path(project_path) / ".c4a"
        stats = {
            "scanned": 0,
            "created": 0,
            "updated": 0,
            "deleted": 0,
            "skipped": 0,
            "conflicted": 0,
            "failed": 0,
        }
        details: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []

        # 确定要扫描的目录
        dirs_to_scan: list[Path] = []
        if scope == "published":
            dirs_to_scan = [
                c4a_root / "published" / "system",
                c4a_root / "published" / "container",
                c4a_root / "published" / "component",
                c4a_root / "published" / "adr",
            ]
        elif scope == "approved":
            dirs_to_scan = [c4a_root / "approved"]
        elif scope == "all":
            dirs_to_scan = [
                c4a_root / "drafts",
                c4a_root / "approved",
                c4a_root / "published" / "system",
                c4a_root / "published" / "container",
                c4a_root / "published" / "component",
                c4a_root / "published" / "adr",
            ]
        elif scope == "path" and path:
            dirs_to_scan = [Path(project_path) / path]

        # 收集所有 .c4a.yaml 文件
        files_to_sync: list[Path] = []
        for scan_dir in dirs_to_scan:
            if scan_dir.exists():
                for file_path in scan_dir.rglob("*.c4a.yaml"):
                    files_to_sync.append(file_path)

        stats["scanned"] = len(files_to_sync)

        # 获取库中已有的 ID 列表（用于冲突检测和 full 模式删除）
        existing_ids: set[str] = set()
        if mode == "full" or conflict_policy != "override":
            for collection in ["systems", "containers", "components", "adrs"]:
                try:
                    docs = self.mongodb.find(collection, {}, limit=10000)
                    for doc in docs:
                        if "id" in doc:
                            existing_ids.add(doc["id"])
                except Exception:
                    pass  # Collection may not exist yet

        synced_ids: set[str] = set()

        # 同步每个文件
        for file_path in files_to_sync:
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = yaml.safe_load(f)

                if not content or not isinstance(content, dict):
                    continue

                # 处理 datetime.date 等特殊类型
                content = self._normalize_yaml_values(content)

                dsl_type = content.get("type")
                if not dsl_type:
                    continue

                # 类型过滤（支持 software-system 类型）
                normalized_filter = type_filter
                if type_filter == "software-system":
                    normalized_filter = "software-system"
                if type_filter != "all" and dsl_type != type_filter:
                    continue

                # 映射 type 到数据键名（处理 software-system 等复合类型）
                type_to_key = {
                    "software-system": "system",
                    "container": "container",
                    "component": "component",
                    "adr": "adr",
                }
                data_key = type_to_key.get(dsl_type, dsl_type)

                # 提取 ID
                type_data = content.get(data_key, {})
                doc_id = type_data.get("id")
                if dsl_type == "adr":
                    doc_id = type_data.get("id") or type_data.get("title")
                if not doc_id:
                    continue

                # 确定集合名
                collection_map = {
                    "software-system": "systems",
                    "container": "containers",
                    "component": "components",
                    "adr": "adrs",
                }
                collection = collection_map.get(dsl_type)
                if not collection:
                    continue

                # 检查是否是 published 范围
                is_published_scope = scope == "published" or "/published/" in str(file_path)

                # 冲突检测（仅对非 published 范围的文件检测）
                if not is_published_scope and doc_id in existing_ids:
                    if conflict_policy == "skip":
                        stats["conflicted"] += 1
                        details.append({
                            "path": str(file_path.relative_to(project_path)),
                            "id": doc_id,
                            "type": dsl_type,
                            "action": "conflicted",
                            "reason": "已存在于 published",
                        })
                        continue
                    elif conflict_policy == "error":
                        raise Exception(f"冲突: {doc_id} 已存在于库中")
                    # override: 继续同步

                # 准备同步数据
                sync_data = {
                    "id": doc_id,
                    "dsl_type": dsl_type,
                    "source_path": str(file_path.relative_to(project_path)),
                    **content,
                }

                # 判断是创建还是更新
                is_update = doc_id in existing_ids
                action = "updated" if is_update else "created"

                # 调用 save 方法同步到三库
                await self.save(collection, sync_data, doc_id)
                synced_ids.add(doc_id)

                if is_update:
                    stats["updated"] += 1
                else:
                    stats["created"] += 1

                details.append({
                    "path": str(file_path.relative_to(project_path)),
                    "id": doc_id,
                    "type": dsl_type,
                    "action": action,
                })

            except Exception as e:
                stats["failed"] += 1
                errors.append({
                    "path": str(file_path.relative_to(project_path)),
                    "error": str(e),
                })
                logger.warning(f"Sync failed for {file_path}: {e}")

        # Full 模式：删除库中存在但本地不存在的记录
        if mode == "full" and scope == "published":
            ids_to_delete = existing_ids - synced_ids
            for doc_id in ids_to_delete:
                try:
                    # 尝试从各集合删除
                    for collection in ["systems", "containers", "components", "adrs"]:
                        result = await self.delete(collection, doc_id)
                        if result.get("status") == "deleted":
                            stats["deleted"] += 1
                            details.append({
                                "id": doc_id,
                                "action": "deleted",
                            })
                            break
                except Exception as e:
                    logger.warning(f"Delete failed for {doc_id}: {e}")

        # 计算跳过数（未变化的）
        stats["skipped"] = max(0, stats["scanned"] - stats["created"] - stats["updated"] - stats["conflicted"] - stats["failed"])

        return {
            "success": stats["failed"] == 0,
            "stats": stats,
            "errors": errors,
            "details": details,
        }

    def close(self) -> None:
        """Close all storage connections."""
        self.mongodb.close()
        self.neo4j.close()
        if self.milvus:
            self.milvus.close()
        # Close embedding client if it has a close method (e.g., OllamaEmbedding)
        if self.embedder and hasattr(self.embedder, "close"):
            self.embedder.close()
        logger.info("DataService closed all connections")
