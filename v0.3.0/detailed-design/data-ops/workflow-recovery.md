# Workflow 错误恢复机制

> 本文档定义 `/c4a:know:learn` 等多步骤 Skill 的错误恢复实现细节。

> **相关文档**：
> - Skill 设计：[../skills/know-skills.md](../skills/know-skills.md)
> - Feat 生命周期：[../mcp/store-feat-lifecycle.md](../mcp/store-feat-lifecycle.md)

---

## 1. 概述

`/c4a:know:learn` 等 Skill 会编排多个子步骤（创建 Feature → 生成规格 → 生成方案 → 发布）。当执行中途失败时，需要支持从失败点恢复，避免重复执行已完成的步骤。

### 1.1 设计目标

| 目标 | 说明 |
|------|------|
| **断点续传** | 从失败步骤继续，不重复已完成步骤 |
| **跨机器恢复** | 状态存储在数据库，支持换机器继续 |
| **幂等安全** | 重试不会产生副作用 |
| **原子清理** | 放弃时可完整清理已创建的实体 |

---

## 2. 数据结构

### 2.1 workflow_steps 字段

将流程步骤记录在 Feat 元数据的 `workflow_steps` 字段中：

```yaml
# Feat 元数据（存储在数据库）
id: feat-a001-redis-guide
type: feat
status: draft
workflow_steps:
  - id: step-1
    type: create_feat
    title: "创建 Feature"
    status: completed
    metadata:
      workflow: /c4a:know:learn
      feat_id: feat-a001-redis-guide
      completed_at: "2026-01-22T10:00:00Z"

  - id: step-2
    type: generate_spec
    title: "生成功能规格"
    status: completed
    metadata:
      workflow: /c4a:know:learn
      completed_at: "2026-01-22T10:05:00Z"

  - id: step-3
    type: generate_plan
    title: "生成技术方案"
    status: failed
    metadata:
      workflow: /c4a:know:learn
      error: "缺少必要的依赖信息"
      failed_at: "2026-01-22T10:10:00Z"

  - id: step-4
    type: publish
    title: "发布知识"
    status: pending
    metadata:
      workflow: /c4a:know:learn
```

### 2.2 步骤状态

```
pending → in_progress → completed
              ↓
           failed
```

| 状态 | 含义 |
|------|------|
| `pending` | 待执行 |
| `in_progress` | 执行中（用于 crash 恢复判断） |
| `completed` | 已完成 |
| `failed` | 执行失败 |

### 2.3 步骤类型

| 步骤类型 | 说明 | 完成判定 |
|---------|------|---------|
| `create_feat` | 创建 Feature | Feat ID 已存在 |
| `generate_spec` | 生成功能规格 | Functional Spec 实体已存在 |
| `generate_plan` | 生成技术方案 | Technical Spec 实体已存在 |
| `save_to_db` | 保存到数据库 | 记录存在且哈希匹配 |
| `status_transition` | 状态流转 | 当前状态 = 目标状态 |
| `publish` | 发布 | proposal_id=null 且 status=published |

---

## 3. 恢复流程

### 3.1 自动检测

用户下次运行 `/c4a:know:learn` 时，自动检测未完成的 workflow：

```
⚠️  检测到未完成的 workflow:
  feat-a001-redis-guide: /c4a:know:learn
  失败步骤: 生成技术方案
  错误: 缺少必要的依赖信息

? 如何处理？
  > 从失败点继续
    从头开始
    删除 feat 并重新开始
    保留 feat，稍后手动处理
```

### 3.2 恢复选项

| 选项 | 行为 | 适用场景 |
|------|------|----------|
| 从失败点继续 | 保留已完成步骤，从失败步骤重新执行 | 临时错误（网络、权限等） |
| 从头开始 | 保留 feat，重置 workflow_steps，重新执行所有步骤 | 输入内容有误，需要重新分析 |
| 删除 feat 并重新开始 | 删除 feat 和所有已创建实体 | 完全放弃当前尝试 |
| 保留 feat，稍后手动处理 | 不自动恢复，用户手动调用 `/c4a:feat` 流程 | 需要精细控制 |

### 3.3 恢复命令

```bash
# 自动恢复（从失败点继续）
/c4a:know:learn --resume feat-a001-redis-guide
```

---

## 4. 实现规范

### 4.1 原子更新

为避免并发更新导致状态覆盖，`workflow_steps` 的更新必须使用数据库原子操作。

**Server 模式（Python + MongoDB）**：

```python
# mcp-data 内部实现
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorDatabase

async def update_workflow_step(
    db: AsyncIOMotorDatabase,
    feat_id: str,
    step_id: str,
    status: str,
    metadata: dict
):
    """原子更新 workflow_steps 中的特定步骤"""
    await db.feats.update_one(
        {"id": feat_id, "workflow_steps.id": step_id},
        {
            "$set": {
                "workflow_steps.$.status": status,
                "workflow_steps.$.metadata": {**metadata},
                "updated_at": datetime.utcnow().isoformat()
            }
        }
    )
```

**Local 模式（TypeScript + SQLite）**：

```typescript
// mcp-local 内部实现
import { Database } from 'bun:sqlite';

function updateWorkflowStep(
  db: Database,
  featId: string,
  stepId: string,
  status: string,
  metadata: Record<string, unknown>
): void {
  // 读取当前 workflow_steps
  const feat = db.prepare('SELECT data FROM entities WHERE id = ?').get(featId) as { data: string };
  const data = JSON.parse(feat.data);

  // 更新特定步骤
  const step = data.workflow_steps?.find((s: any) => s.id === stepId);
  if (step) {
    step.status = status;
    step.metadata = { ...step.metadata, ...metadata };
  }

  // 保存（SQLite 单库事务保证原子性）
  db.prepare('UPDATE entities SET data = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), new Date().toISOString(), featId);
}
```

### 4.2 执行流程（先标记后执行）

为确保 crash 恢复时状态与实际操作一致，必须遵循"先标记后执行"的时序：

**Server 模式（Python）**：

```python
from typing import Callable, Any
from datetime import datetime

async def execute_step(
    db: AsyncIOMotorDatabase,
    feat_id: str,
    step: dict,
    execute_fn: Callable[[], Any]
):
    """执行单个步骤，支持 crash 恢复"""
    step_id = step["id"]
    
    # 1. 先标记为 in_progress（持久化到数据库）
    await update_workflow_step(db, feat_id, step_id, "in_progress", {
        "started_at": datetime.utcnow().isoformat()
    })
    
    try:
        # 2. 执行实际操作（可能耗时）
        await execute_fn()
        
        # 3. 标记为 completed
        await update_workflow_step(db, feat_id, step_id, "completed", {
            "completed_at": datetime.utcnow().isoformat()
        })
    except Exception as error:
        # 4. 标记为 failed
        await update_workflow_step(db, feat_id, step_id, "failed", {
            "error": str(error),
            "failed_at": datetime.utcnow().isoformat()
        })
        raise
```

**Local 模式（TypeScript）**：

```typescript
async function executeStep(
  db: Database.Database,
  featId: string,
  step: WorkflowStep,
  executeFn: () => Promise<void>
): Promise<void> {
  const stepId = step.id;
  
  // 1. 先标记为 in_progress
  updateWorkflowStep(db, featId, stepId, 'in_progress', {
    started_at: new Date().toISOString()
  });
  
  try {
    // 2. 执行实际操作
    await executeFn();
    
    // 3. 标记为 completed
    updateWorkflowStep(db, featId, stepId, 'completed', {
      completed_at: new Date().toISOString()
    });
  } catch (error) {
    // 4. 标记为 failed
    updateWorkflowStep(db, featId, stepId, 'failed', {
      error: error instanceof Error ? error.message : String(error),
      failed_at: new Date().toISOString()
    });
    throw error;
  }
}
```

### 4.3 完成判定（checkStepCompletion）

为保证幂等性，每个步骤必须有明确的完成判定逻辑。

**Server 模式（Python）**：

```python
async def check_step_completion(
    db: AsyncIOMotorDatabase,
    step: dict
) -> bool:
    """
    检查步骤是否实际完成（用于 crash 恢复场景）
    
    设计原则：
    1. 检查产物而非状态：不依赖 workflow_steps.status，而是检查实际产物
    2. 保守判定：有疑问时返回 False，宁可重试也不跳过
    3. 幂等安全：即使误判为未完成，重试也不会产生副作用
    """
    step_type = step.get("type")
    metadata = step.get("metadata", {})
    
    if step_type == "create_feat":
        # 检查 Feat 是否已存在
        feat = await db.feats.find_one({"id": metadata.get("feat_id")})
        return feat is not None
    
    elif step_type == "generate_spec" or step_type == "generate_plan":
        # 检查实体是否已存在
        entity = await db.entities.find_one({"id": metadata.get("entity_id")})
        return entity is not None
    
    elif step_type == "save_to_db":
        # 检查数据库记录是否存在且内容哈希匹配
        entity = await db.entities.find_one({"id": metadata.get("entity_id")})
        if not entity:
            return False
        # 可选：验证内容哈希
        if metadata.get("content_hash"):
            return compute_hash(entity) == metadata["content_hash"]
        return True
    
    elif step_type == "status_transition":
        # 检查实体当前状态是否已是目标状态
        entity = await db.entities.find_one({"id": metadata.get("entity_id")})
        return entity and entity.get("status") == metadata.get("target_status")
    
    elif step_type == "publish":
        # 检查实体是否已发布
        entity = await db.entities.find_one({"id": metadata.get("entity_id")})
        return (entity and 
                entity.get("proposal_id") is None and 
                entity.get("status") == "published")
    
    else:
        # 未知步骤类型，保守返回 False（触发重试）
        return False
```

**Local 模式（TypeScript）**：

```typescript
async function checkStepCompletion(
  db: Database.Database,
  step: WorkflowStep
): Promise<boolean> {
  const { type, metadata } = step;
  
  switch (type) {
    case 'create_feat': {
      const feat = db.prepare('SELECT 1 FROM feats WHERE id = ?')
        .get(metadata.feat_id);
      return feat !== undefined;
    }
    
    case 'generate_spec':
    case 'generate_plan': {
      const entity = db.prepare('SELECT 1 FROM entities WHERE id = ?')
        .get(metadata.entity_id);
      return entity !== undefined;
    }
    
    case 'save_to_db': {
      const entity = db.prepare('SELECT data FROM entities WHERE id = ?')
        .get(metadata.entity_id) as { data: string } | undefined;
      if (!entity) return false;
      if (metadata.content_hash) {
        return computeHash(JSON.parse(entity.data)) === metadata.content_hash;
      }
      return true;
    }
    
    case 'status_transition': {
      const entity = db.prepare('SELECT status FROM entities WHERE id = ?')
        .get(metadata.entity_id) as { status: string } | undefined;
      return entity?.status === metadata.target_status;
    }
    
    case 'publish': {
      const entity = db.prepare(
        'SELECT proposal_id, status FROM entities WHERE id = ?'
      ).get(metadata.entity_id) as { proposal_id: string | null; status: string } | undefined;
      return entity?.proposal_id === null && entity?.status === 'published';
    }
    
    default:
      return false;
  }
}
```

### 4.4 恢复执行

**Server 模式（Python）**：

```python
async def resume_workflow(db: AsyncIOMotorDatabase, feat_id: str):
    """从断点恢复 workflow 执行"""
    feat = await db.feats.find_one({"id": feat_id})
    if not feat:
        raise ValueError(f"Feat {feat_id} not found")
    
    workflow_steps = feat.get("workflow_steps", [])
    
    for step in workflow_steps:
        if step["status"] == "completed":
            # 已完成，跳过
            continue
        
        if step["status"] == "in_progress":
            # crash 恢复场景：检查实际操作是否已完成
            if await check_step_completion(db, step):
                # 实际已完成，只需更新状态
                await update_workflow_step(db, feat_id, step["id"], "completed", {
                    "completed_at": datetime.utcnow().isoformat(),
                    "recovered": True
                })
                continue
            # 实际未完成，重新执行（幂等性保证安全）
        
        # pending 或需要重试的 in_progress
        execute_fn = get_step_executor(step)
        await execute_step(db, feat_id, step, execute_fn)
```

---

## 5. 实体清理机制

### 5.1 清理流程

当用户选择"删除 feat 并重新开始"时，需要清理 feat 及其关联的所有实体。

**关键设计**：所有在 feat 中创建的实体都带有 `proposal_id = feat_id`，可通过此字段批量查询和删除。

**Server 模式（Python）**：

```python
async def cleanup_feat(db: AsyncIOMotorDatabase, feat_id: str):
    """清理 feat 及其关联的所有实体"""
    
    # 1. 查询 feat 关联的所有实体
    entities = await db.entities.find({
        "proposal_id": feat_id
    }).to_list(length=None)
    
    # 2. 批量删除实体（仅删除 feat 分支副本，不影响主分支）
    if entities:
        entity_ids = [e["id"] for e in entities]
        await db.entities.delete_many({
            "id": {"$in": entity_ids},
            "proposal_id": feat_id  # 仅删除 feat 分支的副本
        })
    
    # 3. 删除 feat 本身
    await db.feats.delete_one({"id": feat_id})
    
    # 4. 清理本地目录（如有）- 由 CLI 层处理
    # rm -rf .context/feat/{feat_id}/
```

**Local 模式（TypeScript）**：

```typescript
function cleanupFeat(db: Database.Database, featId: string): void {
  // SQLite 事务保证原子性
  const cleanup = db.transaction(() => {
    // 1. 删除 feat 关联的所有实体
    db.prepare('DELETE FROM entities WHERE proposal_id = ?').run(featId);
    
    // 2. 删除 feat 本身
    db.prepare('DELETE FROM feats WHERE id = ?').run(featId);
  });
  
  cleanup();
}
```

### 5.2 安全保证

- 只删除 `proposal_id = featId` 的实体副本
- 不影响主分支（`proposal_id = null`）的实体
- 不影响其他 feat 的实体

### 5.3 原子性风险与缓解

> **已知风险**：当前清理流程是逐个删除实体，如果在删除过程中发生中断（网络错误、进程崩溃），可能导致部分实体残留。

| 风险场景 | 影响 | 缓解措施 |
|---------|------|---------|
| 删除中途中断 | 部分实体残留，feat 记录已删除 | 定期清理孤儿实体（`proposal_id` 对应的 feat 不存在） |
| 数据库连接断开 | 同上 | 重试机制 + 孤儿清理 |

**孤儿实体清理（后台任务）**：

```python
async def cleanup_orphan_entities(db: AsyncIOMotorDatabase):
    """清理 proposal_id 对应的 feat 不存在的孤儿实体"""
    # 获取所有非空 proposal_id
    pipeline = [
        {"$match": {"proposal_id": {"$ne": None}}},
        {"$group": {"_id": "$proposal_id"}}
    ]
    proposal_ids = [doc["_id"] async for doc in db.entities.aggregate(pipeline)]
    
    # 检查哪些 feat 不存在
    existing_feats = await db.feats.find(
        {"id": {"$in": proposal_ids}},
        {"id": 1}
    ).to_list(length=None)
    existing_ids = {f["id"] for f in existing_feats}
    
    orphan_proposal_ids = [pid for pid in proposal_ids if pid not in existing_ids]
    
    # 删除孤儿实体
    if orphan_proposal_ids:
        result = await db.entities.delete_many({
            "proposal_id": {"$in": orphan_proposal_ids}
        })
        return result.deleted_count
    
    return 0
```

---

## 6. 失败原因分类

| 失败原因 | 自动恢复 | 用户操作 |
|---------|---------|---------|
| 网络错误 | ✅ 自动重试 3 次 | 无需操作 |
| 权限错误 | ❌ 提示用户修复权限 | 修复后选择"从失败点继续" |
| 内容歧义 | ❌ 暂停等待用户澄清 | 提供澄清后继续 |
| 依赖缺失 | ❌ 提示缺少哪些依赖 | 补充依赖后继续 |
| 一致性冲突 | ❌ 提示冲突详情 | 选择处理方式后继续 |

---

## 7. 关键设计说明

### 7.1 workflow_steps 是纯运行时状态

`workflow_steps` 仅存在于数据库中，**不同步到本地 `feat.yaml` 文件**。

**理由**：
- Agent 通过 MCP 工具直接修改数据库
- 如果同时同步到本地文件，会导致 `c4a sync` 时产生冲突
- 本地 `feat.yaml` 只包含 Feat 的基本元数据（id、name、status 等）

### 7.2 与 checklist 的区别

| 维度 | workflow_steps | checklist |
|------|----------------|-----------|
| **用途** | 跟踪 Skill 流程进度（步骤级别） | 跟踪代码实现进度（任务级别） |
| **存储位置** | 仅数据库（运行时状态） | 仅数据库（结构化数据） |
| **本地文件** | ❌ 不导出 | ✅ 渲染为只读视图 |
| **使用场景** | `/c4a:know:learn` 等自动化流程 | `/c4a:implement` 实现阶段 |
| **跨机器恢复** | ✅ 支持（从数据库读取） | ✅ 支持（从数据库读取） |

### 7.3 幂等性要求

每个步骤必须设计为可安全重试：

| 步骤类型 | 幂等性实现 | 说明 |
|---------|-----------|------|
| `create_feat` | 检查 feat_id 是否已存在 | 存在则跳过创建 |
| `generate_spec` | 检查实体是否已存在 | 存在则询问覆盖 |
| `save_to_db` | 使用 upsert 语义 | 存在则更新，不存在则创建 |
| `status_transition` | 检查当前状态是否已是目标状态 | 已是目标则跳过 |
| `publish` | 检查 proposal_id=null 且 status=published | 已发布则跳过 |

---

## 8. 清理机制

- 成功完成后自动将所有步骤标记为 `completed`
- 失败超过 7 天的 workflow 提示用户清理
- 用户可通过 `/c4a:feat --reset-workflow` 重置 workflow_steps
