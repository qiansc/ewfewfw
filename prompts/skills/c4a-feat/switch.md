# 切换上下文

## 当前工作上下文

{{#if current_proposal_id}}
**当前 Feature**: `{{current_proposal_id}}`
**Feature 状态**: `{{current_proposal_status}}`
{{else}}
**当前 Feature**: 无（主分支模式）
{{/if}}

## 工具调用规则

- 读取 feat 元数据使用 `c4a_store_read({ id: "<feat-id>" })`
- 读取 feat 内实体使用 `proposal_id: "<feat-id>"`
- 读取 checklist 使用 `feat_id: "<feat-id>"`

## 触发条件

- 用户说"切换到 feat-xxx"
- 用户说"我要继续做 feat-xxx"
- 用户说"打开 feat-xxx"

## 命令格式

```
/c4a:feat --switch <feat-id>
/c4a:feat --switch feat-a001-user-login
```

## 工具编排

```
1. 验证 Feature 是否存在：
   c4a_store_read({
     id: "<feat-id>"
   })

2. 如不存在，提示错误并列出可用 Feature

3. 设置当前工作上下文（内存状态）

4. 读取 Feature 详情：
   - 类型、状态、创建时间（feat 元数据）
   - 关联实体列表（使用 `proposal_id: "<feat-id>"` 读取）
   - 实现进度（如有 checklist，使用 `proposal_id: "<feat-id>"`）

5. 展示状态概览并建议下一步
```

## 输出格式

```
✅ 已切换到: {feat-id}

📋 Feature 概览：
- 标题：{title}
- 类型：{需求开发|架构变更|纯知识}
- 状态：{draft|approved|published}
- 创建时间：{created_at}

📦 关联实体：
- {entity-1} ({type})
- {entity-2} ({type})

📊 实现进度：{completed}/{total} ({percentage}%)

💡 下一步建议：
- draft → /c4a:specify 或 /c4a:plan
- approved → /c4a:implement 或 /c4a:feat --status=published
- published → 已完成，可查看或归档
```

## 示例

**成功切换**:
```
用户: "切换到 feat-a001-user-login"

Agent:
✅ 已切换到: feat-a001-user-login

📋 Feature 概览：
- 标题：用户登录功能
- 类型：需求开发
- 状态：approved
- 创建时间：2024-01-15

📦 关联实体：
- auth-service (container)
- jwt-validator (component)
- api-auth-login (contract)

📊 实现进度：5/10 (50%)

💡 下一步建议：/c4a:implement 继续实现
```

**Feature 不存在**:
```
用户: "切换到 feat-xxx"

Agent:
❌ Feature 不存在: feat-xxx

📋 可用 Feature 列表：
1. feat-a001-user-login (approved) - 用户登录功能
2. feat-a002-db-migration (draft) - 数据库迁移
3. feat-a003-api-docs (published) - API 文档整理

💡 请选择一个有效的 Feature ID
```

## 上下文信息

切换后，后续操作自动使用当前 Feature 的 `proposal_id`：

- `/c4a:specify` → 使用当前 feat 的 proposal_id
- `/c4a:plan` → 使用当前 feat 的 proposal_id
- `/c4a:implement` → 使用当前 feat 的 proposal_id
- `/c4a:analyze` → 使用当前 feat 的 proposal_id

## 错误处理

| 场景 | 处理 |
|------|------|
| feat-id 不存在 | 列出可用 Feature，提示选择 |
| feat-id 格式错误 | 提示正确格式 |
| 网络错误 | 提示重试 |
