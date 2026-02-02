# Part 02: 三模式架构

> 详细执行计划 - 基于 `v0.3.0/architecture.md`

---

## 任务清单

| # | 功能 | [ ] | 描述 |
|---|------|:---:|------|
| 2.0 | 文档结构 | [x] | 相关文档链接与导航 |
| 2.1 | 三模式对比 | [x] | Local/Server/Remote 特性对比表 |
| 2.2 | Extract MCP 本地运行 | [x] | c4a_extract_* 必须 stdio 本地运行约束 |
| 2.3 | 存储层可插拔 | [x] | 同一套 MCP 工具接口适配多存储 |
| 2.4 | 知识生命周期阶段 | [x] | Extract→Model→Store→Query 四阶段 |
| 2.5 | 架构图 | [x] | 用户层/MCP 工具层/存储适配层 |
| 2.6 | Skills/Commands 分层 | [x] | MCP 工具设计原则 |
| 2.7 | 存储位置 | [x] | 数据库缓存目录 + .context/ |
| 2.8 | 工作目录结构 | [x] | business/technical/feat 目录规范 |
| 2.9 | 项目配置 | [x] | .c4a.yaml 格式规范 |
| 2.10 | ID 命名规范 | [x] | 唯一性约束 + 命名格式规则 |
| 2.11 | 文件命名规则 | [x] | DSL 文件路径规则 |
| 2.12 | checklist 处理 | [x] | DB-only + 本地只读视图 |
| 2.12a | ADR 定位 | [x] | ADR 作为普通实体的设计 |
| 2.13 | Schema 校验 | [x] | JSON Schema + 离线支持 |
| 2.14 | 子 .context 规则 | [x] | 多项目支持 + 配置继承 |
| 2.15 | 实体类型定义 | [x] | type 字段枚举值 |
| 2.16 | 知识层级 scope | [x] | domain/enterprise/project |
| 2.17 | 知识点类型 kind | [x] | implementation/external/concept |
| 2.18 | 跨层级引用 | [x] | 引用格式规范 + 解析优先级 |
| 2.18a | 状态生命周期 | [x] | draft→approved→published→deprecated→archived |
| 2.18b | 表结构设计 | [x] | configs/entities/metadata/relations/vectors |
| 2.18c | 示例数据 | [x] | 典型 Container 实体示例 |
| 2.18d | data 字段结构 | [x] | 各实体类型的 data 字段定义 |
| 2.18e | Local 模式技术栈 | [x] | SQLite + USearch + transformers |
| 2.18f | 数据流设计 | [x] | 写入流程 + 同步与备份 |
| 2.18g | CLI 架构 | [x] | 用户 CLI + 开发 CLI 设计 |
| 2.19 | feat 机制 | [x] | CoW + 变更管控 + 工作流程 |
| 2.20 | 合并策略 | [x] | 自动合并 + 人工介入规则 |
| 2.20a | MCP 工具与 feat | [x] | feat 工具接口定义 |
| 2.20b | 冲突解决与回滚 | [x] | 回滚 feat 机制 |
| 2.21 | 跨项目 feat | [x] | 中心化数据库架构支持 |
| 2.21a | 查询策略 | [x] | 主分支/feat/合并视图查询 |
| 2.22 | 清理 legacy 配置路径 | [x] | 仅保留 .context/.c4a.yaml |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 2.0 | 文档结构 | `architecture.md` | 文档头部 | L1-15 | [x] | [x] |
| 2.1-2.2 | 模式对比 | `architecture.md` | §1.1 模式对比 | L16-76 | [x] | [x] |
| 2.3 | 存储层可插拔 | `architecture.md` | §1.2 存储层可插拔 | L77-95 | [x] | [x] |
| 2.4 | 知识生命周期阶段 | `architecture.md` | §1.3 知识生命周期 | L96-115 | [x] | [x] |
| 2.5 | 架构图 | `architecture.md` | §1.4 架构图 | L116-182 | [x] | [x] |
| 2.6 | Skills/Commands | `architecture.md` | §1.5 Skills/Commands | L183-235 | [x] | [x] |
| 2.7 | 存储位置 | `architecture.md` | §2.1 存储位置 | L238-254 | [x] | [x] |
| 2.8 | 工作目录结构 | `architecture.md` | §2.2 工作目录结构 | L255-337 | [x] | [x] |
| 2.9 | 项目配置 | `architecture.md` | §2.3 项目配置 | L338-357 | [x] | [x] |
| 2.10 | ID 命名规范 | `architecture.md` | §2.4 ID 命名规范 | L358-446 | [x] | [x] |
| 2.11 | 文件命名规则 | `architecture.md` | §2.5 文件命名规则 | L447-507 | [x] | [x] |
| 2.12 | checklist 处理 | `architecture.md` | §2.5 checklist 处理 | L484-507 | [x] | [x] |
| 2.12a | ADR 定位 | `architecture.md` | §2.6 ADR 的定位 | L508-554 | [x] | [x] |
| 2.13 | Schema 校验 | `architecture.md` | §2.7 Schema 校验 | L555-627 | [x] | [x] |
| 2.14 | 子 .context 规则 | `architecture.md` | §2.8 子 .context | L628-640 | [x] | [x] |
| 2.15-2.17 | 数据模型 | `architecture.md` | §3 数据模型 | L641-696 | [x] | [x] |
| 2.18 | 跨层级引用 | `architecture.md` | §3.4.1 跨层级引用 | L712-743 | [x] | [x] |
| 2.18a | 状态生命周期 | `architecture.md` | §3.5 状态生命周期 | L744-762 | [x] | [x] |
| 2.18b | 表结构设计 | `architecture.md` | §3.6 表结构 | L763-774 | [x] | [x] |
| 2.18c | 示例数据 | `architecture.md` | §3.7 示例数据 | L775-807 | [x] | [x] |
| 2.18d | data 字段结构 | `architecture.md` | §3.8 data 字段结构 | L808-831 | [x] | [x] |
| 2.18e | Local 模式技术栈 | `architecture.md` | §4 Local 模式技术栈 | L832-842 | [x] | [x] |
| 2.18e+ | 包结构 | `architecture.md` | §4.1 包结构 | L843-857 | [x] | [x] |
| 2.18f | 数据流设计 | `architecture.md` | §5 数据流 | L858-898 | [x] | [x] |
| 2.18g | CLI 架构 | `architecture.md` | §6 CLI 架构 | L899-989 | [x] | [x] |
| 2.19 | feat 机制 | `architecture.md` | §7 feat 机制 | L990-1103 | [x] | [x] |
| 2.20 | 合并策略 | `architecture.md` | §7.5 合并策略 | L1108-1116 | [x] | [x] |
| 2.20a | MCP 工具与 feat | `architecture.md` | §7.4 MCP 工具与 feat | L1104-1107 | [x] | [x] |
| 2.20b | 冲突解决与回滚 | `architecture.md` | §7.6 冲突解决与回滚 | L1117-1122 | [x] | [x] |
| 2.21 | 跨项目 feat | `architecture.md` | §7.7 跨项目 feat | L1123-1132 | [x] | [x] |
| 2.21a | 查询策略 | `architecture.md` | §7.8 查询策略 | L1133-1147 | [x] | [x] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| 配置解析 | `packages/core/src/utils/config.ts` | .c4a.yaml 解析（mode: local/server/remote） | ✅ |
| 目录结构 | `packages/core/src/utils/path.ts` | .context/ + business/technical/feat 路径计算 | ✅ |
| ID 生成 | `packages/core/src/utils/id.ts` | ID 生成与验证 | ✅ |
| 适配器配置 | `packages/storage/src/get-adapter.ts` | 仅识别 .context/.c4a.yaml | ✅ |
| Schema 验证 | `packages/core/src/utils/schema.ts` | JSON Schema 验证（复用 validator 模块） | ✅ |
| 验证器 | `packages/core/src/validator/index.ts` | DSL 验证器（validateDSL, validateDSLAuto） | ✅ |
| 单元测试 | `packages/core/src/utils/__tests__/path.test.ts` | 路径计算测试（30 cases） | ✅ |
| 单元测试 | `packages/core/src/utils/__tests__/config.test.ts` | 配置解析测试（8 cases） | ✅ |
| 单元测试 | `packages/storage/src/__tests__/get-adapter.test.ts` | 仅 .c4a.yaml 生效（忽略 .c4a.yml） | ✅ |
| 本地视图 | `packages/cli/src/mcp/store/featChecklist.ts` | 渲染 checklist.md 只读视图 | ✅ |

---

## 补充（2026-02-02）：配置加载一致性

集成验证发现 `get-adapter.ts` 的环境变量回退仅在 `basePath === process.cwd()` 时生效，
导致 MCP 服务从子目录启动时无法正确进入 Server 模式。

**修复要求**：
1. `C4A_STORAGE_BACKEND_URL` 回退逻辑不依赖 `cwd`
2. 支持显式传入项目根目录 `basePath`（或向上查找 `.context/.c4a.yaml`）
3. 增加回归测试覆盖子目录启动场景

## 设计决策

### 存储架构（用户透明）

**核心原则**：MCP 工具对用户透明，底层存储切换不影响用户体验。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          用户 / Agent                                        │
│                    (连接同一套 MCP Server)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                     MCP Server 层 (TypeScript)                               │
│              c4a-extract-mcp / c4a-store-mcp / c4a-query-mcp                 │
│                    (工具名完全一致，用户无感知)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                     StorageAdapter 接口 (TypeScript)                         │
│                save / read / list / search / queryDeps / ...                 │
├──────────────────────────────┬──────────────────────────────────────────────┤
│       LiteAdapter            │           ServerAdapter                       │
│       (TypeScript)           │           (TypeScript)                        │
│            │                 │                │                              │
│            ▼                 │                ▼                              │
│   SQLite + USearch           │        HTTP/gRPC 调用                         │
│   (Local 模式)               │                │                              │
│                              │                ▼                              │
│                              │      storage-backend (Python)                 │
│                              │      MongoDB + Neo4j + Milvus                 │
│                              │      (Server 模式)                            │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

**设计要点**：

| 层级 | 实现语言 | 说明 |
|------|----------|------|
| MCP Server | TypeScript | 统一入口，用户只连接这一层 |
| StorageAdapter 接口 | TypeScript | 定义 `save/read/list/search` 等方法 |
| LiteAdapter | TypeScript | SQLite + USearch (Local 模式) |
| ServerAdapter | TypeScript | 调用 Python 后端的 HTTP/gRPC 客户端 |
| storage-backend | Python | 封装 MongoDB/Neo4j/Milvus 访问 |

**为什么 Server 模式后端用 Python？**

| 数据库 | Bun/Node.js 兼容性 | 风险 |
|--------|-------------------|------|
| MongoDB | ✅ 验证过 | 低 |
| Neo4j | ⚠️ JS driver 有性能问题 | 中 |
| Milvus | ⚠️ gRPC 在 Bun 上较新 | 高 |

Python 生态对这三个数据库的支持更成熟稳定，因此 Server 模式的存储后端使用 Python 实现。

**包命名对照**：

| 模式 | TypeScript 包 | Python 包 |
|------|--------------|-----------|
| Local | `@c4a/storage` (LiteAdapter) | - |
| Server | `@c4a/storage` (ServerAdapter) | `storage-backend` |

### 类型系统分层

| 层级 | 文件 | 用途 | 包含类型 |
|------|------|------|---------|
| DSL 层 | `types/dsl.ts` | YAML 文件格式，与 JSON Schema 一致 | SystemDSL, ContainerDSL, ComponentDSL, ADRDSL, ContractDSL |
| 存储层 | `types/base.ts` + `types/entities.ts` | 数据库存储格式 | BaseEntityMetadata, StoredEntityMetadata, Product, Process, SoR |

**关键决策**：
- DSL 类型是"输入格式"，存储类型是"内部表示"
- 数据流：DSL 文件 → 解析 → 存储类型 → 数据库
- JSON Schema **不需要**存储层字段（`proposal_id`, `content_hash`, `source_project`），这些由系统自动生成
- `types/dsl.ts` 保留用于 MCP 工具解析 `.c4a.yaml` 文件

### 目录结构变更

| 旧设计 | 新设计 |
|--------|--------|
| `.c4a/` | `.context/` |
| `drafts/`, `approved/`, `published/`, `archive/` | `business/`, `technical/`, `feat/` |
| `cwd/c4a.config.yaml` | `.context/.c4a.yaml` |

---

## 依赖关系

- 依赖 Part 01 的类型定义
- 被 Part 03-12 依赖

---

## 最终验证（提交前必须执行）

**参考设计文档：**
- `v0.3.0/architecture.md` (全文)

**Review 流程：**
1. 运行 `git diff --name-only` 查看所有未提交变更
2. 打开 `v0.3.0/architecture.md` 逐行对照检查
3. 确认设计文档中定义的每个章节的内容都实现，代码与设计完全一致
