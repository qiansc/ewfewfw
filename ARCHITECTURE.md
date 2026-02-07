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
│         知识存储 / 知识查询 / 代码提取 / 可视化                  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Storage 适配层                           │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐   │
│  │     Lite Adapter        │  │      Server Adapter         │   │
│  │  SQLite + USearch       │  │  分布式存储                 │   │
│  │  (Local 模式)           │  │  (Server/Remote 模式)       │   │
│  └─────────────────────────┘  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 知识模型

### 实体类型

实体分为三个层面：

- **业务层**：产品定义、业务流程、权威数据源
- **架构层**：系统边界、服务容器、模块组件、架构决策
- **契约层**：API 契约（OpenAPI/AsyncAPI/Proto）

> 具体类型定义参见 `packages/core/src/types/`

### 实体字段与版本管理

- **物理主键**：`uuid`（UUID v4）
- **包边界**：`root_id`（由 CLI/Adapter 注入）
- **版本集合**：`versions: string[]`（受控字段，通过版本管理工具修改）
- **关联字段**：`requirement_id`（Feat UUID）、`component_id`（父 Component）

新增实体类型 `feat` / `checklist` / `spec`，其中 `feat`/`checklist` 仅用于流程与任务管理，不进入图谱与向量索引。

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

Feat 是知识的隔离单元，类似 Git 分支，支持并行开发和知识演进。

### 核心概念

- **主分支**：已发布的权威知识
- **Feat 分支**：开发中的知识变更，与主分支隔离
- **合并**：Feat 审核通过后合并到主分支

### Feat 生命周期

```
create → draft → approved → published (合并到 main)
                    │
                    └── deprecated/archived
```

> 具体实现参见 `packages/storage/src/`

## 存储架构

### Local 模式 (Lite Adapter)

单文件 SQLite + 本地向量索引，适合个人开发。

### Server 模式 (Server Adapter)

分布式存储（TypeScript 直连三库），适合团队协作：
- 文档存储：实体数据
- 图数据库：关系图谱
- 向量数据库：语义搜索

> 具体配置参见 `docker/docker-compose.server.yml`

## MCP 工具集

MCP Server 通过 Model Context Protocol 向 AI Agent 暴露工具：

- **知识存储**：实体 CRUD、文件同步、一致性检查
- **知识查询**：语义搜索、依赖查询、影响分析
- **代码提取**：接口提取、代码分析、契约生成
- **可视化**：C4 架构图渲染

> 具体工具列表参见各 MCP 包的 `src/tools/`

## 数据流

### 知识写入

```
Agent 调用 → Schema 校验 → ADR 合规检查(可选) → 写入主存储 → 同步关系图谱 → 更新向量索引
```

### 知识查询

```
Agent 调用 → 文本向量化 → 向量相似度搜索 → 获取实体详情 → 返回结果
```

## 文件系统同步

### .context/ 目录结构

```
.context/
├── .c4a.yaml                 # 项目配置
├── assets/                   # 主分支资源
├── business/                 # 业务视角
│   ├── products/
│   ├── processes/
│   └── sors/
├── technical/                # 技术视角
│   ├── adrs/
│   ├── systems/
│   ├── containers/
│   ├── components/
│   ├── contracts/
│   ├── processes/
│   └── sors/
└── feat/                      # 需求迭代
    └── feat-xxx/
        ├── feat.yaml
        ├── assets/
        ├── business/
        └── technical/
```

### 同步方向

- **import**：文件 → 数据库
- **export**：数据库 → 文件

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun (Node.js 兼容) |
| 语言 | TypeScript |
| MCP 框架 | @modelcontextprotocol/sdk |
| Schema | Zod |
| 本地存储 | bun:sqlite, USearch (WASM) |

> Server 模式的存储配置参见 `docker/docker-compose.server.yml`
