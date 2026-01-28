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
# 实现清单元信息
metadata:
  feat_id: feat-a001-user-login
  feat_title: 用户登录功能
  created_at: "2026-01-22T10:00:00Z"
  updated_at: "2026-01-22T15:30:00Z"
  created_by: alice
  status: in_progress  # draft / in_progress / completed

# 进度统计（自动计算）
progress:
  total: 10
  completed: 5
  in_progress: 2
  blocked: 1
  pending: 2
  completion_rate: 50  # 百分比

# 实现任务列表
tasks:
  - id: task-001
    title: 创建 auth-service Container
    description: 在 Technical Spec 中定义 auth-service 容器
    type: dsl  # dsl / code / test / doc / contract
    status: completed  # pending / in_progress / completed / blocked
    priority: high  # high / medium / low
    estimated_hours: 2
    actual_hours: 1.5
    assignee: alice
    related_entities:
      - auth-service
    dependencies: []
    completed_at: "2026-01-22T11:00:00Z"
    notes: "已创建并保存到数据库"

  - id: task-002
    title: 实现 JWT 认证组件
    description: 实现 jwt-validator Component
    type: code
    status: completed
    priority: high
    estimated_hours: 4
    actual_hours: 5
    assignee: alice
    related_entities:
      - jwt-validator
    dependencies:
      - task-001
    completed_at: "2026-01-22T14:00:00Z"
    notes: "使用 jsonwebtoken 库实现"

  - id: task-003
    title: 创建登录接口 /api/auth/login
    description: 实现登录 API 端点
    type: code
    status: in_progress
    priority: high
    estimated_hours: 3
    actual_hours: 1.5
    assignee: alice
    related_entities:
      - auth-service
    dependencies:
      - task-002
    started_at: "2026-01-22T14:30:00Z"
    notes: "正在实现参数验证"

  - id: task-004
    title: 创建 OpenAPI 契约
    description: 为登录接口创建 OpenAPI 规格
    type: contract
    status: in_progress
    priority: medium
    estimated_hours: 2
    actual_hours: 0.5
    assignee: bob
    related_entities:
      - api-auth-login
    dependencies:
      - task-003
    started_at: "2026-01-22T15:00:00Z"
    notes: "参考现有契约格式"

  - id: task-005
    title: 编写单元测试
    description: 为 JWT 认证组件编写单元测试
    type: test
    status: blocked
    priority: high
    estimated_hours: 3
    actual_hours: 0
    assignee: alice
    related_entities:
      - jwt-validator
    dependencies:
      - task-002
    blocked_at: "2026-01-22T15:00:00Z"
    blocked_reason: "等待测试环境配置完成"
    blocked_by: "DevOps 团队"
    notes: "需要 Redis 测试实例"

  - id: task-006
    title: 集成测试
    description: 端到端测试登录流程
    type: test
    status: pending
    priority: medium
    estimated_hours: 4
    assignee: bob
    related_entities:
      - auth-service
    dependencies:
      - task-003
      - task-005

  - id: task-007
    title: 更新 API 文档
    description: 更新用户文档，说明登录接口使用方法
    type: doc
    status: pending
    priority: low
    estimated_hours: 1
    assignee: bob
    related_entities:
      - auth-service
    dependencies:
      - task-004

# 风险和问题
risks:
  - id: risk-001
    title: 测试环境延迟
    description: 测试环境配置延迟可能影响进度
    severity: high  # high / medium / low
    probability: medium
    impact: "可能延迟 2-3 天"
    mitigation: "与 DevOps 团队协调，优先配置测试环境"
    status: open  # open / mitigated / closed

# 变更记录
changes:
  - timestamp: "2026-01-22T10:00:00Z"
    user: alice
    action: created
    description: "创建实现清单"

  - timestamp: "2026-01-22T11:00:00Z"
    user: alice
    action: task_completed
    task_id: task-001
    description: "完成 auth-service Container 创建"

  - timestamp: "2026-01-22T15:00:00Z"
    user: alice
    action: task_blocked
    task_id: task-005
    description: "单元测试被阻塞，等待测试环境"
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

**优先级（priority）**：
- `high`: 高优先级（阻塞其他任务）
- `medium`: 中优先级
- `low`: 低优先级（可延后）

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

