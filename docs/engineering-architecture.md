# C4A v2 工程架构

## 概述

C4A v2 采用 **MCP (Model Context Protocol) + Agent** 架构，完全围绕 AI Agent 设计：

- **Agent**：OpenCode 驱动，使用 prompts/ 中定义的角色
- **MCP 服务**：三个独立的 MCP Server，提供工具能力
- **存储层**：MongoDB（主存储）+ Neo4j（Graph 索引）+ Milvus（Vector 索引）
- **CLI**：Ink (React for CLI) 交互式菜单

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent (OpenCode)                     │
│                 prompts/c4a.md 等                      │
└─────────────────────────────────────────────────────────────┘
                              │ MCP Protocol
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │   mcp-dsl   │     │  mcp-code   │     │  mcp-data   │
   │  (TS/Bun)   │     │  (TS/Bun)   │     │  (Python)   │
   │  Port 8051  │     │  Port 8052  │     │  Port 8050  │
   └─────────────┘     └─────────────┘     └─────────────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                              ▼                   ▼                   ▼
                       ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                       │   MongoDB   │     │    Neo4j    │     │   Milvus    │
                       │  Port 27017 │     │  Port 7687  │     │  Port 19530 │
                       └─────────────┘     └─────────────┘     └─────────────┘
```

## 快速启动

```bash
./start.sh              # 交互式菜单
./start.sh dev          # 开发模式 (存储服务 + 本地 MCP)
./start.sh docker       # Docker 模式 (全容器化)
./start.sh prod         # 生产模式
```

### 开发模式

```bash
./start.sh dev
```

启动存储服务（Docker）和本地 mcp-data（Python），然后可选启动 OpenCode。

### Docker 模式

```bash
./start.sh docker
```

全部服务容器化运行，包括三个 MCP Server。

## 项目结构

```
c4a/
├── packages/                  # 所有模块
│   ├── cli/                   # 交互式 CLI (Ink)
│   ├── config-generator/      # 配置生成器 (TypeScript)
│   ├── core/                  # 共享核心库 (TypeScript)，包含 JSON Schema
│   ├── mcp-code/              # 代码分析提取 MCP (TypeScript)
│   ├── mcp-data/              # 数据服务 MCP (Python)
│   └── mcp-dsl/               # DSL 解析验证 MCP (TypeScript)
│
├── prompts/                   # Agent Prompts
│   ├── AGENTS.md              # Agent 角色汇总说明
│   ├── c4a.md                 # 主 Agent (全功能)
│   ├── c4a-dsl.md             # DSL 子 Agent
│   ├── c4a-plan.md            # 规划 Agent (只读)
│   ├── c4a-query.md           # 查询子 Agent
│   └── skills/                # 技能命令 Prompts
│
├── docker/                    # Docker 配置
│   ├── docker-compose.yml
│   ├── Dockerfile.data
│   └── Dockerfile.mcp-ts
│
├── docs/                      # 项目文档
│   ├── documentation_standards.md
│   └── engineering-architecture.md
│
├── rfc2/                      # v2 架构设计文档
│   ├── index.md
│   └── ...
│
├── c4a.config.yaml            # 统一配置文件
├── package.json               # Monorepo 根配置
├── bun.lock                   # Bun 依赖锁定
├── start.sh                   # CLI 入口
├── tsconfig.json              # TypeScript 配置
├── CLAUDE.md                  # 项目说明
└── README.md                  # 项目简介
```

## MCP 服务架构

### mcp-dsl (TypeScript)

DSL 解析与验证服务。

| 工具 | 功能 |
|------|------|
| `c4a_dsl_parse` | 解析 C4A DSL 文件 (YAML → Object) |
| `c4a_dsl_validate` | 验证 DSL 正确性 |
| `c4a_dsl_generate` | 生成 DSL 模板 |
| `c4a_dsl_schema` | 获取 JSON Schema |
| `c4a_local_init_repo` | 初始化 .c4a/ 目录结构 |
| `c4a_local_list_files` | 列出本地架构知识文件 |
| `c4a_local_read_file` | 读取本地 DSL 文件 |
| `c4a_local_write_file` | 写入本地 DSL 文件 |
| `c4a_local_transition_status` | 流转 DSL 状态 |

**传输模式**：
- stdio（开发调试）
- streamable-http（生产，端口 8051）

### mcp-code (TypeScript)

代码分析与提取服务，基于 Tree-sitter。

| 工具 | 功能 |
|------|------|
| `c4a_code_extract` | 从代码提取接口、类型、类定义 |
| `c4a_code_analyze` | 分析代码结构和依赖关系 |
| `c4a_code_ast` | 获取代码的 AST 结构 |
| `c4a_code_contract` | 从代码生成 API 契约 (OpenAPI/AsyncAPI/Proto) |

**传输模式**：
- stdio（开发调试）
- streamable-http（生产，端口 8052）

### mcp-data (Python)

统一数据服务，整合三种存储。

| 工具 | 功能 |
|------|------|
| `c4a_db_save_entity` | 保存/更新 C4A 文档，自动同步三库 |
| `c4a_db_get_entity` | 从 MongoDB 查询 C4A 文档 |
| `c4a_db_delete_entity` | 删除 C4A 文档，级联清理三库 |
| `c4a_db_search_semantic` | 语义搜索 C4A 知识库 (Milvus) |
| `c4a_db_query_deps` | 查询实体的依赖关系 (Neo4j) |
| `c4a_db_query_impact` | 分析实体变更的影响范围 |
| `c4a_db_exec_cypher` | 执行原生 Cypher 查询 |
| `c4a_db_sync_file` | 同步单个 DSL 文件到三库 |
| `c4a_db_sync_local` | 批量同步本地 .c4a/ 目录到三库 |

**传输模式**：
- stdio（开发调试）
- streamable-http（生产，端口 8050）

## CLI 架构

基于 Ink (React for CLI) 的交互式菜单。

### 组件结构

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

### 菜单交互

采用水平级联展开设计：

```
┌─────────────────────┬─────────────────────┐
│ ▸ 开发              │ ▸ 启动开发环境      │
│   运维              │   调试 DSL MCP      │
│   调试              │   调试 Code MCP     │
│   工具              │   调试 Data MCP     │
└─────────────────────┴─────────────────────┘
```

- `↑↓` 上下选择
- `→` 展开子菜单
- `←` 收起返回
- `␣/↵` 确认执行
- `q` 退出

## 存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                       mcp-data                               │
│                    (统一数据服务)                             │
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

数据写入 MongoDB 后，由 mcp-data 负责同步到 Neo4j 和 Milvus。

## 部署模式

### 开发模式 (dev)

```bash
./start.sh dev
```

- 存储服务：Docker 容器
- MCP 服务：本地进程（mcp-data 以 HTTP 模式运行）
- Web 终端：ttyd 提供局域网访问（端口 7681）
- Agent：项目内置 OpenCode (opencode-ai)

局域网其他机器可通过 `http://<ip>:7681` 访问 OpenCode 终端界面。

适用于日常开发和调试、团队协作。

### Docker 模式 (docker)

```bash
./start.sh docker
```

- 所有服务：Docker 容器
- MCP 服务：通过 HTTP 暴露

适用于集成测试和演示。

### 生产模式 (prod)

```bash
./start.sh prod
```

- 所有服务：Docker 容器（优化配置）
- 包含健康检查和资源限制

适用于生产部署。

## 端口分配

| 端口 | 服务 | 说明 |
|------|------|------|
| 27017 | MongoDB | 文档数据库 |
| 7474 | Neo4j HTTP | Web 管理界面 |
| 7687 | Neo4j Bolt | 连接协议 |
| 19530 | Milvus | Vector 数据库 |
| 7681 | ttyd | Web 终端 (仅 dev 模式) |
| 8050 | mcp-data | Python MCP (HTTP) |
| 8051 | mcp-dsl | TypeScript MCP (HTTP) |
| 8052 | mcp-code | TypeScript MCP (HTTP) |

## 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 运行时 | Bun 1.3+ | TypeScript 执行 |
| Python | 3.11+ | mcp-data 服务 |
| Agent 框架 | OpenCode (opencode-ai) | 项目内置 AI Agent |
| Web 终端 | ttyd | 局域网共享 OpenCode |
| MCP SDK | @modelcontextprotocol/sdk | TypeScript MCP |
| MCP SDK | mcp (Python) | Python MCP |
| CLI 框架 | Ink | React for CLI |
| DSL 解析 | YAML + Zod | 结构化配置 |
| 代码提取 | Tree-sitter | 多语言 AST 解析 |
| 主存储 | MongoDB 7.0 | 文档存储 |
| Graph 存储 | Neo4j 5.x | 架构关系 |
| Vector 存储 | Milvus 2.5 | 语义索引 |

## MCP 传输协议

TypeScript MCP 服务支持双模式传输：

### stdio 模式（开发调试）

```bash
./start.sh debug:dsl    # 调试 mcp-dsl
./start.sh debug:code   # 调试 mcp-code
./start.sh debug:data   # 调试 mcp-data
```

直接通过标准输入输出通信，适合本地调试。

### Streamable HTTP 模式（生产）

```typescript
// 环境变量控制
MCP_TRANSPORT=streamable-http
MCP_PORT=8051
```

通过 HTTP 提供 MCP 服务，支持多客户端并发。

**端点**：
- `GET /health` - 健康检查
- `POST /mcp` - MCP 协议入口
- `GET /mcp` - SSE 事件流
- `DELETE /mcp` - 关闭会话

## 环境变量

通过 `.env` 文件统一管理：

```bash
cp .env.example .env
```

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `MCP_TRANSPORT` | MCP 传输模式 | stdio |
| `MCP_PORT` | MCP HTTP 端口 | 8050/8051/8052 |
| `MONGODB_URI` | MongoDB 连接串 | mongodb://localhost:27017 |
| `NEO4J_URI` | Neo4j 连接地址 | bolt://localhost:7687 |
| `NEO4J_USER` | Neo4j 用户名 | neo4j |
| `NEO4J_PASSWORD` | Neo4j 密码 | - |
| `MILVUS_HOST` | Milvus 主机 | localhost |
| `MILVUS_PORT` | Milvus 端口 | 19530 |
