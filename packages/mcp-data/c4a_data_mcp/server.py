"""
C4A Data MCP Server

统一封装 MongoDB + Neo4j + Milvus，提供 8 个工具：
- c4a_db_save_entity, c4a_db_get_entity, c4a_db_delete_entity (CRUD)
- c4a_db_search_semantic (语义搜索)
- c4a_db_query_deps, c4a_db_query_impact (关系查询)
- c4a_db_exec_cypher (原生 Cypher)
- c4a_db_sync_local (批量同步本地 DSL 到三库)

命名规范: c4a_db_{verb}_{object}
"""

import os
from typing import Any

from mcp.server.fastmcp import FastMCP

from .config import get_config
from .services import DataService


# 初始化配置
config = get_config()

# HTTP 服务配置
_http_host = os.getenv("FASTMCP_HOST", os.getenv("MCP_HOST", "0.0.0.0"))
_http_port = int(os.getenv("FASTMCP_PORT", os.getenv("MCP_PORT", "8050")))

# 创建 MCP Server
mcp = FastMCP("c4a-data-mcp", json_response=True, host=_http_host, port=_http_port)

# 延迟初始化 DataService（在工具首次调用时）
_data_service: DataService | None = None


def get_data_service() -> DataService:
    """Get or create DataService singleton."""
    global _data_service
    if _data_service is None:
        _data_service = DataService(
            mongodb_uri=config.mongodb_uri,
            neo4j_uri=config.neo4j_uri,
            neo4j_user=config.neo4j_user,
            neo4j_password=config.neo4j_password,
            milvus_uri=config.milvus_uri,
        )
    return _data_service


# =============================================================================
# MCP Tools
# =============================================================================


@mcp.tool()
async def c4a_db_save_entity(
    collection: str,
    data: dict[str, Any],
    id: str | None = None,
) -> dict[str, Any]:
    """
    保存/更新 C4A 文档，自动同步三库（MongoDB + Neo4j + Milvus）。

    Args:
        collection: 集合名称 (systems, containers, components, adrs, contracts)
        data: 文档数据
        id: 文档 ID（省略则自动生成）

    Returns:
        包含 id、status、graph_synced、vector_indexed 的结果
    """
    service = get_data_service()
    return await service.save(collection, data, id)


@mcp.tool()
async def c4a_db_get_entity(
    collection: str,
    query: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    从 MongoDB 查询 C4A 文档。

    Args:
        collection: 集合名称 (systems, containers, components, adrs, contracts)
        query: 查询条件
            - {"id": "xxx"}: 按 ID 获取单个文档
            - {"filter": {...}, "limit": 10}: 按条件过滤

    Returns:
        匹配的文档列表
    """
    service = get_data_service()
    return await service.get(collection, query)


@mcp.tool()
async def c4a_db_delete_entity(
    collection: str,
    id: str,
) -> dict[str, str]:
    """
    删除 C4A 文档，级联清理三库。

    Args:
        collection: 集合名称 (systems, containers, components, adrs, contracts)
        id: 文档 ID

    Returns:
        包含 id、status、graph_deleted、vector_deleted 的结果
    """
    service = get_data_service()
    return await service.delete(collection, id)


@mcp.tool()
async def c4a_db_search_semantic(
    query: str,
    scope: str | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """
    语义搜索 C4A 知识库。

    使用向量相似度在 Milvus 中搜索，返回语义相关的文档。

    Args:
        query: 自然语言搜索词
        scope: 搜索范围限制 (systems, containers, components, adrs, contracts, all)
        limit: 返回结果数量上限（默认 10）

    Returns:
        匹配的文档列表，包含 _score 相似度分数
    """
    service = get_data_service()
    return await service.search(query, scope, limit)


@mcp.tool()
async def c4a_db_query_deps(
    id: str,
    direction: str = "both",
    depth: int = 1,
) -> list[dict[str, Any]]:
    """
    查询实体的依赖关系。

    通过 Neo4j 图遍历查询上下游依赖。

    Args:
        id: 实体 ID
        direction: 方向 (upstream=上游依赖, downstream=下游被依赖, both=双向)
        depth: 遍历深度 (1-5)

    Returns:
        依赖节点列表，包含 id、label、distance 等信息
    """
    service = get_data_service()
    return await service.deps(id, direction, depth)


@mcp.tool()
async def c4a_db_query_impact(
    id: str,
    change_type: str | None = None,
    depth: int = 3,
) -> list[dict[str, Any]]:
    """
    分析实体变更的影响范围。

    通过 Neo4j 图遍历分析哪些下游实体会受到影响。

    Args:
        id: 实体 ID
        change_type: 变更类型 (upgrade=升级, deprecate=废弃, remove=移除)
        depth: 分析深度 (1-5，默认 3)

    Returns:
        受影响的节点列表，包含 id、label、distance、change_type 等信息
    """
    service = get_data_service()
    return await service.impact(id, change_type, depth)


@mcp.tool()
async def c4a_db_exec_cypher(
    query: str,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    执行原生 Cypher 查询。

    直接在 Neo4j 上执行 Cypher 语句，用于复杂的图查询场景。

    Args:
        query: Cypher 查询语句
        params: 查询参数（可选）

    Returns:
        查询结果列表
    """
    service = get_data_service()
    return await service.cypher(query, params)


@mcp.tool()
async def c4a_db_sync_file(
    file_path: str,
    project_path: str | None = None,
) -> dict[str, Any]:
    """
    同步单个 DSL 文件到三库 (MongoDB/Neo4j/Milvus)。

    推荐用于避免批量同步超时问题。先用 c4a_local_list_files 获取文件列表，
    然后逐个调用此工具同步。

    Args:
        file_path: DSL 文件路径（相对于项目根目录，如 .c4a/published/adr/adr-001.c4a.yaml）
        project_path: 项目根目录（默认使用 C4A_PROJECT_ROOT 环境变量）

    Returns:
        包含 id、type、action (created/updated)、status 的同步结果
    """
    service = get_data_service()
    effective_project_path = project_path if project_path else config.project_root
    return await service.sync_file(file_path, effective_project_path)


@mcp.tool()
async def c4a_db_sync_local(
    scope: str = "published",
    path: str | None = None,
    type: str = "all",
    mode: str = "incremental",
    conflict_policy: str = "skip",
    project_path: str | None = None,
) -> dict[str, Any]:
    """
    将本地 .c4a/ 目录的 DSL 文件批量同步到三库 (MongoDB/Neo4j/Milvus)。

    ⚠️ 注意：批量同步可能因文件数量较多导致超时。
    推荐使用 c4a_db_sync_file 逐文件同步以避免超时问题。

    Args:
        scope: 同步范围 (published=已发布, approved=已批准, all=全部, path=指定路径)
        path: 指定路径 (当 scope="path" 时使用)
        type: 按类型筛选 (system, container, component, adr, all)
        mode: 同步模式 (incremental=增量, full=完整)
        conflict_policy: 冲突处理策略 (skip=跳过, error=报错, override=覆盖)
        project_path: 项目根目录（默认使用 C4A_PROJECT_ROOT 环境变量）

    Returns:
        包含 stats (scanned, created, updated, skipped, conflicted, failed)
        和 details (每个文件的同步结果) 的结果
    """
    service = get_data_service()
    # 使用配置中的 project_root 作为默认值
    effective_project_path = project_path if project_path else config.project_root
    return await service.sync(
        scope=scope,
        path=path,
        type_filter=type,
        mode=mode,
        conflict_policy=conflict_policy,
        project_path=effective_project_path,
    )


# =============================================================================
# Health Check Resource
# =============================================================================


@mcp.resource("health://status")
def health_status() -> str:
    """Get server health status."""
    import json
    return json.dumps({
        "status": "healthy",
        "service": "c4a-data-mcp",
        "version": "0.1.0",
    })


# =============================================================================
# Entry Point
# =============================================================================


def main() -> None:
    """Run the MCP server."""
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    mcp.run(transport=transport)  # type: ignore


if __name__ == "__main__":
    main()
