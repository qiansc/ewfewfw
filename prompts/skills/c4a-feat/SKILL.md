---
name: "c4a:feat"
description: |
  Feature 生命周期管理。触发条件：
  - "开发功能"、"实现功能"、"新建 feat"
  - "创建 ADR"、"迁移"、"升级"、"重构"
  - "整理知识"、"记录规范"
  - "切换到 feat-xxx"、"继续做 feat-xxx"
  - "批准方案"、"发布"
  用于：(1) 创建 Feature，(2) 切换工作上下文，(3) 状态流转（draft→approved→published）
---

# /c4a:feat - Feature 生命周期管理

## 当前工作上下文

{{#if current_feat_uuid}}
**当前 Feature**: `{{current_feat_uuid}}`
**Feature 状态**: `{{current_feat_status}}`
{{else}}
**当前 Feature**: 无（主分支模式）
{{/if}}

## 命令格式

```
/c4a:feat [描述]              # 创建 Feature
/c4a:feat --switch <feat-id>  # 切换上下文
/c4a:feat --status=approved   # 批准方案
/c4a:feat --status=published  # 发布
```

## 路由表

### 能力路由

| 触发条件 | 路由到 | 说明 |
|---------|--------|------|
| `--switch <id>` 或 "切换到" | switch.md | 切换工作上下文 |
| `--status=approved` 或 "批准方案" | transition.md | 状态流转（批准） |
| `--status=published` 或 "发布" | transition.md | 状态流转（发布） |
| 默认 | create.md | 创建 Feature |

### 场景路由

| 关键词 | 场景 | 路由到 |
|--------|------|--------|
| "实现"、"开发"、"功能" | 需求开发 | create.md（类型：需求开发） |
| "迁移"、"升级"、"重构" | 架构变更 | create.md（类型：架构变更） |
| "整理"、"记录"、"规范" | 纯知识 | create.md（类型：纯知识） |

### 默认行为

无法识别时，询问用户确认场景类型后再创建 Feature。

## 核心能力

| 能力 | 说明 | 详细文档 |
|------|------|----------|
| 创建 Feature | 自动识别类型，生成 ID 和目录 | [create.md](create.md) |
| 切换上下文 | 切换当前工作 Feature | [switch.md](switch.md) |
| 状态流转 | draft→approved→published | [transition.md](transition.md) |

## Feature 类型识别

| 关键词 | 类型 | 后续流程 |
|--------|------|----------|
| "实现"、"开发"、"功能" | 需求开发 | specify → plan → implement → publish |
| "迁移"、"升级"、"重构" | 架构变更 (ADR) | plan → implement → publish |
| "整理"、"记录"、"规范" | 纯知识 | specify → plan → publish |

## 工具调用规则

- `c4a_store_feat_lifecycle` 使用 `feat_id` 进行创建/流转
- 读取 feat 内实体时必须传递 `requirement_id: "{{current_feat_uuid}}"`（如已选择）

## 工具依赖

- `c4a_store_feat_lifecycle`: Feature 生命周期操作
- `c4a_query_search`: 查询相关知识

## 快速示例

**创建 Feature**:
```
用户: "我想开发用户登录功能"
→ 创建 feat-a001-user-login，类型：需求开发
```

**切换上下文**:
```
用户: "切换到 feat-a001"
→ 加载 feat-a001 上下文，展示状态
```

**状态流转**:
```
用户: "批准方案"
→ draft → approved

用户: "发布"
→ approved → published（含一致性检查和合并）
```
