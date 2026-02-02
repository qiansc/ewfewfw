# C4A 技术架构

## 系统概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Agent (Claude/GPT/...)                │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │ MCP Protocol
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Server 层                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ mcp-store   │  │ mcp-query   │  │ mcp-extract │  │mcp-visual│ │
│  │ 知识存储    │  │ 知识查询    │  │ 代码提取    │  │ 可视化  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Storage 适配层                           │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐   │
│  │     Lite Adapter        │  │      Server Adapter         │   │
│  │  SQLite + USearch       │  │  MongoDB + Neo4j + Milvus   │   │
│  │  (Local 模式)           │  │  (Server/Remote 模式)       │   │
│  └─────────────────────────┘  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 知识模型

### 实体类型

| 类型 | 层面 | 说明 | 典型字段 |
|------|------|------|----------|
| **Product** | 业务 | 产品定义 | user_stories, acceptance_criteria |
| **Process** | 业务 | 业务流程 | steps, triggers, outcomes |
| **SoR** | 业务 | 权威数据源 | schema, owner, consumers |
| **System** | 架构 | 系统边界 | external_systems, boundaries |
| **Container** | 架构 | 服务/应用 | technology, system_id |
| **Component** | 架构 | 模块/类 | container_id, interfaces |
| **ADR** | 架构 | 架构决策 | status, context, decision, consequences |
| **Contract** | 契约 | API 契约 | spec_type (openapi/asyncapi/proto), spec |

### 实体状态流转

```
draft → approved → published → deprecated → archived
  │                    │
  └────────────────────┘
        (rejected)
```

### 知识点类型 (kind)

| Kind | 说明 | 示例 |
|------|------|------|
| `implementation` | 代码实现 | 服务、模块、函数 |
| `external` | 外部依赖 | 第三方 API、SaaS |
| `concept` | 概念定义 | 领域模型、业务规则 |

## Feat 分支机制

Feat 是知识的隔离单元，类似 Git 分支：

```
main (proposal_id = null)
  │
  ├── feat-user-auth (proposal_id = "feat-user-auth")
  │     └── 修改 System A, 新增 Container B
  │
  └── feat-payment (proposal_id = "feat-payment")
        └── 新增 ADR-003, Contract-payment
```

### Feat 生命周期

```
create → draft → approved → published (合并到 main)
                    │
                    └── deprecated/archived
```

### 查询隔离

- `proposal_id = null`：查询主分支
- `proposal_id = "feat-xxx"`：查询特定 Feat（包含主分支 + Feat 变更）

## 存储架构

### Local 模式 (Lite Adapter)

```
SQLite (单文件)
├── entities        # 实体主表
├── relations       # 关系表
├── metadata        # 元数据
└── feat_registry   # Feat 注册表

USearch (WASM)
└── 本地向量索引
```

### Server 模式 (Server Adapter)

```
MongoDB (文档存储)
├── entities        # 实体文档
├── feat_registry   # Feat 元数据
└── checklist       # 任务清单

Neo4j (图数据库)
└── 实体关系图谱

Milvus (向量数据库)
└── 语义搜索索引
```

## MCP 工具集

### mcp-store (知识存储)

| 工具 | 功能 |
|------|------|
| `c4a_store_save` | 保存/更新实体 |
| `c4a_store_read` | 读取实体 |
| `c4a_store_list` | 列出实体 |
| `c4a_store_delete` | 删除实体 |
| `c4a_store_sync` | 文件系统同步 |
| `c4a_store_validate` | 一致性检查 |
| `c4a_store_feat_lifecycle` | Feat 生命周期 |
| `c4a_store_feat_merge` | Feat 合并 |
| `c4a_store_feat_checklist` | Checklist 管理 |

### mcp-query (知识查询)

| 工具 | 功能 |
|------|------|
| `c4a_query_search` | 语义搜索 |
| `c4a_query_deps` | 依赖查询 |
| `c4a_query_impact` | 影响分析 |

### mcp-extract (代码提取)

| 工具 | 功能 |
|------|------|
| `c4a_extract_interfaces` | 提取接口定义 |
| `c4a_extract_analyze` | 分析代码结构 |
| `c4a_extract_ast` | 获取 AST |
| `c4a_extract_contract` | 生成 API 契约 |

### mcp-visual (可视化)

| 工具 | 功能 |
|------|------|
| `c4a_visual_generate` | AI 生成图片 |
| `c4a_visual_render_c4` | 渲染 C4 架构图 |

## 数据流

### 知识写入流程

```
Agent 调用 c4a_store_save
        │
        ▼
┌───────────────────┐
│  Schema 校验      │
│  (Zod validation) │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  ADR 合规检查     │
│  (可选)           │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  写入主存储       │
│  (SQLite/MongoDB) │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  同步关系图谱     │
│  (Neo4j)          │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  更新向量索引     │
│  (USearch/Milvus) │
└───────────────────┘
```

### 知识查询流程

```
Agent 调用 c4a_query_search
        │
        ▼
┌───────────────────┐
│  文本向量化       │
│  (Embedding)      │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  向量相似度搜索   │
│  (USearch/Milvus) │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  获取实体详情     │
│  (SQLite/MongoDB) │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  返回结果         │
└───────────────────┘
```

## 文件系统同步

### .context/ 目录结构

```
.context/
├── drafts/         # 草稿 (可自由修改)
├── approved/       # 已审核 (设计冻结)
├── published/      # 已发布 (禁止修改)
└── archive/        # 归档 (禁止修改)
```

### 同步方向

- **import**：文件 → 数据库
- **export**：数据库 → 文件

## 服务端口

| 端口 | 服务 | 说明 |
|------|------|------|
| 8051 | mcp-store | 知识存储 |
| 8052 | mcp-extract | 代码提取 |
| 8053 | mcp-visual | 可视化 |
| 8054 | mcp-query | 知识查询 |
| 8055 | storage-backend | Python 后端 (Server 模式) |
| 27017 | MongoDB | 文档存储 |
| 7474 | Neo4j Browser | 图数据库 UI |
| 7687 | Neo4j Bolt | 图数据库协议 |
| 19530 | Milvus | 向量数据库 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun (Node.js 兼容) |
| 语言 | TypeScript, Python |
| MCP 框架 | @modelcontextprotocol/sdk |
| Schema | Zod |
| 本地存储 | bun:sqlite, USearch (WASM) |
| 远程存储 | MongoDB, Neo4j, Milvus |
| 后端框架 | FastAPI |
