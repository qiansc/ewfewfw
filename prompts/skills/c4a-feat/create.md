# 创建 Feature

## 当前工作上下文

{{#if current_feat_uuid}}
**当前 Feature**: `{{current_feat_uuid}}`
**Feature 状态**: `{{current_feat_status}}`
{{else}}
**当前 Feature**: 无（主分支模式）
{{/if}}

## 工具调用规则

创建 Feature 时使用 `c4a_store_feat_lifecycle`，必须传递 `feat_id` 与 `metadata`。

## 触发条件

- 用户说"我想开发一个功能"
- 用户说"我想整理业务知识"
- 用户说"我想升级数据库"
- 用户说"创建 ADR"

## 类型自动识别

| 关键词 | 类型 | 说明 |
|--------|------|------|
| "实现"、"开发"、"功能"、"需求" | 需求开发 | 完整流程：specify → plan → implement |
| "迁移"、"升级"、"重构"、"ADR" | 架构变更 | 跳过 specify：plan → implement |
| "整理"、"记录"、"规范"、"知识" | 纯知识 | 无 implement：specify → plan |

## 工具编排

```
1. 分析用户描述，识别类型
2. 生成 Feature ID：feat-{code}-{slug}
   - code: 自动递增编号（a001, a002...）
   - slug: 从描述生成，最多 5 个单词
3. 调用 c4a_store_feat_lifecycle:
   c4a_store_feat_lifecycle({
     action: "create",
     feat_id: "<feat-id>",
     metadata: {
       title: "<Feature 标题>",
       description: "<用户描述>",
       created_by: "<当前用户>"
     }
   })
4. 创建本地目录：.context/feat/feat-xxx/
5. 根据类型生成初步内容：
   - 需求开发：PRD 草稿模板
   - 架构变更：ADR 草稿 + 影响分析模板
   - 纯知识：知识文档草稿模板
6. c4a_query_search 查询相关现有知识
7. 展示结果并建议下一步
```

## ID 命名规范

- 格式：`feat-{code}-{slug}`
- code：4 位字母数字编号（a001, a002, b001...）
- slug：kebab-case，最多 5 个单词
- 示例：`feat-a001-user-login`, `feat-a002-db-migration`

## 输出格式

```
✅ 已创建 Feature: {feat-id}
📝 类型：{需求开发|架构变更|纯知识}
📂 目录：.context/feat/{feat-id}/
📄 状态：draft

🔍 相关知识：
- {相关实体1}
- {相关实体2}

💡 下一步建议：
- 需求开发 → /c4a:specify 定义功能规格
- 架构变更 → /c4a:plan 设计技术方案
- 纯知识 → /c4a:specify 定义知识范围
```

## 示例

**需求开发**:
```
用户: "我想开发一个用户登录功能"

Agent:
✅ 已创建 Feature: feat-a001-user-login
📝 类型：需求开发
📂 目录：.context/feat/feat-a001-user-login/
📄 状态：draft

🔍 相关知识：
- auth-service（现有认证服务）
- user-profile（用户数据 SoR）

💡 下一步建议：/c4a:specify - 定义功能规格
```

**架构变更**:
```
用户: "我想把数据库从 MySQL 迁移到 PostgreSQL"

Agent:
✅ 已创建 Feature: feat-a002-mysql-to-postgresql
📝 类型：架构变更 (ADR)
📂 目录：.context/feat/feat-a002-mysql-to-postgresql/
📄 状态：draft

🔍 相关知识：
- database-service（现有数据库服务）
- adr-001-use-mysql（历史决策）

💡 下一步建议：/c4a:plan - 设计迁移方案
```

## 错误处理

| 场景 | 处理 |
|------|------|
| 无法识别类型 | 询问用户确认类型 |
| ID 冲突 | 自动递增编号 |
| 描述过于模糊 | 询问用户补充信息 |
