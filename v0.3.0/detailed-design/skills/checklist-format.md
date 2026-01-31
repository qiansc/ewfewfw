## 实现清单格式（checklist.md）

> **重要说明**：Checklist 是**纯数据库数据**，本地文件只是渲染的只读视图。
>
> - **数据源**：数据库 `feats` 表/集合的 `checklist` 字段（唯一权威源）
>   - Local 模式：SQLite `feats` 表
>   - Server/Remote 模式：MongoDB `feats` 集合
> - **本地文件**：`.context/feat/{feat-id}/checklist.md`（渲染的只读视图）
> - **同步策略**：
>   - Checklist **不参与同步**，Agent 通过 `c4a_store_feat_checklist` 直接操作数据库
>   - CLI 的 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 Markdown 文件
>   - `published`/`archived` 状态：自动清理数据库字段，本地渲染文件保留作为历史记录
> - **设计理由**：避免双重标准和状态分裂，简化同步逻辑
> - **详细说明**：[mcp-tools.md#c4a_store_feat_checklist](./mcp-tools.md#37-c4a_store_feat_checklist-checklist-管理)

### 存储位置

**数据源**（按部署模式）：

```javascript
// Local 模式：SQLite feats 表
// Server/Remote 模式：MongoDB feats 集合
{
  id: "feat-a001-user-login",
  checklist: { ... }  // 仅在 draft/approved 状态存在
}
```

**本地渲染文件**（只读视图）：
```
.context/feat/{feat-id}/checklist.md
```

**示例**：
```
.context/feat/feat-a001-user-login/checklist.md
```

### YAML 格式

```yaml
version: "1.0"
metadata:
  feat_id: feat-a001-user-login
  generated_at: "2026-01-22T10:00:00Z"
  source: technical_spec
updated_at: "2026-01-22T15:30:00Z"
updated_by: alice
items:
  - id: task-001
    title: 创建 auth-service Container
    type: dsl
    status: completed
    entity_id: auth-service
    assignee: alice
    completed_at: "2026-01-22T11:00:00Z"
  - id: task-002
    title: 实现 JWT 认证组件
    type: code
    status: in_progress
    entity_id: jwt-validator
    assignee: alice
```

### 字段说明

**任务类型（type）**：
- `dsl`: DSL 定义（System/Container/Component/SoR/Contract）
- `code`: 代码实现
- `test`: 测试（单元测试/集成测试）
- `doc`: 文档编写
- `contract`: 契约定义（OpenAPI/AsyncAPI/Proto）

**任务状态（status）**：
- `pending`: 待开始
- `in_progress`: 进行中
- `completed`: 已完成
- `blocked`: 已阻塞
- `skipped`: 已跳过

### 使用方式

Checklist 操作分为两层：

**1. Skill 层（用户交互）**：

```bash
# 生成清单（由 /c4a:implement 自动调用 MCP 工具）
/c4a:implement

# 查看进度
/c4a:implement --status

# 一致性检查
/c4a:analyze
```

**2. MCP 工具层（Agent 内部调用）**：

```typescript
// 生成清单
c4a_store_feat_checklist({
  action: "generate",
  feat_id: "feat-a001-user-login",
  source: "technical_spec"
})

// 更新任务状态（标记完成）
c4a_store_feat_checklist({
  action: "patch",
  feat_id: "feat-a001-user-login",
  patches: [{
    task_id: "task-003",
    updates: { status: "completed", completed_at: "2026-01-22T15:00:00Z" }
  }]
})

// 标记任务阻塞
c4a_store_feat_checklist({
  action: "patch",
  feat_id: "feat-a001-user-login",
  patches: [{
    task_id: "task-005",
    updates: { status: "blocked", blocked_reason: "等待测试环境" }
  }]
})

// 获取当前 checklist
c4a_store_feat_checklist({
  action: "get",
  feat_id: "feat-a001-user-login"
})
```

> **映射关系**：Skill 层的 `/c4a:implement --complete task-003` 等命令由 Agent 内部转换为对应的 MCP 工具调用。

---
