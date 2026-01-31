# Part 07 Data Ops - Agent 提示词

> 执行顺序：Agent-R（重构）→ Agent-0 → Agent-1~5 并行 → Agent-6

---

## 概述

Data Ops 模块实现数据操作的核心能力，包括：

| 子模块 | 设计文档 | 核心能力 | 任务编号 |
|--------|---------|---------|---------|
| 跨层级/跨项目引用 | [cross-reference.md](../v0.3.0/detailed-design/data-ops/cross-reference.md) | 引用解析、Copy-on-Write、悬空引用处理 | 7.1-7.4 |
| 同步导出 | [sync-export.md](../v0.3.0/detailed-design/data-ops/sync-export.md) | 双向同步、增量导出、冲突检测 | 7.5-7.8 |
| 冲突解决与回滚 | [conflict-rollback.md](../v0.3.0/detailed-design/data-ops/conflict-rollback.md) | feat 冲突解决、回滚 feat 机制 | 7.9-7.11 |
| 跨项目事务 | [cross-project-transaction.md](../v0.3.0/detailed-design/data-ops/cross-project-transaction.md) | 跨项目 feat、事务补偿 | 7.12-7.14 |
| Workflow 恢复 | [workflow-recovery.md](../v0.3.0/detailed-design/data-ops/workflow-recovery.md) | 断点续传、步骤幂等、实体清理 | 7.15-7.18 |

**依赖关系**：
- 依赖 Part 06 Local Mode 的 SQLite 存储层
- 被 Part 08 MCP Tools 和 Part 10 Skills 依赖

**优先级说明**：

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | Agent-R + 7.1-7.8 | Local 模式闭环必需 |
| P1 | 7.9-7.11 | Feat 高级功能（冲突解决、回滚） |
| P2 | 7.12-7.14 | 依赖 Part 13 Server 模式，可挂起 |
| P3 | 7.15-7.18 | Workflow 恢复，可后续迭代 |

---

## Agent-R：重构 lite-adapter 业务逻辑（必须最先完成）

```
请执行 lite-adapter/ 业务逻辑重构任务，将业务逻辑迁移到 data-ops/。

【背景】
当前 lite-adapter/ 混合了两类代码：
- 纯 CRUD 操作（应保留）
- 业务逻辑（应迁移到 data-ops/）

为支持未来 Server 模式复用业务逻辑，需要分离这两层。

【重构目标】
lite-adapter/ 只保留纯存储操作，业务逻辑统一放 data-ops/。

【迁移清单】

1. Feat 生命周期逻辑：
   - 源文件：lite-adapter/featLifecycle.ts
   - 目标：data-ops/feat/lifecycle.ts
   - 保留在 lite-adapter/：无（整体迁移）
   - 迁移内容：
     - createFeat() 状态机逻辑
     - transitionFeat() 状态流转验证
     - deleteFeat() 清理逻辑

2. Feat 合并逻辑：
   - 源文件：lite-adapter/featMerge.ts
   - 目标：data-ops/feat/merge.ts
   - 迁移内容：
     - detectFeatConflicts() 冲突检测算法 ← 统一实现位置
     - mergeFeatToMain() 合并算法
     - collectFeatEntitiesForVector() 实体收集
   - 注意：后续 Agent-3 的 conflictResolver.ts 调用此处实现，不重复实现

3. 同步操作逻辑：
   - 源文件：lite-adapter/sync-operations.ts
   - 目标：data-ops/sync/syncEngine.ts
   - 迁移内容：
     - 同步策略逻辑
     - 增量同步算法
     - 冲突检测逻辑
   - 保留在 lite-adapter/：SQLite 特定的读写操作
   - 注意：后续 Agent-2 在此基础上补齐新能力（导出引擎等）

4. Feat Workflow 逻辑：
   - 源文件：lite-adapter/featWorkflow.ts
   - 目标：data-ops/workflow/
   - 迁移内容：工作流状态管理

5. 引用解析模块：
   - 源文件：data-ops/reference/parser.ts（已存在）
   - 检查：若 reference/ 目录不存在则创建
   - 检查：parser.ts 依赖的 types.ts 需要创建（Agent-0 或 Agent-1 补齐）

【重构步骤】

Step 1: 创建 data-ops/ 目录结构
   packages/storage/src/data-ops/
   ├── index.ts
   ├── types.ts                    # 共享类型 + StorageOperations 接口
   ├── feat/                       # Feat 业务逻辑
   │   ├── index.ts
   │   ├── lifecycle.ts            # 生命周期（从 featLifecycle.ts 迁移）
   │   └── merge.ts                # 合并逻辑（从 featMerge.ts 迁移）
   ├── reference/                  # 引用解析（parser.ts 已存在，需补 types.ts）
   ├── sync/                       # 同步逻辑
   ├── transaction/                # 事务逻辑
   └── workflow/                   # Workflow 逻辑

Step 2: 定义存储接口
   - 创建 data-ops/types.ts
   - 定义 StorageOperations 接口（CRUD 操作抽象）
   - 接口设计原则：
     - 保留批量操作（batchSave、batchDelete）避免性能下降
     - 更新接口返回 affectedRows 用于并发冲突检测
     - 支持事务上下文传递
   - data-ops/ 通过接口调用存储层，不直接依赖 SQLite

Step 3: 迁移 featLifecycle.ts
   - 复制业务逻辑到 data-ops/feat/lifecycle.ts
   - 将 SQLite 直接调用改为通过 StorageOperations 接口
   - 更新 lite-adapter/featLifecycle.ts 调用 data-ops/

Step 4: 迁移 featMerge.ts
   - 复制业务逻辑到 data-ops/feat/merge.ts
   - 抽象存储操作
   - 更新调用关系

Step 5: 迁移 sync-operations.ts
   - 分离业务逻辑和 SQLite 操作
   - 业务逻辑迁移到 data-ops/sync/
   - SQLite 操作保留在 lite-adapter/

Step 6: 更新 lite-adapter/ 入口
   - lite-adapter.ts 调用 data-ops/ 的业务逻辑
   - 传入 SQLite 实现的 StorageOperations

Step 7: 验证
   - 运行现有测试，确保功能不变
   - bun run test --filter storage

【产物】
- data-ops/types.ts（StorageOperations 接口）
- data-ops/feat/lifecycle.ts
- data-ops/feat/merge.ts
- data-ops/sync/syncEngine.ts（基础框架）
- 更新后的 lite-adapter/ 文件
- 所有现有测试通过

【注意事项】
- 保持 API 兼容，外部调用方式不变
- 先迁移，后优化，避免同时改动太多
- 每迁移一个文件就运行测试验证
- StorageOperations 接口设计要考虑 SQLite 批量操作性能
```

---

## Agent-0：前置准备（必须先完成）

```
请执行 Part 07 Data Ops 的前置准备任务：

1. 阅读设计文档：
   - v0.3.0/detailed-design/data-operations.md（总览）
   - v0.3.0/architecture.md §3.4（关系类型）
   - v0.3.0/concepts.md §6（关系类型定义）

2. 确认 Agent-R 重构已完成：
   - data-ops/feat/lifecycle.ts 已存在
   - data-ops/feat/merge.ts 已存在
   - data-ops/types.ts（StorageOperations 接口）已存在
   - 现有测试全部通过：bun run test --filter storage

3. 补全 Data Ops 模块目录结构：
   packages/storage/src/data-ops/
   ├── index.ts                    # 统一导出
   ├── types.ts                    # 共享类型（Agent-R 已创建）
   ├── feat/                       # Feat 业务逻辑（Agent-R 已创建）
   │   ├── index.ts
   │   ├── lifecycle.ts            # 生命周期
   │   └── merge.ts                # 合并逻辑（含 detectFeatConflicts）
   ├── reference/                  # 引用解析模块
   │   ├── index.ts
   │   ├── types.ts                # 引用相关类型 ← 新增（parser.ts 依赖）
   │   ├── parser.ts               # 引用格式解析（已存在，检查是否正常）
   │   ├── resolver.ts             # 引用解析器 ← 新增
   │   └── validator.ts            # 悬空引用验证 ← 新增
   ├── sync/                       # 同步导出模块
   │   ├── index.ts
   │   ├── types.ts                # 同步相关类型 ← 新增
   │   ├── syncEngine.ts           # 同步引擎（Agent-R 已迁移基础框架）
   │   ├── exportEngine.ts         # 导出引擎 ← 新增
   │   └── conflictDetector.ts     # 同步冲突检测 ← 新增
   ├── transaction/                # 事务模块
   │   ├── index.ts
   │   ├── types.ts                # 事务相关类型 ← 新增
   │   ├── featTransaction.ts      # feat 事务 ← 新增
   │   ├── conflictResolver.ts     # 冲突解决策略 ← 新增（调用 feat/merge.ts）
   │   ├── rollback.ts             # 回滚机制 ← 新增
   │   └── compensator.ts          # 补偿机制 ← 新增
   └── workflow/                   # Workflow 模块
       ├── index.ts
       ├── types.ts                # Workflow 类型 ← 新增
       ├── workflowState.ts        # 状态管理（Agent-R 已迁移基础框架）
       ├── stepExecutor.ts         # 步骤执行器 ← 新增
       └── recovery.ts             # 恢复机制 ← 新增

4. Schema/数据库变更清单：

   【新增表】
   - workflow_states: Workflow 状态持久化
     ```sql
     CREATE TABLE IF NOT EXISTS workflow_states (
       id TEXT PRIMARY KEY,
       workflow_type TEXT NOT NULL,
       current_step INTEGER DEFAULT 0,
       total_steps INTEGER NOT NULL,
       state TEXT DEFAULT 'pending',  -- pending/running/paused/completed/failed
       context_json TEXT,              -- 步骤上下文
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_workflow_states_state ON workflow_states(state);
     ```

   - compensation_logs: 补偿日志
     ```sql
     CREATE TABLE IF NOT EXISTS compensation_logs (
       id TEXT PRIMARY KEY,
       transaction_id TEXT NOT NULL,
       action TEXT NOT NULL,
       rollback_action TEXT NOT NULL,
       params_json TEXT,
       executed INTEGER DEFAULT 0,
       created_at TEXT NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_compensation_logs_tx ON compensation_logs(transaction_id);
     ```

   【新增字段 - 需要 ALTER TABLE】
   - entities 表：
     - orphaned INTEGER DEFAULT 0  -- 标记孤立实体
     - orphaned_at TEXT            -- 标记时间

   【新增索引】
   - CREATE INDEX IF NOT EXISTS idx_entities_orphaned ON entities(orphaned) WHERE orphaned = 1;

5. Schema 迁移策略（向后兼容）：
   - 修改 packages/storage/src/sqlite-store.ts
   - 在 initSchema() 中：
     - 新表使用 CREATE TABLE IF NOT EXISTS（幂等）
     - 新字段使用 ALTER TABLE ADD COLUMN（需 try-catch，已存在时忽略）
     - 新索引使用 CREATE INDEX IF NOT EXISTS（幂等）
   - 迁移代码示例：
     ```typescript
     // 新增字段（兼容已有数据库）
     try {
       db.exec('ALTER TABLE entities ADD COLUMN orphaned INTEGER DEFAULT 0');
       db.exec('ALTER TABLE entities ADD COLUMN orphaned_at TEXT');
     } catch (e) {
       // 字段已存在，忽略
     }
     ```

6. 类型/Schema/Validator 更新：
   - 更新 packages/core/src/types/entities.ts
     - Entity 类型添加 orphaned?: boolean, orphaned_at?: string
   - 更新 packages/core/src/index.ts（统一导出入口）
     - 导出新增类型（WorkflowState、CompensationLog 等）
   - 注意：workflow_states 和 compensation_logs 是内部表，
     不需要 JSON Schema 和 validator 注册（非 DSL 实体）

7. 产物：
   - 目录结构补全完成
   - 各模块 index.ts 和 types.ts 导出占位
   - Schema 变更已应用（含迁移逻辑）
   - 类型更新已完成
   - 确认依赖的 store 模块可用

完成后告诉我，我会启动 Agent-1~5 并行执行。
```

**状态**：✅ Agent-0 前置准备已完成（2026-01-30），测试通过：`bun run --filter @c4a/storage test`

---

## Agent-1：跨层级/跨项目引用（7.1-7.4）

```
请实现跨层级和跨项目引用模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/data-ops/cross-reference.md（完整阅读）
   - 重点关注：
     - §1 引用格式规范
     - §2 引用解析优先级
     - §3 Copy-on-Write 机制
     - §4 悬空引用处理

2. 任务 7.1 - 引用格式规范：
   - 实现 packages/storage/src/data-ops/reference/types.ts
     - ReferenceFormat 类型（简单ID/project:/repo:/scope:）
     - ResolvedReference 类型
     - ReferenceError 类型
   - 实现 packages/storage/src/data-ops/reference/parser.ts
     - parseReference(ref: string): ParsedReference
     - 支持格式：{id}, project:{project_id}/{id}, repo:{repo_id}/{id}, scope:{scope}/{id}

3. 任务 7.2 - 引用解析优先级：
   - 实现 packages/storage/src/data-ops/reference/resolver.ts
     - resolveReference(ref: string, context: ResolveContext): ResolvedReference
     - 解析优先级：本项目 → 同 repo 基建 → 同 repo 其他项目 → Enterprise → Domain → 悬空
     - 歧义检测：发现多个匹配时返回警告

4. 任务 7.3 - 悬空引用处理：
   - 实现 packages/storage/src/data-ops/reference/validator.ts
     - validateReferences(entity: Entity): ValidationResult
     - 检测悬空引用（状态感知：draft/approved/published）
     - 生成修复建议

5. 任务 7.4 - Copy-on-Write 机制：
   - 在 resolver.ts 中实现 copyOnWrite(entityId: string, targetFeatId: string): Entity
   - 从主分支复制实体到 feat 分支
   - 设置 proposal_id = targetFeatId
   - 保留原始 source_project、source_repo

6. 测试用例（写到 packages/storage/src/data-ops/reference/__tests__/）：
   - parser.test.ts：各种引用格式解析
   - resolver.test.ts：解析优先级、歧义检测
   - validator.test.ts：悬空引用检测
   - copyOnWrite.test.ts：Copy-on-Write 机制
```

---

## Agent-2：同步导出引擎（7.5-7.8）

```
请实现同步导出模块。

【前置条件】
- Agent-R 已将 sync-operations.ts 基础框架迁移到 data-ops/sync/syncEngine.ts
- 本任务在迁移后的基础上补齐新能力

1. 阅读设计文档：
   - v0.3.0/detailed-design/data-ops/sync-export.md（完整阅读）
   - 重点关注：
     - §1 同步策略
     - §2 增量同步算法
     - §3 冲突检测
     - §4 导出格式

2. 任务 7.5 - 同步引擎：
   - 实现 packages/storage/src/data-ops/sync/types.ts
     - SyncDirection: 'db-to-file' | 'file-to-db' | 'bidirectional'
     - SyncResult、ConflictInfo、ExportOptions 类型
   - 扩展 packages/storage/src/data-ops/sync/syncEngine.ts（Agent-R 已迁移基础）
     - sync(options: SyncOptions): Promise<SyncResult>
     - 双向同步：数据库 ↔ .context/ 目录

3. 任务 7.6 - 增量同步算法：
   - 在 syncEngine.ts 中实现增量同步
   - 基于 content_hash 和 updated_at 判断变更
   - 只同步有变化的实体

4. 任务 7.7 - 冲突检测：
   - 实现 packages/storage/src/data-ops/sync/conflictDetector.ts
     - detectConflicts(dbEntities, fileEntities): ConflictInfo[]
     - 冲突类型：内容冲突、删除冲突、类型冲突
     - 生成冲突报告

5. 任务 7.8 - 导出引擎：
   - 实现 packages/storage/src/data-ops/sync/exportEngine.ts
     - exportToFiles(options: ExportOptions): Promise<ExportResult>
     - 支持格式：yaml（默认）、json
     - 支持范围：全量、增量、指定 feat
     - 目录结构：遵循 architecture.md §2.2

6. 同步规则（冲突处理细则）：
   - **数据库是权威源**
   - **db-to-file**：DB 内容覆盖文件，无冲突
   - **file-to-db**：
     - 新增实体：允许流入 DB
     - 已存在实体：以 DB 为准，忽略文件修改（或报警告）
   - **bidirectional**：
     - 双方都有修改时报错，要求用户手动解决
     - 仅一方修改时自动同步
   - checklist 不参与同步（仅数据库存储）
   - assets 目录仅文件系统
   - contracts 目录仅文件系统（大型契约）

7. 测试用例（写到 packages/storage/src/data-ops/sync/__tests__/）：
   - syncEngine.test.ts：双向同步、增量同步
   - conflictDetector.test.ts：各类冲突检测
   - exportEngine.test.ts：导出格式、目录结构
```

---

## Agent-3：冲突解决与回滚（7.9-7.11）

```
请实现冲突解决与回滚模块。

【重要说明】
- detectFeatConflicts() 已在 data-ops/feat/merge.ts 中实现（Agent-R 迁移）
- 本模块的 conflictResolver.ts 负责"冲突解决策略"，调用 feat/merge.ts 的检测函数
- 不要重复实现冲突检测算法

1. 阅读设计文档：
   - v0.3.0/detailed-design/data-ops/conflict-rollback.md（完整阅读）
   - 重点关注：
     - §1 feat 冲突场景
     - §2 冲突解决策略
     - §3 回滚机制

2. 任务 7.9 - Feat 冲突检测（策略层）：
   - 实现 packages/storage/src/data-ops/transaction/types.ts
     - FeatConflict 类型（复用或从 feat/merge.ts 导入）
     - ConflictResolution: 'ours' | 'theirs' | 'manual' | 'abort'
     - RollbackFeat 类型
   - 实现 packages/storage/src/data-ops/transaction/conflictResolver.ts
     - 导入 { detectFeatConflicts } from '../feat/merge.js'
     - getFeatConflicts(featId: string): FeatConflict[]  // 封装调用
     - 检测场景（由 feat/merge.ts 实现）：
       - 并发 feat 修改同一实体
       - feat 引用的实体被其他 feat 删除
       - feat 内实体类型与主分支冲突

3. 任务 7.10 - 冲突解决策略：
   - 在 conflictResolver.ts 中实现
     - resolveConflict(conflict: FeatConflict, resolution: ConflictResolution): void
   - 自动合并：新增实体、无冲突修改
   - 需人工介入：内容冲突、删除冲突、语义冲突
   - 提供冲突报告和解决建议

4. 任务 7.11 - 回滚机制：
   - 实现 packages/storage/src/data-ops/transaction/rollback.ts
     - createRollbackFeat(targetFeatId: string, reason: string): RollbackFeat
     - 回滚机制：创建"回滚 feat"而非直接删除
     - 保持审计追踪
     - executeRollback(rollbackFeatId: string): Promise<void>

5. 测试用例（写到 packages/storage/src/data-ops/transaction/__tests__/）：
   - conflictResolver.test.ts：各类冲突检测和解决
   - rollback.test.ts：回滚 feat 创建和执行
```

**状态**：已实现冲突解决/回滚逻辑与测试（2026-01-30）

---

## Agent-4：跨项目事务（7.12-7.14）

```
请实现跨项目事务模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/data-ops/cross-project-transaction.md（完整阅读）
   - 重点关注：
     - §1 跨项目 feat 设计
     - §2 事务边界
     - §3 补偿机制
     - §4 一致性保证

2. 任务 7.12 - Feat 事务：
   - 实现 packages/storage/src/data-ops/transaction/featTransaction.ts
     - beginFeatTransaction(featId: string): TransactionContext
     - commitFeatTransaction(ctx: TransactionContext): Promise<void>
     - rollbackFeatTransaction(ctx: TransactionContext): Promise<void>
     - 支持跨项目实体操作

3. 任务 7.13 - 补偿机制：
   - 实现 packages/storage/src/data-ops/transaction/compensator.ts
     - CompensationLog 类型
     - recordCompensation(action: string, rollbackAction: string): void
     - executeCompensation(transactionId: string): Promise<void>
     - 补偿日志持久化到数据库

4. 任务 7.14 - 跨项目 Feat：
   - 在 featTransaction.ts 中扩展跨项目支持
   - feat 可以包含多个项目的实体
   - 通过 proposal_id 关联
   - 发布时原子性合并所有项目的实体
   - 失败时执行补偿回滚

5. 事务保证：
   - Local 模式：SQLite 单文件事务
   - Server 模式：最终一致性 + 补偿机制
   - 补偿日志：记录每个操作的逆操作

6. 测试用例（写到 packages/storage/src/data-ops/transaction/__tests__/）：
   - featTransaction.test.ts：事务开始、提交、回滚
   - compensator.test.ts：补偿日志记录和执行
   - crossProject.test.ts：跨项目 feat 场景
```

---

## Agent-5：Workflow 恢复机制（7.15-7.18）

```
请实现 Workflow 恢复模块。

1. 阅读设计文档：
   - v0.3.0/detailed-design/data-ops/workflow-recovery.md（完整阅读）
   - 重点关注：
     - §1 Workflow 状态模型
     - §2 断点续传机制
     - §3 步骤幂等性
     - §4 实体清理机制

2. 任务 7.15 - Workflow 状态管理：
   - 实现 packages/storage/src/data-ops/workflow/types.ts
     - WorkflowState: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
     - WorkflowStep、WorkflowCheckpoint 类型
     - RecoveryStrategy: 'retry' | 'skip' | 'rollback' | 'manual'
   - 实现 packages/storage/src/data-ops/workflow/workflowState.ts
     - createWorkflow(workflowId: string, steps: WorkflowStep[]): Workflow
     - getWorkflowState(workflowId: string): WorkflowState
     - updateWorkflowState(workflowId: string, state: WorkflowState): void
     - 状态持久化到数据库 workflow_states 表

3. 任务 7.16 - 断点续传：
   - 实现 packages/storage/src/data-ops/workflow/recovery.ts
     - saveCheckpoint(workflowId: string, checkpoint: WorkflowCheckpoint): void
     - resumeFromCheckpoint(workflowId: string): Promise<void>
     - 断点续传：从最后成功的步骤继续

4. 任务 7.17 - 步骤幂等性：
   - 实现 packages/storage/src/data-ops/workflow/stepExecutor.ts
     - executeStep(step: WorkflowStep): Promise<StepResult>
     - 幂等性保证：相同输入产生相同结果
     - 幂等键：step_id + input_hash
     - 跳过已完成的步骤

5. 任务 7.18 - 实体清理机制：
   - 在 recovery.ts 中实现
     - cleanupOrphanedEntities(workflowId: string): Promise<void>
     - 清理失败 workflow 产生的孤立实体
   - 清理规则：
     - workflow 失败时标记关联实体为 orphaned
     - 提供手动清理命令
     - 自动清理：超过 24 小时的 orphaned 实体

6. 测试用例（写到 packages/storage/src/data-ops/workflow/__tests__/）：
   - workflowState.test.ts：状态管理
   - stepExecutor.test.ts：步骤执行、幂等性
   - recovery.test.ts：断点续传、实体清理
```

**状态**：已创建占位文件（types.ts / workflowState.ts / stepExecutor.ts / recovery.ts），逻辑与测试待实现（2026-01-30）

---

## Agent-6：集成收尾（等待 Agent-1~5 全部完成）

```
请执行 Part 07 Data Ops 的集成收尾任务。

1. 阅读设计文档：
   - v0.3.0/detailed-design/data-operations.md（确认所有模块已实现）
   - v0.3.0/architecture.md §5（数据流）

2. 集成任务：
   - 更新 packages/storage/src/data-ops/index.ts
     - 统一导出所有子模块
     - 导出类型定义

   - 更新 packages/storage/src/index.ts
     - 添加 data-ops 模块导出

   - 创建集成测试 packages/storage/src/data-ops/__tests__/integration.test.ts
     - 端到端测试：创建 feat → 添加实体 → 解析引用 → 同步 → 发布
     - 跨项目 feat 测试
     - 冲突解决测试
     - Workflow 恢复测试

3. 文档更新：
   - 更新 packages/storage/README.md
     - 添加 Data Ops 模块说明
     - API 使用示例

  4. 验证清单：
   - [x] 引用解析：所有格式正确解析
   - [x] Copy-on-Write：正确复制实体到 feat
   - [x] 同步引擎：双向同步无数据丢失
   - [x] 冲突检测：所有冲突类型正确识别
   - [x] 回滚机制：回滚 feat 正确创建和执行
   - [x] 跨项目事务：原子性保证
   - [x] Workflow 恢复：断点续传正常工作
   - [x] 幂等性：重复执行结果一致
   - [x] 实体清理：孤立实体正确清理

5. 产物：
   - packages/storage/src/data-ops/ 完整实现
   - 集成测试通过
   - README 文档更新
```

---

## 执行检查清单

| 步骤 | Agent | 任务编号 | 状态 | 完成时间 |
|------|-------|---------|:----:|---------|
| 0 | Agent-R | 重构 lite-adapter | [x] | |
| 1 | Agent-0 | 前置准备 + Schema | [x] | |
| 2 | Agent-1 | 7.1-7.4 | [x] | 2026-01-31 |
| 2 | Agent-2 | 7.5-7.8 | [x] | 2026-01-30 |
| 2 | Agent-3 | 7.9-7.11 | [x] | 2026-01-30 |
| 2 | Agent-4 | 7.12-7.14 | [x] | |
| 2 | Agent-5 | 7.15-7.18 | [x] | |
| 3 | Agent-6 | 集成收尾 | [x] | 2026-01-30 |

---

## 任务编号索引

| 编号 | 任务 | Agent |
|------|------|-------|
| 7.1 | 引用格式规范 | Agent-1 |
| 7.2 | 引用解析优先级 | Agent-1 |
| 7.3 | 悬空引用处理 | Agent-1 |
| 7.4 | CoW 机制实现 | Agent-1 |
| 7.5 | 同步引擎 | Agent-2 |
| 7.6 | 增量同步算法 | Agent-2 |
| 7.7 | 冲突检测 | Agent-2 |
| 7.8 | 导出引擎 | Agent-2 |
| 7.9 | Feat 冲突检测 | Agent-3 |
| 7.10 | 冲突解决策略 | Agent-3 |
| 7.11 | 回滚机制 | Agent-3 |
| 7.12 | Feat 事务 | Agent-4 |
| 7.13 | 补偿机制 | Agent-4 |
| 7.14 | 跨项目 Feat | Agent-4 |
| 7.15 | Workflow 状态管理 | Agent-5 |
| 7.16 | 断点续传 | Agent-5 |
| 7.17 | 步骤幂等性 | Agent-5 |
| 7.18 | 实体清理机制 | Agent-5 |

---

## 关键设计决策

### 1. 引用解析优先级

```
本项目 → 同 repo 基建 → 同 repo 其他项目 → Enterprise → Domain → 悬空引用
```

### 2. Copy-on-Write 机制

修改 published 实体时，自动复制到 feat 分支：
- 设置 `proposal_id = feat_id`
- 保留原始 `source_project`、`source_repo`
- 主分支实体不变

### 3. 同步策略

- **数据库是权威源**
- **同步方向与冲突处理**：
  - `db-to-file`：DB 内容覆盖文件，无冲突
  - `file-to-db`：
    - 新增实体：允许流入 DB
    - 已存在实体：以 DB 为准，忽略文件修改（或报警告）
  - `bidirectional`：
    - 双方都有修改时报错，要求用户手动解决
    - 仅一方修改时自动同步
- **不参与同步的内容**：
  - checklist（仅数据库存储）
  - assets 目录（仅文件系统）
  - contracts 目录（仅文件系统，大型契约）

### 4. 回滚机制

通过创建"回滚 feat"实现，而非直接删除：
- 保持完整审计追踪
- 支持回滚的回滚
- 符合 feat 生命周期

### 5. 幂等性保证

```typescript
幂等键 = hash(step_id + input_hash)
执行前检查 → 已完成则返回缓存 → 未完成则执行并记录
```

### 6. 补偿机制

```typescript
// 记录每个操作的逆操作
recordCompensation(
  action: "create_entity",
  rollbackAction: "delete_entity",
  params: { entity_id: "xxx" }
)
```
