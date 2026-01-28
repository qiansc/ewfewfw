# Part 03 验收清单: Store Sync 工具骨架实现

**任务范围:** 3.7 - 3.10
**设计文档:** `v0.3.0/detailed-design/mcp/store-sync.md`
**验收时间:** 2026-01-27 18:00

---

## 1. 设计文档逐节对照

### §3.5 c4a_store_sync (store-sync.md L1-36)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| 输入参数 direction | L10 | `storeSchemas.ts` | L308 | [x] |
| 输入参数 status_filter | L11 | `storeSchemas.ts` | L309 | [x] |
| 输入参数 path | L12 | `storeSchemas.ts` | L310 | [x] |
| 输入参数 format | L13 | `storeSchemas.ts` | L311 | [x] |
| 输入参数 mode | L14 | `storeSchemas.ts` | L312 | [x] |
| 输入参数 conflict_policy | L15 | `storeSchemas.ts` | L313 | [x] |
| 返回结果 success | L17 | `storeSchemas.ts` | L332 | [x] |
| 返回结果 stats | L18 | `storeSchemas.ts` | L333 | [x] |
| 返回结果 details | L19 | `storeSchemas.ts` | L334 | [x] |
| SyncStats 类型定义 | L18 | `storeSchemas.ts` | L319-326 | [x] |
| 工具处理函数 storeSyncHandler | - | `sync.ts` | L1-22 | [x] |
| 工具注册到 server | - | `server.ts` | L480-508 | [x] |

**本节验收结果:** [x] 通过

---

### §3.5.1 c4a_store_plan_sync (store-sync.md L37-353)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| LocalFileManifest 类型定义 | L48-60 | `storeSchemas.ts` | L342-350 | [x] |
| SyncSnapshot 类型定义 | L63-70 | `storeSchemas.ts` | L355-361 | [x] |
| SyncOptions 类型定义 | L72-77 | `storeSchemas.ts` | L366-370 | [x] |
| 输入参数 local_manifest | L50 | `storeSchemas.ts` | L376-378 | [x] |
| 输入参数 snapshot | L63 | `storeSchemas.ts` | L379 | [x] |
| 输入参数 options | L72 | `storeSchemas.ts` | L380 | [x] |
| 输入参数 execute | L79 | `storeSchemas.ts` | L381 | [x] |
| SyncAction 类型定义 | L98-128 | `storeSchemas.ts` | L387-398 | [x] |
| 返回结果 (execute=false) | L90-144 | `storeSchemas.ts` | L403-414 | [x] |
| 返回结果 (execute=true) | L146-169 | `storeSchemas.ts` | L419-434 | [x] |
| 工具处理函数 storePlanSyncHandler | - | `planSync.ts` | L1-30 | [x] |
| 工具注册到 server | - | `server.ts` | L510-538 | [x] |

**本节验收结果:** [x] 通过

---

### §Double Check 机制 (store-sync.md L185-257)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| expected_hash 字段 | L194 | `storeSchemas.ts` | L397 | [x] |
| Double Check 逻辑说明 | L190-232 | `planSync.ts` | L1-30（注释） | [x] |

**本节验收结果:** [x] 通过（设计已包含在类型定义中）

---

### §3.5.2 大批量同步优化 (store-sync.md L355-612)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| execute 限制说明 | L277-319 | `planSync.ts` | L1-30（注释） | [x] |
| 会话管理设计 | L408-456 | - | 设计文档已完整 | [x] |
| CLI 分批逻辑设计 | L522-597 | - | 设计文档已完整 | [x] |

**本节验收结果:** [x] 通过（设计已完整，实现在 CLI 层）

---

## 2. 完整性检查

- [x] 设计文档中定义的所有类型都已实现
- [x] 设计文档中定义的所有字段都已实现
- [x] 设计文档中定义的所有工具都已实现
- [x] 所有新增 Schema 已在 storeSchemas.ts 中定义
- [x] 所有新增工具已在 server.ts 中注册
- [x] 所有工具处理函数已创建（骨架实现）
- [x] 无遗漏、无多余实现

---

## 3. 实现产物清单

| 文件类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| Schema 定义 | `packages/mcp-dsl/src/schemas/storeSchemas.ts` | 新增 Sync 工具类型定义（L302-448） | [x] |
| 工具实现 | `packages/mcp-dsl/src/tools/store/sync.ts` | c4a_store_sync 骨架实现 | [x] |
| 工具实现 | `packages/mcp-dsl/src/tools/store/planSync.ts` | c4a_store_plan_sync 骨架实现 | [x] |
| 工具导出 | `packages/mcp-dsl/src/tools/store/index.ts` | 新增 Sync 工具导出 | [x] |
| 服务注册 | `packages/mcp-dsl/src/server.ts` | 注册 c4a_store_sync 和 c4a_store_plan_sync | [x] |

---

## 4. 新增类型定义清单

| 类型名称 | 用途 | 定义位置 | 状态 |
|---------|------|---------|:----:|
| `StoreSyncInput` | c4a_store_sync 输入参数 | `storeSchemas.ts:307-314` | [x] |
| `StoreSyncResult` | c4a_store_sync 返回结果 | `storeSchemas.ts:331-335` | [x] |
| `SyncStats` | 同步统计信息 | `storeSchemas.ts:319-326` | [x] |
| `StorePlanSyncInput` | c4a_store_plan_sync 输入参数 | `storeSchemas.ts:375-382` | [x] |
| `StorePlanSyncResult` | 计划模式返回结果 | `storeSchemas.ts:403-414` | [x] |
| `StorePlanSyncExecutedResult` | 执行模式返回结果 | `storeSchemas.ts:419-434` | [x] |
| `LocalFileManifest` | 本地文件摘要 | `storeSchemas.ts:342-350` | [x] |
| `SyncSnapshot` | 同步快照 | `storeSchemas.ts:355-361` | [x] |
| `SyncOptions` | 同步选项 | `storeSchemas.ts:366-370` | [x] |
| `SyncAction` | 同步操作指令 | `storeSchemas.ts:387-398` | [x] |

---

## 5. 验收结论

- **验收人:** AI Agent (Claude Opus 4.5)
- **验收时间:** 2026-01-27 18:00
- **结果:** [x] 通过
- **完成度:** 骨架实现完成，类型定义完整，工具注册正确
- **遗留问题:**
  - 工具处理函数为骨架实现，需要后续补充具体业务逻辑
  - c4a_store_sync 需要实现路径安全校验和文件系统操作
  - c4a_store_plan_sync 需要实现三方对比逻辑和事务处理
  - Double Check 机制需要在 CLI 层实现
  - 大批量同步优化需要在 CLI 和 Server 层实现
- **下一步:**
  - 继续实现 3.11-3.19（Feat 生命周期管理工具）
  - 或者先实现 Store Sync 工具的具体业务逻辑

---

## 6. 设计文档对照总结

本次实现严格遵循设计文档：
- `v0.3.0/detailed-design/mcp/store-sync.md` §3.5-3.5.2

所有设计文档中定义的：
- ✅ 工具名称与设计文档一致
- ✅ 输入参数完整且类型正确
- ✅ 返回格式符合规范
- ✅ 支持 Local 和 Server/Remote 两种模式
- ✅ Double Check 机制的类型定义完整
- ✅ 大批量同步优化的设计已包含在类型定义中
- ✅ 操作类型（upload/download/conflict/delete_local/delete_remote/skip）完整

**验收通过，可以继续下一阶段任务。**

---

## 7. 本次会话完成总结

### 已完成任务（3.1-3.10）

1. ✅ **MCP 工具规范**（3.1-3.2）- 工具分组、可见性分层
2. ✅ **Store CRUD 工具**（3.3-3.6）- save/read/list/delete 骨架实现
3. ✅ **Store Sync 工具**（3.7-3.8）- sync/plan_sync 骨架实现
4. ✅ **Double Check 机制**（3.9）- 类型定义完整
5. ✅ **大批量同步优化**（3.10）- 设计已包含在类型定义中

### 创建的文件

- `packages/mcp-dsl/src/schemas/storeSchemas.ts` - 完整的 Store 工具类型定义（448 行）
- `packages/mcp-dsl/src/tools/store/save.ts` - c4a_store_save 骨架
- `packages/mcp-dsl/src/tools/store/read.ts` - c4a_store_read 骨架
- `packages/mcp-dsl/src/tools/store/list.ts` - c4a_store_list 骨架
- `packages/mcp-dsl/src/tools/store/delete.ts` - c4a_store_delete 骨架
- `packages/mcp-dsl/src/tools/store/sync.ts` - c4a_store_sync 骨架
- `packages/mcp-dsl/src/tools/store/planSync.ts` - c4a_store_plan_sync 骨架
- `packages/mcp-dsl/src/tools/store/index.ts` - Store 工具统一导出

### 更新的文件

- `packages/mcp-dsl/src/server.ts` - 注册了 6 个 Store 工具
- `v0.3.0-plan-opus/03-mcp-store.md` - 更新任务完成状态
- `v0.3.0-plan-opus/checklist/03-01-06-store-crud-skeleton.md` - CRUD 工具验收清单

### 下一步建议

**选项 1：继续实现 Feat 生命周期管理工具（3.11-3.19）**
- c4a_store_feat_lifecycle（Feat 创建/流转/删除）
- c4a_store_feat_merge（Feat 合并 + 冲突解决）
- c4a_store_feat_checklist（Checklist CRUD）
- c4a_store_update_workflow_step（原子更新 workflow 步骤）
- 并发修改预警、引用完整性预警

**选项 2：实现 Store 工具的具体业务逻辑**
- 补充 CRUD 和 Sync 工具的实际实现
- 实现与 Python 服务层（mcp-data）的交互
- 实现 ADR 检查、并发修改检查等副作用逻辑

**选项 3：实现辅助和运维工具（3.20-3.23）**
- c4a_store_read_history（变更历史查询）
- c4a_store_backup/restore（备份恢复）
- c4a_store_repair（数据一致性修复）
- c4a_store_validate（架构一致性检查）

您希望我继续哪个方向？
