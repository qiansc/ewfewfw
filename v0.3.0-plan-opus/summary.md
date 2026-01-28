# C4A v0.3.0 实施计划

> 基于 v0.3.0/ 设计文档，按章节精确定位

---

## 迁移说明 (2024-01-28)

**代码结构调整**：已删除 `packages/mcp-dsl`，代码迁移到正确位置：

| 原位置 | 新位置 | 说明 |
|--------|--------|------|
| `mcp-dsl/src/store/*` | `packages/core/src/store/` | StorageAdapter + SQLiteStore + LiteAdapter |
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

---

## Part 02: 三模式架构

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 2.1 | 三模式对比 | [x] | Local/Server/Remote 特性对比 |
| 2.2 | Code MCP 本地运行 | [x] | c4a_code_* 必须 stdio 本地 |
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
| 2.22 | 清理 legacy 配置路径 | [ ] | 移除 .c4a.yaml / .c4a.yml 兼容 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 2.1-2.2 | `architecture.md` | §1.1 模式对比 | L16-72 | [x] | [x] |
| 2.3 | `architecture.md` | §1.2 存储层可插拔 | L73-91 | [x] | [x] |
| 2.4 | `architecture.md` | §1.3 知识生命周期 | L92-111 | [x] | [x] |
| 2.5 | `architecture.md` | §1.4 架构图 | L112-178 | [x] | [x] |
| 2.6 | `architecture.md` | §1.5 Skills/Commands | L179-231 | [x] | [x] |
| 2.7 | `architecture.md` | §2.1 存储位置 | L234-250 | [x] | [x] |
| 2.8 | `architecture.md` | §2.2 工作目录结构 | L251-333 | [x] | [x] |
| 2.9 | `architecture.md` | §2.3 项目配置 | L334-353 | [x] | [x] |
| 2.10 | `architecture.md` | §2.4 ID 命名规范 | L354-434 | [x] | [x] |
| 2.11 | `architecture.md` | §2.5 文件命名规则 | L435-495 | [x] | [x] |
| 2.12 | `architecture.md` | §2.5 checklist 处理 | L472-495 | [x] | [x] |
| 2.13 | `architecture.md` | §2.7 Schema 校验 | L543-615 | [x] | [x] |
| 2.14 | `architecture.md` | §2.8 子 .context | L616-628 | [x] | [x] |
| 2.15-2.17 | `architecture.md` | §3 数据模型 | L629-684 | [x] | [x] |
| 2.18 | `architecture.md` | §3.4.1 跨层级引用 | L700-731 | [x] | [x] |
| 2.19 | `architecture.md` | §7 feat 机制 | L965-1078 | [x] | [x] |
| 2.20 | `architecture.md` | §7.5 合并策略 | L1083-1091 | [x] | [x] |
| 2.21 | `architecture.md` | §7.7 跨项目 feat | L1098-1107 | [x] | [x] |

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
| 3.18 | 并发修改预警 | [ ] | 多 feat 修改同一实体 |
| 3.19 | 引用完整性预警 | [ ] | 删除实体时检测依赖 |
| 3.20 | c4a_store_read_history | [ ] | 变更历史查询 |
| 3.21 | c4a_store_backup/restore | [ ] | 备份恢复 |
| 3.22 | c4a_store_repair | [ ] | 数据一致性修复 |
| 3.23 | c4a_store_validate | [ ] | 架构一致性检查 |
| 3.24 | 移除 legacy MCP 接口 | [ ] | 删除 c4a_db_* 旧接口与别名 |

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
| 3.18 | `mcp/store-feat-checklist.md` | §3.10 并发预警 | L572-658 | [ ] | [ ] |
| 3.19 | `mcp/store-feat-checklist.md` | §3.11 引用预警 | L660-707 | [ ] | [ ] |
| 3.20 | `mcp/store-utils.md` | §3.11 read_history | L1-46 | [ ] | [ ] |
| 3.21 | `mcp/store-utils.md` | §3.13-3.14 backup/restore | L65-153 | [ ] | [ ] |
| 3.22 | `mcp/store-utils.md` | §3.15 repair | L155-205 | [ ] | [ ] |
| 3.23 | `mcp/store-utils.md` | §3.16 validate | L208-373 | [ ] | [ ] |

---

## Part 04: MCP Query 工具

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 4.1 | c4a_query_search | [ ] | 语义搜索 |
| 4.2 | c4a_query_deps | [ ] | 依赖查询 |
| 4.3 | c4a_query_impact | [ ] | 影响分析 |
| 4.4 | 查询一致性检测 | [ ] | 不一致状态检测 |
| 4.5 | 降级行为 | [ ] | Neo4j/Milvus 不可用时 |
| 4.6 | Local Mode 查询策略 | [ ] | SQLite + InMemoryGraph |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 4.1 | `mcp/query.md` | §4.1 search | L1-16 | [ ] | [ ] |
| 4.2 | `mcp/query.md` | §4.2 deps | L18-21 | [ ] | [ ] |
| 4.3 | `mcp/query.md` | §4.3 impact | L23-26 | [ ] | [ ] |
| 4.4-4.5 | `mcp/query.md` | §4.4 一致性/降级 | L30-111 | [ ] | [ ] |
| 4.6 | `mcp/query.md` | §4.5 Local Mode | L113-180 | [ ] | [ ] |

---

## Part 05: MCP Code 工具

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 5.1 | c4a_code_extract | [ ] | 提取接口/类型/类 |
| 5.2 | c4a_code_analyze | [ ] | 代码结构 + 依赖分析 |
| 5.3 | c4a_code_ast | [ ] | 获取 AST |
| 5.4 | c4a_code_contract | [ ] | 生成 API 契约 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 5.1 | `mcp/code.md` | §2.1 extract | L1-15 | [ ] | [ ] |
| 5.2 | `mcp/code.md` | §2.2 analyze | L17-32 | [ ] | [ ] |
| 5.3 | `mcp/code.md` | §2.3 ast | L34-45 | [ ] | [ ] |
| 5.4 | `mcp/code.md` | §2.4 contract | L47-61 | [ ] | [ ] |

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
| 6.8 | vectors 表 | [x] | sqlite-vec 向量索引 |
| 6.9 | graph_cache 表 | [x] | 图查询缓存 |
| 6.10 | Merge View 模式 | [x] | Feat 优先 + 主分支兜底 |
| 6.11 | Embedding 生成 | [ ] | @xenova/transformers |
| 6.12 | 向量搜索实现 | [ ] | Feat 版本隔离 |
| 6.13 | 写队列设计 | [x] | WriteQueue + 背压控制 |
| 6.14 | 单例连接管理 | [x] | SQLiteStore 单例 |
| 6.15 | 向量索引维护 | [ ] | 增量更新 + 批量重建 |
| 6.16 | InMemoryGraph 构建 | [x] | 邻接表 + RWLock |
| 6.17 | 图增量更新 | [x] | 实体变更时增量更新 |
| 6.18 | GraphQueryCache | [x] | 两层缓存 + 反向索引 |
| 6.19 | 模式配置 | [x] | .c4a.yaml mode 设置 |
| 6.20 | Local→Server 切换 | [ ] | 备份 + 导出 + 冲突 (挂起) |
| 6.21 | Server→Local 切换 | [ ] | 导入 + 向量重建 (挂起) |
| 6.22 | 数据兼容性 | [ ] | 格式一致性保证 |
| 6.23 | 导出/导入格式 | [ ] | JSON 格式规范 |
| 6.24 | 性能基准测试 | [ ] | 测试环境 + 指标 (挂起) |
| 6.25 | 实现建议 | [x] | 依赖 + 初始化 + 错误处理 |
| 6.26 | 已知限制 | [ ] | 限制说明 + 最佳实践 |
| 6.27 | 未来优化 | [ ] | 短期/长期优化路线 |
| 6.28 | FAQ: sqlite-vec 降级 | [ ] | 无扩展时降级策略 |
| 6.29 | FAQ: 模式选择指南 | [ ] | Local vs Server 选择 |
| 6.30 | 数据完整性检查 | [ ] | validate 命令 |
| 6.31 | 数据修复命令 | [ ] | repair 命令 |
| 6.32 | 错误码定义 | [ ] | C4A-MIGRATE-001~008 |
| 6.33 | 数据示例 | [ ] | Domain/Enterprise/Project |

**进度**: 17/33 已完成，3 挂起 (依赖 Part 13)

**P0 待修复**:
- P0-Fix1: crud-operations.ts 未调用 converter.ts
- P0-Fix2: parseRelations 不符合 DSL Schema

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 6.1-6.10 | `detailed-design/local-mode/sqlite-schema.md` | 全文 | L1-370 | [x] | [x] |
| 6.11-6.15 | `detailed-design/local-mode/vector-search.md` | 全文 | L1-598 | [x] | 🔶 |
| 6.16-6.18 | `detailed-design/local-mode/graph-query.md` | 全文 | L1-308 | [x] | [x] |
| 6.19-6.27 | `detailed-design/local-mode/mode-switch.md` | 全文 | L1-454 | [x] | 🔶 |
| 6.28-6.33 | `detailed-design/local-mode/appendix.md` | 全文 | L1-628 | [x] | 🔶 |

---

## Part 07: 数据操作

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 7.1 | 实体唯一性设计 | [ ] | 逻辑/物理唯一键 |
| 7.2 | 引用格式规范 | [ ] | 简单ID/跨项目/跨仓库/scope |
| 7.3 | 引用解析优先级 | [ ] | 本项目→基建→其他→Enterprise→Domain |
| 7.4 | 悬空引用处理 | [ ] | 状态感知 + 自动解析 |
| 7.5 | CoW 机制实现 | [ ] | 数据库设计 + 工作流 |
| 7.6 | Checklist 处理 | [ ] | DB-only + 渲染 |
| 7.7 | 实体变更历史 | [ ] | entity_history 表 |
| 7.8 | 冲突检测算法 | [ ] | content_hash + 两阶段 |
| 7.9 | conflict_policy | [ ] | skip/warn/override/prompt |
| 7.10 | Feat 合并策略 | [ ] | 自动合并 + 模型决策 |
| 7.11 | 回滚机制 | [ ] | 创建回滚 Feat |
| 7.12 | 跨项目 Feat | [ ] | 中心化数据库架构 |
| 7.13 | 跨库事务补偿 | [ ] | MongoDB→Neo4j→Milvus |
| 7.14 | Feat 发布事务 | [ ] | MongoDB 多文档事务 |
| 7.15 | workflow_steps 字段 | [ ] | 断点续传支持 |
| 7.16 | 恢复流程实现 | [ ] | 检测 + 选项 + 执行 |
| 7.17 | 步骤幂等性 | [ ] | checkStepCompletion |
| 7.18 | 实体清理机制 | [ ] | cleanup Feat |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 7.1-7.4 | `data-ops/cross-reference.md` | §1.1-1.11 | L1-340 | [ ] | [ ] |
| 7.5 | `data-ops/cross-reference.md` | §1.12 CoW | L340-700 | [ ] | [ ] |
| 7.6 | `data-ops/cross-reference.md` | §1.12.7 Checklist | L700-820 | [ ] | [ ] |
| 7.7 | `data-ops/cross-reference.md` | §1.13 历史 | L820-END | [ ] | [ ] |
| 7.8-7.9 | `data-ops/sync-export.md` | §2.3-2.4 | L30-190 | [ ] | [ ] |
| 7.10-7.11 | `data-ops/conflict-rollback.md` | §3-4 | L1-240 | [ ] | [ ] |
| 7.12 | `data-ops/cross-project-transaction.md` | §5 跨项目 | L1-70 | [ ] | [ ] |
| 7.13-7.14 | `data-ops/cross-project-transaction.md` | §6 事务 | L70-360 | [ ] | [ ] |
| 7.15-7.18 | `data-ops/workflow-recovery.md` | 全文 | L1-END | [ ] | [ ] |

---

## Part 08: 用户 CLI

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 8.1 | CLI 架构设计 | [ ] | User CLI vs Dev CLI |
| 8.2 | 首次运行引导 | [ ] | 模式选择 (local/server/remote/skip) |
| 8.3 | 动态菜单显示 | [ ] | 根据模式显示不同菜单项 |
| 8.4 | c4a init | [ ] | 项目初始化 |
| 8.5 | c4a status | [ ] | 查看项目状态 |
| 8.6 | c4a install | [ ] | Local/Server 模式安装 |
| 8.7 | c4a sync | [ ] | 双向同步 |
| 8.8 | c4a validate | [ ] | 离线 DSL 验证 |
| 8.9 | c4a feat render | [ ] | Checklist 渲染 |
| 8.10 | c4a template/schema | [ ] | 模板/Schema 生成 |
| 8.11 | c4a server 子菜单 | [ ] | backup/restore/status |
| 8.12 | c4a local 子菜单 | [ ] | backup/restore/repair |
| 8.13 | c4a rollback (v0.4.0) | [ ] | 紧急回滚命令 |
| 8.14 | 多模式支持 | [ ] | 同时安装 Local/Server |
| 8.15 | 全局/项目配置 | [ ] | ~/.c4a/config.yaml + .c4a.yaml |
| 8.16 | Remote 模式设计 | [ ] | 选择流程 + 命令可用性 |
| 8.17 | CLI-MCP 映射 | [ ] | 命令到工具映射 |
| 8.18 | sync 实现细节 | [ ] | Local/Server/Remote 差异 |
| 8.19 | 冲突检测算法 | [ ] | 哈希 + 时间戳 |
| 8.20 | Commands vs Skills | [ ] | 职责划分 |
| 8.21 | CLI 目录迁移 | [ ] | packages/cli 新结构 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 8.1 | `cli/overview.md` | 全文 | L1-32 | [ ] | [ ] |
| 8.2-8.16 | `cli/user-cli.md` | 全文 | L1-1739 | [ ] | [ ] |
| 8.17-8.19 | `cli/mcp-mapping.md` | 全文 | L1-760 | [ ] | [ ] |
| 8.20 | `cli/commands-vs-skills.md` | 全文 | L1-80 | [ ] | [ ] |
| 8.21 | `cli/structure-migration.md` | 全文 | L1-172 | [ ] | [ ] |

---

## Part 09: 开发者 CLI

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 9.1 | start.sh dev | [ ] | 本地开发模式 |
| 9.2 | start.sh docker | [ ] | 全容器化 |
| 9.3 | start.sh debug | [ ] | MCP 服务调试 |
| 9.4 | start.sh build | [ ] | 编译用户 CLI |
| 9.5 | 延迟依赖检查 | [ ] | 按需验证依赖 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 9.1-9.5 | `cli/dev-cli.md` | 全文 | L1-END | [ ] | [ ] |

---

## Part 10: Skills 体系

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 10.1 | Skills 设计原则 | [ ] | 完整流程/路由/禁止直接MCP |
| 10.2 | Skills 触发方式 | [ ] | 显式命令/自然语言/意图识别 |
| 10.3 | Skills 架构概述 | [ ] | 7公开+1内部 Skill 定义 |
| 10.4 | /c4a:feat | [ ] | Feature 全生命周期 |
| 10.5 | /c4a:specify | [ ] | 功能规格定义 |
| 10.6 | /c4a:plan | [ ] | 技术方案+契约+清单 |
| 10.7 | /c4a:analyze | [ ] | 一致性检查 |
| 10.8 | /c4a:implement | [ ] | 实现代码+清单跟踪 |
| 10.9 | /c4a:know:learn | [ ] | 快速知识录入 |
| 10.10 | /c4a:know:search | [ ] | 语义搜索 |
| 10.11 | /c4a:model (内部) | [ ] | DSL 生成规则+提示词内联 |
| 10.12 | 三种场景流程 | [ ] | 需求/架构变更/纯知识 |
| 10.13 | 建模阶段规则 | [ ] | 实体识别/层级判断/关系推断 |
| 10.14 | ADR 关联逻辑 | [ ] | 架构变更定义+检测时机 |
| 10.15 | ADR 检测性能优化 | [ ] | 按依赖范围检查+延迟检查 |
| 10.16 | ADR 检测实现 | [ ] | /c4a:plan 和 /c4a:analyze 中检测 |
| 10.17 | ADR 模板 | [ ] | 架构变更 ADR 模板 |
| 10.18 | ADR 实现要点 | [ ] | 变更对比/关联/警告级别/完整性检查 |
| 10.19 | Checklist 格式 | [ ] | YAML 结构规范+字段定义 |
| 10.20 | Checklist 存储 | [ ] | 数据库存储+本地只读视图 |
| 10.21 | Skill 文件结构 | [ ] | 目录/路由表/状态拆分 |
| 10.22 | Skill 执行规则 | [ ] | 路由匹配+状态流转 |
| 10.23 | 错误处理规范 | [ ] | recoverable_actions |
| 10.24 | Feat 上下文注入 | [ ] | proposal_id 必传 |
| 10.25 | 系统集成 | [ ] | 与现有系统集成+实现阶段 |
| 10.26 | 悬空引用定义 | [ ] | 状态感知+合并视图查询 |
| 10.27 | 悬空引用检测 | [ ] | 精确匹配+类型推断 |
| 10.28 | 悬空引用可视化 | [ ] | 图表样式+CLI 报告 |
| 10.29 | Diff 视图优化 | [ ] | 冲突对比+智能分析 |
| 10.30 | 未来 Skills 规划 | [ ] | v0.4.0+ 规划 |

**详细计划：** [10-skills.md](10-skills.md)

---

## Part 11: 权限与错误处理

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 11.1 | 模式差异处理 | [ ] | Local跳过鉴权/Server严格 |
| 11.2 | Local 数据完整性 | [ ] | source_project 必填+自动填充 |
| 11.3 | Server/Remote 权限 | [ ] | 用户上下文+权限存储 |
| 11.4 | Local→Server 迁移 | [ ] | 权限校验/元数据补全 |
| 11.5 | 权限元数据映射 | [ ] | owner/created_by 补全 |
| 11.6 | 权限模型 | [ ] | Admin/Writer/Reader |
| 11.7 | 权限变更处理 | [ ] | 创建/发布时权限变化 |
| 11.8 | 创建时权限检查 | [ ] | source_project 立即检查 |
| 11.9 | 修改/发布权限检查 | [ ] | 实体修改+feat发布 |
| 11.10 | 跨项目发布权限 | [ ] | 需所有项目 Admin |
| 11.11 | 权限配置 | [ ] | 配置文件+继承规则 |
| 11.12 | 权限实现建议 | [ ] | MCP层+外部系统+审计 |
| 11.13 | 错误分类 | [ ] | INPUT/DATA/SYS/BIZ/PERM |
| 11.14 | 错误处理原则 | [ ] | 明确原因+修复建议 |
| 11.15 | 分层错误处理 | [ ] | MCP返回/CLI呈现/Agent |
| 11.16 | Skill 错误处理 | [ ] | implement/analyze/publish |
| 11.17 | 系统错误处理 | [ ] | DB连接/MCP超时 |
| 11.18 | 恢复机制 | [ ] | 操作日志/回滚支持 |
| 11.19 | 归档检查 | [ ] | 最小保留期/无引用 |
| 11.20 | Server 数据修复 | [ ] | c4a_store_repair |
| 11.21 | 数据备份 | [ ] | 自动备份配置 |
| 11.22 | 错误码格式 | [ ] | C4A-{类别}-{编号} |
| 11.23 | 错误码使用指南 | [ ] | Agent 按类别处理 |
| 11.24 | 完整错误码表 | [ ] | 7 类错误码映射 |
| 11.25 | 错误响应格式 | [ ] | code/message/details |
| 11.26 | 多语言错误消息 | [ ] | Accept-Language |
| 11.27 | 最佳实践 | [ ] | 错误/权限/恢复 |
| 11.28 | DSL 注入防护 | [ ] | 输入验证/输出转义 |
| 11.29 | 路径安全校验 | [ ] | Path Traversal+TOCTOU |
| 11.30 | 未来优化方向 | [ ] | 短期/长期路线 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 11.1-11.2 | `permissions/cross-project-auth.md` | §1.1.1 Local | L12-137 | [ ] | [ ] |
| 11.3 | `permissions/cross-project-auth.md` | §1.1.2 Server/Remote | L139-166 | [ ] | [ ] |
| 11.4-11.5 | `permissions/cross-project-auth.md` | §1.1.3 迁移 | L168-348 | [ ] | [ ] |
| 11.6-11.7 | `permissions/cross-project-auth.md` | §1.2-1.3 权限模型 | L350-402 | [ ] | [ ] |
| 11.8-11.10 | `permissions/cross-project-auth.md` | §1.4 权限检查 | L404-671 | [ ] | [ ] |
| 11.11-11.12 | `permissions/cross-project-auth.md` | §1.5-1.7 配置/实现 | L673-828 | [ ] | [ ] |
| 11.13-11.14 | `permissions/error-recovery.md` | §2.1-2.2 错误分类 | L1-19 | [ ] | [ ] |
| 11.15 | `permissions/error-recovery.md` | §2.2.1 分层职责 | L21-98 | [ ] | [ ] |
| 11.16-11.17 | `permissions/error-recovery.md` | §2.3-2.6 Skill/系统 | L100-404 | [ ] | [ ] |
| 11.18-11.19 | `permissions/error-recovery.md` | §2.7.1-2.7.3 恢复 | L406-530 | [ ] | [ ] |
| 11.20-11.21 | `permissions/error-recovery.md` | §2.7.3-2.7.4 修复/备份 | L571-657 | [ ] | [ ] |
| 11.22-11.23 | `permissions/error-codes.md` | §3.1 错误码格式 | L1-70 | [ ] | [ ] |
| 11.24-11.26 | `permissions/error-codes.md` | §3.2-3.4 错误码表 | L72-177 | [ ] | [ ] |
| 11.27 | `permissions/error-codes.md` | §4 最佳实践 | L179-206 | [ ] | [ ] |
| 11.28-11.29 | `permissions/error-codes.md` | §5 输入验证/安全 | L209-424 | [ ] | [ ] |
| 11.30 | `permissions/error-codes.md` | §6 未来优化 | L427-467 | [ ] | [ ] |

---

## Part 12: 用户故事与规划

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 12.1 | 产品愿景 KDD | [ ] | 知识驱动开发 |
| 12.2 | 6 个用户故事 | [ ] | 核心场景验证 |
| 12.3 | 已知问题处理 | [ ] | Server 一致性/权限死锁等 |
| 12.4 | 可视化工具(保留) | [ ] | v0.3.0 不实现 |
| 12.5 | 未来 Skills | [ ] | rollback/prune 计划 |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 12.1 | `product.md` | 全文 | L1-END | [ ] | [ ] |
| 12.2 | `user-stories.md` | 全文 | L1-END | [ ] | [ ] |
| 12.3 | `ISSUES.md` | 全文 | L1-END | [ ] | [ ] |
| 12.4 | `mcp/visual.md` | 全文 | L1-END | [ ] | [ ] |
| 12.5 | `skills/future-skills.md` | 全文 | L1-END | [ ] | [ ] |

---

## Part 13: Server 模式实现

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 13.1 | Docker Compose 配置 | [ ] | MongoDB + Neo4j + Milvus 编排 |
| 13.2 | 服务健康检查 | [ ] | 各服务启动检测和依赖等待 |
| 13.3 | MongoDB 适配器 | [ ] | 实体 CRUD + 多文档事务 |
| 13.4 | Neo4j 适配器 | [ ] | 图关系存储 + Cypher 查询 |
| 13.5 | Milvus 适配器 | [ ] | 向量存储 + 相似度搜索 |
| 13.6 | 存储层抽象 (ServerStore) | [ ] | 统一接口封装三库操作 |
| 13.7 | 三库写入顺序 | [ ] | MongoDB→Neo4j→Milvus 顺序 |
| 13.8 | 同步状态追踪 | [ ] | sync_status 字段管理 |
| 13.9 | 失败补偿机制 | [ ] | 后台重试 + 手动修复 |
| 13.10 | MCP Data 服务 | [ ] | Python FastMCP HTTP 接口 |
| 13.11 | Remote 模式支持 | [ ] | HTTP 客户端连接远程服务 |
| 13.12 | 连接池管理 | [ ] | 各数据库连接池配置 |
| 13.13 | MCP 命名统一 | [ ] | 仅保留 c4a_store_* / c4a_query_* |
| 13.14 | 目录结构迁移 | [ ] | .c4a → .context |

**相关设计文档：**

| 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|------|------|------|------|:----:|:------:|
| 13.1-13.2 | `architecture.md` | §1.4 架构图 | L112-178 | [ ] | [ ] |
| 13.3 | `data-ops/cross-project-transaction.md` | §6.1 MongoDB 事务 | L70-150 | [ ] | [ ] |
| 13.4 | `data-ops/cross-project-transaction.md` | §6.2 Neo4j 同步 | L150-220 | [ ] | [ ] |
| 13.5 | `data-ops/cross-project-transaction.md` | §6.2 Milvus 同步 | L220-280 | [ ] | [ ] |
| 13.6 | `architecture.md` | §1.2 存储层可插拔 | L73-91 | [ ] | [ ] |
| 13.7-13.9 | `data-ops/cross-project-transaction.md` | §6.3 同步状态 | L280-360 | [ ] | [ ] |
| 13.10 | `architecture.md` | §1.5 MCP 架构 | L179-231 | [ ] | [ ] |
| 13.11 | `architecture.md` | §1.1 模式对比 | L16-72 | [ ] | [ ] |
| 13.12 | `mcp/store-feat-lifecycle.md` | §3.7.9 多库一致性 | L344-534 | [ ] | [ ] |

**实现产物：**

| 文件 | 说明 |
|------|------|
| `docker/docker-compose.yml` | 基础编排 |
| `docker/docker-compose.server.yml` | Server 模式 |
| `packages/mcp-data/src/store/mongo_store.py` | MongoDB 操作 |
| `packages/mcp-data/src/store/neo4j_store.py` | Neo4j 操作 |
| `packages/mcp-data/src/store/milvus_store.py` | Milvus 操作 |
| `packages/mcp-data/src/store/server_store.py` | 统一接口 |
| `packages/mcp-data/src/server.py` | FastMCP 入口 |

**详细计划：** [13-server-mode.md](13-server-mode.md)

---

## 统计

| Part | 任务数 | 设计文件数 |
|------|--------|-----------|
| 01 核心概念 | 34 | 5 |
| 02 架构 | 33 | 1 |
| 03 MCP Store | 23 | 5 |
| 04 MCP Query | 6 | 1 |
| 05 MCP Code | 4 | 1 |
| 06 Local 模式 | 33 | 5 |
| 07 数据操作 | 48 | 5 |
| 08 用户 CLI | 44 | 6 |
| 09 开发者 CLI | 16 | 1 |
| 10 Skills | 18 | 8 |
| 11 权限错误 | 30 | 3 |
| 12 用户故事+测试 | 43 | 6 |
| 13 Server 模式 | 12 | 4 |
| **总计** | **344** | **50** |

---

## 依赖关系图

### 核心架构：存储适配层

根据 architecture.md §1.2 设计，MCP 工具通过 **Storage Adapter Layer** 访问存储：

```
MCP Tools (c4a_store_*, c4a_query_*)
              │
              ▼
    ┌─────────────────────┐
    │  StorageAdapter     │  ← 统一接口（Part 06 定义）
    │  (抽象层)            │
    └─────────┬───────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌─────────┐      ┌─────────┐
│  Lite   │      │ Server  │
│ Adapter │      │ Adapter │
│  (TS)   │      │(Python) │
└────┬────┘      └────┬────┘
     │                │
     ▼                ▼
  SQLite         MongoDB/Neo4j/Milvus
```

### P0 - Core Loop（Local 模式优先）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           P0 - Core Loop                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  01 Core ──► 02 Arch ──► 06 Local ──► 03 Store ──► 04 Query            │
│     │                        │            │           │                 │
│     │                   (含 Adapter)      │           │                 │
│     │                        │            ▼           │                 │
│     │                        │        05 Code        │                 │
│     │                        │            │           │                 │
│     ▼                        ▼            ▼           ▼                 │
│  08 User CLI ◄────────── 07 Data Ops ◄── 10 Skills ◄─┘                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

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

## Release Checklist

- [ ] 单机模式 (Local Mode) 完整闭环，无 Docker 依赖
- [ ] 核心 Skills (/c4a:feat/specify/plan) 可流畅运行
- [ ] 数据同步 (Sync) 在 Local 模式下准确无误
- [ ] 单元测试覆盖核心逻辑 (CoW, Graph)
- [ ] Server 模式 Docker Compose 一键启动
- [ ] 权限控制在 Server 模式下正常工作
- [ ] 迁移指南完整且可执行

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
pnpm typecheck

# 单元测试
pnpm test

# 构建验证
pnpm build
```

**详细验证规则见：** [implement.md](implement.md) §2.1 实现验证规则
