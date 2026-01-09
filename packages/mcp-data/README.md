# c4a-data-mcp

C4A 统一数据服务 MCP Server，封装 MongoDB + Neo4j + Milvus 三库操作。

## 功能

提供 8 个高层工具（Agent 首选）+ 1 个低层工具（保底方案）：

### 高层工具

| 工具 | 描述 | 使用场景 |
|------|------|---------|
| `c4a_db_save_entity` | 保存/更新文档 | "保存这个 System DSL" |
| `c4a_db_get_entity` | 获取文档 | "获取 order-system 定义" |
| `c4a_db_delete_entity` | 删除文档 | "删除这个 ADR" |
| `c4a_db_search_semantic` | 语义搜索 | "找和支付相关的设计文档" |
| `c4a_db_query_deps` | 依赖查询 | "order-service 依赖哪些服务？" |
| `c4a_db_query_impact` | 影响分析 | "升级 MySQL 8.0 会影响什么？" |
| `c4a_db_sync_file` | **单文件同步（推荐）** | 同步单个 DSL 文件到三库，避免超时 |
| `c4a_db_sync_local` | 批量同步（⚠️ 可能超时） | 同步本地 DSL 文件到三库 |

### 低层工具

| 工具 | 描述 | 使用场景 |
|------|------|---------|
| `c4a_db_exec_cypher` | 原生 Cypher 查询 | 复杂图查询（高层工具无法满足时） |

## 架构

```
c4a_db_save_entity/get_entity/delete_entity/search_semantic/query_deps/query_impact
         │
         ▼
   Data Service Layer
   (写入时同步三库，删除时级联清理)
         │
    ┌────┼────┐
    ▼    ▼    ▼
MongoDB Neo4j Milvus
(主存储)(图索引)(向量索引)
```

## 开发

```bash
# 安装依赖
uv sync

# 启动服务
uv run python -m src.server

# 运行测试
uv run pytest

# 类型检查
uv run mypy src/
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MONGODB_URI` | `mongodb://localhost:27017/c4a` | MongoDB 连接串 |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j Bolt 地址 |
| `NEO4J_USER` | `neo4j` | Neo4j 用户名 |
| `NEO4J_PASSWORD` | `c4a_password` | Neo4j 密码 |
| `MILVUS_URI` | `http://localhost:19530` | Milvus 地址 |
| `MCP_PORT` | `8050` | MCP Server 端口 |
| `DEBUG` | `false` | 调试模式 |

## 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/mcp` | POST | MCP 协议入口 |
