---
name: "c4a:specify"
description: |
  Functional Spec 生成。触发条件：
  - 从 feat 流转过来（创建 Feature 后的下一步）
  - "定义功能规格"、"写需求"、"功能需求"
  - "定义用例"、"业务流程"、"验收标准"
  用于：生成 Product 定义、Business Process、Business SoR（业务规则）
---

# /c4a:specify - 功能规格

## 当前工作上下文

{{#if current_proposal_id}}
**当前 Feature**: `{{current_proposal_id}}`
**Feature 状态**: `{{current_proposal_status}}`

⚠️ 所有 MCP 工具调用必须传递 `proposal_id: "{{current_proposal_id}}"`（除非明确读取主分支）。
{{else}}
**当前 Feature**: 无（主分支模式）

⚠️ 当前未选择 Feature，无法在分支中生成规格。请先执行 `/c4a:feat` 创建或 `/c4a:feat --switch <id>` 切换。
{{/if}}

## 前置检查

1. 检查 `current_proposal_id` 是否存在
2. 若不存在，提示用户创建或切换 Feature

## 工具调用规则

在调用以下 MCP 工具时，必须传递 `proposal_id`：

| 工具 | proposal_id 要求 |
|------|-----------------|
| `c4a_store_read` | 必须传递 `current_proposal_id` |
| `c4a_store_save` | 必须传递 `current_proposal_id` |
| `c4a_query_search` | 建议传递 `current_proposal_id` 以限定范围 |

## 职责

将用户需求转换为结构化的 Functional Spec，包含：
- Product 定义
- Business Process 描述
- Business SoR（业务规则）

## 工作流程

```
1. c4a_store_read 读取当前 Feature 信息
2. 与用户对话澄清功能需求
3. c4a_query_search 查询相关业务知识
4. 生成 Functional Spec（DSL + Markdown）
5. c4a_store_save 保存到 feat 目录
```

## 需求澄清清单

与用户对话时，逐步澄清以下内容：

| 维度 | 问题 | 输出 |
|------|------|------|
| 功能范围 | 这个功能要解决什么问题？边界在哪里？ | Product 定义 |
| 用户场景 | 谁会使用？主要场景是什么？ | Actor + UseCase |
| 业务流程 | 用户如何完成任务？有哪些步骤？ | Business Process |
| 业务规则 | 有哪些约束条件？数据校验规则？ | Business SoR |
| 验收标准 | 如何判断功能完成？ | Acceptance Criteria |

## 实体建模

调用 [modeling-rules.md](../c4a-model/modeling-rules.md) 生成业务实体：

| 实体类型 | 识别关键词 | 说明 |
|---------|-----------|------|
| `actor` | 用户、角色、外部系统 | 交互参与者 |
| `usecase` | 用例、场景、流程 | 业务用例 |
| `sor` | 记录系统、数据源、业务规则 | System of Record |

## 输出产物

### 1. Functional Spec DSL

```yaml
c4a: "1.0"
type: functional-spec
id: spec-{feat-id}
feat: {feat-id}
product:
  name: {产品/功能名称}
  description: {功能描述}
  goals:
    - {目标1}
actors:
  - id: {actor-id}
    name: {角色名称}
    description: {角色描述}
usecases:
  - id: {usecase-id}
    name: {用例名称}
    actor: {actor-id}
    preconditions:
      - {前置条件}
    flow:
      - {步骤1}
    postconditions:
      - {后置条件}
    exceptions:
      - condition: {异常条件}
        action: {处理方式}
business_rules:
  - id: {rule-id}
    name: {规则名称}
    description: {规则描述}
    validation: {校验逻辑}
acceptance_criteria:
  - {验收标准1}
```

### 2. 功能规格文档（Markdown）

生成人类可读的功能规格文档，包含：
- 功能概述
- 用户角色
- 用例描述（含流程图）
- 业务规则
- 验收标准

## 示例

**输入**：
```
用户: "定义用户登录功能的需求"
（当前 feat: feat-a001-user-login）
```

**对话澄清**：
```
Agent: 让我了解一下登录功能的需求：

1. 功能范围：支持哪些登录方式？
2. 用户场景：主要用户是谁？
3. 业务规则：密码复杂度？锁定策略？
```

**输出 DSL**：
```yaml
c4a: "1.0"
type: functional-spec
id: spec-feat-a001-user-login
feat: feat-a001-user-login
product:
  name: 用户登录
  description: 提供安全的用户身份认证功能
actors:
  - id: end-user
    name: 终端用户
usecases:
  - id: uc-password-login
    name: 密码登录
    actor: end-user
    flow:
      - 用户输入用户名和密码
      - 系统验证凭据
      - 系统生成会话令牌
business_rules:
  - id: rule-login-lockout
    name: 登录锁定
    description: 连续5次失败后锁定账户30分钟
acceptance_criteria:
  - 用户可以使用正确的用户名密码登录
  - 连续失败5次后账户被锁定
```

## 下一步

完成 Functional Spec 后：
```
→ /c4a:plan 设计技术方案
```

## 工具依赖

- `c4a_store_read`: 读取 Feature 信息
- `c4a_query_search`: 查询相关业务知识
- `c4a_store_save`: 保存 Functional Spec
