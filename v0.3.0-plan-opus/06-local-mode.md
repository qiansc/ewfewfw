# Part 06: Local 模式实现

> 详细执行计划 - 基于 `v0.3.0/detailed-design/local-mode/*.md`

---

## 关联文件索引

### 设计文档 (v0.3.0/)

| 文件 | 说明 | 关键章节 |
|------|------|---------|
| `architecture.md` | 三模式架构设计 | §1.2 存储层可插拔, §4 Local 模式技术栈 |
| `detailed-design/local-mode.md` | Local 模式入口 | 文档结构索引 |
| `detailed-design/local-mode/sqlite-schema.md` | SQLite 表结构 | §1 概述, §2 表结构, §3 Merge View |
| `detailed-design/local-mode/vector-search.md` | 向量搜索实现 | §3.1 Embedding, §3.2 搜索, §3.3 并发 |
| `detailed-design/local-mode/graph-query.md` | 图查询实现 | §4.1 内存图, §4.2 缓存 |
| `detailed-design/local-mode/mode-switch.md` | 模式切换 | §5 切换流程, §6 性能基准 |
| `detailed-design/local-mode/appendix.md` | 附录 | FAQ, 数据完整性, 数据示例 |
| `detailed-design/mcp-tools.md` | MCP 工具定义 | c4a_store_*, c4a_query_* |
| `detailed-design/data-operations.md` | 数据操作 | 跨项目引用, 冲突处理 |

### 现有实现代码 (packages/core/src/)

| 文件 | 说明 | 行数 | 状态 | 备注 |
|------|------|------|:----:|------|
| `store/adapter.ts` | StorageAdapter 接口 + 类型定义 | ~1136 | ✅ | 完整 |
| `store/sqlite-store.ts` | SQLite 底层存储 | ~577 | ✅ | 完整 |
| `store/lite-adapter.ts` | LiteAdapter 主入口 | - | ✅ | 完整 |
| `store/lite-adapter/crud-save.ts` | save | ~416 | ✅ | 已拆分并修复 P0-Fix |
| `store/lite-adapter/crud-read.ts` | read/list/delete | ~533 | ✅ | 已拆分并修复 P0-Fix |
| `store/lite-adapter/relations.ts` | 关系解析/保存 | ~487 | ✅ | 已拆分并修复 P0-Fix |
| `store/lite-adapter/feat-operations.ts` | feat 生命周期 | - | ✅ | 完整 |
| `store/lite-adapter/sync-operations.ts` | sync/planSync | - | ✅ | 完整 |
| `store/lite-adapter/graph-operations.ts` | queryDeps/queryImpact | - | ✅ | 完整 |
| `store/lite-adapter/search-operations.ts` | search (向量/全文) | - | 🔶 | 依赖 6.11/6.12 |
| `store/lite-adapter/utils-operations.ts` | readHistory/backup/restore | - | ✅ | 完整 |
| `store/lite-adapter/helpers.ts` | 辅助函数 | ~154 | ✅ | 完整 |
| `store/lite-adapter/types.ts` | 内部类型 | - | ✅ | 完整 |
| `store/in-memory-graph.ts` | InMemoryGraph | - | ✅ | 完整 |
| `store/graph-query-cache.ts` | GraphQueryCache | - | ✅ | 完整 |
| `store/write-queue.ts` | WriteQueue | - | ✅ | 完整 |
| `store/vector-search.ts` | VectorSearch | ~230 | ✅ | USearch 已集成 |
| `store/mode-switch.ts` | 模式切换（入口） | ~15 | 🔶 | 重新导出拆分后的实现 |
| `store/modeSwitchTypes.ts` | 模式切换类型定义 | ~132 | ✅ | 类型与导出格式 |
| `store/modeSwitchBackup.ts` | Local 备份 | ~196 | 🔶 | Local 部分完成 |
| `store/modeSwitchRestore.ts` | Local 恢复 | ~573 | 🔶 | Local 部分完成，Server API 挂起 |
| `store/server-adapter.ts` | Server 适配器占位 | ~160 | 🔶 | 占位提示，等待 Part 13 |
| `store/validate.ts` | 数据验证 | ~389 | ✅ | 已完成 |
| `store/repair.ts` | 数据修复 | ~370 | ✅ | 已完成 |
| `store/get-adapter.ts` | 适配器工厂 | - | ✅ | 完整 |

**状态说明**:
- ✅ 完整: 功能已实现，可直接使用
- 🔶 部分完成: 框架/核心逻辑已实现，部分功能待完善
- ⚠️ 需修复: 存在已知问题需要修复

### 依赖的 Part 01/02 产物

| 文件 | 说明 | Part |
|------|------|------|
| `types/base.ts` | EntityType, EntityStatus, Perspective | 01 |
| `types/dsl.ts` | DSL 类型定义 | 01 |
| `types/entities.ts` | 存储类型定义 | 01 |
| `types/relations.ts` | 关系类型 | 01 |
| `types/feat.ts` | Feat 类型 | 01 |
| `utils/config.ts` | 配置管理 | 02 |
| `utils/path.ts` | 路径计算 | 02 |
| `utils/yaml.ts` | YAML 处理 | 01 |
| `utils/hash.ts` | 哈希计算 | 01 |
| `utils/id.ts` | ID 生成与验证 | 01 |
| `utils/converter.ts` | DSL ↔ 内部结构转换 | 02 |
| `validator/index.ts` | DSL 验证 | 01 |

### 问题记录

| 文件 | 说明 |
|------|------|
| `v0.3.0-plan-opus/changes/02-architecture-fixes.md` | 架构修复记录 |

---

## 概述

Part 06 是 Local 模式的核心实现，定义 StorageAdapter 接口并实现 LiteAdapter。这是 Part 03 (MCP Store) 和 Part 04 (MCP Query) 的前置依赖。

**关键产物**：
- `StorageAdapter` 接口 - 统一存储抽象
- `LiteAdapter` - Local 模式实现
- `SQLiteStore` - SQLite 底层存储
- `InMemoryGraph` - 图查询引擎
- `VectorSearch` - 向量搜索引擎

---

## 任务清单

| # | 功能 | [ ] | 描述 |
|---|------|:---:|------|
| 6.1 | 模式对比 | [x] | Local vs Server 差异定义 |
| 6.2 | 并发访问配置 | [x] | WAL + busy_timeout |
| 6.3 | entities 表 | [x] | 复合主键设计 (source_project, id, proposal_id) |
| 6.4 | metadata 表 | [x] | 元数据 + content_hash |
| 6.5 | relations 表 | [x] | 关系存储 + 无外键约束 |
| 6.6 | entity_history 表 | [x] | 变更历史 |
| 6.7 | feat_history 表 | [x] | 发布历史（回滚支持） |
| 6.8 | 向量索引（USearch） | [x] | USearch 索引文件 + keymap |
| 6.9 | graph_cache 表 | [x] | 图查询缓存 |
| 6.10 | Merge View 模式 | [x] | Feat 优先 + 主分支兜底 |
| 6.11 | Embedding 生成 | [x] | @xenova/transformers 集成 |
| 6.12 | 向量搜索实现 | [x] | Feat 版本隔离 |
| 6.13 | 写队列设计 | [x] | WriteQueue + 背压控制 |
| 6.14 | 单例连接管理 | [x] | SQLiteStore 单例 |
| 6.15 | 向量索引维护 | [x] | 增量更新 + 批量重建 |
| 6.16 | InMemoryGraph 构建 | [x] | 邻接表 + RWLock |
| 6.17 | 图增量更新 | [x] | 实体变更时增量更新 |
| 6.18 | GraphQueryCache | [x] | 两层缓存 + 反向索引 |
| 6.19 | 模式配置 | [x] | .c4a.yaml mode 设置 |
| 6.20 | Local→Server 切换 | [ ] | 占位提示 + Server API 依赖 |
| 6.21 | Server→Local 切换 | [ ] | Local 导入 + 向量重建（Server 备份依赖） |
| 6.22 | 数据兼容性 | [x] | 格式一致性保证 |
| 6.23 | 导出/导入格式 | [x] | JSON 格式规范 |
| 6.24 | 性能基准测试 | [ ] | 测试环境 + 指标 |
| 6.25 | 实现建议 | [x] | 依赖 + 初始化 + 错误处理 |
| 6.26 | 已知限制 | [x] | 限制说明 + 最佳实践 |
| 6.27 | 未来优化 | [x] | 短期/长期优化路线 |
| 6.28 | FAQ: USearch 降级 | [x] | USearch 不可用时降级策略 |
| 6.29 | FAQ: 模式选择指南 | [x] | Local vs Server 选择 |
| 6.30 | 数据完整性检查 | [x] | validate 命令 |
| 6.31 | 数据修复命令 | [x] | repair 命令 |
| 6.32 | 错误码定义 | [x] | C4A-MIGRATE-001~008 |
| 6.33 | 数据示例 | [x] | Domain/Enterprise/Project |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 6.1 | 模式对比 | `sqlite-schema.md` | §1.1 模式对比 | L13-24 | [x] | [x] |
| 6.2 | 并发访问配置 | `sqlite-schema.md` | §1.2 并发访问配置 | L25-77 | [x] | [x] |
| 6.3 | entities 表 | `sqlite-schema.md` | §2.1 核心表 | L102-121 | [x] | [x] |
| 6.4 | metadata 表 | `sqlite-schema.md` | §2.1 核心表 | L122-141 | [x] | [x] |
| 6.5 | relations 表 | `sqlite-schema.md` | §2.1 核心表 | L143-165 | [x] | [x] |
| 6.6 | entity_history 表 | `sqlite-schema.md` | §2.2 实体变更历史表 | L205-230 | [x] | [x] |
| 6.7 | feat_history 表 | `sqlite-schema.md` | §2.2.1 Feat 发布历史表 | L257-292 | [x] | [x] |
| 6.8 | 向量索引（USearch） | `sqlite-schema.md` | §2.3.1 向量索引（USearch） | L293-329 | [x] | [x] |
| 6.9 | graph_cache 表 | `sqlite-schema.md` | §2.3.3 图查询缓存表 | L465-486 | [x] | [x] |
| 6.10 | Merge View 模式 | `sqlite-schema.md` | §3 Merge View 模式 | L488-559 | [x] | [x] |
| 6.11 | Embedding 生成 | `vector-search.md` | §3.1 Embedding 生成 | L3-33 | [x] | [x] |
| 6.12 | 向量搜索实现 | `vector-search.md` | §3.2 向量搜索 | L35-240 | [x] | [x] |
| 6.13 | 写队列设计 | `vector-search.md` | §3.3.3 写操作串行化 | L312-441 | [x] | [x] |
| 6.14 | 单例连接管理 | `vector-search.md` | §3.4 向量索引维护 | L466-505 | [x] | [x] |
| 6.15 | 向量索引维护 | `vector-search.md` | §3.4 向量索引维护 | L506-556 | [x] | [x] |
| 6.16 | InMemoryGraph 构建 | `graph-query.md` | §4.1 内存图构建 | L3-258 | [x] | [x] |
| 6.17 | 图增量更新 | `graph-query.md` | §4.1 内存图更新机制 | L259-298 | [x] | [x] |
| 6.18 | GraphQueryCache | `graph-query.md` | §4.2 图查询缓存 | L299-373 | [x] | [x] |
| 6.19 | 模式配置 | `mode-switch.md` | §5.1 配置方式 | L3-18 | [x] | [x] |
| 6.20 | Local→Server 切换 | `mode-switch.md` | §5.2.1 Local → Server | L19-83 | [x] | [ ] |
| 6.21 | Server→Local 切换 | `mode-switch.md` | §5.2.2 Server → Local | L84-283 | [x] | [ ] |
| 6.22 | 数据兼容性 | `mode-switch.md` | §5.3 数据兼容性 | L284-293 | [x] | [x] |
| 6.23 | 导出/导入格式 | `mode-switch.md` | §5.4 导出/导入格式 | L294-399 | [x] | [x] |
| 6.24 | 性能基准测试 | `mode-switch.md` | §6 性能基准 | L400-428 | [x] | [ ] |
| 6.25 | 实现建议 | `mode-switch.md` | §7 实现建议 | L429-531 | [x] | [x] |
| 6.26 | 已知限制 | `mode-switch.md` | §8 限制和注意事项 | L532-551 | [x] | [x] |
| 6.27 | 未来优化 | `mode-switch.md` | §9 未来优化方向 | L552-566 | [x] | [x] |
| 6.28 | FAQ: USearch 降级 | `appendix.md` | Q1 USearch 降级 | L3-120 | [x] | [x] |
| 6.29 | FAQ: 模式选择指南 | `appendix.md` | Q2 模式选择 | L164-245 | [x] | [x] |
| 6.30 | 数据完整性检查 | `appendix.md` | §A.9.3 数据完整性检查 | L246-309 | [x] | [x] |
| 6.31 | 数据修复命令 | `appendix.md` | §A.9.3.2 repair 命令 | L310-546 | [x] | [x] |
| 6.32 | 错误码定义 | `appendix.md` | §A.9.7 错误码参考 | L547-561 | [x] | [x] |
| 6.33 | 数据示例 | `appendix.md` | 附录：数据示例 | L562-714 | [x] | [x] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 | 备注 |
|---------|---------|------|:----:|------|
| 接口定义 | `packages/core/src/store/adapter.ts` | StorageAdapter 接口 + 所有类型定义 | ✅ | |
| SQLite 存储 | `packages/core/src/store/sqlite-store.ts` | SQLite 底层存储实现 | ✅ | |
| Lite 适配器 | `packages/core/src/store/lite-adapter.ts` | LiteAdapter 主入口 | ✅ | |
| CRUD 操作 | `packages/core/src/store/lite-adapter/crud-save.ts` | save | ✅ | 已拆分并修复 P0-Fix |
| CRUD 操作 | `packages/core/src/store/lite-adapter/crud-read.ts` | read/list/delete | ✅ | 已拆分并修复 P0-Fix |
| 关系解析 | `packages/core/src/store/lite-adapter/relations.ts` | 关系解析/保存 | ✅ | 已拆分并修复 P0-Fix |
| Feat 操作 | `packages/core/src/store/lite-adapter/feat-operations.ts` | feat 生命周期管理 | ✅ | |
| 同步操作 | `packages/core/src/store/lite-adapter/sync-operations.ts` | sync/planSync | ✅ | |
| 图操作 | `packages/core/src/store/lite-adapter/graph-operations.ts` | queryDeps/queryImpact | ✅ | |
| 搜索操作 | `packages/core/src/store/lite-adapter/search-operations.ts` | search (向量/全文) | ✅ | |
| 工具操作 | `packages/core/src/store/lite-adapter/utils-operations.ts` | readHistory/backup/restore | ✅ | |
| 辅助函数 | `packages/core/src/store/lite-adapter/helpers.ts` | parseContent/formatContent/computeHash | ✅ | |
| 类型定义 | `packages/core/src/store/lite-adapter/types.ts` | 内部类型定义 | ✅ | |
| 内存图 | `packages/core/src/store/in-memory-graph.ts` | InMemoryGraph 实现 | ✅ | |
| 图缓存 | `packages/core/src/store/graph-query-cache.ts` | GraphQueryCache 实现 | ✅ | |
| 写队列 | `packages/core/src/store/write-queue.ts` | WriteQueue + 背压控制 | ✅ | |
| 向量搜索 | `packages/core/src/store/vector-search.ts` | VectorSearch 实现 | ✅ | USearch 已集成 |
| 模式切换（入口） | `packages/core/src/store/mode-switch.ts` | Local↔Server 切换 | 🔶 | 重新导出拆分后的实现 |
| 模式切换类型 | `packages/core/src/store/modeSwitchTypes.ts` | 类型定义 | ✅ | 导出/导入格式 |
| 模式切换备份 | `packages/core/src/store/modeSwitchBackup.ts` | Local 备份 | 🔶 | Local 部分完成 |
| 模式切换恢复 | `packages/core/src/store/modeSwitchRestore.ts` | Local 恢复 | 🔶 | Local 部分完成，Server API 挂起 |
| Server 适配器 | `packages/core/src/store/server-adapter.ts` | Server 占位适配器 | 🔶 | 占位提示，等待 Part 13 |
| 数据验证 | `packages/core/src/store/validate.ts` | 数据完整性检查 | ✅ | 已完成 |
| 数据修复 | `packages/core/src/store/repair.ts` | 数据修复命令 | ✅ | 已完成 |
| 适配器工厂 | `packages/core/src/store/get-adapter.ts` | getAdapter() 工厂函数 | ✅ | |
| 导出入口 | `packages/core/src/store/index.ts` | 模块导出 | ✅ | |

**状态说明**:
- ✅ 完整: 功能已实现，可直接使用
- 🔶 部分完成: 框架/核心逻辑已实现，部分功能待完善
- ⚠️ 需修复: 存在已知问题需要修复

---

## 与 Part 01/02 的一致性检查

### 已确认一致

1. **类型系统**：`adapter.ts` 中的 `EntityType`, `EntityStatus` 与 `types/base.ts` 一致
2. **路径计算**：使用 `utils/path.ts` 的 `getEntityPath`, `parseEntityPath`
3. **配置管理**：使用 `utils/config.ts` 的 `loadConfig`, `C4AConfig`
4. **YAML 处理**：使用 `utils/yaml.ts` 的 `parseYAML`, `stringifyYAML`
5. **哈希计算**：使用 `utils/hash.ts` 的 `computeContentHash`

### 需要修复的问题

> ⚠️ **风险警告**：crud-operations.ts 目前的实现处于"原型"阶段，存在逻辑漏洞，无法直接用于生产。

---

#### 🔴 P0-Fix1: DSL 转换缺失

**问题描述**：
`crud-operations.ts` 的 `doSave` 方法直接将传入的 DSL 对象存入数据库的 `data` 字段，未调用 `converter.ts` 进行 DSL → 内部结构转换。

**代码位置**：
- [crud-operations.ts:94-101](packages/core/src/store/lite-adapter/crud-operations.ts#L94-L101): 直接使用 `params.data`
- [crud-operations.ts:252-261](packages/core/src/store/lite-adapter/crud-operations.ts#L252-L261): 直接从 `data` 取值写入数据库

**当前代码**：
```typescript
// L257-259: kind/scope/perspective 直接从 data 顶层取值
(data.kind as string) || null,
(data.scope as string) || null,
(data.perspective as string) || null,
```

**问题分析**：
DSL 结构是 `{ type: "software-system", system: { id, name, ... } }`，`kind`/`scope`/`perspective` 不在顶层，所以这些字段会是 `NULL`。

**影响**：
- 数据损坏：数据库中的 `kind`、`scope`、`perspective` 字段将为 NULL
- 查询失效：基于 `kind` 或 `scope` 的过滤将无法工作
- 类型错误：读取时无法正确映射回 DSL

**修复方案**：
```typescript
import * as converter from '../../utils/converter.js';

async function doSave(ctx, params) {
  // 1. 解析内容
  let rawData = parseContent(params.content, params.format);

  // 2. 转换 DSL -> Internal Entity
  let entity;
  if (converter.isSystemDSL(rawData)) {
    entity = converter.dslToSystem(rawData);
  } else if (converter.isContainerDSL(rawData)) {
    entity = converter.dslToContainer(rawData);
  } else if (converter.isComponentDSL(rawData)) {
    entity = converter.dslToComponent(rawData);
  }
  // ... 处理其他类型

  // 3. 使用转换后的字段
  const kind = entity.kind;
  const scope = entity.scope;
  const perspective = entity.perspective;
  const internalData = entity.data;

  // 4. 执行 DB 操作...
}
```

---

#### 🔴 P0-Fix2: 关系解析不匹配 DSL Schema

**问题描述**：
`parseRelations` 函数只支持简单的 `relationships` 数组或 `{ type: [targets] }` 对象，与实际 DSL Schema 定义不匹配。

**代码位置**：
- [crud-operations.ts:815-879](packages/core/src/store/lite-adapter/crud-operations.ts#L815-L879): `parseRelations` 函数

**Schema 定义 vs 当前解析**：

| DSL 类型 | Schema 定义 | 当前代码期望 | 状态 |
|---------|-------------|-------------|:----:|
| System | `relationships.consumers: [{id, type}]` | 不支持 | ❌ |
| System | `relationships.dependencies: [{id}]` | `dependencies: ["xxx"]` (字符串数组) | ❌ |
| Container | `relationships: [{to, type}]` | `relationships: [{target, type}]` | ❌ |
| System/SoR | `system.corresponds_to` | `data.corresponds_to` (顶层) | ❌ |

**修复方案**：
重构 `parseRelations`，根据 `params.type` 使用不同的解析策略：

```typescript
function parseRelations(
  data: Record<string, unknown>,
  sourceProject: string,
  entityId: string,
  entityType: EntityType  // 新增参数
): ParsedRelation[] {
  const relations: ParsedRelation[] = [];

  // System: { consumers: [{id, type}], dependencies: [{id}] }
  if (entityType === 'system') {
    const rels = data.relationships as { consumers?: Array<{id: string}>, dependencies?: Array<{id: string}> };
    // dependencies -> DEPENDS_ON (Self -> Target)
    for (const dep of rels?.dependencies || []) {
      relations.push({ toProject: sourceProject, toId: dep.id, relType: 'DEPENDS_ON' });
    }
    // consumers -> DEPENDS_ON (Target -> Self) - 反向关系
    for (const consumer of rels?.consumers || []) {
      relations.push({ fromProject: sourceProject, fromId: consumer.id, toId: entityId, relType: 'DEPENDS_ON' });
    }
    // corresponds_to 从嵌套字段读取
    const systemData = data.system as { corresponds_to?: string };
    if (systemData?.corresponds_to) {
      relations.push({ toProject: sourceProject, toId: systemData.corresponds_to, relType: 'CORRESPONDS' });
    }
  }

  // Container: relationships: [{to, type, description}]
  if (entityType === 'container') {
    const rels = data.relationships as Array<{to: string, type?: string}>;
    for (const rel of rels || []) {
      relations.push({ toProject: sourceProject, toId: rel.to, relType: rel.type || 'DEPENDS_ON' });
    }
  }

  // ... 其他类型
  return relations;
}
```

---

#### 🟢 P1-Fix1: Status 状态逻辑 (已确认：当前实现正确)

**问题描述**：
`doSave` 中状态判定逻辑为 `const status = proposalId ? 'draft' : 'published'`，Gemini 审查认为忽略了 DSL 中的 status 字段。

**设计确认**：经查阅设计文档，当前实现**符合设计意图**，采用"状态由位置决定"模式：
- `store-feat-lifecycle.md` L301: feat 中保存实体时 `status: "draft"`
- `cross-project-transaction.md` L256: 发布时 `$set: { proposal_id: null, status: "published" }`
- `concepts.md` L122: "`published` 状态的实体不可直接修改，需创建新版本（新 draft）"

**设计模式**：
```
feat 内保存 → status = draft (强制)
发布 feat  → status = published (强制，由 feat_lifecycle 处理)
主分支保存 → status = published (强制)
软删除     → status = archived (强制，由 delete 处理)
```

**结论**：无需修改。状态流转（`published → deprecated → archived`）由 `c4a_store_save` 更新 status 字段实现，但这是显式的状态流转操作，不是保存时自动推导。ADR 的 `superseded` 和 Contract 的 `implemented` 存储在 `data.status` 字段，与顶层 `status`（LifecycleStatus）分开管理。

---

### 问题汇总

| 问题 | 优先级 | 状态 | 影响范围 |
|------|:------:|:----:|----------|
| P0-Fix1: DSL 转换缺失 | P0 | ✅ 已修复 | 数据损坏，查询失效 |
| P0-Fix2: 关系解析不匹配 | P0 | ✅ 已修复 | 关系数据丢失 |
| P1-Fix1: Status 逻辑 | P1 | ✅ 已确认正确 | 无需修改 |
| D1: 关系单一性约束 | 设计 | ✅ 已更新 | sqlite-schema.md L132-158 |
| D2: 关系删除遮蔽 | 设计 | ✅ 已更新 | graph-query.md L33-99, cross-reference.md L697-700 |
| D3: 导出格式完整字段 | 设计 | ✅ 已更新 | mode-switch.md L282-360 |
| D4: UNIQUE约束NULL处理 | 设计 | ✅ 已更新 | sqlite-schema.md L155-158 (COALESCE索引) |
| D5: 向量搜索状态过滤 | 设计 | ✅ 已更新 | vector-search.md L134-189 |
| D6: 图查询实体状态过滤 | 设计 | ✅ 已更新 | graph-query.md L33-99 |
| D7: 后台重建写入路由 | 设计 | ✅ 已更新 | mode-switch.md L154-252 (双写+切换+回滚) |
| D8: 图查询proposal_id过度绑定 | 设计 | ✅ 已更新 | graph-query.md L33-99 (Merge View实体选择) |
| D9: 向量搜索简化版状态过滤 | 设计 | ✅ 已更新 | vector-search.md L206-224 |
| D10: 文档编码损坏 | 文档 | ✅ 已修复 | sqlite-schema.md L34 |
| D11: USearch 复合 ID 设计 | 设计 | ✅ 已更新 | sqlite-schema.md L293-320 (使用 composite_id 映射) |
| D12: 向量导出矛盾 | 设计 | ✅ 已更新 | mode-switch.md L323-360 (不导出向量，导入时重建) |
| D13: CLI 并发访问表述 | 设计 | ✅ 已更新 | sqlite-schema.md L27 (明确单进程架构，请求通过 MCP Server) |
| D14: USearch 检测时机 | 设计 | ✅ 已更新 | appendix.md L11 (MCP Server 初始化时检测) |
| D15: 运维工具 MCP 暴露 | 设计 | ✅ 已确认 | architecture.md L857-868 (方案 A: MCP 工具供 CLI 内部调用) |
| D16: 全文搜索降级方案 | 设计 | ✅ 已更新 | sqlite-schema.md L283-411, appendix.md L56-145 (引入 FTS5 表结构) |
| D17: 索引命名不一致 | 设计 | ✅ 已更新 | sqlite-schema.md L272 (统一为 idx_vectors_lookup) |
| D18: FTS5 tokenizer 配置无效 | 设计 | ✅ 已更新 | sqlite-schema.md L294, L298-311 (改为 unicode61，添加 tokenizer 选择说明) |
| D19: FTS 查询 ORDER BY rank 错误 | 设计 | ✅ 已更新 | sqlite-schema.md L366-402, appendix.md L105-145 (使用 bm25() 函数) |
| D20: FTS5 可用性假设 | 设计 | ✅ 已更新 | appendix.md L64-103 (添加 probeFTS5() 探测，降级到 LIKE) |
| D21: idx_entities_composite 索引缺失 | 设计 | ✅ 已更新 | sqlite-schema.md L107-108 (添加复合索引定义) |
| D22: 章节编号顺序混乱 | 文档 | ✅ 已修复 | sqlite-schema.md (2.3.2 FTS5 → 2.3.3 图缓存) |
| D23: FTS5 搜索缺少 status 过滤 | 设计 | ✅ 已更新 | sqlite-schema.md L366-402, appendix.md L105-145 (JOIN metadata + status 过滤) |
| D24: 降级策略文案不完整 | 文档 | ✅ 已更新 | appendix.md L5-23 (添加三级降级策略表，补充 LIKE 降级说明) |
| D25: 工具可见性不一致 | 设计 | ✅ 已更新 | mcp-tools.md L55-62 (标注 backup/restore 仅 CLI 内部调用) |
| D26: FTS 查询状态过滤不一致 | 设计 | ✅ 已确认 | sqlite-schema.md L389-399 已有 metadata JOIN + status 过滤 |
| D27: 降级 MCP 返回示例不完整 | 文档 | ✅ 已更新 | appendix.md L49-70 (补充 LIKE 降级场景的返回示例) |
| D28: 重建期间降级说明不完整 | 文档 | ✅ 已更新 | mode-switch.md L81, L117 (补充 FTS5 不可用时降级到 LIKE) |
| D29: FTS5 别名不一致 | 设计 | ✅ 已更新 | sqlite-schema.md L378, L400; appendix.md L132, L154 (统一使用 fts 别名) |
| D30: 后台重建降级说明不完整 | 文档 | ✅ 已更新 | mode-switch.md L137 (补充 FTS5 不可用时降级到 LIKE) |
| D31: source_project NOT NULL 与 Domain/Enterprise 冲突 | 设计 | ✅ 已更新 | sqlite-schema.md L93-103, L113-115, L134-152, L267-270 (允许 NULL 表示全局实体) |
| D32: vector_key 写入缺失 | 设计 | ✅ 已更新 | vector-search.md L506-544 (补充向量写入逻辑) |
| D33: 备份导出向量矛盾 | 文档 | ✅ 已更新 | appendix.md L417-426 (删除"导出向量"，与 mode-switch.md 保持一致) |
| D34: Bun 运行时兼容性风险 | 文档 | ✅ 已更新 | mode-switch.md L407-419 (添加运行时兼容性说明和回退方案) |
| D35: 实体唯一性约束描述错误 | 设计 | ✅ 已更新 | architecture.md L356-380, L627, L714 (修正为 source_project,id,proposal_id 三元组) |
| D36: FTS5 触发器 source_project NULL 处理 | 设计 | ✅ 已更新 | sqlite-schema.md L344, L361 (添加 source_project IS NULL 判断) |
| D37: 向量重建时间说明不清晰 | 文档 | ✅ 已更新 | mode-switch.md L105-121 (区分 SQLite 批量插入和 Embedding 生成两阶段) |
| D38: InMemoryGraph 缓存失效局限性 | 文档 | ✅ 已更新 | graph-query.md L171-182 (添加 key.includes() 误匹配风险说明) |
| D39: vectors 索引重复定义 | 文档 | ✅ 已更新 | sqlite-schema.md L331-344 (vectors 索引定义) |
| D40: configs 表用途不明确 | 文档 | ✅ 已更新 | sqlite-schema.md L83-97 (补充用途说明和与 .c4a.yaml 的关系) |
| D41: external 实体 source_project 说明缺失 | 文档 | ✅ 已更新 | appendix.md L663-684 (添加 external 实体字段说明) |
| D42: relations.status 与 metadata.status 混淆 | 文档 | ✅ 已更新 | mode-switch.md L355 (添加说明区分两种 status) |
| D43: FTS 索引字段与实体类型映射不明确 | 文档 | ✅ 已更新 | sqlite-schema.md L374-385 (添加字段映射说明和设计考量) |
| D44: RWLock 实现未说明 | 文档 | ✅ 已更新 | graph-query.md L7 (添加伪代码说明和第三方库建议) |
| D45: Bun 兼容性说明位置不完整 | 文档 | ✅ 已更新 | architecture.md L22, L30 (添加脚注说明可回退 Node.js) |
| D46: SQLite 主键不支持 COALESCE 表达式 | 设计 | ✅ 已更新 | sqlite-schema.md L102-191 (改用空字符串哨兵值，添加应用层转换说明) |
| D47: NULL 语义未贯穿查询示例 | 设计 | ✅ 已更新 | sqlite-schema.md, vector-search.md, graph-query.md (统一使用空字符串比较) |
| D48: entity_history 表 source_project NOT NULL | 设计 | ✅ 已更新 | sqlite-schema.md L211-233 (改用空字符串哨兵值) |
| D49: 向量重建阻塞语义不一致 | 文档 | ✅ 已更新 | mode-switch.md L389-401 (明确默认同步阻塞，大数据量提示后台) |
| D50: 并发模型描述错误 | 设计 | ✅ 已更新 | vector-search.md L242-310 (修正为多进程模型，依赖 SQLite WAL 和文件锁) |
| D51: Checklist 同步断层未说明 | 文档 | ✅ 已更新 | mode-switch.md L345-367 (添加 Checklist 数据处理说明和协作注意事项) |
| D52: vector-search.md 方案2/3 NULL 引用 | 设计 | ✅ 已更新 | vector-search.md L134-216 (主分支搜索改用空字符串) |
| D53: vector-search.md 测试用例 NULL 引用 | 文档 | ✅ 已更新 | vector-search.md L226-239 (测试用例注释改用空字符串说明) |
| D54: sqlite-schema.md 并发模型描述错误 | 设计 | ✅ 已更新 | sqlite-schema.md L27-52 (修正为多进程并发模型) |
| D55: appendix.md FTS 降级示例 NULL 引用 | 设计 | ✅ 已更新 | appendix.md L123-161 (ftsSearch 函数改用空字符串哨兵值) |
| D56: appendix.md 数据示例 null 引用 | 文档 | ✅ 已更新 | appendix.md L562-715 (数据示例改用空字符串，添加哨兵值说明) |
| D57: graph-query.md NodeKey 哨兵值转换 | 文档 | ✅ 已更新 | graph-query.md L11-19 (添加 makeNodeKey 函数的哨兵值转换说明) |
| D58: architecture.md NULL 引用 | 设计 | ✅ 已更新 | architecture.md L358-390, L792-799, L1118-1134 (唯一性约束、metadata 示例、查询策略添加哨兵值说明) |
| D59: appendix.md external 实体示例 | 文档 | ✅ 已更新 | appendix.md L672-695 (external 实体 source_project/source_repo 改用空字符串) |
| D60: 图查询缓存缺少项目维度 | 实现 | ✅ 已修复 | graph-operations.ts (缓存 key 加入 source_project) |
| D61: 缓存失效粒度过粗 | 实现 | ✅ 已修复 | crud-read.ts + cache-keys.ts (按 source_project:id 失效) |
| D62: 导出数据兼容旧字段 | 实现 | ✅ 已修复 | modeSwitchRestore.ts (ADR title/name, Contract component_id, kind/scope/perspective 归一化) |
| D63: 向量索引维护执行方式调整 | 文档 | ✅ 已更新 | vector-search.md/实现一致（改为异步重建，不阻塞保存） |
| D64: 文件 I/O API 兼容性调整 | 文档 | ✅ 已更新 | modeSwitchBackup.ts/utilsBackup.ts（统一 Node fs 写入） |
| D63: list 查询未应用 Merge View | 实现 | ✅ 已修复 | crud-read.ts (列表/计数/分组走 Merge View) |
| D64: 关系变更未失效图查询缓存 | 实现 | ✅ 已修复 | relations.ts (关系写入后失效相关缓存) |
| D65: 导入全局项目字段兼容 | 实现 | ✅ 已修复 | modeSwitchRestore.ts (metadata/relations null → '') |
| D66: restore 缺少进度回调 | 实现 | ✅ 已修复 | modeSwitchRestore.ts + modeSwitchTypes.ts (onProgress 回调) |
| D67: backup 缺少进度回调 | 实现 | ✅ 已修复 | modeSwitchBackup.ts + modeSwitchTypes.ts (onProgress 回调) |
| D68: 冲突统计摘要缺失 | 实现 | ✅ 已修复 | modeSwitchRestore.ts + modeSwitchTypes.ts (conflict_summary) |
| D69: 冲突摘要缺少 target 维度 | 实现 | ✅ 已修复 | modeSwitchRestore.ts + modeSwitchTypes.ts (by_target 统计) |
| D70: 冲突摘要缺少 target×resolution 维度 | 实现 | ✅ 已修复 | modeSwitchRestore.ts + modeSwitchTypes.ts (by_target_resolution 统计) |
| D71: 缺少摘要格式化函数 | 实现 | ✅ 已修复 | modeSwitchSummary.ts (formatConflictSummary) |
| D72: 冲突摘要缺少 entity_type 维度 | 实现 | ✅ 已修复 | modeSwitchRestore.ts + modeSwitchTypes.ts (by_entity_type 统计) |
| D73: 冲突摘要缺少 status 维度 | 实现 | ✅ 已修复 | modeSwitchRestore.ts + modeSwitchTypes.ts (by_status/by_target_status 统计) |
| D74: 冲突摘要缺少 feat_status 维度 | 实现 | ✅ 已修复 | modeSwitchRestore.ts + modeSwitchTypes.ts (by_feat_status 统计) |

---

## 依赖分析与执行范围

### Part 01/02 依赖状态检查

| 依赖项 | 文件 | 状态 | 说明 |
|--------|------|:----:|------|
| EntityType | `types/base.ts` | ✅ | 已定义，Part 06 可用 |
| EntityStatus | `types/base.ts` | ✅ | 已定义，Part 06 可用 |
| Perspective | `types/base.ts` | ✅ | 已定义，Part 06 可用 |
| EntityKind | `types/base.ts` | ✅ | 已定义，Part 06 可用 |
| DSL 类型 | `types/dsl.ts` | ✅ | 已定义，Part 06 可用 |
| dslTo* 转换函数 | `utils/converter.ts` | ✅ | 已实现，Part 06 可调用 |
| inferKind/inferPerspective | `utils/converter.ts` | ✅ | 已实现，Part 06 可调用 |
| parseYAML/stringifyYAML | `utils/yaml.ts` | ✅ | 已实现，Part 06 可用 |
| computeContentHash | `utils/hash.ts` | ✅ | 已实现，Part 06 可用 |
| loadConfig | `utils/config.ts` | ✅ | 已实现，Part 06 可用 |
| getEntityPath | `utils/path.ts` | ✅ | 已实现，Part 06 可用 |
| validateDSL | `validator/index.ts` | ✅ | 已实现，Part 06 可用 |

**结论**: Part 01/02 的核心依赖已就绪，Part 06 可以独立执行。

### 任务依赖分析

| # | 任务 | 外部依赖 | 内部依赖 | 可独立执行 | 执行范围 |
|---|------|----------|----------|:----------:|----------|
| 6.11 | Embedding 生成 | @xenova/transformers | P0-Fix1/2 | ✅ | Part 06 |
| 6.12 | 向量搜索实现 | USearch | 6.11 | ✅ | Part 06 |
| 6.15 | 向量索引维护 | 无 | 6.11, 6.12 | ✅ | Part 06 |
| 6.20 | Local→Server 切换 | Server API | 6.23 | ⚠️ | 挂起 (占位提示，需 Part 13) |
| 6.21 | Server→Local 切换 | Server API | 6.15, 6.23 | ⚠️ | 挂起 (Local 导入/向量重建完成，需 Part 13) |
| 6.22 | 数据兼容性 | 无 | 6.23 | ✅ | Part 06 |
| 6.23 | 导出/导入格式 | 无 | 无 | ✅ | Part 06 |
| 6.24 | 性能基准测试 | 无 | 全部 | ⚠️ | 挂起 (最后执行) |
| 6.26 | 已知限制 | 无 | 无 | ✅ | Part 06 (文档) |
| 6.27 | 未来优化 | 无 | 无 | ✅ | Part 06 (文档) |
| 6.28 | USearch 降级 | 无 | 6.12 | ✅ | Part 06 |
| 6.29 | 模式选择指南 | 无 | 无 | ✅ | Part 06 (文档) |
| 6.30 | 数据完整性检查 | 无 | 无 | ✅ | Part 06 |
| 6.31 | 数据修复命令 | 无 | 6.30 | ✅ | Part 06 |
| 6.32 | 错误码定义 | 无 | 无 | ✅ | Part 06 |
| 6.33 | 数据示例 | 无 | 无 | ✅ | Part 06 (文档) |
| P0-Fix1 | 修复 converter 调用 | Part 02 converter.ts | 无 | ✅ | Part 06 |
| P0-Fix2 | 修复关系解析 | Part 01 DSL Schema | 无 | ✅ | Part 06 |

### 挂起任务说明

| 任务 | 挂起原因 | 解除条件 |
|------|----------|----------|
| 6.20 Local→Server 切换 | 需要 Server 模式 API (mcp-data) | Part 13 Server 模式实现后 |
| 6.21 Server→Local 切换 | 需要 Server 模式 API (mcp-data) | Part 13 Server 模式实现后 |
| 6.24 性能基准测试 | 需要所有功能完成后统一测试 | Part 06 其他任务完成后 |

> 备注：已提供 ServerAdapter 占位实现（明确抛错提示），用于在 Part 13 完成前阻止误用。

---

## 待实现任务

### 高优先级 (P0) - 本次执行

| 任务 | 描述 | 依赖 | 状态 |
|------|------|------|:----:|
| P0-Fix1 | 修复 DSL 转换缺失 (调用 converter.ts) | Part 02 ✅ | 已完成 |
| P0-Fix2 | 修复关系解析 (按 DSL Schema 重构 parseRelations) | Part 01 ✅ | 已完成 |
| 6.11 | Embedding 生成 (@xenova/transformers) | P0-Fix1/2 | ✅ 已完成 |
| 6.12 | 向量搜索实现 (Feat 版本隔离) | 6.11 | ✅ 已完成 |
| 6.15 | 向量索引维护 (增量更新 + 批量重建) | 6.11, 6.12 | ✅ 已完成 |
| 6.28 | USearch 降级策略 | 6.12 | ✅ 已完成 |

> ⚠️ **执行顺序说明**：必须先完成 P0-Fix1/2，否则后续写入的数据都是损坏的，会导致向量搜索无法正确索引、图查询关系不完整。

### 中优先级 (P1) - 本次执行

| 任务 | 描述 | 依赖 | 状态 |
|------|------|------|:----:|
| P1-Fix1 | Status 逻辑 | P0-Fix1 | ✅ 已确认正确，无需修改 |
| 6.23 | 导出/导入格式 (JSON 规范) | 无 | 已完成 |
| 6.22 | 数据兼容性保证 | 6.23 | 已完成 |
| 6.30 | 数据完整性检查 (validate) | 无 | 已完成 |
| 6.31 | 数据修复命令 (repair) | 6.30 | 已完成 |
| 6.32 | 错误码定义 | 无 | 已完成 |

### 低优先级 (P2) - 本次执行 (文档)

| 任务 | 描述 | 依赖 | 状态 |
|------|------|------|:----:|
| 6.26 | 已知限制说明 | 无 | 已完成 |
| 6.27 | 未来优化路线 | 无 | 已完成 |
| 6.29 | 模式选择指南 | 无 | 已完成 |
| 6.33 | 数据示例 | 无 | 已完成 |

### 挂起 (Deferred) - 依赖 Part 13

| 任务 | 描述 | 依赖 | 解除条件 |
|------|------|------|----------|
| 6.20 | Local→Server 切换 | Server API | Part 13 完成 |
| 6.21 | Server→Local 切换 | Server API | Part 13 完成 |
| 6.24 | 性能基准测试 | 全部功能 | Part 06 完成 |

---

## 实现顺序

```
Phase 1: 核心修复 (P0-Fix)
├── P0-Fix1: 修复 converter 调用 (crud-operations.ts)
│   └── 调用 dslTo* 转换函数
│   └── 使用 inferKind/inferPerspective 推导字段
├── P0-Fix2: 修复关系解析 (crud-operations.ts)
│   └── 按实体类型解析不同关系结构
│   └── 支持跨项目引用格式
└── 单元测试验证

Phase 2: 向量搜索 (6.11, 6.12, 6.15, 6.28)
├── 6.11 Embedding 生成
│   └── 集成 @xenova/transformers
│   └── 模型加载与缓存
├── 6.12 向量搜索实现
│   └── Feat 版本隔离
│   └── 相似度计算
├── 6.15 向量索引维护
│   └── 增量更新
│   └── 批量重建
└── 6.28 USearch 降级
    └── 检测索引可用性
    └── 降级到全文搜索

Phase 3: 数据操作 (6.23, 6.22, 6.30, 6.31, 6.32)
├── 6.23 导出/导入格式
│   └── JSON 格式规范
│   └── 版本兼容性
├── 6.22 数据兼容性
│   └── Local/Server 格式一致
├── 6.30 数据完整性检查
│   └── validate 命令实现
├── 6.31 数据修复命令
│   └── repair 命令实现
└── 6.32 错误码定义
    └── C4A-STORE-* 错误码
    └── C4A-MIGRATE-* 错误码

Phase 4: 文档完善 (6.26, 6.27, 6.29, 6.33)
├── 6.26 已知限制
├── 6.27 未来优化
├── 6.29 模式选择指南
└── 6.33 数据示例

Phase 5: 挂起任务 (依赖 Part 13)
├── 6.20 Local→Server 切换 [DEFERRED]
├── 6.21 Server→Local 切换 [DEFERRED]
└── 6.24 性能基准测试 [DEFERRED]
```

---

## 验证方法

```bash
# 类型检查
cd packages/core && bun run typecheck

# 单元测试
cd packages/core && bun run test

# 构建验证
cd packages/core && bun run build
```

---

## 依赖关系

- **依赖 Part 01**: 类型定义 (`types/*.ts`)
- **依赖 Part 02**: 工具函数 (`utils/*.ts`), 配置管理, 路径计算
- **被 Part 03 依赖**: MCP Store 工具通过 StorageAdapter 接口访问存储
- **被 Part 04 依赖**: MCP Query 工具通过 StorageAdapter 接口查询

---

## 验收标准

### Part 06 本次执行范围

- [x] P0-Fix1: converter.ts 在 save 操作中被正确调用
- [x] P0-Fix2: parseRelations 按 DSL Schema 正确解析关系
- [x] 6.11: Embedding 生成功能可用
- [x] 6.12: 向量搜索支持 Feat 版本隔离
- [x] 6.15: 向量索引增量更新和批量重建
- [x] 6.28: USearch 不可用时降级到全文搜索
- [x] 6.23: 导出/导入 JSON 格式定义完成
- [x] 6.22: Local/Server 数据格式兼容
- [x] 6.30: validate 命令可用
- [x] 6.31: repair 命令可用
- [x] 6.32: 错误码定义完成
- [x] 单元测试覆盖核心逻辑
- [x] 与 Part 01/02 类型一致

### 挂起任务 (Part 13 后执行)

- [ ] 6.20: Local→Server 切换
- [ ] 6.21: Server→Local 切换
- [ ] 6.24: 性能基准测试

---

## 执行摘要

| 类别 | 数量 | 说明 |
|------|:----:|------|
| 已完成 | 30 | 6.1-6.14, 6.16-6.19, 6.22-6.23, 6.25-6.27, 6.29-6.33, P0-Fix1/2 |
| 本次执行 | 4 | 错误码统一/validate JSON 输出/备份转换/ includeVectors 处理 |
| 挂起 | 3 | 6.20, 6.21, 6.24 (依赖 Part 13) |
| **总计** | **35** | 33 原任务 + 2 P0-Fix |

**详细统计**:
- 已完成 (30): 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.16, 6.17, 6.18, 6.19, 6.22, 6.23, 6.25, 6.26, 6.27, 6.29, 6.30, 6.31, 6.32, 6.33, P0-Fix1, P0-Fix2
- 本次执行 (4): 迁移错误码统一（errors.ts）、validate JSON 输出、备份数据归一化、includeVectors 显式报错
- 挂起 (3): 6.20, 6.21, 6.24
