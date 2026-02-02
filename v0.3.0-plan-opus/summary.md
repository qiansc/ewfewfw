# C4A v0.3.0 实施计划

> 基于 v0.3.0/ 设计文档，按章节精确定位

---

## 迁移说明 (2024-01-28)

**代码结构调整**：已删除 `packages/mcp-dsl`，代码迁移到正确位置：

| 原位置 | 新位置 | 说明 |
|--------|--------|------|
| `mcp-dsl/src/store/*` | `packages/storage/src/` | StorageAdapter + SQLiteStore + LiteAdapter |
| `packages/core/src/store/*` | `packages/storage/src/` | Local 模式存储实现（SQLite + 向量搜索） |
| `mcp-dsl/src/tools/store/*` | `packages/cli/src/mcp/store/` | MCP Store 工具 handlers |
| `mcp-dsl/src/schemas/storeSchemas.ts` | `packages/cli/src/mcp/storeSchemas.ts` | Zod Schema 定义 |
| `mcp-dsl/src/server.ts` | `packages/cli/src/mcp/server.ts` | MCP Server 工厂函数 |

**计划策略调整**：采用增量规划，每完成一个 Part 再详细规划下一个。已删除 03-13 的详细计划文件。

---

## Part 01: 核心概念与数据模型

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 1.1 | 双视角三构件模型 | [x] | Entity/Process/SoR + Business/Technical 双视角 |
| 1.2 | 三层知识结构 | [x] | Domain/Enterprise/Project 三层及流动规则 |
| 1.3 | 知识生命周期 | [x] | draft→approved→published→deprecated→archived |
| 1.4 | Entity 构件 | [x] | Product/System/Container/Component 定义 |
| 1.5 | Process 构件 | [x] | Business/Technical Process + Flow 存储 |
| 1.6 | SoR 构件 | [x] | 9 种 SoR 类型 + 双视角 SoR |
| 1.7 | Entity-Process Mesh | [x] | 交叉产生 SoR 的机制 |
| 1.8 | 六种关系类型 | [x] | CONTAINS/DEPENDS_ON/REFERENCES/IMPLEMENTS/CORRESPONDS/DERIVES |
| 1.9 | 附属实体 ADR | [x] | 架构决策记录结构 |
| 1.10 | 附属实体 Contract | [x] | spec/spec_uri 存储方式 |
| 1.11 | Functional/Technical Spec | [x] | PRD/技术设计的 DSL 版本 |
| 1.12 | feat 实体 | [x] | Feature 分支隔离机制 |
| 1.13 | 术语表 | [x] | feat_id/proposal_id/source_project 区分 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 1.1 | `concepts.md` | §1 双视角三构建块 | L5-38 | [x] | [x] |
| 1.2 | `concepts.md` | §2 三层知识结构 | L41-95 | [x] | [x] |
| 1.3 | `concepts.md` | §3 知识生命周期 | L97-149 | [x] | [x] |
| 1.4 | `concepts.md` | §4.1 Entity | L153-210 | [x] | [x] |
| 1.5 | `concepts.md` | §4.2 Process | L212-289 | [x] | [x] |
| 1.6 | `concepts.md` | §4.3 SoR | L291-364 | [x] | [x] |
| 1.7 | `concepts.md` | §5 Entity-Process Mesh | L366-441 | [x] | [x] |
| 1.8 | `concepts.md` | §6 关系类型 | L443-461 | [x] | [x] |
| 1.9 | `concepts.md` | §8.2 ADR | L622-631 | [x] | [x] |
| 1.10 | `concepts.md` | §8.1 Contract | L526-621 | [x] | [x] |
| 1.11 | `concepts.md` | §8.3-8.5 Spec/feat | L632-728 | [x] | [x] |
| 1.12 | `concepts.md` | §8.4 feat | L680-705 | [x] | [x] |
| 1.13 | `concepts.md` | 附录：术语表 | L854-884 | [x] | [x] |

**实现产物：**

| 文件 | 说明 | 状态 |
|------|------|:----:|
| `packages/core/src/types/base.ts` | 基础类型 + 生命周期状态机 | ✅ |
| `packages/core/src/types/entities.ts` | Entity/Process/SoR 存储类型 | ✅ |
| `packages/core/src/types/relations.ts` | 关系类型 + Reference | ✅ |
| `packages/core/src/types/feat.ts` | Feat/FeatStatus/FeatChange | ✅ |
| `packages/core/src/types/checklist.ts` | Checklist/ChecklistItem | ✅ |
| `packages/core/src/types/attached.ts` | ADR/Contract 附属实体 | ✅ |
| `packages/core/src/types/dsl.ts` | DSL 文件类型（Product/System/Container/Component/Process/SoR/ADR/Contract） | ✅ |
| `packages/core/src/types/errors.ts` | C4AError 错误类型 | ✅ |
| `packages/core/src/schemas/c4a-product.schema.json` | Product DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-system.schema.json` | System DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-container.schema.json` | Container DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-component.schema.json` | Component DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-process.schema.json` | Process DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-sor.schema.json` | SoR DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-adr.schema.json` | ADR DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-contract.schema.json` | Contract DSL Schema | ✅ |
| `packages/core/src/schemas/c4a-feat.schema.json` | Feat Schema | ✅ |
| `packages/core/src/schemas/c4a-checklist.schema.json` | Checklist Schema | ✅ |
| `packages/core/src/validator/ajvInstance.ts` | AJV 单例 + Schema 加载 | ✅ |
| `packages/core/src/validator/index.ts` | DSL 验证业务封装 | ✅ |
| `packages/core/src/utils/hash.ts` | 哈希计算工具 | ✅ |
| `packages/core/src/utils/id.ts` | ID 生成与解析 | ✅ |
| `packages/core/src/utils/path.ts` | 路径计算工具 | ✅ |
| `packages/core/src/utils/date.ts` | 日期工具 | ✅ |
| `packages/core/src/utils/yaml.ts` | YAML 工具 | ✅ |
| `packages/core/src/utils/config.ts` | 配置加载/保存 | ✅ |
| `packages/core/src/utils/logger.ts` | 日志系统 | ✅ |
| `packages/core/src/utils/schema.ts` | JSON Schema 验证 | ✅ |

**补充（2026-01-28）**：已补齐 Part 01 的 schema/logger/base/feat 测试覆盖并通过全量测试。

---

## Part 02: 三模式架构

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 2.1 | 三模式对比 | [x] | Local/Server/Remote 特性对比 |
| 2.2 | Extract MCP 本地运行 | [x] | c4a_extract_* 必须 stdio 本地 |
| 2.3 | 存储层可插拔 | [x] | 同一套 MCP 工具接口 |
| 2.4 | 知识生命周期阶段 | [x] | Extract→Model→Store→Query |
| 2.5 | 架构图 | [x] | 用户层/MCP 工具层/存储适配层 |
| 2.6 | Skills/Commands 分层 | [x] | MCP 工具设计原则 |
| 2.7 | 存储位置 | [x] | 数据库缓存目录 + .context/ |
| 2.8 | 工作目录结构 | [x] | business/technical/feat 目录 |
| 2.9 | 项目配置 | [x] | .c4a.yaml 格式 |
| 2.10 | ID 命名规范 | [x] | 唯一性约束 + 命名格式 |
| 2.11 | 文件命名规则 | [x] | DSL 文件路径规则 |
| 2.12 | checklist 处理 | [x] | DB-only + 本地只读视图 |
| 2.13 | Schema 校验 | [x] | JSON Schema + 离线支持 |
| 2.14 | 子 .context 规则 | [x] | 多项目支持 |
| 2.15 | 实体类型定义 | [x] | type 字段枚举 |
| 2.16 | 知识层级 scope | [x] | domain/enterprise/project |
| 2.17 | 知识点类型 kind | [x] | implementation/external/concept |
| 2.18 | 跨层级引用 | [x] | 引用格式规范 + 解析优先级 |
| 2.19 | feat 机制 | [x] | CoW + 变更管控 + 工作流程 |
| 2.20 | 合并策略 | [x] | 自动合并 + 人工介入 |
| 2.21 | 跨项目 feat | [x] | 中心化数据库架构 |
| 2.22 | 清理 legacy 配置路径 | [x] | 仅保留 .context/.c4a.yaml |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 2.1-2.2 | `architecture.md` | §1.1 模式对比 | L16-76 | [x] | [x] |
| 2.3 | `architecture.md` | §1.2 存储层可插拔 | L77-94 | [x] | [x] |
| 2.4 | `architecture.md` | §1.3 知识生命周期 | L96-115 | [x] | [x] |
| 2.5 | `architecture.md` | §1.4 架构图 | L116-181 | [x] | [x] |
| 2.6 | `architecture.md` | §1.5 Skills/Commands | L183-234 | [x] | [x] |
| 2.7 | `architecture.md` | §2.1 存储位置 | L238-254 | [x] | [x] |
| 2.8 | `architecture.md` | §2.2 工作目录结构 | L255-337 | [x] | [x] |
| 2.9 | `architecture.md` | §2.3 项目配置 | L338-357 | [x] | [x] |
| 2.10 | `architecture.md` | §2.4 ID 命名规范 | L358-446 | [x] | [x] |
| 2.11 | `architecture.md` | §2.5 文件命名规则 | L447-507 | [x] | [x] |
| 2.12 | `architecture.md` | §2.5 checklist 处理 | L484-507 | [x] | [x] |
| 2.13 | `architecture.md` | §2.7 Schema 校验 | L555-627 | [x] | [x] |
| 2.14 | `architecture.md` | §2.8 子 .context | L628-640 | [x] | [x] |
| 2.15-2.17 | `architecture.md` | §3 数据模型 | L641-696 | [x] | [x] |
| 2.18 | `architecture.md` | §3.4.1 跨层级引用 | L712-743 | [x] | [x] |
| 2.19 | `architecture.md` | §7 feat 机制 | L990-1103 | [x] | [x] |
| 2.20 | `architecture.md` | §7.5 合并策略 | L1108-1116 | [x] | [x] |
| 2.21 | `architecture.md` | §7.7 跨项目 feat | L1123-1132 | [x] | [x] |

**实现产物：**

| 文件 | 说明 |
|------|------|
| `packages/core/src/utils/config.ts` | .c4a.yaml 配置解析（mode: local/server/remote） |
| `packages/core/src/utils/path.ts` | .context/ + business/technical/feat 路径计算 |
| `packages/core/src/utils/id.ts` | ID 生成与验证 |
| `packages/core/src/utils/schema.ts` | JSON Schema 验证（复用 validator 模块） |
| `packages/core/src/validator/index.ts` | DSL 验证器 |
| `packages/core/src/utils/__tests__/path.test.ts` | 路径计算测试（30 cases） |
| `packages/core/src/utils/__tests__/config.test.ts` | 配置解析测试（8 cases） |

---

## Part 03: MCP Store 工具

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 3.1 | MCP 工具规范 | [x] | 命名/返回格式/版本策略 |
| 3.2 | 工具可见性分层 | [x] | 核心/辅助/运维 工具分类 |
| 3.3 | c4a_store_save | [x] | 保存/更新实体 + ADR 检查 |
| 3.4 | c4a_store_read | [x] | 读取实体 + Merge View |
| 3.5 | c4a_store_list | [x] | 列表概要 + 分组统计 |
| 3.6 | c4a_store_delete | [x] | 删除实体 + 软删除 |
| 3.7 | c4a_store_sync | [x] | Local 模式直接同步 |
| 3.8 | c4a_store_plan_sync | [x] | Server/Remote 同步计划 |
| 3.9 | Double Check 机制 | [x] | 本地文件写入保护 |
| 3.10 | 大批量同步优化 | [x] | CLI 分批 + 会话管理 |
| 3.11 | c4a_store_feat_lifecycle | [x] | Feat 创建/流转/删除 |
| 3.12 | c4a_store_feat_merge | [x] | Feat 合并 + 冲突解决 |
| 3.13 | Server 多库一致性 | [x] | MongoDB 权威 + 后台同步 |
| 3.14 | proposal_id 上下文管理 | [x] | CoW 防护机制 |
| 3.15 | c4a_store_feat_checklist | [x] | Checklist CRUD |
| 3.16 | 本地文件保护机制 | [x] | 文件指纹 + 明确阻断 |
| 3.17 | c4a_store_update_workflow_step | [x] | 原子更新 workflow 步骤 |
| 3.18 | 并发修改预警 | [x] | 多 feat 修改同一实体 |
| 3.19 | 引用完整性预警 | [x] | 删除实体时检测依赖 |
| 3.20 | c4a_store_read_history | [x] | 变更历史查询 |
| 3.21 | c4a_store_backup/restore | [x] | 备份恢复 |
| 3.22 | c4a_store_repair | [x] | 数据一致性修复 |
| 3.23 | c4a_store_validate | [x] | 架构一致性检查 |
| 3.24 | 移除 legacy MCP 接口 | [x] | 删除旧接口与别名 |

> 备注: feat checklist 并发更新冲突校验已补齐（2026-01-31）。
> 前置验证（2026-02-01）：健康检查/搜索降级/repair 端点已确认；`@c4a/storage` 测试 129 pass / 5 skip；storage-backend pytest 29 passed（1 warning）；coverage 未输出；待修复：graph Neo4j 降级。

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 3.1 | `mcp/overview.md` | §1.1 工具分组 | L1-18 | [x] | [x] |
| 3.2 | `mcp/overview.md` | §1.2 可见性分层 | L20-79 | [x] | [x] |
| 3.1 | `mcp/overview.md` | §1.3-1.5 规范 | L82-179 | [x] | [x] |
| 3.3 | `mcp/store-crud.md` | §3.1 save | L1-156 | [x] | [x] |
| 3.4 | `mcp/store-crud.md` | §3.2 read | L158-243 | [x] | [x] |
| 3.5 | `mcp/store-crud.md` | §3.3 list | L244-285 | [x] | [x] |
| 3.6 | `mcp/store-crud.md` | §3.4 delete | L286-361 | [x] | [x] |
| 3.7 | `mcp/store-sync.md` | §3.5 sync | L1-36 | [x] | [x] |
| 3.8 | `mcp/store-sync.md` | §3.5.1 plan_sync | L37-353 | [x] | [x] |
| 3.9 | `mcp/store-sync.md` | §Double Check | L185-257 | [x] | [x] |
| 3.10 | `mcp/store-sync.md` | §3.5.2 大批量优化 | L355-612 | [x] | [x] |
| 3.11 | `mcp/store-feat-lifecycle.md` | §3.6 lifecycle | L1-203 | [x] | [x] |
| 3.12 | `mcp/store-feat-lifecycle.md` | §3.7 merge | L205-343 | [x] | [x] |
| 3.13 | `mcp/store-feat-lifecycle.md` | §3.7.9 多库一致性 | L344-535 | [x] | [x] |
| 3.14 | `mcp/store-feat-lifecycle.md` | §3.7.3 上下文管理 | L536-593 | [x] | [x] |
| 3.15 | `mcp/store-feat-checklist.md` | §3.8 checklist | L1-203 | [x] | [x] |
| 3.16 | `mcp/store-feat-checklist.md` | §3.8.1 文件保护 | L206-324 | [x] | [x] |
| 3.17 | `mcp/store-feat-checklist.md` | §3.9 workflow_step | L325-570 | [x] | [x] |
| 3.18 | `mcp/store-feat-checklist.md` | §3.10 并发预警 | L572-658 | [x] | [x] |
| 3.19 | `mcp/store-feat-checklist.md` | §3.11 引用预警 | L660-707 | [x] | [x] |
| 3.20 | `mcp/store-utils.md` | §3.11 read_history | L1-46 | [x] | [x] |
| 3.21 | `mcp/store-utils.md` | §3.13-3.14 backup/restore | L65-153 | [x] | [x] |
| 3.22 | `mcp/store-utils.md` | §3.15 repair | L155-205 | [x] | [x] |
| 3.23 | `mcp/store-utils.md` | §3.16 validate | L208-373 | [x] | [x] |

---

## Part 03.5: MCP 包架构清理与命名规范化

> 详细计划见: [03.5-architecture-cleanup.md](03.5-architecture-cleanup.md)

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 3.5.1-2 | 清理遗留包 | [x] | 删除 mcp-data、mcp-dsl |
| 3.5.3-5 | Extract 包重构 | [x] | mcp-code → mcp-extract + 工具重命名 |
| 3.5.6-9 | Store 包迁移 | [x] | cli/src/mcp → mcp-store + c4a-store-mcp Server |
| 3.5.10-12 | Query 包创建 | [x] | mcp-query 空壳 + c4a-query-mcp Server |
| 3.5.13-15 | 配置更新 | [x] | Claude MCP 配置 + monorepo 配置 |
| 3.5.16-18 | 验证 | [x] | build + test + MCP Server 启动 |

**MCP Server 命名规范**：

| MCP Server | 工具前缀 | 说明 |
|------------|----------|------|
| `c4a-extract-mcp` | `c4a_extract_*` | 知识采集 (从 c4a-code-mcp 重命名) |
| `c4a-store-mcp` | `c4a_store_*` | 知识存储 (从 c4a-dsl-mcp 迁出) |
| `c4a-query-mcp` | `c4a_query_*` | 知识消费 (新建) |
| `c4a-visual-mcp` | `c4a_visual_*` | 可视化 (已规范 ✅) |

**目标包结构**：
```
packages/
├── mcp-extract/    # c4a_extract_* (知识采集)
├── mcp-store/      # c4a_store_* (知识存储)
├── mcp-query/      # c4a_query_* (知识消费)
├── mcp-visual/     # c4a_visual_* (可视化)
├── storage/        # StorageAdapter 层
├── core/           # 核心类型
└── cli/            # CLI (不含 MCP Server)
```

---

## Part 04: MCP Query 工具

> 详细计划见: [04-mcp-query.md](04-mcp-query.md)

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 4.1 | c4a_query_search | [x] | 语义搜索（复用 SearchParams，含 proposal_id） |
| 4.2 | c4a_query_deps | [x] | 依赖查询（复用 DepsParams，含 proposal_id） |
| 4.3 | c4a_query_impact | [x] | 影响分析（复用 ImpactParams，含 proposal_id） |
| 4.4 | 查询一致性检测 | [x] | 不一致状态检测（Local stub 已就绪） |
| 4.5 | 降级行为 | [x] | Neo4j/Milvus 不可用时返回 degraded 标记 |
| 4.6 | Local Mode 查询策略 | [x] | 调用 Part 06 的 USearch + InMemoryGraph |

**已完成基础设施（Part 06）**：
- ✅ `adapterSearchTypes.ts` - SearchParams/DepsParams/ImpactParams 类型（含 proposal_id）
- ✅ `vector-search.ts` - USearch 向量搜索
- ✅ `in-memory-graph.ts` - 图查询
- ✅ `graph-query-cache.ts` - 图查询缓存

**测试状态（2026-01-29）**：
- ✅ `@c4a/mcp-query` 与 `@c4a/storage` 单元测试通过（局部执行）

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 4.1 | `mcp/query.md` | §4.1 search | L1-16 | [x] | [x] |
| 4.2 | `mcp/query.md` | §4.2 deps | L18-21 | [x] | [x] |
| 4.3 | `mcp/query.md` | §4.3 impact | L23-26 | [x] | [x] |
| 4.4-4.5 | `mcp/query.md` | §4.4 一致性/降级 | L30-111 | [x] | [x] |
| 4.6 | `mcp/query.md` | §4.5 Local Mode | L113-180 | [x] | [x] |

**阻塞清单（等待 Part 13 Server）**：
- checkSyncStatus：sync_status + /utils/check-consistency 已实现，阻塞解除（2026-02-01）

**补充说明（2026-02-01）**：
- Server 模式实体保存已写入 `sync_status`，并新增 `/utils/check-consistency` 端点与测试用例。

---

## Part 05: MCP Extract 工具 (知识采集)

> 详细计划见: [05-mcp-code.md](05-mcp-code.md)
>
> **注意**：包名将从 `mcp-code` 重命名为 `mcp-extract`（Part 03.5），工具名 `c4a_extract_*`。

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 5.1 | c4a_extract_interfaces | [x] | 提取接口/类型/类（已有基础实现） |
| 5.2 | c4a_extract_analyze | [x] | 代码结构 + 依赖分析（已有基础实现） |
| 5.3 | c4a_extract_ast | [x] | 获取 AST（已有基础实现） |
| 5.4 | c4a_extract_contract | [x] | 生成 API 契约（已有基础实现） |
| 5.5 | TypeScript 解析器 | [x] | 使用 typescript 编译器 API |
| 5.6 | Go/Python 解析器 | [x] | tree-sitter（需验证 Bun 兼容性） |
| 5.7 | 接口一致性验证 | [x] | 对照 mcp/code.md 验证现有实现 |
| 5.8 | 单元测试 | [x] | 各工具基本功能测试 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 5.1 | `mcp/code.md` | §2.1 extract | L1-15 | [x] | [x] |
| 5.2 | `mcp/code.md` | §2.2 analyze | L17-32 | [x] | [x] |
| 5.3 | `mcp/code.md` | §2.3 ast | L34-45 | [x] | [x] |
| 5.4 | `mcp/code.md` | §2.4 contract | L47-61 | [x] | [x] |

---

## Part 06: Local 模式实现

> 详细计划见: [06-local-mode.md](06-local-mode.md)

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 6.1 | 模式对比 | [x] | Local vs Server 差异 |
| 6.2 | 并发访问配置 | [x] | WAL + busy_timeout |
| 6.3 | entities 表 | [x] | 复合主键设计 |
| 6.4 | metadata 表 | [x] | 元数据 + content_hash |
| 6.5 | relations 表 | [x] | 关系存储 + 无外键 |
| 6.6 | entity_history 表 | [x] | 变更历史 |
| 6.7 | feat_history 表 | [x] | 发布历史（回滚支持） |
| 6.8 | vectors 表 | [x] | USearch 向量索引 |
| 6.9 | graph_cache 表 | [x] | 图查询缓存 |
| 6.10 | Merge View 模式 | [x] | Feat 优先 + 主分支兜底 |
| 6.11 | Embedding 生成 | [x] | @xenova/transformers |
| 6.12 | 向量搜索实现 | [x] | Feat 版本隔离 |
| 6.13 | 写队列设计 | [x] | WriteQueue + 背压控制 |
| 6.14 | 单例连接管理 | [x] | SQLiteStore 单例 |
| 6.15 | 向量索引维护 | [x] | 增量更新 + 批量重建 |
| 6.16 | InMemoryGraph 构建 | [x] | 邻接表 + RWLock |
| 6.17 | 图增量更新 | [x] | 实体变更时增量更新 |
| 6.18 | GraphQueryCache | [x] | 两层缓存 + 反向索引 |
| 6.19 | 模式配置 | [x] | .c4a.yaml mode 设置 |
| 6.20 | Local→Server 切换 | [x] | migrateLocalToServer 已实现 |
| 6.21 | Server→Local 切换 | [x] | migrateServerToLocal 已实现 |
| 6.22 | 数据兼容性 | [x] | 格式一致性保证 |
| 6.23 | 导出/导入格式 | [x] | JSON 格式规范 |
| 6.24 | 性能基准测试 | ⏳ | 测试环境 + 指标 (延后 v0.4.0) |
| 6.25 | 实现建议 | [x] | 依赖 + 初始化 + 错误处理 |
| 6.26 | 已知限制 | [x] | 限制说明 + 最佳实践 |
| 6.27 | 未来优化 | [x] | 短期/长期优化路线 |
| 6.28 | FAQ: USearch 降级 | [x] | 无扩展时降级策略 |
| 6.29 | FAQ: 模式选择指南 | [x] | Local vs Server 选择 |
| 6.30 | 数据完整性检查 | [x] | validate 命令 |
| 6.31 | 数据修复命令 | [x] | repair 命令 |
| 6.32 | 错误码定义 | [x] | C4A-MIGRATE-001~008 |
| 6.33 | 数据示例 | [x] | Domain/Enterprise/Project |

**进度**: 32/33 已完成，1 延后 (性能基准测试)

**P0 待修复**:
- ✅ P0-Fix1: crud-operations.ts 未调用 converter.ts（已修复）
- ✅ P0-Fix2: parseRelations 不符合 DSL Schema（已修复）

**补充修复**:
- ✅ 图查询缓存加入 source_project 维度（避免跨项目污染）
- ✅ 缓存失效粒度调整为 source_project:id
- ✅ LocalRestore 数据兼容性修复（ADR title/name、Contract component_id、kind/scope/perspective 归一化）
- ✅ 迁移错误码统一引用 errors.ts（避免重复定义）
- ✅ DataValidator 支持 JSON 格式输出（--format=json）
- ✅ LocalBackup 归一化 legacy 字段（ADR title/name、Contract component_id、kind/scope/perspective）
- ✅ includeVectors 显式报错（向量不导出，恢复时重建）
- ✅ list 查询补齐 Merge View（避免 feat+主分支重复计数/展示）
- ✅ 关系变更后图查询缓存失效补齐（Relation 变更影响 cache）
- ✅ LocalRestore 支持 null source_project/relations 兼容（全局实体导入）
- ✅ LocalRestore 进度回调（onProgress）补齐（本地侧可观测性增强）
- ✅ LocalBackup 进度回调（onProgress）补齐
- ✅ LocalRestore 冲突统计摘要（conflict_summary）补齐
- ✅ LocalRestore 冲突摘要补齐 target 维度（feat/entity）
- ✅ LocalRestore 冲突摘要补齐 target×resolution 维度
- ✅ 冲突摘要格式化工具（formatConflictSummary）
- ✅ LocalRestore 冲突摘要补齐 entity_type 维度
- ✅ LocalRestore 冲突摘要补齐 status 维度
- ✅ LocalRestore 冲突摘要补齐 feat_status 维度
- ✅ ServerAdapter 占位实现，Server 模式明确抛错（等待 Part 13）
- ✅ 单元测试补齐（向量索引维护 + ServerAdapter 占位）
- ✅ 与 Part 01/02 类型一致性已核对
- ✅ 保存关系纳入事务（避免实体/关系不一致）
- ✅ 关系保存批量事务化（避免逐条隐式事务性能问题）
- ✅ 向量索引写盘节流（延迟保存/批量重建 flush）
- ✅ LocalRestore 大文件流式解析（降低 OOM 风险）
- ✅ rebuildVectorIndex 改为迭代遍历（降低 OOM 风险）

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 6.1-6.10 | `detailed-design/local-mode/sqlite-schema.md` | 全文 | L1-370 | [x] | [x] |
| 6.11-6.15 | `detailed-design/local-mode/vector-search.md` | 全文 | L1-576 | [x] | [x] |
| 6.16-6.18 | `detailed-design/local-mode/graph-query.md` | 全文 | L1-308 | [x] | [x] |
| 6.19-6.27 | `detailed-design/local-mode/mode-switch.md` | 全文 | L1-454 | [x] | 🔶 |
| 6.28-6.33 | `detailed-design/local-mode/appendix.md` | 全文 | L1-628 | [x] | [x] |

---

## Part 07: 数据操作

> 详细计划见: [07-data-ops.md](07-data-ops.md)
> 备注: Agent-R lite-adapter 业务逻辑重构已完成。
> 备注: Agent-0 前置准备 + Schema 已完成。
> 备注: transaction/workflow/reference/sync 占位文件已创建，其中冲突回滚模块已实现并补齐测试（2026-01-30）。
> 备注: Agent-6 集成收尾已完成（2026-01-30），补齐 data-ops 统一导出、集成测试、README。
> 备注: 引用解析已完成 LiteAdapter 集成，支持 references 字段与 resolved 标记（2026-01-31）。
> 备注: DSL references schema 验证用例已补齐（2026-01-31）。

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 7.1 | 引用格式规范 | [x] | 简单ID/project:/repo:/scope: 四种格式 |
| 7.2 | 引用解析优先级 | [x] | 本项目→基建→其他→Enterprise→Domain |
| 7.3 | 悬空引用处理 | [x] | 状态感知 + 修复建议 |
| 7.4 | CoW 机制实现 | [x] | 复制实体到 feat 分支 |
| 7.5 | 同步引擎 | [x] | 双向同步 DB ↔ .context/ |
| 7.6 | 增量同步算法 | [x] | content_hash + updated_at |
| 7.7 | 冲突检测 | [x] | 内容/删除/类型冲突 |
| 7.8 | 导出引擎 | [x] | yaml/json 格式导出 |
| 7.9 | Feat 冲突检测 | [x] | 并发修改/删除冲突 |
| 7.10 | 冲突解决策略 | [x] | ours/theirs/manual/abort |
| 7.11 | 回滚机制 | [x] | 创建回滚 Feat |
| 7.12 | Feat 事务 | [x] | begin/commit/rollback |
| 7.13 | 补偿机制 | [x] | 补偿日志 + 执行 |
| 7.14 | 跨项目 Feat | [x] | 多项目实体原子发布 |
| 7.15 | Workflow 状态管理 | [x] | pending/running/paused/completed/failed |
| 7.16 | 断点续传 | [x] | checkpoint 保存/恢复 |
| 7.17 | 步骤幂等性 | [x] | step_id + input_hash |
| 7.18 | 实体清理机制 | [x] | orphaned 实体清理 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 7.1-7.4 | `data-ops/cross-reference.md` | 引用解析 + CoW | L1-450 | [x] | [x] |
| 7.5-7.8 | `data-ops/sync-export.md` | 同步导出 | L1-300 | [x] | [x] |
| 7.9-7.11 | `data-ops/conflict-rollback.md` | 冲突回滚 | L1-190 | [x] | [x] |
| 7.12-7.14 | `data-ops/cross-project-transaction.md` | 跨项目事务 | L1-338 | [x] | [x] |
| 7.15-7.18 | `data-ops/workflow-recovery.md` | Workflow 恢复 | L1-574 | [x] | [x] |

---

## Part 08: 用户 CLI

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 8.1 | CLI 架构设计 | [x] | User CLI vs Dev CLI |
| 8.2 | 首次运行引导 | [x] | 模式选择 (local/server/remote/skip) |
| 8.3 | 动态菜单显示 | [x] | 根据模式显示不同菜单项 |
| 8.4 | c4a init | [x] | 项目初始化 |
| 8.5 | c4a status | [x] | 查看项目状态 |
| 8.6 | c4a install | [x] | Local/Server 模式安装 |
| 8.7 | c4a sync | [x] | 双向同步 |
| 8.8 | c4a validate | [x] | 离线 DSL 验证 |
| 8.9 | c4a feat render | [x] | Checklist 渲染 |
| 8.10 | c4a template/schema | [x] | 模板/Schema 生成 |
| 8.11 | c4a server 子菜单 | [x] | backup/restore/status |
| 8.12 | c4a local 子菜单 | [x] | backup/restore/repair |
| 8.13 | c4a rollback | ⏳ | 紧急回滚命令 (延后 v0.4.0) |
| 8.14 | 多模式支持 | [x] | 同时安装 Local/Server |
| 8.15 | 全局/项目配置 | [x] | ~/.c4a/config.yaml + .c4a.yaml |
| 8.16 | Remote 模式设计 | [x] | 选择流程 + 命令可用性 |
| 8.17 | CLI-MCP 映射 | [x] | 命令到工具映射 |
| 8.18 | sync 实现细节 | [x] | Local/Server/Remote 差异 |
| 8.19 | 冲突检测算法 | [x] | 哈希 + 时间戳 |
| 8.20 | Commands vs Skills | [x] | 职责划分 |
| 8.21 | CLI 目录迁移 | [x] | packages/cli 新结构 |

> 备注（2026-01-31）：8.13 为 v0.4.0 计划项，Part 08 其余完成；补齐 sync 双向变更确认与冲突处理递归参数修复。
> 备注（2026-02-01）：check-permissions 已在 Part 13 完成；补齐 server check-consistency / rebuild-neo4j / rebuild-milvus 命令与测试，并记录 sync-pending 移除原因（后端仅支持全量重建，详见 changes/08-user-cli-check-permissions.md）。
> 备注（2026-02-01）：新增根脚本 typecheck（指向 @c4a/cli），并完成 server 命令手动验证（check-consistency / rebuild-neo4j / rebuild-milvus）。
> 备注（2026-02-01）：全量 typecheck 与 @c4a/cli 测试通过，完成 Part 08 集成收尾验证。

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 8.1 | `cli/overview.md` | 全文 | L1-32 | [x] | [x] |
| 8.2-8.16 | `cli/user-cli.md` | 全文 | L1-1739 | [x] | [x] |
| 8.17-8.19 | `cli/mcp-mapping.md` | 全文 | L1-760 | [x] | [x] |
| 8.20 | `cli/commands-vs-skills.md` | 全文 | L1-80 | [x] | [x] |
| 8.21 | `cli/structure-migration.md` | 全文 | L1-172 | [x] | [x] |

---

## Part 09: 开发者 CLI

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 9.1 | start.sh dev | [x] | 本地开发模式 |
| 9.2 | start.sh docker | [x] | 全容器化 |
| 9.3 | start.sh debug | [x] | MCP 服务调试 |
| 9.4 | start.sh build | [x] | 编译用户 CLI |
| 9.5 | 延迟依赖检查 | [x] | 按需验证依赖 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 9.1-9.5 | `cli/dev-cli.md` | 全文 | L1-END | [x] | [x] |

---

## Part 10: Skills 体系

> 详细计划见: [10-skills.md](10-skills.md)

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 10.1-10.7 | 基础设施 | [x] | 设计原则/触发方式/文件结构/路由表/执行规则/上下文注入/错误处理 |
| 10.8-10.11 | /c4a:feat Skill | [x] | Feature 管理（类型识别/上下文切换/状态流转） |
| 10.12 | /c4a:specify Skill | [x] | Functional Spec 生成 |
| 10.13-10.16 | /c4a:plan Skill | [x] | Technical Spec + ADR 检测 + 契约补充 + 验收清单 |
| 10.17-10.19 | /c4a:implement Skill | [x] | 实现代码（状态校验/清单生成） |
| 10.20-10.22 | /c4a:analyze Skill | [x] | 一致性检查（检查项/悬空引用） |
| 10.23-10.26 | /c4a:know:learn Skill | [x] | 快速录入知识（输入识别/流程控制/错误恢复） |
| 10.27 | /c4a:know:search Skill | [x] | 语义搜索知识库 |
| 10.28 | /c4a:model 内部 Skill | [x] | 建模规则（内联到父 Skill） |
| 10.29-10.30 | Checklist 集成 | [x] | 格式定义 + MCP 集成 |
| 10.31-10.33 | ADR 检测 | [x] | 模板定义 + 架构变更规则 + 性能优化 |
| 10.34 | 悬空引用可视化 | [x] | Mermaid 样式 + CLI 报告 |
| 10.35 | 三种场景流程 | [x] | 需求开发/架构变更/纯知识 |
| 10.36-10.38 | 集成与文档 | [x] | c4a.md 更新 + CLAUDE.md 更新 + 单元测试 |

**Skills 体系概览**：

| 类型 | Skills | 说明 |
|------|--------|------|
| 工作流 | `/c4a:feat`, `/c4a:specify`, `/c4a:plan`, `/c4a:implement`, `/c4a:analyze` | 5 个工作流 Skills |
| 知识 | `/c4a:know:learn`, `/c4a:know:search` | 2 个知识 Skills |
| 内部 | `/c4a:model` | 1 个内部 Skill（建模规则，内联到父 Skill） |

**实现产物**：

| 产物 | 路径 | 状态 |
|------|------|:----:|
| /c4a:feat Skill | prompts/skills/c4a-feat/ | ✅ |
| /c4a:specify Skill | prompts/skills/c4a-specify/SKILL.md | ✅ |
| /c4a:plan Skill | prompts/skills/c4a-plan/SKILL.md | ✅ |
| /c4a:implement Skill | prompts/skills/c4a-implement/SKILL.md | ✅ |
| /c4a:analyze Skill | prompts/skills/c4a-analyze/SKILL.md | ✅ |
| /c4a:know:learn Skill | prompts/skills/c4a-know-learn/SKILL.md | ✅ |
| /c4a:know:search Skill | prompts/skills/c4a-know-search/SKILL.md | ✅ |
| 建模规则 | prompts/skills/c4a-model/modeling-rules.md | ✅ |
| Skills 路由逻辑 | prompts/c4a.md | ✅ |
| Skills 使用指南 | CLAUDE.md | ✅ |
| Skill 格式验证测试 | prompts/__tests__/skill-format.test.ts | ✅ |

---

## Part 11: 权限与错误处理（Part 11 Lite 已完成，完整版延后 v0.4.0）

> **说明**: v0.3.0 实现 Part 11 Lite（安全工具 + 错误码基础），完整权限系统延后到 v0.4.0。

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 11.1 | 模式差异处理 | ⏳ | Local跳过鉴权/Server严格 (延后) |
| 11.2 | Local 数据完整性 | ⏳ | source_project 必填+自动填充 (延后) |
| 11.3 | Server/Remote 权限 | ⏳ | 用户上下文+权限存储 (延后) |
| 11.4 | Local→Server 迁移 | ⏳ | 权限校验/元数据补全 (延后) |
| 11.5 | 权限元数据映射 | ⏳ | owner/created_by 补全 (延后) |
| 11.6 | 权限模型 | ⏳ | Admin/Writer/Reader (延后) |
| 11.7 | 权限变更处理 | ⏳ | 创建/发布时权限变化 (延后) |
| 11.8 | 创建时权限检查 | ⏳ | source_project 立即检查 (延后) |
| 11.9 | 修改/发布权限检查 | ⏳ | 实体修改+feat发布 (延后) |
| 11.10 | 跨项目发布权限 | ⏳ | 需所有项目 Admin (延后) |
| 11.11 | 权限配置 | ⏳ | 配置文件+继承规则 (延后) |
| 11.12 | 权限实现建议 | ⏳ | MCP层+外部系统+审计 (延后) |
| 11.13 | 错误分类 | ⏳ | INPUT/DATA/SYS/BIZ/PERM (延后) |
| 11.14 | 错误处理原则 | ⏳ | 明确原因+修复建议 (延后) |
| 11.15 | 分层错误处理 | ⏳ | MCP返回/CLI呈现/Agent (延后) |
| 11.16 | Skill 错误处理 | ⏳ | implement/analyze/publish (延后) |
| 11.17 | 系统错误处理 | ⏳ | DB连接/MCP超时 (延后) |
| 11.18 | 恢复机制 | ⏳ | 操作日志/回滚支持 (延后) |
| 11.19 | 归档检查 | ⏳ | 最小保留期/无引用 (延后) |
| 11.20 | Server 数据修复 | ⏳ | c4a_store_repair (延后) |
| 11.21 | 数据备份 | ⏳ | 自动备份配置 (延后) |
| 11.22 | 错误码格式 | ⏳ | C4A-{类别}-{编号} (延后) |
| 11.23 | 错误码使用指南 | ⏳ | Agent 按类别处理 (延后) |
| 11.24 | 完整错误码表 | [x] | 7 类错误码映射 |
| 11.25 | 错误响应格式 | [x] | code/message/details |
| 11.26 | 多语言错误消息 | [x] | Accept-Language |
| 11.27 | 最佳实践 | ⏳ | 错误/权限/恢复 (延后) |
| 11.28 | DSL 注入防护 | [x] | 输入验证/输出转义 |
| 11.29 | 路径安全校验 | [x] | Path Traversal+TOCTOU |
| 11.30 | 未来优化方向 | ⏳ | 短期/长期路线 (延后) |

**相关设计文档：**

> 以下标记 ⏳ 的任务延后到 v0.4.0，设计文档已读但未实现。

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 11.1-11.2 | `permissions/cross-project-auth.md` | §1.1.1 Local | L12-137 | [x] | ⏳ |
| 11.3 | `permissions/cross-project-auth.md` | §1.1.2 Server/Remote | L139-166 | [x] | ⏳ |
| 11.4-11.5 | `permissions/cross-project-auth.md` | §1.1.3 迁移 | L168-348 | [x] | ⏳ |
| 11.6-11.7 | `permissions/cross-project-auth.md` | §1.2-1.3 权限模型 | L350-402 | [x] | ⏳ |
| 11.8-11.10 | `permissions/cross-project-auth.md` | §1.4 权限检查 | L404-671 | [x] | ⏳ |
| 11.11-11.12 | `permissions/cross-project-auth.md` | §1.5-1.7 配置/实现 | L673-828 | [x] | ⏳ |
| 11.13-11.14 | `permissions/error-recovery.md` | §2.1-2.2 错误分类 | L1-19 | [x] | ⏳ |
| 11.15 | `permissions/error-recovery.md` | §2.2.1 分层职责 | L21-98 | [x] | ⏳ |
| 11.16-11.17 | `permissions/error-recovery.md` | §2.3-2.6 Skill/系统 | L100-404 | [x] | ⏳ |
| 11.18-11.19 | `permissions/error-recovery.md` | §2.7.1-2.7.3 恢复 | L406-530 | [x] | ⏳ |
| 11.20-11.21 | `permissions/error-recovery.md` | §2.7.3-2.7.4 修复/备份 | L571-657 | [x] | ⏳ |
| 11.22-11.23 | `permissions/error-codes.md` | §3.1 错误码格式 | L1-70 | [x] | ⏳ |
| 11.24-11.26 | `permissions/error-codes.md` | §3.2-3.4 错误码表 | L72-177 | [x] | [x] |
| 11.27 | `permissions/error-codes.md` | §4 最佳实践 | L179-206 | [x] | ⏳ |
| 11.28-11.29 | `permissions/error-codes.md` | §5 输入验证/安全 | L209-424 | [x] | [x] |
| 11.30 | `permissions/error-codes.md` | §6 未来优化 | L427-467 | [x] | ⏳ |

---

## Part 12: Testing & Docs

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 12.1 | US-001 端到端验证 | [x] | 核心流程：feat→specify→plan→implement |
| 12.2 | US-002 端到端验证 | [x] | 研发主导流程 |
| 12.3 | US-003 ADR 流程验证 | [x] | 架构变更识别 + ADR 创建 |
| 12.4 | US-004/005/006 验证 | [x] | 契约补充/业务知识/存量知识 |
| 12.5 | MCP Store 集成测试 | [x] | 完整 CRUD + Feat 生命周期 |
| 12.6 | MCP Query 集成测试 | [x] | 搜索 + 图查询测试 |
| 12.7 | Server 模式集成测试 | [x] | MongoDB + Neo4j + Milvus |
| 12.8 | 更新 ARCHITECTURE.md | [x] | 反映 v0.3.0 架构变更 |
| 12.9 | 更新 README.md | [x] | 快速开始指南 |
| 12.10 | 编写 CHANGELOG.md | [x] | v0.3.0 变更记录 |
| 12.11 | 文档化已知问题 | [x] | Server 一致性/Checklist 并发/权限死锁 |

**验证结果汇总（Agent C）**：
- US-001 需求迭代全流程：✅ feat→specify→plan→implement→publish 完整流程
- US-002 研发主导流程：✅ 跳过 specify，直接 plan→implement
- US-003 ADR 流程：✅ 架构变更识别 + ADR 创建 + 审批发布
- US-004 契约补充：✅ 契约定义与关联
- US-005 业务知识：✅ process 实体创建与语义搜索
- US-006 存量知识：✅ 批量创建 system/container/sor，语义搜索可用

**问题记录**：P1-P7 已记录于 `issue.md`。

**待改进项**：`c4a_query_deps` 在图关系未写入时会返回空；建议保存 Container/Component 时自动写入 `CONTAINS` 关系（System→Container→Component）。

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 12.1-12.4 | `user-stories.md` | 全文 | L1-END | [x] | [x] |
| 12.11 | `README.md` | 全文 | L1-END | [x] | [x] |

**执行规划文档：** [12-testing-docs.md](12-testing-docs.md)

---

## Part 13: Server 模式实现

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 13.1 | Docker Compose 配置 | [x] | MongoDB + Neo4j + Milvus 编排 |
| 13.2 | 服务健康检查 | [x] | 各服务启动检测和依赖等待 |
| 13.3 | MongoDB 适配器 | [x] | 实体 CRUD + 多文档事务 |
| 13.4 | Neo4j 适配器 | [x] | 图关系存储 + Cypher 查询 |
| 13.5 | Milvus 适配器 | [x] | 向量存储 + 相似度搜索 |
| 13.6 | 存储层抽象 (ServerAdapter) | [x] | 统一接口封装三库操作 |
| 13.7 | 三库写入顺序 | [x] | MongoDB→Neo4j→Milvus 顺序 |
| 13.8 | 同步状态追踪 | [x] | sync_status 字段管理 |
| 13.9 | 失败补偿机制 | [x] | /utils/repair 手动修复 |
| 13.10 | storage-backend 服务 | [x] | Python FastAPI HTTP 接口 |
| 13.11 | Remote 模式支持 | [x] | HTTP 客户端连接远程服务 |
| 13.12 | 连接池管理 | [x] | 各数据库连接池配置 |
| 13.13 | MCP 命名统一 | [x] | 仅保留 c4a_store_* / c4a_query_* |
| 13.14 | 目录结构迁移 | [x] | .c4a → .context |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 13.1-13.2 | `architecture.md` | §1.4 架构图 | L116-181 | [x] | [x] |
| 13.3 | `data-ops/cross-project-transaction.md` | §6.1 MongoDB 事务 | L70-150 | [x] | [x] |
| 13.4 | `data-ops/cross-project-transaction.md` | §6.2 Neo4j 同步 | L150-220 | [x] | [x] |
| 13.5 | `data-ops/cross-project-transaction.md` | §6.2 Milvus 同步 | L220-280 | [x] | [x] |
| 13.6 | `architecture.md` | §1.2 存储层可插拔 | L77-94 | [x] | [x] |
| 13.7-13.9 | `data-ops/cross-project-transaction.md` | §6.3 同步状态 | L280-360 | [x] | [x] |
| 13.10 | `architecture.md` | §1.5 MCP 架构 | L183-234 | [x] | [x] |
| 13.11 | `architecture.md` | §1.1 模式对比 | L16-76 | [x] | [x] |
| 13.12 | `mcp/store-feat-lifecycle.md` | §3.7.9 多库一致性 | L344-534 | [x] | [x] |

**实现产物：**

| 文件 | 说明 |
|------|------|
| `docker/docker-compose.server.yml` | Server 模式（含基础编排） |
| `packages/storage/src/server-adapter.ts` | ServerAdapter (TypeScript HTTP 客户端) |
| `packages/storage-backend/` | Python 存储后端服务 |
| `packages/storage-backend/src/main.py` | FastAPI 入口 |
| `packages/storage-backend/src/adapters/mongodb.py` | MongoDB 适配器 |
| `packages/storage-backend/src/adapters/neo4j.py` | Neo4j 适配器 |
| `packages/storage-backend/src/adapters/milvus.py` | Milvus 适配器 |

> **架构说明**：MCP Server 层统一使用 TypeScript，对用户透明。Server 模式下 ServerAdapter 通过 HTTP 调用 Python 后端（storage-backend），Python 封装 MongoDB/Neo4j/Milvus 访问。这样设计是因为 Bun/Node.js 对这三个数据库的驱动支持不如 Python 成熟稳定。

**补充（2026-01-31）**：已完成 Agent-0 前置准备（storage-backend 目录骨架、ServerAdapter HTTP 占位、docker-compose.server.yml）。

**补充（2026-02-01）**：已完成 Agent-1 ServerAdapter 核心实现（HTTP 客户端、CRUD/关系/搜索接口、单元与可选集成测试）。

**补充（2026-02-01）**：已完成 storage-backend Python 测试（pytest），并验证 Docker 启动后 /health 可达。

**补充（2026-02-01）**：已完成 Agent-4 模式切换与 CLI 完善（Local↔Server 迁移、权限/断点、server status 健康检查地址修正）。
**补充（2026-02-01）**：已完成 Agent-3 权限系统（storage-backend 权限模型/服务/中间件/依赖/权限路由 + 关系写入校验）。
**补充（2026-02-01）**：修复 Milvus collection 加载兼容性并增强向量命中解析，补充 search vector 单测。
**补充（2026-02-01）**：扩展 storage-backend 集成测试覆盖（graph/feat/utils/sync 等路由）。
**补充（2026-02-01）**：新增真实服务集成回归脚本（storage-backend）。
**补充（2026-02-01）**：补充权限/错误路径集成测试覆盖（read/relations/search/utils 恢复冲突）。
**补充（2026-02-01）**：完成 Agent-5 集成收尾（getAdapter 异步初始化、MCP Store 预热、Server 集成测试、docker-compose.server.yml 增补 MCP 服务、README Server 模式说明）。
**补充（2026-02-01）**：修复 Server 安装链路（补齐 Docker MCP 镜像依赖与根 tsconfig、修复 storage-backend 健康检查），验证 MongoDB/Neo4j/Milvus/Embedding 与 `c4a install server` 正常。
**补充（2026-02-01）**：内联 Server 模式配置（MCP 容器改用 `C4A_STORAGE_BACKEND_URL`，移除 `docker/c4a.server.yaml`），并统一使用 `docker-compose.server.yml`。
**补充（2026-02-01）**：Part 13 全部任务已完成，包括图查询降级（deps/impact 返回 degraded）、sync_status 字段、/utils/check-consistency 端点。

**详细计划：** [13-server-mode.md](13-server-mode.md)

---

## 统计

| Part | 任务数 | 设计文件数 |
|------|--------|-----------|
| 01 核心概念 | 34 | 5 |
| 02 架构 | 33 | 1 |
| 03 MCP Store | 23 | 5 |
| 03.5 架构清理 | 18 | 1 |
| 04 MCP Query | 6 | 1 |
| 05 MCP Extract | 8 | 1 |
| 06 Local 模式 | 33 | 5 |
| 07 数据操作 | 48 | 5 |
| 08 用户 CLI | 44 | 6 |
| 09 开发者 CLI | 16 | 1 |
| 10 Skills | 38 | 12 |
| 11 权限错误 | 30 | 3 |
| 12 用户故事+测试 | 43 | 6 |
| 13 Server 模式 | 12 | 4 |
| **总计** | **386** | **56** |

---

## 依赖关系图

### 核心架构：存储适配层

根据 architecture.md §1.2 设计，MCP 工具通过 **Storage Adapter Layer** 访问存储：

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

**核心原则**：MCP 工具对用户透明，底层存储切换不影响用户体验。

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

### P0 - Core Loop（Local 模式优先）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           P0 - Core Loop                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  01 Core ──► 02 Arch ──► 03.5 Cleanup ──► 06 Local ──► 03 Store        │
│     │                        │                │            │            │
│     │                   (包结构重组)      (含 Adapter)      │            │
│     │                        │                │            ▼            │
│     │                        │                │        04 Query         │
│     │                        │                │            │            │
│     │                        │                ▼            ▼            │
│     │                        │            05 Extract ◄────┘            │
│     │                        │                │                         │
│     ▼                        ▼                ▼                         │
│  08 User CLI ◄────────── 07 Data Ops ◄── 10 Skills                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### P1 - Server & Advanced

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        P1 - Server & Advanced                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  13 Server Mode ──► 03 Store (ServerAdapter) ──► 07 Data Ops           │
│        │                    │                                           │
│        ▼                    ▼                                           │
│  11 Perms ◄──────── 08 User CLI (Server Commands)                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### P2 - Polish & Release

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         P2 - Polish & Release                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  09 Dev CLI ──► 12 Testing & Docs                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Part 06 关键产物

Part 06 不仅实现 SQLite 存储，还需要提供 **StorageAdapter 接口**：

| 产物 | 说明 | 被依赖 |
|------|------|--------|
| `StorageAdapter` 接口 | 定义 save/read/list/delete/sync 等抽象方法 | Part 03, 04 |
| `LiteAdapter` | 调用 SQLiteStore 实现接口 | Part 03 (Local 模式) |
| `getAdapter()` | 根据 mode 配置返回对应 Adapter | Part 03, 04 |
| `SQLiteStore` | SQLite 底层存储实现 | LiteAdapter |

---

## 时间规划

**总计**: 约 8-9 周

| 阶段 | 周期 | 重点任务 | Parts |
|------|------|----------|-------|
| **Phase 1: Foundation** | Week 1-2 | 核心类型、架构、Local 存储 | 01, 02, 06 |
| **Phase 2: Core MCP** | Week 3-4 | Store/Query/Code 工具、Feat 逻辑 | 03, 04, 05, 07 |
| **Phase 3: CLI & Skills** | Week 5 | 用户 CLI、核心 Skills | 08, 10 |
| **Phase 4: Server Mode** | Week 6-7 | Server 后端、数据同步、权限 | 13, 11 |
| **Phase 5: Polish** | Week 8-9 | 开发者 CLI、测试、文档 | 09, 12 |

---

## 优先级建议

**P0 (必须 - Core Loop)**：
- Part 01: 核心概念（TypeScript 类型 + JSON Schema）
- Part 02: 架构（目录结构 + 配置）
- Part 06: Local 模式（SQLite 全套）
- Part 03: MCP Store（CRUD + Sync + Feat）
- Part 04: MCP Query
- Part 05: MCP Code
- Part 08: 用户 CLI（init/sync/feat）
- Part 10: Skills（/c4a:feat/specify/plan）

**P1 (重要 - Server & Advanced)**：
- Part 13: Server 模式（Docker + 三库适配）
- Part 07: 数据操作（Server Sync）
- Part 11: 权限错误

**P2 (可选 - Polish)**：
- Part 09: 开发者 CLI
- Part 12: 用户故事+测试+文档

---

## 延后到未来版本的任务

以下任务不在 v0.3.0 实现，延后到未来版本：

### Part 11 权限与错误处理（精简为 Part 11 Lite）

| 原任务编号 | 任务 | 延后原因 |
|-----------|------|---------|
| 11.1-11.5 | 权限模式差异处理 | 需要 Server 模式 |
| 11.6-11.12 | 权限检查器 + 配置 + 审计 | 需要完整权限系统 |
| 11.13-11.21 | 错误响应格式化 | errors.ts 已有完整实现 |
| 11.22-11.27 | 错误码规范 | errors.ts 已有完整实现 |

**本版本实现（Part 11 Lite）**：
- Gateway 错误码扩展（在现有 errors.ts 中添加 SYS-006~009）
- 安全工具（utils/security.ts：路径校验、DSL 注入防护）

> **设计原则**：不创建新目录，复用现有 `types/` 和 `utils/` 结构；不重复造轮子，`errors.ts` 已有完整错误处理基础设施。

### Part 06 Local 模式

| 原任务编号 | 任务 | 延后原因 |
|-----------|------|---------|
| 6.20 | Local→Server 切换 | 依赖 Server API |
| 6.21 | Server→Local 切换 | 依赖 Server 备份 |
| 6.24 | 性能基准测试 | 非核心功能 |

### Part 08 用户 CLI

| 原任务编号 | 任务 | 延后原因 |
|-----------|------|---------|
| 8.13 | c4a rollback | 紧急回滚命令，计划 v0.4.0 |

---

## Release Checklist

- **补充（2026-01-28）**：修复配置加载异常处理、getAdapter 配置变更失效与 Checklist 解析/并发冲突保护，并补齐对应测试。

- [x] 单机模式 (Local Mode) 完整闭环，无 Docker 依赖
- [x] 核心 Skills (/c4a:feat/specify/plan) 可流畅运行
- [x] 数据同步 (Sync) 在 Local 模式下准确无误
- [x] 单元测试覆盖核心逻辑 (CoW, Graph)
- [x] Server 模式 Docker Compose 一键启动
- [x] 权限控制在 Server 模式下正常工作
- [x] 迁移指南完整且可执行

---

## 执行说明

1. **阅读设计**：逐个阅读"相关设计文档"表格中的文件，勾选"已读"
2. **实现功能**：完成实现后勾选"已实现"
3. **标记完成**：功能表格中"已读"+"已实现"都完成后，勾选"完成"
4. **持续更新**：实施过程中随时更新本文档

### 验证规则（防止遗漏）

**每个 Part 完成后，必须验证：**

1. **类型完整性**：设计文档中定义的所有类型是否都有对应的 TypeScript 类型？
2. **Schema 完整性**：所有实体类型是否都有对应的 JSON Schema 文件？
3. **验证器注册**：新增的 Schema 是否已在 `ajvInstance.ts` 中注册？
4. **类型映射更新**：`validator/index.ts` 的 DSLType 和 typeMap 是否包含新类型？
5. **工具函数映射**：`utils/schema.ts` 的 SCHEMA_MAP 是否包含新类型？
6. **导出完整性**：所有新增类型是否已在 `index.ts` 中导出？

**验证方法：**
```bash
# 类型检查
bun run typecheck

# 单元测试
bun run test

# 构建验证
bun run build
```

**详细验证规则见：** [implement.md](implement.md) §2.1 实现验证规则
