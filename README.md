# C4A - Context For AI

**知识驱动开发（Knowledge-Driven Development）平台**

C4A 是一个 AI 原生的知识管理平台，为 AI Agent 提供结构化的上下文，实现从业务需求到代码实现的全链路知识贯通。

## 核心理念

**传统开发的痛点**：需求文档、设计文档、代码实现之间存在断层，AI Agent 缺乏足够的上下文来理解业务意图。

**C4A 的解决方案**：通过统一的知识模型，将业务知识、架构决策、技术实现串联起来，让 AI Agent 能够：
- 理解业务背景和约束条件
- 遵循已有的架构决策
- 生成符合规范的代码

## 知识模型

C4A 定义了 8 种知识实体，覆盖业务、架构、技术三个层面：

| 层面 | 实体类型 | 说明 |
|------|----------|------|
| **业务层** | Product | 产品定义、用户故事、验收标准 |
| | Process | 业务流程、工作流定义 |
| | SoR (Source of Record) | 权威数据源、主数据定义 |
| **架构层** | System | 系统边界、外部依赖 |
| | Container | 服务、应用、数据存储 |
| | Component | 模块、类、函数 |
| | ADR | 架构决策记录 |
| **契约层** | Contract | API 契约（OpenAPI/AsyncAPI/Proto） |

## 数据模型速览

- `uuid`: 物理主键（UUID v4），全局唯一
- `root_id`: 包边界标识，由工具链从 `package.json` 或 `.c4a.yaml` 注入
- `versions`: 版本集合（受控字段），不允许通过 DSL 直接修改
- `requirement_id`: 关联 Feat 的 UUID（可选）
- `component_id`: 关联父 Component（可选）
- 新增实体类型：`feat` / `checklist` / `spec`（`feat`/`checklist` 不入图谱与向量索引）
- 移除旧字段（项目/提案相关 legacy 字段）

版本管理通过 MCP 工具完成：`c4a_store_add_version`、`c4a_store_remove_version`、`c4a_store_publish_version`。

## 工作模式

| 模式 | 存储 | 适用场景 |
|------|------|----------|
| **Local** | SQLite + 本地向量 | 个人开发、离线使用 |
| **Server** | MongoDB + Neo4j + Milvus | 团队协作、知识共享 |
| **Remote** | 云端托管 | 企业级部署 |

## 快速开始

```bash
# 初始化项目
c4a init

# 安装并配置工作模式
c4a install              # 交互式选择
c4a install local        # Local 模式
c4a install server       # Server 模式

# 查看状态
c4a status
```

## CLI 命令

```bash
c4a init                 # 初始化项目
c4a install [mode]       # 安装 (local|server|remote)
c4a sync                 # 同步知识到数据库
c4a status               # 查看状态
c4a validate             # 验证 DSL 文件
c4a feat render <id>     # 渲染 Checklist
c4a template <type>      # 生成实体模板
c4a schema <type|all>    # 输出 JSON Schema
c4a server <subcommand>  # 服务管理 (Server 模式)
c4a local <subcommand>   # 本地管理 (Local 模式)
```

## 迁移提示

当旧数据需要升级到新模型时：
- Local 模式可使用 `@c4a/storage` 的 `migrateLegacySchema` 进行 SQLite 结构与数据迁移
- Server 模式可使用 `@c4a/storage` 的 `migrateLegacyEntities` 迁移旧文档结构

迁移后需确保 `root_id`、`uuid`、`versions` 字段已补齐。
同时清理项目/提案相关 legacy 字段。

## Skills

### 工作流 Skills

| Skill | 用途 |
|-------|------|
| `/c4a:feat` | Feature 管理（创建/修改/切换/流转） |
| `/c4a:specify` | 功能规格（Functional Spec） |
| `/c4a:plan` | 技术方案（Technical Spec + 契约 + 验收清单） |
| `/c4a:analyze` | 一致性检查 |
| `/c4a:implement` | 实现代码辅助 |

### 知识技能 Skills

| Skill | 用途 |
|-------|------|
| `/c4a:know:learn` | 快速录入知识 |
| `/c4a:know:search` | 搜索知识库 |

## 文档

- [CLAUDE.md](CLAUDE.md) - 开发指南
- [ARCHITECTURE.md](ARCHITECTURE.md) - 技术架构

## License

MIT
