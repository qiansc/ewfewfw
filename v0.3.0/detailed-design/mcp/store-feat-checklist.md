# Feat Checklist 与工作流


### 3.8 `c4a_store_feat_checklist`（checklist 管理）

**设计目的**：管理 Feat 的实现清单，数据库是唯一数据源。

> **关键设计**：Checklist **不参与同步**，数据库是唯一数据源。
>
> - Agent 通过此工具直接操作数据库中的 checklist
> - CLI 的 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 `checklist.md`（只读视图）
> - 本地文件仅供人类查看，不作为数据源
> - 避免了双重标准和状态分裂问题

**输入（概念签名）**：

```typescript
c4a_store_feat_checklist({
  action: "generate" | "get" | "patch" | "clear",
  feat_id: "feat-a001-user-login",

  // generate 用：从 Technical Spec 自动生成 checklist
  source?: "technical_spec",
  // generate 用：可选的初始任务（用于一次性生成带任务的 checklist）
  items?: ChecklistItem[],

  // patch 用：更新特定任务（增量模式，推荐用于多人协作）
  patches?: [
    {
      task_id: "task-1",
      updates: {
        status?: "completed" | "in_progress" | "pending" | "blocked",
        assignee?: "alice@example.com",
        completed_at?: "2026-01-22T10:00:00Z",
        blocked_reason?: "等待 API 定义"
      }
    }
  ],

  // generate 用：是否验证 checklist 结构
  validate?: boolean  // 默认 true
})
```

**返回（概念示例）**：

```typescript
// action=generate（从 Technical Spec 生成）
{
  success: true,
  feat_id: "feat-a001-user-login",
  checklist: {
    version: "1.0",
    metadata: {
      feat_id: "feat-a001-user-login",
      generated_at: "2026-01-22T10:00:00Z",
      source: "technical_spec"
    },
    items: [
      { id: "task-001", title: "创建 auth-service Container", type: "dsl", status: "pending", entity_id: "auth-service" },
      { id: "task-002", title: "实现 jwt-component Component", type: "dsl", status: "pending", entity_id: "jwt-component" },
      { id: "task-003", title: "创建 login API Contract", type: "contract", status: "pending", entity_id: "contract-login-api" }
    ]
  }
}

// action=get（获取当前 checklist）
{
  success: true,
  feat_id: "feat-a001-user-login",
  checklist: {
    version: "1.0",
    updated_at: "2026-01-22T15:30:00Z",
    updated_by: "bob@example.com",
    items: [...]
  }
}

// action=patch（增量更新成功）
{
  success: true,
  feat_id: "feat-a001-user-login",
  patched_at: "2026-01-22T15:30:00Z",
  patched_tasks: [
    { task_id: "task-1", fields_updated: ["status", "completed_at"] },
    { task_id: "task-2", fields_updated: ["assignee"] }
  ],
  updated_checklist: { ... }  // 更新后的完整 checklist
}

// action=patch（任务不存在）
{
  success: false,
  error: "task_not_found",
  missing_tasks: ["task-999"],
  message: "任务 task-999 不存在，请先执行 get 获取最新 checklist"
}

// action=clear
{
  success: true,
  feat_id: "feat-a001-user-login",
  cleared: true
}
```

**职责说明**：

- **generate**：从 Technical Spec 自动生成 checklist 并保存到数据库
  - 解析 feat 关联的 Container、Component、Contract 实体
  - 为每个实体生成对应的任务项（带 `entity_id` 关联）
  - 若传入 `items`，与自动生成的任务合并（`id` 冲突时以 `items` 为准）
  - 仅传 `items`（不提供 `source`）时，直接用作初始 checklist
  - 直接保存到 MongoDB，返回结构化的 checklist
  - LLM 可在此基础上通过 patch 补充自定义任务
- **get**：从数据库获取当前 checklist
  - 返回完整的 checklist 内容
  - CLI 可用此数据渲染本地 `checklist.md` 文件
- **patch**：增量更新特定任务（推荐用于多人协作）
  - 仅更新指定任务的特定字段，不影响其他任务
  - 直接在数据库执行原子更新，无冲突风险
  - 返回更新后的完整 checklist
  - 适用于单个任务状态变更、分配负责人等操作
- **clear**：删除数据库中的 checklist 字段
  - 由 `c4a_store_feat_lifecycle` 在 transition 到 `published`/`archived` 时自动调用
  - CLI 应在清理前先渲染最终版本到本地文件（作为历史记录）

**Checklist 验证规则**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `items` | array | ✅ | 任务列表 |
| `items[].id` | string | ✅ | 任务唯一标识，格式 `task-{number}` |
| `items[].title` | string | ✅ | 任务标题 |
| `items[].status` | enum | ✅ | `pending` \| `in_progress` \| `completed` \| `blocked` |
| `items[].type` | enum | ❌ | `dsl` \| `code` \| `test` \| `doc` \| `contract` |
| `items[].entity_id` | string | ❌ | 关联的 DSL 实体 ID |
| `items[].assignee` | string | ❌ | 负责人 |
| `items[].completed_at` | datetime | ❌ | 完成时间（status=completed 时建议填写） |
| `items[].blocked_reason` | string | ❌ | 阻塞原因（status=blocked 时建议填写） |

**推荐工作流**：

```typescript
// 1. 生成基础 checklist（从 Technical Spec 提取，直接保存到数据库）
const result = await c4a_store_feat_checklist({
  action: "generate",
  feat_id: "feat-a001",
  source: "technical_spec"
});

// 2. 补充自定义任务（通过 patch 增量添加）
await c4a_store_feat_checklist({
  action: "patch",
  feat_id: "feat-a001",
  patches: [
    {
      task_id: "task-100",  // 新任务 ID
      updates: {
        title: "编写单元测试",
        type: "test",
        status: "pending"
      }
    }
  ]
});

// 2.1 或者：一次性生成带自定义任务
await c4a_store_feat_checklist({
  action: "generate",
  feat_id: "feat-a001",
  source: "technical_spec",
  items: [
    { id: "task-100", title: "编写单元测试", status: "pending", type: "test" }
  ]
});

// 3. CLI 渲染到本地文件供查看
// c4a feat render feat-a001
```

**数据存储**：

```javascript
// MongoDB feats 集合
{
  id: "feat-a001-user-login",
  type: "feat",
  status: "draft",  // draft | approved | published | archived

  // 临时字段：仅在 draft/approved 状态存在
  checklist: {
    version: "1.0",
    updated_at: "2026-01-22T15:30:00Z",
    updated_by: "bob@example.com",
    items: [
      {
        id: "task-1",
        title: "创建 auth-service Container",
        status: "completed",
        assignee: "alice@example.com",
        completed_at: "2026-01-22T10:00:00Z"
      }
    ]
  }
}
```

**生命周期管理**：

| Feat 状态 | 数据库 checklist | 本地 checklist.md | 说明 |
|-----------|-----------------|-------------------|------|
| draft | ✅ 存在 | 可渲染 | Agent 可修改 |
| approved | ✅ 存在 | 可渲染 | Agent 可修改 |
| published | ❌ **自动清理** | ✅ 保留最终版本 | 历史记录 |
| archived | ❌ **自动清理** | ✅ 保留最终版本 | 历史记录 |

---

### 3.8.1 本地文件保护机制

#### 问题背景

开发者习惯在 IDE 中直接编辑 Markdown 文件（如手动打钩 `[x]`）。但根据"数据库是唯一真源"的设计，本地 `checklist.md` 仅为只读视图。如果不加保护，`c4a feat render` 会静默覆盖用户的手动修改，导致数据丢失。

#### 解决方案：文件指纹 + 明确阻断

**1. 文件头部标记**

CLI 渲染的 `checklist.md` 必须包含元数据头：

```markdown
<!-- C4A-GENERATED
     feat_id: feat-a001-user-login
     rendered_at: 2026-01-25T10:00:00Z
     content_hash: sha256:abc123...
     DO NOT EDIT: 此文件由 C4A 自动生成，手动修改将在下次渲染时丢失
-->

# Checklist: feat-a001-user-login

- [x] 创建 auth-service Container
- [ ] 实现 jwt-component Component
...
```

**2. 渲染前检查流程**

```typescript
async function renderChecklist(featId: string) {
  const localFile = `.context/feat/${featId}/checklist.md`;

  if (existsSync(localFile)) {
    const content = readFileSync(localFile, 'utf-8');
    const header = parseC4AHeader(content);

    if (!header) {
      // 文件存在但无 C4A 头部 → 可能是用户手动创建的
      throw new Error(
        `文件 ${localFile} 不是 C4A 生成的文件，拒绝覆盖。\n` +
        `如需重新生成，请先手动删除或重命名该文件。`
      );
    }

    const currentHash = computeHash(content);
    if (currentHash !== header.content_hash) {
      // 文件被修改过
      throw new Error(
        `文件 ${localFile} 已被手动修改，拒绝覆盖。\n` +
        `选项：\n` +
        `  1. 使用 --force 强制覆盖（丢失本地修改）\n` +
        `  2. 手动删除文件后重新渲染\n` +
        `  3. 通过 MCP 工具将修改同步到数据库`
      );
    }
  }

  // 安全渲染
  const checklist = await mcpCall('c4a_store_feat_checklist', {
    action: 'get',
    feat_id: featId
  });
  writeChecklistWithHeader(localFile, checklist);
}
```

**3. CLI 命令行为**

| 场景 | 默认行为 | `--force` 行为 |
|------|---------|---------------|
| 文件不存在 | 正常渲染 | 正常渲染 |
| 文件存在，未修改 | 正常渲染 | 正常渲染 |
| 文件存在，已修改 | **报错退出** | 强制覆盖 + 警告 |
| 文件无 C4A 头部 | **报错退出** | 强制覆盖 + 警告 |

**4. 用户交互示例**

```bash
$ c4a feat render feat-a001

❌ 错误：文件 .context/feat/feat-a001/checklist.md 已被手动修改

检测到本地修改：
  - 原始哈希: sha256:abc123...
  - 当前哈希: sha256:def456...

选项：
  1. c4a feat render feat-a001 --force  # 强制覆盖（丢失本地修改）
  2. 手动删除文件后重新运行
  3. 如需保留修改，请通过 Agent 使用 c4a_store_feat_checklist 更新数据库
```

---

**多人协作**：

```typescript
// Alice 更新 task-1 状态
await c4a_store_feat_checklist({
  action: "patch",
  feat_id: "feat-a001",
  patches: [{ task_id: "task-1", updates: { status: "completed" } }]
});

// Bob 同时更新 task-2 状态（无冲突，原子操作）
await c4a_store_feat_checklist({
  action: "patch",
  feat_id: "feat-a001",
  patches: [{ task_id: "task-2", updates: { status: "in_progress" } }]
});

// 任何人都可以获取最新状态
const latest = await c4a_store_feat_checklist({
  action: "get",
  feat_id: "feat-a001"
});
```

### 3.9 `c4a_store_update_workflow_step`（原子更新 workflow 步骤状态）

**设计目的**：支持 Skills 错误恢复机制，提供 workflow_steps 的原子更新能力，避免并发覆盖风险。

**输入（概念签名）**：

```typescript
c4a_store_update_workflow_step({
  feat_id: "feat-a001-user-login",
  step_id: "step-3",
  status?: "pending" | "in_progress" | "completed" | "failed" | "skipped",
  metadata?: {
    started_at?: string,
    completed_at?: string,
    failed_at?: string,
    error?: string,
    recovered?: boolean,
    [key: string]: any
  }
})
```

**返回（概念示例）**：

```typescript
// 成功
{
  success: true,
  feat_id: "feat-a001-user-login",
  step_id: "step-3",
  updated_fields: ["status", "metadata.completed_at"]
}

// 失败：feat 不存在
{
  success: false,
  error: "feat_not_found",
  message: "Feat feat-a001-user-login 不存在"
}

// 失败：step 不存在
{
  success: false,
  error: "step_not_found",
  message: "Step step-3 在 feat-a001-user-login 中不存在"
}
```

**职责说明**：

- **原子更新**：使用数据库的原子操作（如 MongoDB 的 `$set`）更新特定步骤的字段
- **并发安全**：避免"读取整个 Feat → 修改内存 → 保存整个 Feat"导致的并发覆盖
- **部分更新**：仅更新指定字段，不影响其他步骤或 Feat 的其他字段
- **错误恢复**：支持 Skills 错误恢复机制中的状态持久化

**实现示例（MongoDB）**：

```typescript
async function updateWorkflowStep(params: UpdateWorkflowStepParams): Promise<UpdateResult> {
  const { feat_id, step_id, status, metadata } = params;

  // 1. 构造更新操作（仅更新提供的字段）
  const updateFields: any = {};

  if (status !== undefined) {
    updateFields['workflow_steps.$.status'] = status;
  }

  if (metadata !== undefined) {
    for (const [key, value] of Object.entries(metadata)) {
      updateFields[`workflow_steps.$.metadata.${key}`] = value;
    }
  }

  // 2. 原子更新（使用 $ 位置操作符）
  const result = await db.collection('feats').updateOne(
    {
      id: feat_id,
      'workflow_steps.id': step_id  // 匹配特定步骤
    },
    {
      $set: updateFields,
      $currentDate: { 'workflow_steps.$.updated_at': true }
    }
  );

  // 3. 检查更新结果
  if (result.matchedCount === 0) {
    // 未匹配到文档，可能是 feat 不存在或 step 不存在
    const featExists = await db.collection('feats').findOne({ id: feat_id });
    if (!featExists) {
      return { success: false, error: 'feat_not_found', message: `Feat ${feat_id} 不存在` };
    } else {
      return { success: false, error: 'step_not_found', message: `Step ${step_id} 在 ${feat_id} 中不存在` };
    }
  }

  return {
    success: true,
    feat_id,
    step_id,
    updated_fields: Object.keys(updateFields)
  };
}
```

**实现示例（SQLite）**：

```typescript
async function updateWorkflowStep(params: UpdateWorkflowStepParams): Promise<UpdateResult> {
  const { feat_id, step_id, status, metadata } = params;

  // 1. 读取当前 workflow_steps（JSON 字段）
  const feat = await db.get('SELECT workflow_steps FROM feats WHERE id = ?', [feat_id]);
  if (!feat) {
    return { success: false, error: 'feat_not_found', message: `Feat ${feat_id} 不存在` };
  }

  const workflowSteps = JSON.parse(feat.workflow_steps);
  const stepIndex = workflowSteps.findIndex((s: any) => s.id === step_id);

  if (stepIndex === -1) {
    return { success: false, error: 'step_not_found', message: `Step ${step_id} 在 ${feat_id} 中不存在` };
  }

  // 2. 更新特定步骤
  if (status !== undefined) {
    workflowSteps[stepIndex].status = status;
  }

  if (metadata !== undefined) {
    workflowSteps[stepIndex].metadata = {
      ...workflowSteps[stepIndex].metadata,
      ...metadata
    };
  }

  workflowSteps[stepIndex].updated_at = new Date().toISOString();

  // 3. 原子写回（使用事务）
  await db.run(
    'UPDATE feats SET workflow_steps = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify(workflowSteps), feat_id]
  );

  return {
    success: true,
    feat_id,
    step_id,
    updated_fields: ['status', 'metadata']
  };
}
```

**使用场景**：

1. **错误恢复**（Skills 设计中的核心场景）：
   ```typescript
   // 步骤开始前：标记为 in_progress
   await c4a_store_update_workflow_step({
     feat_id: "feat-a001",
     step_id: "step-3",
     status: "in_progress",
     metadata: { started_at: new Date().toISOString() }
   });

   try {
     // 执行实际操作
     await executeStep();

     // 步骤完成：标记为 completed
     await c4a_store_update_workflow_step({
       feat_id: "feat-a001",
       step_id: "step-3",
       status: "completed",
       metadata: { completed_at: new Date().toISOString() }
     });
   } catch (error) {
     // 步骤失败：标记为 failed
     await c4a_store_update_workflow_step({
       feat_id: "feat-a001",
       step_id: "step-3",
       status: "failed",
       metadata: {
         error: error.message,
         failed_at: new Date().toISOString()
       }
     });
   }
   ```

2. **Crash 恢复**：
   ```typescript
   // Agent 重启后，检查 in_progress 的步骤
   const feat = await c4a_store_read({ id: "feat-a001" });
   for (const step of feat.workflow_steps) {
     if (step.status === 'in_progress') {
       // 检查实际操作是否已完成
       const actuallyCompleted = await checkStepCompletion(step);
       if (actuallyCompleted) {
         // 仅更新状态，无需重新执行
         await c4a_store_update_workflow_step({
           feat_id: "feat-a001",
           step_id: step.id,
           status: "completed",
           metadata: {
             completed_at: new Date().toISOString(),
             recovered: true
           }
         });
       }
     }
   }
   ```

**与 `c4a_store_save` 的区别**：

| 维度 | `c4a_store_save` | `c4a_store_update_workflow_step` |
|------|-----------------|--------------------------------|
| **更新粒度** | 整个实体 | 单个 workflow step |
| **并发安全** | 后写入者覆盖 | 原子更新，不影响其他步骤 |
| **适用场景** | 创建/修改实体 | 更新步骤状态 |
| **性能** | 需要读取和写入完整实体 | 仅更新特定字段 |

**设计理由**：

1. **为什么不直接用 `c4a_store_save`？**
   - `c4a_store_save` 需要读取整个 Feat → 修改 → 保存，存在并发覆盖风险
   - 多个 Agent 并发执行不同步骤时，后写入者会覆盖前者的状态更新
   - 原子更新避免了这个问题

2. **为什么不在 `c4a_store_save` 中增加局部更新能力？**
   - `c4a_store_save` 的语义是"保存完整实体"，增加局部更新会混淆职责
   - 局部更新需要特殊的参数设计（如 `$set` 操作符），不适合通用保存接口
   - 独立工具更清晰，便于理解和维护

3. **为什么只支持 workflow_steps？**
   - 目前仅 workflow_steps 有原子更新需求（错误恢复场景）
   - 其他字段（如 Feat 元数据）通常整体更新，无并发风险
   - 如未来有其他字段需要原子更新，可扩展此工具或新增专用工具

**注意事项**：

- 此工具仅更新 MongoDB 中的 Feat 文档，不涉及 Neo4j 或 Milvus
- 不触发文件系统同步（workflow_steps 不导出到 DSL 文件）
- 不验证 workflow_steps 的完整性（如步骤依赖关系），仅更新状态

### 3.10 并发修改预警机制

**设计目的**：在 feat 内修改实体时提前预警，避免发布时才发现冲突导致返工。

**预警时机**：调用 `c4a_store_save` 修改已存在的实体时

**检查逻辑**：
```sql
-- 检查是否有其他活跃 feat 也在修改同一实体
SELECT e.proposal_id, m.updated_at, m.updated_by
FROM entities e
JOIN metadata m ON e.id = m.entity_id
WHERE e.id = '目标实体ID'
  AND e.proposal_id IS NOT NULL
  AND e.proposal_id != '当前feat-id'
  AND m.status IN ('draft', 'approved');
```

**工作流程**：

1. **首次调用**（未设置 `ignore_concurrent_warning`）：
   - 检测到并发修改 → 返回 `success: true`，但包含 `warnings` 字段
   - Agent 展示警告信息给用户，询问是否继续

2. **用户确认后**：
   - Agent 再次调用 `c4a_store_save`，设置 `ignore_concurrent_warning: true`
   - 工具跳过并发检查，直接保存

**返回示例**（见 3.1 节）：
```json
{
  "success": true,
  "id": "auth-service",
  "status": "draft",
  "warnings": [
    {
      "code": "CONCURRENT_MODIFICATION",
      "message": "实体 auth-service 正在被其他 feat 修改",
      "severity": "warning",
      "details": {
        "concurrent_feats": [
          {
            "feat_id": "feat-a001",
            "status": "approved",
            "updated_by": "user-a@example.com",
            "updated_at": "2026-01-22T13:00:00Z",
            "changes_summary": "升级到 v2.0, 新增 OAuth 支持"
          }
        ]
      }
    }
  ]
}
```

**Agent 交互示例**：
```
⚠️  并发修改警告

实体 auth-service 正在被其他 feat 修改：

并发修改的 feat：
- feat-a001 (approved) - 负责人: @user-a - 最后修改: 2 小时前
  修改内容: 升级到 v2.0, 新增 OAuth 支持

建议：
1. 联系 @user-a 协调变更范围
2. 等待 feat-a001 发布后再修改
3. 或继续修改（发布时可能需要解决冲突）

? 是否继续修改？
  > 是，继续修改（Agent 将设置 ignore_concurrent_warning=true 重新调用）
    否，取消
```

**实现要点**：
- 预警不阻止操作，通过 `warnings` 字段返回
- 显示并发 feat 的负责人和最后修改时间
- 建议用户主动协调，避免发布时冲突
- 用户确认后，Agent 通过 `ignore_concurrent_warning` 参数跳过检查

**配置选项**（`.c4a.yaml`）：
```yaml
feat:
  concurrent_warning: true  # 是否启用并发修改预警（默认 true）
  auto_notify: true         # 是否自动通知并发 feat 负责人（默认 false）
```

### 3.11 引用完整性预警

**设计目的**：在删除或废弃实体时，检测是否有其他实体（包括其他 Feat 中的）依赖它，避免产生悬空引用。

**预警时机**：
- `c4a_store_save` 将实体状态改为 `deprecated` 或 `archived`
- `c4a_store_delete` 删除实体

**检查逻辑**（Neo4j）：
```cypher
// 查询依赖当前实体的所有实体
MATCH (dependent)-[:DEPENDS_ON|:USES|:CALLS]->(target {id: $entity_id})
WHERE dependent.proposal_id IS NULL  // 主分支
   OR dependent.proposal_id IN $active_feat_ids  // 活跃 feat
RETURN dependent.id, dependent.proposal_id, dependent.type
```

**返回示例**：
```json
{
  "success": true,
  "id": "user-component",
  "warnings": [
    {
      "code": "DANGLING_REFERENCE",
      "message": "删除此实体将导致 3 个依赖方出现悬空引用",
      "severity": "warning",
      "details": {
        "dependents": [
          { "id": "order-service", "type": "container", "feat_id": null },
          { "id": "auth-component", "type": "component", "feat_id": "feat-b002" }
        ]
      }
    }
  ]
}
```

**与并发预警的区别**：

| 维度 | 并发修改预警 | 引用完整性预警 |
|------|------------|--------------|
| 检测对象 | 同一实体的多方修改 | 实体间的依赖关系 |
| 触发时机 | 修改实体时 | 删除/废弃实体时 |
| 数据源 | MongoDB | Neo4j |

