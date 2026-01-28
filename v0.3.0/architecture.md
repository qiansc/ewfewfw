# C4A 轻量化架构设计

> 基于知识生命周期的架构设计，支持 Local、Server、Remote 三模式

> **相关文档**：
> - 核心概念：[concepts.md](./concepts.md)
> - MCP 工具单一真源：[mcp-tools.md](./detailed-design/mcp-tools.md)
> - CLI 架构设计：[detailed-design/cli-design.md](./detailed-design/cli-design.md)
> - Skills/Commands 设计：[detailed-design/skills-design.md](./detailed-design/skills-design.md)
> - 数据操作详细设计：[detailed-design/data-operations.md](./detailed-design/data-operations.md)
> - Local 模式实现：[detailed-design/local-mode.md](./detailed-design/local-mode.md)
> - 权限与错误处理：[detailed-design/permissions-and-errors.md](./detailed-design/permissions-and-errors.md)

---

## 1. 三模式架构

### 1.1 模式对比

| 特性 | Local 模式 | Server 模式 | Remote 模式 |
|------|----------|-------------|-------------|
| 运行时 | Bun (TypeScript)¹ | Python | - |
| 存储 | SQLite | MongoDB + Neo4j + Milvus | 远程服务 |
| 访问方式 | MCP stdio（由 IDE 管理生命周期） | HTTP Server | HTTP API |
| 安装 | `npm install -g @c4a/cli` | `docker-compose up` | 无需安装存储 |
| 适用场景 | 个人开发、离线、小项目 | 团队协作、大规模数据 | 使用团队共享服务 |
| 资源占用 | ~200MB | ~2GB | ~50MB (CLI only) |
| 启动时间 | <1s | 30-60s | <1s |

> ¹ Local 模式默认使用 Bun 运行时。若 Bun 与原生扩展（better-sqlite3、sqlite-vec）存在兼容性问题，可回退到 Node.js 运行时。详见 [mode-switch.md §7.1](./detailed-design/local-mode/mode-switch.md#71-依赖库)。

**Remote 模式说明**：
- 不安装本地存储，使用项目配置的远程 MCP 服务
- 通过 HTTP API 调用远程服务的 MCP 工具
- 适合使用团队共享的 C4A 服务实例
- 需要在项目配置中指定 `remote.url` 和认证信息

**Code MCP 必须本地运行**：

`c4a_code_*` 工具（代码分析、AST 解析、契约提取）需要访问本地文件系统，因此在任何模式下都必须以 stdio 方式本地运行。Remote 模式仅影响 Data MCP（`c4a_store_*`、`c4a_query_*`）的连接方式。

```
┌─────────────────────────────────────────────────────────────┐
│                    Remote 模式 MCP 连接                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┐      stdio      ┌──────────────┐             │
│   │  Agent  │◄───────────────►│  Code MCP    │             │
│   │         │                 │  (本地运行)   │             │
│   │         │                 └──────┬───────┘             │
│   │         │                        │                     │
│   │         │                        ▼                     │
│   │         │                 ┌──────────────┐             │
│   │         │                 │ 本地文件系统  │             │
│   │         │                 │  ./src/*     │             │
│   │         │                 └──────────────┘             │
│   │         │                                              │
│   │         │      HTTP       ┌──────────────┐             │
│   │         │◄───────────────►│  Data MCP    │             │
│   └─────────┘                 │  (远程服务器) │             │
│                               └──────┬───────┘             │
│                                      │                     │
│                               ┌──────▼───────┐             │
│                               │ MongoDB/Neo4j│             │
│                               │ Milvus       │             │
│                               └──────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

| MCP 服务 | 工具前缀 | 连接方式 | 说明 |
|---------|---------|---------|------|
| Code MCP | `c4a_code_*` | stdio（始终本地） | 需要访问本地源代码 |
| Data MCP | `c4a_store_*`、`c4a_query_*` | 按模式切换 | Local: stdio，Server/Remote: HTTP |

### 1.2 核心洞察：存储层可插拔

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           同一套 MCP 工具                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Local 模式            │    Server 模式            │    Remote 模式     │
│   ────────────          │    ────────────           │    ────────────    │
│   • 零依赖安装           │    • 完整三库              │    • 无本地存储     │
│   • SQLite 单文件        │    • MongoDB+Neo4j+Milvus │    • 连接远程服务   │
│   • 单用户              │    • 多用户/团队协作        │    • 团队共享实例   │
│   • 离线可用            │    • 实时同步              │    • HTTP API      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键设计**：Agent 使用相同的 MCP 工具接口，底层存储可切换，Agent 无感知。

### 1.3 知识生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                        知识生命周期                              │
│                                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │  发现    │ ─► │  建模    │ ─► │  存储    │ ─► │  消费    │ │
│   │ Extract  │    │  Model   │    │  Store   │    │  Query   │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

| 阶段 | 职责 | 能力 | MCP 工具 |
|------|------|------|---------|
| **Extract** | 从代码/文档提取知识碎片 | 代码分析、AST 解析、契约提取 | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) 的 `c4a_code_*` |
| **Model** | 将碎片/对话结果建模为结构化 DSL（实体 + 关系） | DSL 生成、关系推断、规范化 | 由 Skills 完成（调用 `c4a_store_*` 工具） |
| **Store** | 持久化 + 索引 + 版本管理 | 保存/读取/同步/feat 管理/模板生成/Schema | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) 的 `c4a_store_*` |
| **Query** | 查询/推理/可视化 | 语义搜索、依赖分析、影响分析 | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) 的 `c4a_query_*` |

### 1.4 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户层                                   │
│                                                                 │
│   自然语言交互 ──► Skills (7个)                                  │
│                    ├─ 工作流 Skills (5个)                        │
│                    │  ├─ /c4a:feat                              │
│                    │  ├─ /c4a:specify                           │
│                    │  ├─ /c4a:plan                              │
│                    │  ├─ /c4a:analyze                           │
│                    │  └─ /c4a:implement                         │
│                    └─ 知识技能 Skills (2个)                      │
│                       ├─ /c4a:know:learn                        │
│                       └─ /c4a:know:search                       │
│                                                                 │
│   CLI 命令 ──► Commands (主要)                                   │
│                ├─ c4a init                                      │
│                ├─ c4a install                                   │
│                ├─ c4a sync                                      │
│                ├─ c4a status                                    │
│                ├─ c4a feat (render/...)                         │
│                └─ c4a help                                      │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ MCP Protocol (统一接口)
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Tools (按知识生命周期)                   │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐   │
│  │   extract   │  │    store    │  │    query    │  │  visual   │   │
│  │   知识采集   │  │   知识存储   │  │   知识消费   │  │  可视化    │   │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤  ├───────────┤   │
│  │ 代码分析     │  │ save (保存)  │  │search (搜索)│  │ 图片生成   │   │
│  │ AST 解析    │  │ read (读取)  │  │ deps (依赖) │  │ C4 架构图  │   │
│  │ 契约提取     │  │ list (列表)  │  │impact (影响)│  │           │   │
│  │ 依赖发现     │  │ sync (同步)  │  │             │  │           │   │
│  │             │  │ plan_sync    │  │             │  │           │   │
│  │             │  │ feat_*       │  │             │  │           │   │
│  │             │  │ validate     │  │             │  │           │   │
│  └─────────────┘  └──────┬──────┘  └──────┬──────┘  └───────────┘   │
│                       │              │                         │
└───────────────────────┼──────────────┼─────────────────────────┘
                        │              │
          ┌─────────────▼──────────────▼─────┐
          │      Storage Adapter Layer       │
          │         (存储适配层)               │
          ├──────────────┬───────────────────┤
          │              │                   │
     ┌────▼────┐    ┌────▼────┐              │
     │  Lite   │    │ Server  │              │
     │ Adapter │    │ Adapter │              │
     │  (TS)   │    │ (Python)│              │
     └────┬────┘    └────┬────┘              │
          │              │                   │
   ┌──────▼──┐    ┌──────▼──────┐            │
   │ SQLite  │    │  MongoDB    │            │
   │ 单文件   │    │  Neo4j      │            │
   │{缓存目录}│    │  Milvus     │            │
   └─────────┘    └─────────────┘            │
```

> **说明**：用户通过 Skills（自然语言/命令）和 CLI 命令两种方式与系统交互。详见 [detailed-design/skills-design.md](./detailed-design/skills-design.md)。

### 1.5 Skills/Commands 与 MCP 工具的关系

**架构分层**：
```
用户 ──► Skills (自然语言/命令) ──► MCP Tools ──► 存储层
     └─► CLI 命令 ──────────────► MCP Tools ──► 存储层
                              └─► CLI 内部实现（不暴露为 MCP）
```

**MCP 工具设计原则**：

MCP 工具的核心目的是**让 Agent 能够自主完成知识管理任务**，而不是暴露所有系统能力。

| 原则 | 说明 | 示例 |
|------|------|------|
| **Agent 视角优先** | 从 Agent 工作流出发设计，而非从系统能力出发 | Skills 需要 `c4a_store_save`，不需要 `backup` |
| **区分调用者** | 明确工具是给 Agent 还是给用户/运维 | Agent 用 `save`，运维用 CLI `backup` |
| **避免功能膨胀** | 相关功能合并参数，辅助功能内部实现 | `generate` 返回路径，不需要单独的 `get_reference` |
| **用户决策点由 CLI 处理** | 需要用户确认的操作通过 CLI 命令 | `sync`、`restore` 需用户决定 |

**工具分层**：

| 分层 | 定位 | 暴露方式 | 示例 |
|------|------|---------|------|
| **核心工具** | Agent 自主完成任务所需 | MCP 工具 | `save`, `read`, `query_search` |
| **辅助工具** | Agent 特定场景按需使用 | MCP 工具 | `validate`, `read_history` |
| **运维工具** | 用户决策点、系统管理 | CLI 命令 | `backup`, `restore`, `sync` |
| **内部实现** | 可合并到其他工具的功能 | 不暴露 | 模板、Schema 查询 |

> 详细的工具可见性分层见 [mcp/overview.md](./detailed-design/mcp/overview.md#12-工具可见性分层)

**职责划分**：

| 层级 | 职责 | 示例 |
|------|------|------|
| **工作流 Skills** | 完整流程编排、DSL 生成逻辑、用户交互 | `/c4a:feat` 管理 Feature 全生命周期 |
| **知识技能 Skills** | 知识管理专用能力、快捷入口 | `/c4a:know:learn` 快速录入知识 |
| **CLI 命令** | 用户决策点、运维操作、系统管理 | `c4a sync` 同步、`c4a backup` 备份 |
| **MCP Tools** | Agent 自主任务所需的原子操作 | 见 [mcp-tools.md](./detailed-design/mcp-tools.md)（避免各文档重复列举造成漂移） |

**DSL 生成逻辑位置**：
- **复杂 DSL 生成**：在 Skills 的提示词中定义（如 Product/System/SoR 的生成规则）
- **简单模板生成**：通过 CLI `c4a template <type>` 命令获取基础模板
- **共享建模规则**：`/c4a:model` 内部 Skill，供 `/c4a:specify`、`/c4a:plan`、`/c4a:know:learn` 调用
- **DSL 解析和验证**：作为 `c4a_store_save` 的内部实现，不暴露为独立工具

**跨平台支持**：
- Skills 提示词是平台无关的模板
- 转换器负责将模板转换为各平台格式（Claude Code、Cursor、OpenCode 等）
- 具体目录结构由转换器决定，不在架构设计中固定

---

## 2. 存储设计

### 2.1 存储位置

| 内容 | 位置 | Git | 说明 |
|------|------|-----|------|
| 数据库 | `~/.c4a/store.db` | ❌ 不跟踪 | 权威数据源 |
| 工作目录 | `.context/` (项目内) | 用户自行决定 | 导出产物，用于版本控制和人类阅读 |

**系统缓存目录**：
- macOS: `~/.c4a/`
- Linux: `~/.c4a/`
- Windows: `%LOCALAPPDATA%\.c4a\cache\`

**数据库特性**：
- 全局单文件存储，所有项目共用
- 通过 `project_id` 字段区分不同项目
- 通过 `repo_id` 字段区分不同仓库

### 2.2 工作目录结构

采用双视角平铺结构，所有实体按类型分目录存放：

```
用户仓库/
├── .context/                        # 工作目录（CLI/MCP 自动识别）
│   ├── .c4a.yaml                   # 配置文件
│   ├── assets/                     # 主分支资源（MRD/PRD/设计稿等）
│   │   ├── mrd-v1.pdf
│   │   └── architecture-diagram.png
│   ├── business/                   # 业务视角
│   │   ├── products/               # Product 定义
│   │   │   └── e-commerce.c4a.yaml
│   │   ├── processes/              # Business Process
│   │   │   └── order-fulfillment.c4a.yaml
│   │   └── sors/                   # Business SoR
│   │       └── sor-b-a001.c4a.yaml
│   ├── technical/                  # 技术视角
│   │   ├── adrs/                   # ADR（平铺存放）
│   │   │   ├── adr-a001-init-architecture.c4a.yaml
│   │   │   └── adr-a002-choose-database.c4a.yaml
│   │   ├── systems/                # System 定义（平铺存放）
│   │   │   └── e-commerce.c4a.yaml
│   │   ├── containers/             # Container 定义（平铺存放）
│   │   │   ├── order-service.c4a.yaml
│   │   │   └── payment-service.c4a.yaml
│   │   ├── components/             # Component 定义（平铺存放）
│   │   │   └── order-processor.c4a.yaml
│   │   ├── contracts/              # Contract 规格文件（可选）
│   │   │   └── order-service.openapi.yaml
│   │   ├── processes/              # Technical Process
│   │   │   └── deployment-flow.c4a.yaml
│   │   └── sors/                   # Technical SoR
│   │       └── sor-t-a001.c4a.yaml
│   └── feat/                       # 需求迭代（feat）
│       └── feat-a001-user-login/
│           ├── feat.yaml           # feat 元信息
│           ├── assets/             # feat 相关资源
│           │   └── design.png
│           ├── business/           # 变更的业务实体
│           │   └── sors/
│           │       └── sor-b-a002.c4a.yaml
│           └── technical/          # 变更的技术实体
│               ├── adrs/
│               │   └── adr-a003-jwt-auth.c4a.yaml
│               ├── containers/
│               │   └── auth-service.c4a.yaml
│               └── components/
│                   └── jwt-validator.c4a.yaml
├── packages/
│   └── sub-module/
│       └── .context/               # 子工作目录（独立 project_id）
│           ├── .c4a.yaml
│           └── ...
└── src/
```

**说明**：
- 所有实体按类型平铺存放，不使用层级嵌套
- `assets/` 目录存放原始文档（MRD/PRD/设计稿等），主分支和 feat 都可以有
- `technical/contracts/` 目录存放外部引用的 Contract 规格文件（可选）
- ADR 平铺在 `technical/adrs/` 目录，文件名 `adr-{id}-{slug}.c4a.yaml`
- feat 内的实体与主分支结构相同（即 `feat/{feat-id}/technical/adrs/` 存放 feat 内的 ADR）
- feat 发布后，实体合并到主分支对应目录，feat 目录完整保留作为历史记录

**原始文档引用方式**：

| 方式 | 说明 | 示例 |
|------|------|------|
| **assets/ 目录** | 存放在本地 | `./assets/mrd-v1.pdf` |
| **外部 URI** | 引用外部系统 | `https://docs.company.com/mrd/v1` |

在实体的 `data` 字段中引用：
```yaml
# Product 引用 MRD
data:
  name: 电商平台
  doc_uri: ./assets/mrd-v1.pdf  # 本地文件
  # 或
  doc_uri: https://docs.company.com/mrd/v1  # 外部链接
```

### 2.3 项目配置 (.context/.c4a.yaml)

```yaml
repo_id: company/my-repo        # 仓库标识
project_id: my-project          # 项目标识
mode: local                     # local | server | remote
skills: {cursor: true, claude: false, opencode: false}  # Skills 配置
adr_policy: {enforce: true, scope: [system, container], on_missing: warning}
server: {url: http://localhost:8050}    # Server 模式配置
remote: {url: https://c4a.example.com}  # Remote 模式配置
```

**配置字段说明**：
- `skills`: 启用的 AI 工具（cursor/claude/opencode）
- `adr_policy`: ADR 策略（enforce/scope/on_missing: error|warning|ignore）
- `server`/`remote`: 对应模式的服务地址配置

> 详细配置说明见 [cli-design.md 2.5 节](./detailed-design/cli-design.md#25-项目配置)


### 2.4 ID 命名规范

#### 2.4.0 唯一性约束

实体 ID 在 `(source_project, id, proposal_id)` 三元组内唯一。

- `source_project`：实体归属项目（Domain/Enterprise 层全局实体为 `null`，数据库存储为 `''`）
- `id`：实体 ID
- `proposal_id`：Feat 版本（主分支为 `null`，数据库存储为 `''`）

> **注意**：`source_repo` 是元数据字段，不参与唯一性约束。同一 `source_project` 下的实体可能来自不同 repo。
>
> **存储约定**：应用层使用 `null` 表示全局实体/主分支，数据库层使用空字符串 `''` 存储（SQLite 主键不支持 NULL）。详见 [sqlite-schema.md §2.1](./detailed-design/local-mode/sqlite-schema.md#21-核心表) 的空字符串哨兵值约定。

**特殊情况：全局实体**

| 实体层级 | source_project (应用层) | source_project (DB层) | 示例 |
|---------|------------------------|----------------------|------|
| Project 层 | `"project-a"` | `"project-a"` | `(project-a, auth-service, '')` |
| Domain/Enterprise 层 | `null` | `''` | `('', order-state-machine, '')` |

**潜在歧义场景**：

同一环境下可能同时存在：
- `(project-a, auth-utils, '')` — 项目 A 的实体
- `('', auth-utils, '')` — 全局实体（DB 层用 `''` 表示 `null`）

当使用简单 ID `auth-utils` 引用时，系统按优先级查找（本项目 → 全局实体 → 其他项目）。如发现多个匹配，**返回歧义警告，要求用户使用明确引用格式**：

```
project:project-a/auth-utils    # 明确引用项目实体
global:auth-utils               # 明确引用全局实体
```

> 详细的引用解析规则和歧义处理见 [data-operations.md 1.5-1.8 节](./detailed-design/data-operations.md#15-引用解析优先级)

#### 2.4.1 命名方式分类

| 类型 | 命名方式 | 格式 | 示例 |
|------|---------|------|------|
| Product | 语义化 | `{kebab-case-name}` | `e-commerce-platform` |
| System | 语义化 | `{kebab-case-name}` | `order-system` |
| Container | 语义化 | `{kebab-case-name}` | `order-service` |
| Component | 语义化 | `{kebab-case-name}` | `order-processor` |
| Contract | 语义化 | `{kebab-case-name}` | `api-order-service` |
| feat | 序号 + 语义 | `feat-{id}-{slug}` | `feat-a001-user-login` |
| ADR | 序号 + 语义 | `adr-{id}-{slug}` | `adr-a001-introduce-mq` |
| Business Process | 序号 | `prc-b-{id}` | `prc-b-a001` |
| Technical Process | 序号 | `prc-t-{id}` | `prc-t-a001` |
| Business SoR | 序号 | `sor-b-{id}` | `sor-b-a001` |
| Technical SoR | 序号 | `sor-t-{id}` | `sor-t-a001` |

#### 2.4.2 序号格式

序号格式为 `[a-z][0-9]{3}`，即一个小写字母 + 三位数字：

```
a001 → a002 → ... → a999 → b001 → b002 → ... → z999
```

- 字母从 `a` 开始顺排
- 数字从 `001` 开始，满 `999` 后字母进位
- 理论上限：26 × 999 = 25,974 个 ID

#### 2.4.3 序号递增规则

每个前缀在 `(source_repo, source_project)` 范围内独立递增：

| 前缀 | 独立计数 | 示例序列 |
|------|---------|---------|
| `feat-` | ✅ | `feat-a001`, `feat-a002`, ... |
| `adr-` | ✅ | `adr-a001`, `adr-a002`, ... |
| `prc-b-` | ✅ | `prc-b-a001`, `prc-b-a002`, ... |
| `prc-t-` | ✅ | `prc-t-a001`, `prc-t-a002`, ... |
| `sor-b-` | ✅ | `sor-b-a001`, `sor-b-a002`, ... |
| `sor-t-` | ✅ | `sor-t-a001`, `sor-t-a002`, ... |

**注意**：`prc-b-` 和 `prc-t-` 是独立序列，`sor-b-` 和 `sor-t-` 也是独立序列。

#### 2.4.4 设计理由

| 决策 | 理由 |
|------|------|
| Entity 使用语义化命名 | 便于人类阅读和记忆，跨项目引用时更直观 |
| Process/SoR 使用序号 | 数量多、生命周期短，语义化命名维护成本高 |
| feat/ADR 带 slug | 提高可读性，便于在目录结构中识别 |
| 区分 b/t 前缀 | 明确区分业务视角和技术视角，避免混淆 |
| 独立序列计数 | 简化实现，避免跨类型协调 |

### 2.5 文件命名规则

**业务视角**：
- Product: `business/products/{product-id}.c4a.yaml`
- Business Process: `business/processes/{process-id}.c4a.yaml`
- Business SoR: `business/sors/{sor-id}.c4a.yaml`

**技术视角**（平铺存放）：
- ADR: `technical/adrs/{adr-id}.c4a.yaml`（如 `adr-a001-introduce-mq.c4a.yaml`）
- System: `technical/systems/{system-id}.c4a.yaml`
- Container: `technical/containers/{container-id}.c4a.yaml`
- Component: `technical/components/{component-id}.c4a.yaml`
- Technical Process: `technical/processes/{process-id}.c4a.yaml`
- Technical SoR: `technical/sors/{sor-id}.c4a.yaml`

**feat（需求迭代）**：
- feat 元信息: `feat/{feat-id}/feat.yaml`（如 `feat/feat-a001-user-login/feat.yaml`）
- feat 内实体: `feat/{feat-id}/business|technical/...`（与主分支结构相同）
- feat 资源: `feat/{feat-id}/assets/`（设计稿、调研文档等）

**说明**：
- 所有 DSL 实体文件使用 `.c4a.yaml` 扩展名（便于区分和工具识别）
- `feat.yaml` 是特殊的元信息文件，保持 `.yaml` 扩展名
- 所有实体按类型平铺存放，不使用层级嵌套
- `assets/` 目录存放原始文档（MRD/PRD/设计稿等），主分支和 feat 都可以有
- `technical/contracts/` 目录存放外部引用的 Contract 规格文件（可选）
- ADR 平铺在 `technical/adrs/` 目录，文件名 `adr-{id}-{slug}.c4a.yaml`
- feat 内的实体与主分支结构相同（即 `feat/{feat-id}/technical/adrs/` 存放 feat 内的 ADR）
- feat 发布后，实体 DSL 文件合并到主分支，feat 目录完整保留作为历史记录（详见 [7.3 节](#73-feat-生命周期)）

**数据存储策略**：
- **DSL 实体**：数据库 + 文件系统双写（数据库用于查询，文件系统用于版本控制）
- **checklist**：数据库是唯一数据源，本地 `.context/feat/{feat-id}/checklist.md` 是只读视图
- **assets**：仅文件系统（原始文档、生成的图片）
- **contracts**：仅文件系统（大型契约文件）
- 数据库是结构化数据的权威源，文件系统是完整的工作目录

**checklist 处理说明**：

> **关键设计**：Checklist **不参与同步**，数据库是唯一数据源。

**存储位置**：
- **数据源**：MongoDB `feats` 集合的 `checklist` 字段（唯一权威源）
- **本地文件**：`.context/feat/{feat-id}/checklist.md`（渲染的只读视图）

**工作机制**：
- Agent 通过 `c4a_store_feat_checklist` 直接操作数据库
- CLI 的 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 Markdown 文件
- 本地文件仅供人类查看，不作为数据源

**生命周期**：
- **draft/approved 状态**：数据库 `checklist` 字段存在，支持多人协作
- **published/archived 状态**：自动清理数据库字段，本地渲染文件保留作为历史记录

**设计理由**：
- 避免双重标准：checklist 不是普通 DSL 文件，不需要双向同步
- 支持多人协作：Agent 直接操作数据库，无冲突风险
- 简化同步逻辑：`c4a sync` 只处理 DSL 实体文件

详细说明参见：[store-feat-checklist.md](detailed-design/mcp/store-feat-checklist.md)

### 2.6 ADR 的定位

ADR（Architecture Decision Record）在 C4A 中是普通实体，状态流转随 feat 进行：

| 特性 | 说明 |
|------|------|
| 类型 | `type: adr` 的普通实体 |
| 存储 | 平铺在 `technical/adrs/` 目录 |
| 状态 | 随 feat 流转（draft → approved → published），支持 `superseded` 表示被新决策取代 |
| 命名 | `adr-{id}-{slug}.c4a.yaml`（如 `adr-a001-introduce-mq.c4a.yaml`） |

**ADR 与 feat 的关系**：

| 场景 | ADR 位置 | proposal_id |
|------|---------|-------------|
| 主分支的 ADR | `technical/adrs/adr-a001-introduce-mq.c4a.yaml` | null |
| feat 内的 ADR | `feat/feat-a002-order-flow/technical/adrs/adr-a002-split-db.c4a.yaml` | "feat-a002-order-flow" |
| feat 发布后 | `technical/adrs/adr-a002-split-db.c4a.yaml` | null（已清空） |

**ADR 示例**：

```yaml
# technical/adrs/adr-a005-introduce-mq.c4a.yaml
schema: c4a/v1
type: adr
adr:
  id: adr-a005-introduce-mq
  title: 引入 RabbitMQ 解耦订单和库存
  status: published
  context: |
    订单系统和库存系统耦合严重，导致...
  decision: |
    选择 RabbitMQ 作为消息队列...
  consequences: |
    - 优点: 解耦、异步处理
    - 缺点: 增加运维复杂度
  alternatives:
    - name: Kafka
      reason: 过于重量级
    - name: Redis Pub/Sub
      reason: 不支持持久化
  related_entities:
    - order-service
    - inventory-service
    - mq-service
```

### 2.7 Schema 校验

每个 YAML 文件通过首行注释声明 schema，实现 IDE 实时校验。

**文件内 schema 声明**：

```yaml
# yaml-language-server: $schema=https://context4ai.org/schemas/c4a-system.schema.json
schema: c4a/v1
type: software-system
system:
  id: e-commerce
  name: 电商系统
  ...
```

**各类型 schema URL**：

| 类型 | Schema URL |
|------|------------|
| Product | `https://context4ai.org/schemas/c4a-product.schema.json` |
| Process | `https://context4ai.org/schemas/c4a-process.schema.json` |
| SoR | `https://context4ai.org/schemas/c4a-sor.schema.json` |
| System | `https://context4ai.org/schemas/c4a-system.schema.json` |
| Container | `https://context4ai.org/schemas/c4a-container.schema.json` |
| Component | `https://context4ai.org/schemas/c4a-component.schema.json` |
| ADR | `https://context4ai.org/schemas/c4a-adr.schema.json` |

> **注意**：
> - DSL 文件中 System 使用 `type: software-system`（符合 C4 模型命名），内部存储映射为 `system`
> - Schema URL 将在 v0.3.0 正式发布后上线。在此之前，IDE 校验依赖本地 JSON Schema 文件（位于 `packages/core/schemas/`）

**离线支持策略**：

为支持内网环境和离线使用，Schema 文件采用多层回退机制：

| 优先级 | Schema 来源 | 适用场景 | 实现层 |
|--------|------------|---------|--------|
| 1 | 远程 URL (`https://context4ai.org/schemas/`) | 在线环境，自动更新（规划中，当前不可用） | IDE |
| 2 | 项目本地 (`.context/.schemas/`) | 离线环境，`c4a init` 时自动复制 | CLI |
| 3 | CLI 安装目录 (`node_modules/@c4a/cli/schemas/`) | 备用方案，随 CLI 安装 | CLI |
| 4 | 核心包内置 (`packages/core/schemas/`) | 运行时验证 | Core |

> **职责分配**：
> - **IDE 层**：通过 `yaml-language-server` 注释自动识别 Schema，支持远程 URL
> - **CLI 层**：负责 `.context/.schemas/` 的初始化和更新，提供离线回退
> - **Core 层**：运行时验证使用包内置 Schema，不依赖外部文件

**IDE 配置**：
- VSCode 通过 `yaml-language-server` 注释自动识别 Schema
- 离线环境下，IDE 会自动回退到本地 Schema 文件
- 无需手动配置，`c4a init` 自动处理

**校验层级**：

| 层级 | 时机 | 实现 |
|------|------|------|
| IDE 实时校验 | 编辑时 | VSCode YAML 扩展 + 文件内 schema 声明（支持离线） |
| 运行时校验 | 保存/导入时 | `c4a_store_save` 内部自动执行 DSL 解析和验证 |
| CI 校验 | 提交时 | `c4a validate` 命令（使用本地 Schema） |

**版本策略**：

v0.3.0 是全新设计，`schema: c4a/v1` 是 v0.3.x 的唯一 Schema 版本：

| 策略 | 说明 |
|------|------|
| **不向后兼容** | 不支持旧版本 DSL，v0.2.x 数据需重新建模 |
| **Schema 版本固定** | v0.3.x 全系列使用 `c4a/v1`，不支持版本混用 |
| **无自动迁移** | 不提供旧版本到 v0.3.0 的自动迁移工具 |

> 详细版本策略见 [mcp-tools.md 1.3 节](./detailed-design/mcp-tools.md#13-版本策略)

### 2.8 子 .context 规则

- 子 .context 与父 .context 共享 `repo_id`
- 子 .context 有独立的 `project_id`
- 子 .context 完全覆盖父 .context（配置和内容）
- 实体唯一性：遵循 `(source_project, id, proposal_id)` 三元组唯一性约束
  - 父 .context（基建/全局）：`source_project = null`（应用层），数据库存储为 `''`
  - 子 .context（项目）：`source_project = project_id`
  - 允许同名实体（如 `auth-utils`）同时存在于父和子，通过 `source_project` 区分
- 实体发布时校验：implementation 可覆盖其他状态，变更需持有 project

---

## 3. 数据模型

> 详细的概念定义请参考 [concepts.md](./concepts.md)

### 3.1 实体类型 (type)

C4A 采用"双视角三构建块"模型：

| 视角 | 构建块 | 实体类型 |
|------|--------|---------|
| **业务视角** | Entity | `product` |
| | Process | `process` (process_type=business) |
| | SoR | `sor` (entity_type=product) |
| **技术视角** | Entity | `system` / `container` / `component` |
| | Process | `process` (process_type=technical) |
| | SoR | `sor` (entity_type=system/container/component) |
| **附属实体** | ADR | `adr` |
| | Contract | `contract` (SoR 的技术设计表达) |

**Product 与 System 的对应关系**：
- Product（业务视角）和 System（技术视角）是**同一事物的两个视角**
- 通过 `CORRESPONDS` 关系建立 **1:1 对应**
- Product 在 Enterprise 层定义，System 在 Project 层创建
- 详细说明请参考 [concepts.md](./concepts.md#412-product-与-system-的关系)

**附属实体说明**：
- 附属实体不是三构建块（Entity/Process/SoR），但作为独立的实体类型存储
- Contract：SoR 的技术设计表达，通过 `IMPLEMENTS` 关系连接 SoR 和 Component
- ADR：架构决策记录，记录"为什么这样设计"

### 3.2 知识层级 (scope)

| scope 值 | 说明 | 管理者 | 变更频率 | 是否有代码 |
|---------|------|--------|---------|-----------|
| `domain` | 行业通用知识 | 行业专家 | 低（年度级） | ❌ 无 |
| `enterprise` | 企业特有知识 | 技术委员会 | 中（季度级） | ❌ 无 |
| `project` | 项目实现知识 | 研发团队 | 高（日度级） | ✅ 有 |

**层级约束**：
- Domain/Enterprise 层：只有业务视角（Product + Business Process + Business SoR）
- Project 层：完整双视角（Product + System/Container/Component + Process + SoR）

### 3.3 知识点类型 (kind)

| kind | 说明 | source 字段 |
|------|------|-------------|
| `implementation` | 本项目实现 | 有值 |
| `external` | 外部系统/组件 | 空，可填 external_url |
| `concept` | 抽象概念/纯文档 | 空 |

三种类型可互相转化：
- concept → implementation：抽象概念决定落地实现
- concept → external：抽象概念决定用外部方案
- external → implementation：外部组件内部化 (fork/重写)
- implementation → external：内部组件外部化

### 3.4 关系类型 (rel_type)

> 详细定义请参考 [concepts.md](./concepts.md#6-关系类型)

精简为 6 种核心关系：

| 关系类型 | 语义 | 示例 |
|---------|------|------|
| `CONTAINS` | 层级包含 | System→Container→Component |
| `DEPENDS_ON` | 依赖关系 | Container A 依赖 Container B |
| `REFERENCES` | 引用关系 | Project 引用 Enterprise 的 Product |
| `IMPLEMENTS` | 实现关系 | Contract→SoR, Component→Contract |
| `CORRESPONDS` | 对应关系（双视角映射） | Product↔System, Business SoR↔Technical SoR |
| `DERIVES` | 派生/产出 | Entity×Process→SoR |

#### 3.4.1 跨层级和跨项目引用

> 详细的引用格式、解析逻辑、数据库存储和悬空引用处理请参考 [detailed-design/data-operations.md](./detailed-design/data-operations.md#1-跨层级和跨项目引用)

**设计原则**：
- DSL 保持简洁，用户编写时只需写实体 ID
- 数据库存储完整信息（source_repo、source_project 等）
- CLI 自动解析和智能提示
- 实体唯一性：`(source_project, id, proposal_id)` 三元组唯一

**实体归属**：

| 实体类型 | source_repo | source_project | 说明 |
|---------|------------|---------------|------|
| 项目实体 | 有值 | 有值 | 属于某个项目 |
| 全局实体 | 有值或无 | null（应用层）/ ''（DB） | Domain/Enterprise 层，不属于任何项目 |
| Domain/Enterprise | null（应用层）/ ''（DB） | null（应用层）/ ''（DB） | 全局知识 |

**引用格式规范**：

| 格式 | 说明 | 示例 | 支持状态 |
|------|------|------|---------|
| `{id}` | 简单 ID，按优先级自动解析 | `payment-service` | ✅ 已支持 |
| `project:{project_id}/{id}` | 同 repo 跨项目 | `project:frontend-app/auth` | ✅ 已支持 |
| `repo:{repo_id}/{id}` | 跨 repo 基建 | `repo:company/shared-lib/jwt-utils` | ✅ 已支持 |
| `repo:{repo_id}/project:{project_id}/{id}` | 跨 repo 跨项目 | `repo:other/repo/project:app/svc` | 🔜 未来支持 |
| `scope:{scope}/{id}` | 指定层级 | `scope:domain/order-fsm` | ✅ 已支持 |

> **注意**：`repo:*/project:*` 组合格式为高级场景，v0.3.0 暂不支持，将在后续版本实现。

**解析优先级**（简单 ID）：本项目 → 同 repo 基建 → 同 repo 其他项目 → Enterprise → Domain → 悬空引用

### 3.5 状态生命周期

```
draft ──批准──► approved ──发布──► published ──废弃──► deprecated ──归档──► archived
  │                                    │
  └──────────────拒绝──────────────────►│
                                       ▼
                                   archived
```

**强制规则**：
- 状态流转必须按顺序进行，不可跳过（例外：feat 支持 `published → archived` 快速归档）
- `draft → published` 是非法操作，必须先经过 `approved`
- 只有 `approved` 状态的实体才能发布
- `published` 状态的实体不可直接修改，需创建新版本（新 draft）
- 状态流转需记录操作人和时间（完整规则含归档条件见 concepts.md §3）

**状态值规范**：通用状态使用小写 `draft`, `approved`, `published`, `deprecated`, `archived`；ADR 额外支持 `superseded`，Contract 额外支持 `implemented`（详见 concepts.md §4）

### 3.6 表结构

> 完整 DDL 和实现细节请参考 [detailed-design/local-mode.md](./detailed-design/local-mode.md#2-sqlite-表结构)

| 表名 | 用途 | 主要字段 |
|------|------|---------|
| `configs` | 项目配置 | id, repo_id, created_at, updated_at |
| `entities` | 实体数据 | id, type, kind, scope, perspective, data |
| `metadata` | 元数据 | entity_id, source_project, source_repo, status, proposal_id, content_hash |
| `relations` | 关系图谱 | from_id, to_id, rel_type, properties |
| `vectors` | 向量索引 | entity_id, embedding |

### 3.7 示例数据

> 完整的各层级示例数据请参考 [detailed-design/local-mode.md 附录](./detailed-design/local-mode.md#附录数据示例)

**典型 Container 实体示例**：

```yaml
# entities 表
id: order-service
type: container
kind: implementation
scope: project
perspective: technical
data:
  name: 订单服务
  technology: [{language: Go}]
  code_path: packages/order-service/

# metadata 表
entity_id: order-service
source_project: my-project
source_repo: company/my-repo
status: published
proposal_id: ''              # 主分支（数据库存储值，应用层为 null）
created_at: "2026-01-20T10:00:00Z"
updated_at: "2026-01-20T10:00:00Z"

# relations 表（Product ↔ System 对应关系）
from_id: e-commerce-system
to_id: e-commerce-product
rel_type: CORRESPONDS
```

### 3.8 data 字段结构

不同实体类型的 `data` 字段有不同的结构。完整的 JSON Schema 定义在 `packages/core/schemas/` 目录。

| 实体类型 | 主要字段 | 说明 |
|---------|---------|------|
| Product | name, description, doc_uri | 产品定义 |
| System | name, description | 系统定义 |
| Container | name, technology, code_path | 容器定义 |
| Component | name, container_id, implements_contracts | 组件定义 |
| Process | process_type, name, description, steps | 业务/技术流程 |
| SoR | name, entity_type, sor_type, description, acceptance_criteria, corresponds_to | 记录系统（Technical SoR 通过 corresponds_to 关联 Business SoR） |
| ADR | title, status, context, decision, consequences, alternatives | 架构决策记录（状态定义见 concepts.md） |
| Contract | contract_type, implements_sor, spec/spec_uri | API 契约（状态定义见 concepts.md） |

**Contract 的 spec 与 spec_uri**：

| 字段 | 说明 | 适用场景 |
|------|------|---------|
| `spec` | 内联存储规格内容 | 小型契约，便于版本管理 |
| `spec_uri` | 外部引用（相对路径或 URL） | 大型契约，避免 DSL 文件过大 |

---

## 4. Local 模式技术栈

| 能力 | 选型 | 说明 |
|------|------|------|
| 文档存储 | SQLite | 单文件，零依赖 |
| 图存储 | SQLite relations 表 + 内存图 | 查询时加载到内存 |
| 向量存储 | SQLite + sqlite-vec | 纯 C 实现，零依赖 |
| Embedding | @xenova/transformers | 本地 ONNX 模型，384 维 |

> **详细设计**：向量存储选型、SQLite 表结构、图查询实现等请参考 [detailed-design/local-mode.md](./detailed-design/local-mode.md)

---

## 5. 数据流

### 5.1 写入流程

```
Agent 调用 save()
    │
    ▼
mcp-store 写入数据库
    │
    ├── Local: SQLite (单文件事务)
    └── Server: MongoDB + Neo4j + Milvus (最终一致性 + 补偿机制)
```

**Server 模式一致性策略**：MongoDB 是权威数据源，Neo4j/Milvus 是索引。写入失败时记录日志，后台任务自动重试。

### 5.2 同步与备份

| 操作 | 命令 | 说明 |
|------|------|------|
| 项目同步 | `c4a sync` | 双向同步 `.context/` ↔ 数据库 |
| 备份 | `c4a local/server backup` | 导出为压缩包 |
| 恢复 | `c4a local/server restore` | 从压缩包恢复 |

**CLI 命令与 MCP 工具的关系**：

备份/恢复功能通过 CLI 命令暴露给用户，CLI 内部调用对应的 MCP 工具：

| CLI 命令 | 内部调用的 MCP 工具 | 说明 |
|---------|-------------------|------|
| `c4a local backup` | `c4a_store_backup` | Local 模式备份 |
| `c4a local restore` | `c4a_store_restore` | Local 模式恢复 |
| `c4a server backup` | `c4a_store_backup` | Server 模式备份 |
| `c4a server restore` | `c4a_store_restore` | Server 模式恢复 |

> **设计理由**：备份/恢复需要用户确认（如覆盖警告、冲突处理），因此通过 CLI 命令暴露而非直接暴露 MCP 工具给 Agent。MCP 工具作为底层实现，CLI 负责用户交互和决策点处理。

> **详细设计**：冲突检测算法、CLI 交互示例请参考 [detailed-design/data-operations.md](./detailed-design/data-operations.md)

---

## 6. CLI 架构

C4A 提供两类 CLI 工具：

| CLI | 包名 | 目标用户 | 存储模式 |
|-----|------|---------|---------|
| **用户 CLI** | `@c4a/cli` | 最终用户 | Local/Server/Remote 可选 |
| **开发 CLI** | `@c4a/cli-dev` | C4A 开发者 | Server (Docker) |

### 6.1 用户 CLI

**CLI 包安装**（通过 npm）：
```bash
npm install -g @c4a/cli   # 安装 CLI 工具包
```

安装后支持三种工作模式（Local/Server/Remote）。

**核心命令**（所有模式通用）：
```bash
c4a                   # 交互式菜单
c4a init              # 初始化项目
c4a sync              # 同步知识
c4a status            # 查看状态
c4a help              # 帮助信息
```

**运行模式初始化**（首次使用时）：
```bash
c4a install           # 选择并初始化运行模式
c4a install local     # 初始化 Local 模式（SQLite）
c4a install server    # 初始化 Server 模式（Docker）
```

**模式特定命令**（动态显示）：
```bash
c4a server            # 服务管理（仅 Server 模式安装后显示）
c4a local             # 本地管理（仅 Local 模式安装后显示）
```

**可选工具**：
```bash
c4a validate          # 验证 DSL 文件（用于 CI/CD）
c4a --version         # 版本号
```

> 详细命令说明见 [cli-design.md](./detailed-design/cli-design.md)

**模式选择**：
- **Local 模式**：SQLite 单文件数据库，无需 Docker，适合个人使用
- **Server 模式**：MongoDB + Neo4j + Milvus，需要 Docker，可提供远程服务，适合团队协作
- **Remote 模式**：不安装本地存储，使用项目配置的远程服务，适合使用团队共享服务

**连接验证机制**：

为避免配置错误导致后续使用失败，CLI 在关键操作时自动执行连接验证：

| 时机 | 验证内容 | 失败处理 |
|------|---------|---------|
| `c4a init` (Remote 模式) | 验证远程 URL 可达性 | 阻止初始化，提示修正配置 |
| `c4a install server` | 验证 Docker 服务健康状态 | 阻止安装，提示检查 Docker |
| `c4a sync` (首次) | 验证数据库连接 | 阻止同步，提示检查配置 |

> **注意**：v0.3.0 暂不支持认证，远程服务允许匿名访问。Token 认证将在后续版本中实现。

**初始化后创建的目录结构**：
```
.context/
├── .c4a.yaml           # 项目配置
├── .schemas/           # 本地 Schema 文件（离线支持）
├── business/           # 业务视角
└── technical/          # 技术视角
```

### 6.2 开发 CLI

在 C4A 项目目录使用，通过 `./start.sh` 启动：

```bash
./start.sh dev         # 启动开发环境
./start.sh build       # 编译用户 CLI
./start.sh docker      # Docker 模式
./start.sh debug:dsl   # 调试 MCP 服务
./start.sh status      # 服务状态
./start.sh stop        # 停止服务
```

> **详细设计**：[detailed-design/cli-design.md](./detailed-design/cli-design.md)

---

## 7. feat 机制（需求迭代）

### 7.1 概述

feat 是**产品维度**的需求迭代机制，用于管理待变更的实体。一个 feat 代表一个完整的功能特性，可能横跨多个仓库和项目。

**核心特性**：
- 产品驱动：feat 由产品定义，技术在 feat 内实现
- 统一生命周期：draft → approved → published → deprecated → archived
- 数据库隔离：通过 `proposal_id` 区分 feat 内实体和主分支实体
- 跨项目支持：中心化数据库天然支持跨项目 feat
- 发布后保留：feat 目录完整保留作为历史记录

### 7.2 变更管控规则

**按实体状态的操作权限**：

| 目标实体状态 | 操作类型 | 是否需要 feat |
|--------------|----------|---------------|
| `draft` | 任意操作 | ❌ 直接执行 |
| `approved` | 修改内容 | ❌ 直接执行（尚未发布） |
| `approved` | 状态流转 | ❌ 直接执行 |
| `published` | 修改内容 | ✅ 必须通过 feat |
| `published` | 删除/归档 | ✅ 必须通过 feat |
| `published` | 合并/拆分 | ✅ 必须通过 feat |
| `deprecated` | 归档 | ❌ 直接执行 |

**一致性检查**：

在以下时机执行一致性检查：

| 时机 | 检查内容 | 强制性 |
|------|---------|--------|
| **实现前** (`/c4a:implement` 开始时) | Functional Spec、Technical Spec、契约完备度 | 默认执行，可通过 `--skip-check` 跳过 |
| **发布前** (`/c4a:feat --status=published`) | 完整性 + DSL 引用 + 关系一致性 + **实体质量检查** | **强制执行**，特殊场景可通过 `--force` 跳过 |

**实体质量检查项**：
- 所有实体的必填字段完整性
- 所有实体的 Schema 合规性（通过 DSL 验证）
- 所有实体的引用有效性（被引用的实体存在）
- 如有不合规实体，阻止发布并列出问题清单

> 详细的一致性检查项和规则请参考 [detailed-design/skills-design.md](./detailed-design/skills-design.md) 中的 `/c4a:analyze` 部分。

**操作原语**：

| 类别 | 操作 | 说明 | 需要 feat |
|------|------|------|----------|
| **创建** | extract | 从代码提取 | ❌ |
| | generate | 生成模板 | ❌ |
| | import | 从文件/文档导入 | ❌ |
| **变换** | merge | 合并实体 | ✅ 涉及 published 时 |
| | split | 拆分实体 | ✅ 涉及 published 时 |
| | link | 建立/修改关系 | ✅ 涉及 published 时 |
| **管理** | transition | 状态流转 | ❌ |
| | delete | 删除 | ✅ 涉及 published 时 |
| | archive | 归档 | ✅ 涉及 published 时 |
| | export | 导出到文件 | ❌ |
| | sync | 同步到远端 | ❌ |
| **消费** | query | 精确查询 | ❌ |
| | search | 语义搜索 | ❌ |
| | deps | 依赖分析 | ❌ |
| | impact | 影响分析 | ❌ |

### 7.3 工作流程

```
1. 创建 feat
   ↓ feat 状态: draft
2. 在 feat 内建模实体（标记 proposal_id）
   ↓ 所有实体状态: draft
3. 保存到数据库（feat 内实体）
4. 审批
   ↓ feat 状态: draft → approved
   ↓ **强制同步**：所有关联实体状态 → approved（无论当前状态）
5. 发布（触发合并）
   ↓ feat 状态: approved → published
   ↓ 自动合并: 实体合并到主分支，清空 proposal_id
   ↓ **强制同步**：所有关联实体状态 → published（无论当前状态）
   ↓ feat 目录完整保留（作为历史记录），实体 DSL 已合并到主分支
   ↓ DSL 实体自动双写到文件系统，便于 Git 审阅与共享
6. 废弃（可选）
   ↓ feat 状态: published → deprecated
7. 归档
   ↓ feat 状态: deprecated → archived（或 published → archived）
```

**feat 发布后的目录状态**：
```
.context/feat/feat-a001-user-login/
├── feat.yaml                    # 保留：feat 元信息（状态变为 published）
├── assets/                      # 保留：设计稿、调研文档等
│   └── design.png
├── business/                    # 保留：发布时的快照，作为历史记录
└── technical/                   # 保留：发布时的快照，作为历史记录
```

> **默认策略**：feat 发布后，`business/` 和 `technical/` 目录**完整保留**，作为该 feat 的历史快照。
> - 保留原因：便于追溯 feat 发布时的完整状态，支持审计和回顾
> - 存储影响：feat 目录通常较小（< 1MB），保留不会造成显著存储压力
> - 清理时机：用户可在 feat 归档（archived）后手动删除整个 feat 目录

**用户可选操作**：
- 保留 feat 目录作为历史记录
- 将 feat 目录加入 `.gitignore`（如不需要版本控制）
- 手动删除 feat 目录（如确认不再需要）

**强制规则**：
- 状态流转必须按顺序进行，**不可跳过**
- `draft → published` 是非法操作，必须先经过 `approved`
- 只有 `approved` 状态的实体才能发布
- `published` 状态的实体不可直接修改，需创建新 feat
- **feat 内所有实体状态强制同步流转**：feat 流转时，所有关联实体（`proposal_id` 匹配）的状态自动更新为 feat 的目标状态，无论实体当前状态如何

### 7.4 MCP 工具与 feat 的关系

feat 的工具接口定义见 [mcp-tools.md](./detailed-design/mcp-tools.md) 的 `c4a_store_feat_lifecycle`、`c4a_store_feat_merge` 和 `c4a_store_feat_checklist`（设计层单一真源）。

### 7.5 合并策略

| 类型 | 处理方式 |
|------|---------|
| **自动合并** | 新增实体、无冲突修改、删除实体（无引用） |
| **需人工介入** | 内容冲突、删除冲突、类型冲突、语义冲突、并发 feat 引用 |

> **详细设计**：合并策略、冲突检测 SQL、冲突提示示例请参考 [detailed-design/data-operations.md](./detailed-design/data-operations.md)

### 7.6 冲突解决与回滚机制

**回滚机制**：通过创建"回滚 feat"实现，保持审计追踪。

> **详细设计**：冲突解决流程、回滚机制请参考 [detailed-design/data-operations.md](./detailed-design/data-operations.md)

### 7.7 跨项目 feat

feat 是产品维度的概念，天然可能横跨多个仓库和项目。C4A 采用中心化数据库架构，跨项目 feat 天然支持：

| 设计点 | 说明 |
|--------|------|
| **数据库是唯一权威源** | 所有实体首先保存到中心数据库 |
| **实体通过 proposal_id 关联 feat** | 不同项目的实体通过同一个 proposal_id 关联 |
| **本地文件是视图** | `.context/` 目录只是数据库的本地投影 |

### 7.8 查询策略

```typescript
// 查询主分支实体（默认）
// 注意：应用层传 null，内部转换为数据库的 '' 空字符串
c4a_store_read({ proposal_id: null })

// 查询 feat 内实体
c4a_store_read({ proposal_id: "feat-a001-user-login" })

// 查询合并视图（主分支 + feat，feat 版本优先覆盖主分支）
c4a_store_read({
  proposal_id: [null, "feat-a001-user-login"]  // null 表示主分支，数组后面的优先
})
```
