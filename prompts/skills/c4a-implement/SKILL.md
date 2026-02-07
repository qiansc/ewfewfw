---
name: "c4a:implement"
description: |
  实现代码辅助。触发条件：
  - "开始实现"、"写代码"、"实现功能"
  - 从 /c4a:plan 流转过来
  前置条件：Feature 状态必须为 approved
  用于：(1) 生成实现清单，(2) 辅助代码实现，(3) 更新实现进度
---

# /c4a:implement - 实现代码

## 当前工作上下文

{{#if current_feat_uuid}}
**当前 Feature**: `{{current_feat_uuid}}`
**Feature 状态**: `{{current_feat_status}}`

⚠️ 所有 MCP 工具调用必须传递 `requirement_id: "{{current_feat_uuid}}"`（除非明确读取主分支）。
{{else}}
**当前 Feature**: 无（主分支模式）

⚠️ 当前未选择 Feature，写入操作将直接影响主分支。如需在 Feature 分支工作，请先执行 `/c4a:feat --switch <id>` 或 `/c4a:feat` 创建新 Feature。
{{/if}}

## 工具调用规则

在调用以下 MCP 工具时，必须传递 `requirement_id`：

| 工具 | requirement_id 要求 |
|------|-----------------|
| `c4a_store_read` | 必须传递 `current_feat_uuid`（读取 feat 实体本身除外） |
| `c4a_store_save` | 必须传递 `current_feat_uuid` |
| `c4a_store_feat_checklist` | 使用 `feat_id: "{{current_feat_uuid}}"` |

## 命令格式

```
/c4a:implement                    # 生成/查看实现清单
/c4a:implement --status           # 查看实现进度
/c4a:implement --complete <id>    # 标记任务完成
/c4a:implement --block <id> <原因> # 标记任务阻塞
```

## 前置条件

**必须检查 Feature 状态**：

1. 调用 `c4a_store_read` 读取当前 Feature 元数据：
   - `c4a_store_read({ id: "{{current_feat_uuid}}" })`
2. 未找到 Feature → 提示切换或创建
3. 状态为 `draft` → 提示："⚠️ 方案尚未批准，请先执行 `/c4a:feat --status=approved`"，终止
4. 状态为 `approved` → 继续执行

## 工作流程

### 1. 生成/读取实现清单

```
c4a_store_feat_checklist 检查是否存在 checklist
├─ 不存在：
│   1. c4a_store_read 读取 Technical Spec
│   2. 分析 Container/Component/Contract
│   3. 生成实现步骤清单
│   4. c4a_store_feat_checklist 保存
└─ 已存在：读取并展示进度
```

### 2. 实现辅助

- 生成实现指南
- 用户遇到问题时，`c4a_query_search` 查询相关知识
- 回答实现细节问题

### 3. 实现完成后

- 询问是否有与设计不符的地方
- 如有变更：更新 DSL → `c4a_store_save`
- `c4a_store_feat_checklist` 更新任务状态

## 工具依赖

- `c4a_store_read`: 读取 Feature 元数据与 Technical Spec
- `c4a_store_feat_checklist`: 管理实现清单
- `c4a_store_save`: 保存 DSL 变更
- `c4a_query_search`: 查询相关知识

## 输出格式

**首次调用**:
```
📋 当前 Feature: feat-xxxx-name
📄 状态：approved ✅

📝 生成实现清单...

实现步骤（共 N 项）：
1. [pending] 创建 xxx Container
2. [pending] 实现 xxx 组件
...

💡 建议：
- /c4a:implement --complete <id> 标记完成
- /c4a:analyze 检查一致性
- /c4a:feat --status=published 发布
```

**查看进度 (--status)**:
```
📊 实现进度：feat-xxxx-name

总进度：X/N (XX%)
- ✅ 已完成：X
- 🔄 进行中：X
- 🚫 已阻塞：X
- ⏳ 待开始：X

详细状态：
1. ✅ 任务描述
2. 🔄 任务描述
3. 🚫 任务描述 (阻塞：xxx)
...
```

## 下一步建议

- `/c4a:analyze` - 检查一致性
- `/c4a:feat --status=published` - 发布功能
