# C4A v0.3.0 工程架构

> **注意**：本文档描述的是 v0.3.0 的实现架构。
>
> **设计文档**请查看 [v0.3.0/architecture.md](v0.3.0/architecture.md)
>
---

## 概述

C4A 是 AI 原生的架构知识管理平台，以 AI Agent 为一等公民。

**核心概念**：
- **知识抽象模型**：8 种实体类型（System, Container, Component, ADR, Contract, Product, Process, SoR）
- **Feat 分支**：类似 Git 分支的知识隔离机制，支持并行开发
- **三种模式**：Local（SQLite + USearch）、Server（MongoDB + Neo4j + Milvus）、Remote（云端托管）

**技术架构**：
- **Agent**：通过 MCP 协议调用工具，使用 prompts/ 中定义的角色
- **MCP 服务**：mcp-store/mcp-extract/mcp-query 提供工具能力，mcp-visual 提供可视化服务
- **存储层**：StorageAdapter 统一接口，屏蔽 Local/Server 差异
- **CLI**：Ink (React for CLI) 交互式菜单（用户 CLI + 开发者 CLI）

## 包结构

```
packages/
├── core/            # 共享核心库
├── storage/         # 存储适配层
├── cli/             # 用户 CLI
├── cli-dev/         # 开发者 CLI
├── storage-backend/ # Python 后端服务
├── mcp-store/       # 知识存储 MCP
├── mcp-query/       # 知识查询 MCP
├── mcp-extract/     # 知识采集 MCP
└── mcp-visual/      # 可视化 MCP
```

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent (OpenCode)                     │
│                     prompts/c4a.md 等                        │
└─────────────────────────────────────────────────────────────┘
                              │ MCP Protocol
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │  mcp-store  │     │ mcp-extract │     │  mcp-query  │
   │  (TS/Bun)   │     │  (TS/Bun)   │     │  (TS/Bun)   │
   └─────────────┘     └─────────────┘     └─────────────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                              ▼                   ▼                   ▼
                       ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                       │   MongoDB   │     │    Neo4j    │     │   Milvus    │
                       └─────────────┘     └─────────────┘     └─────────────┘
```

## MCP 服务架构

### mcp-store (TypeScript)

知识存储服务。

| 工具 | 功能 |
|------|------|
| `c4a_store_save` | 保存/更新 C4A 文档 |
| `c4a_store_read` | 读取 C4A 文档 |
| `c4a_store_list` | 列表查询与统计 |
| `c4a_store_delete` | 删除 C4A 文档 |
| `c4a_store_sync` | 同步本地 DSL 与存储 |
| `c4a_store_plan_sync` | 生成同步计划 |

### mcp-extract (TypeScript)

代码分析与提取服务，基于 Tree-sitter。

| 工具 | 功能 |
|------|------|
| `c4a_extract_interfaces` | 从代码提取接口、类型、类定义 |
| `c4a_extract_analyze` | 分析代码结构和依赖关系 |
| `c4a_extract_ast` | 获取代码的 AST 结构 |
| `c4a_extract_contract` | 从代码生成 API 契约 (OpenAPI/AsyncAPI/Proto) |

### mcp-query (TypeScript)

知识查询服务。

| 工具 | 功能 |
|------|------|
| `c4a_query_search` | 语义搜索 C4A 知识库 (Milvus) |
| `c4a_query_deps` | 查询实体的依赖关系 (Neo4j) |
| `c4a_query_impact` | 分析实体变更的影响范围 |

### MCP 工具命名

- 已移除 `legacy_*` 接口
- MCP 工具统一为 `c4a_store_*` / `c4a_query_*` / `c4a_extract_*`

### MCP 传输协议

所有 MCP 服务支持双模式传输：

**stdio 模式（开发调试）**

直接通过标准输入输出通信，适合本地调试。

**Streamable HTTP 模式（生产）**

通过 HTTP 提供 MCP 服务，支持多客户端并发。

端点：
- `GET /health` - 健康检查
- `POST /mcp` - MCP 协议入口
- `GET /mcp` - SSE 事件流
- `DELETE /mcp` - 关闭会话

## CLI 架构

基于 Ink (React for CLI) 的交互式菜单。

```
packages/cli/
├── src/
│   ├── index.tsx              # CLI 入口
│   ├── App.tsx                # 主应用组件
│   ├── menuData.ts            # 菜单数据结构
│   ├── commands/
│   │   └── index.ts           # 命令实现
│   ├── components/
│   │   ├── Header.tsx         # 标题栏
│   │   ├── CascadeMenu.tsx    # 级联菜单
│   │   ├── HelpPanel.tsx      # 帮助面板
│   │   ├── ConfirmDialog.tsx  # 确认对话框
│   │   └── index.ts           # 组件导出
│   └── utils/
│       ├── docker.ts          # Docker 操作
│       └── process.ts         # 进程管理
└── package.json
```

菜单交互采用水平级联展开设计：

```
┌─────────────────────┬─────────────────────┐
│ ▸ 开发              │ ▸ 启动开发环境      │
│   运维              │   调试 Store MCP    │
│   调试              │   调试 Extract MCP  │
│   工具              │   调试 Query MCP    │
└─────────────────────┴─────────────────────┘
```

- `↑↓` 上下选择
- `→` 展开子菜单
- `←` 收起返回
- `␣/↵` 确认执行
- `q` 退出

## 存储架构

**Local 模式**

```
┌─────────────────────────────────────────────────────────────┐
│                   StorageAdapter (Local)                    │
└─────────────────────────────────────────────────────────────┘
                      │                    │
                      ▼                    ▼
               ┌───────────┐        ┌───────────┐
               │  SQLite   │        │  USearch  │
               │  元数据   │        │  向量检索  │
               └───────────┘        └───────────┘
```

**Server 模式**

```
┌─────────────────────────────────────────────────────────────┐
│                   StorageAdapter (Server)                   │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │   MongoDB   │     │    Neo4j    │     │   Milvus    │
   │   主存储    │     │  Graph 索引  │     │ Vector 索引 │
   └─────────────┘     └─────────────┘     └─────────────┘
```

| 存储 | 用途 | 数据类型 |
|------|------|----------|
| MongoDB | 主存储 | 元数据、ADR、契约、Knowledge |
| Neo4j | 关系索引 | System/Container/Component 关系图 |
| Milvus | 语义索引 | Knowledge 向量嵌入 |
| SQLite | Local 元数据 | 本地模式文档存储 |
| USearch | Local 向量索引 | 本地语义检索 |

数据写入 MongoDB 后，由 mcp-store 负责同步到 Neo4j 和 Milvus。

**模式切换机制**

通过 `.c4a/config.yaml` 的 `mode` 字段切换 `local/server/remote`，CLI 与 MCP 根据配置选择对应的 StorageAdapter。

## Skills 架构

Skills 以目录形式存放在 `.codex/skills/` 下，每个 Skill 至少包含 `SKILL.md` 描述文件：

```
.codex/skills/
└── <skill>/
    ├── SKILL.md
    ├── references/    # 可选：设计/说明文档
    ├── scripts/       # 可选：自动化脚本
    └── assets/        # 可选：模板/资源
```

执行流程：Agent 触发 Skill → 读取 `SKILL.md` → 按步骤执行 → 按需读取 references/scripts/assets。

## 部署模式

### 开发模式 (dev)

- 存储服务：Docker 容器
- MCP 服务：本地进程（mcp-store/mcp-query 以 HTTP 模式运行）
- Web 终端：ttyd 提供局域网访问
- Agent：项目内置 OpenCode (opencode-ai)

局域网其他机器可通过 `http://<ip>:7681` 访问 OpenCode 终端界面。

### Docker 模式 (docker)

- 所有服务：Docker 容器
- MCP 服务：通过 HTTP 暴露

适用于集成测试和演示。

### 生产模式 (prod)

- 所有服务：Docker 容器（优化配置）
- 包含健康检查和资源限制

## 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 运行时 | Bun 1.3+ | TypeScript 执行 |
| Agent 框架 | OpenCode (opencode-ai) | 项目内置 AI Agent |
| Web 终端 | ttyd | 局域网共享 OpenCode |
| MCP SDK | @modelcontextprotocol/sdk | TypeScript MCP |
| CLI 框架 | Ink | React for CLI |
| DSL 解析 | YAML + Zod | 结构化配置 |
| 代码提取 | Tree-sitter | 多语言 AST 解析 |
| Local 存储 | SQLite + USearch | 本地文档与向量检索 |
| Server 主存储 | MongoDB 7.0 | 文档存储 |
| Server Graph 存储 | Neo4j 5.x | 架构关系 |
| Server Vector 存储 | Milvus 2.5 | 语义索引 |
