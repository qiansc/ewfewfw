---
name: "c4a:plan"
description: |
  技术方案设计。触发条件：
  - "设计技术方案"、"写技术设计"、"技术选型"
  - "设计架构"、"设计接口"、"设计契约"
  - 从 /c4a:specify 流转过来
  用于：(1) 生成 Technical Spec，(2) 设计契约，(3) 生成验收清单，(4) 检测架构变更并提示 ADR
---

# /c4a:plan - 技术方案设计

## 当前工作上下文

{{#if current_proposal_id}}
**当前 Feature**: `{{current_proposal_id}}`
**Feature 状态**: `{{current_proposal_status}}`

⚠️ 所有 MCP 工具调用必须传递 `proposal_id: "{{current_proposal_id}}"`（除非明确读取主分支）。
{{else}}
**当前 Feature**: 无（主分支模式）

⚠️ 当前未选择 Feature，无法在分支中生成方案。请先执行 `/c4a:feat` 创建或 `/c4a:feat --switch <id>` 切换。
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
| `c4a_store_feat_checklist` | 使用 `feat_id: "{{current_proposal_id}}"` |
| `c4a_query_search` | 建议传递 `current_proposal_id` 以限定范围 |

## 职责

将 Functional Spec 转换为可实现的技术方案：
- Technical Spec（Container + Component DSL）
- 契约文件（OpenAPI/AsyncAPI/Proto）
- 验收清单
- 架构变更检测与 ADR 提示

## 工作流程

```
1. c4a_store_read 读取 Functional Spec
   - 如无 Functional Spec，提示先执行 /c4a:specify

2. 技术调研：
   - c4a_query_search 查询现有架构
   - c4a_extract_analyze 分析相关代码（如有）
   > 降级处理：代码库为空时跳过代码分析，进入纯设计模式

3. 架构变更检测（见下方"ADR 检测"章节）

4. 技术方案设计：
   - 与用户讨论技术选型
   - 基于建模规则生成 DSL（见 modeling-rules.md）
   - 关联 code_path（如有）

5. 契约补充（见下方"契约设计"章节）

6. 生成验收清单：
   c4a_store_feat_checklist({
     feat_id: "{{current_proposal_id}}",
     action: "generate"
   })

7. c4a_store_save 保存所有产物
```

## 实体建模

调用 [modeling-rules.md](../c4a-model/modeling-rules.md) 生成技术实体：

| 实体类型 | 识别关键词 | 说明 |
|---------|-----------|------|
| `system` | 系统、平台、产品 | 最高层级的软件系统 |
| `container` | 服务、应用、数据库、消息队列 | 系统内的可部署单元 |
| `component` | 模块、组件、类、接口 | 容器内的代码单元 |
| `contract` | API、接口、协议、契约 | 接口契约 |
| `adr` | 决策、选型、迁移、重构 | 架构决策记录 |

---

## ADR 检测

### 架构变更定义

以下情况视为架构变更，需要关联 ADR：

| 变更类型 | 说明 | 示例 |
|---------|------|------|
| 新增/修改/删除 System | 系统级变更 | 新增支付系统 |
| 新增/修改/删除 Container | 服务级变更 | 新增消息队列服务 |
| 新增/修改 DEPENDS_ON | System/Container 级别依赖变更 | order → payment |
| 技术栈变更 | Container 技术栈修改 | MySQL → PostgreSQL |

**不视为架构变更**：Component 级别变更、SoR 变更、Contract 变更

### 检测逻辑

```
1. 读取当前 feat 的 Technical Spec
2. 检测变更（仅 System/Container 级别）：
   - 新增的 System/Container
   - 修改的 System/Container（对比 data 字段）
   - 删除的 System/Container（标记为 deprecated）
   - 新增/修改的 DEPENDS_ON 关系
   - 技术栈变更（对比 Container 的 technology 字段）
3. 如检测到架构变更：
   - 检查当前 feat 是否已有 ADR（通过 proposal_id 关联）
   - 如无 ADR：强制提示用户创建
   - 如有 ADR：检查完整性
```

### 用户交互

检测到架构变更但无 ADR 时：

```
⚠️ 检测到架构变更：
1. 新增 Container: payment-service
2. 新增 DEPENDS_ON: order-service → payment-service

架构变更需要记录决策背景。是否创建 ADR？
1. 是，创建 ADR（推荐）
2. 否，稍后补充
3. 跳过（不推荐）
```

选择创建 ADR 后，引导用户填写：
- 背景：为什么需要这个变更？
- 选项：考虑了哪些方案？（至少 2 个）
- 决策：为什么选择当前方案？
- 后果：正面影响、负面影响、风险、缓解措施

### ADR 模板

```yaml
c4a: "1.0"
type: adr
id: adr-{NNN}-{slug}
proposal_id: {feat-id}
title: {架构变更标题}
status: draft

context:
  background: |
    {背景描述}
  problem: |
    {问题描述}

options:
  - id: option-1
    title: {选项标题}
    description: |
      {选项描述}
    pros:
      - {优点}
    cons:
      - {缺点}

decision:
  chosen_option: option-1
  rationale: |
    {决策理由}

consequences:
  positive:
    - {正面影响}
  negative:
    - {负面影响}
  risks:
    - {风险}
  mitigation:
    - {缓解措施}

affected_entities:
  - {受影响的 System/Container ID}
```

---

## 契约设计

### 契约类型选择

根据技术方案自动推断，用户可覆盖：

| 场景 | 契约类型 | 格式 |
|------|---------|------|
| HTTP API | REST/GraphQL | OpenAPI 3.0 |
| 异步消息 | 事件/消息队列 | AsyncAPI 2.0 |
| RPC 接口 | gRPC/Thrift | Proto 3 |

### 契约生成方式

| 场景 | 方式 |
|------|------|
| 有代码 | `c4a_extract_contract` 从代码提取 |
| 无代码（Greenfield） | Agent 基于描述生成模板，引导用户补充 |

### 契约完整性检查

- 每个对外接口必须有契约
- 契约必须包含：路径/主题、方法/操作、请求/响应结构
- 契约必须关联 provider 和 consumers

---

## 输出产物

| 产物 | 格式 | 说明 |
|------|------|------|
| Technical Spec | C4A DSL | Container + Component 定义 |
| 契约文件 | OpenAPI/AsyncAPI/Proto | 接口契约 |
| 验收清单 | Markdown | 功能 + 技术 + 契约验收点 |
| 技术方案文档 | Markdown | 可读的技术方案说明 |
| ADR（如有变更） | C4A DSL | 架构决策记录 |

### Technical Spec DSL 示例

```yaml
c4a: "1.0"
type: container
id: auth-service
name: 认证服务
description: 处理用户认证，支持密码验证和 JWT
system: c4a-platform
technology: Node.js + Express
tags:
  - authentication

---
c4a: "1.0"
type: component
id: jwt-issuer
name: JWT 签发器
description: 签发和验证 JWT 令牌
container: auth-service
technology: jsonwebtoken
```

---

## 工具依赖

- `c4a_store_read`: 读取 Functional Spec
- `c4a_store_save`: 保存 Technical Spec、契约、ADR
- `c4a_query_search`: 查询现有架构
- `c4a_extract_analyze`: 分析代码（可选）
- `c4a_extract_contract`: 从代码提取契约（可选）
- `c4a_store_feat_checklist`: 生成验收清单

---

## 示例

### 需求开发

```
用户: "/c4a:plan"

Agent:
📖 读取 Functional Spec...
✅ 已加载功能规格：用户登录功能

🔍 技术调研中...
- 发现现有服务：auth-service
- 发现相关契约：api-user-profile

💬 技术选型讨论：
1. 认证方式：JWT vs Session？
2. 密码加密：bcrypt vs argon2？

用户: "用 JWT，bcrypt"

Agent:
📋 技术方案设计完成

📦 Technical Spec：
- auth-service (Container, 已存在)
  - login-handler (Component, 新增)
  - jwt-issuer (Component, 新增)
  - password-validator (Component, 新增)

📜 契约：
- api-auth-login (OpenAPI, 新增)

✅ 验收清单：8 项
- 功能验收：3 项
- 技术验收：3 项
- 契约验收：2 项

💡 下一步建议：/c4a:feat --status=approved 批准方案
```

### 架构变更（触发 ADR）

```
用户: "/c4a:plan"

Agent:
📖 读取 Functional Spec...
✅ 已加载功能规格：数据库迁移

🔍 技术调研中...
- 发现现有服务：database-service (MySQL)

⚠️ 检测到架构变更：
1. 修改 Container 技术栈: database-service (MySQL → PostgreSQL)

❓ 架构变更需要记录决策背景。是否创建 ADR？
1. 是，创建 ADR（推荐）
2. 否，稍后补充
3. 跳过

用户: "1"

Agent:
📝 创建 ADR 草稿...

请描述架构变更的背景：
- 为什么需要迁移到 PostgreSQL？
- 当前 MySQL 存在什么问题？

用户: "MySQL 不支持 JSONB，需要更好的 JSON 查询能力"

Agent:
✅ 已创建 ADR: adr-002-mysql-to-postgresql

请继续填写：
1. 考虑了哪些备选方案？
2. 有哪些风险和缓解措施？

用户: "考虑过 MongoDB，但团队更熟悉 SQL。风险是数据迁移，计划分批迁移"

Agent:
✅ ADR 已完善

📋 技术方案设计完成

📦 Technical Spec：
- database-service (Container, 修改)
  - 技术栈：MySQL → PostgreSQL

📜 契约：无变更

📝 ADR：
- adr-002-mysql-to-postgresql

✅ 验收清单：5 项

💡 下一步建议：/c4a:feat --status=approved 批准方案
```

---

## 下一步

完成技术方案后：
- 需求开发/架构变更：`/c4a:feat --status=approved` → `/c4a:implement`
- 纯知识：`/c4a:feat --status=approved` → `/c4a:feat --status=published`

---

## 错误处理

| 场景 | 处理 |
|------|------|
| 无 Functional Spec | 提示先执行 /c4a:specify |
| 代码分析失败 | 降级到纯设计模式，继续流程 |
| 契约格式不支持 | 询问用户选择格式 |
| ADR 创建被跳过 | 记录警告，继续流程 |
| 验收清单生成失败 | 手动创建基础清单 |
