---
name: "c4a:know:learn"
description: |
  快速录入知识。触发条件：
  - "记录知识"、"整理规范"、"快速记录"
  - "从文档提取知识"、"从代码提取架构"
  - "整理最佳实践"、"录入技术规范"
  用于：从描述/文件/URL/目录快速录入知识到知识库，自动编排完整流程。
---

# /c4a:know:learn - 快速录入知识

纯知识场景的快捷入口，自动编排 `/c4a:feat` → `/c4a:specify` → `/c4a:plan` → 发布 的全流程。

## 命令格式

```
/c4a:know:learn <description>           # 从描述创建知识
/c4a:know:learn <file-path>             # 从本地文件提取知识
/c4a:know:learn <url>                   # 从 URL 提取知识
/c4a:know:learn <directory>             # 从代码目录提取知识
/c4a:know:learn --resume <feat-id>      # 从失败点恢复
```

## 输入识别

| 输入类型 | 识别规则 | 处理方式 |
|----------|----------|----------|
| 描述文本 | 不匹配其他规则 | 与用户对话获取详情 |
| 文件路径 | 以 `./` 或 `/` 开头，指向文件 | `Read` 读取内容 |
| URL | 以 `http://` 或 `https://` 开头 | `WebFetch` 获取内容 |
| 目录 | 以 `./` 或 `/` 开头，指向目录 | `c4a_extract_analyze` 分析代码 |

## 工作流程

```
1. 识别输入 → 获取内容
2. /c4a:feat（内部）→ 创建 Feature，类型：纯知识
3. /c4a:specify（内部）→ 分析内容，提取知识结构
   ⚠️ 如有歧义（置信度 < 90%），暂停询问用户
4. /c4a:plan（内部）→ 查询相关知识，生成 DSL，保存为 draft
5. /c4a:feat --status=approved（内部）→ 批准方案
6. /c4a:feat --status=published（内部）→ 一致性检查，发布
   ⚠️ 如有问题，询问用户处理方式
7. 询问：是否同步到知识库？
```

## 流程控制

| 场景 | 行为 |
|------|------|
| 内容明确（置信度 > 90%） | 自动执行，进入下一步 |
| 内容歧义（置信度 < 90%） | 暂停，询问用户澄清 |
| 一致性警告 | 显示警告，默认继续 |
| 同步确认 | 默认否，可配置为自动同步 |

## 交互点（最多 3 个）

| 交互点 | 时机 | 询问内容 | 默认行为 |
|--------|------|---------|---------|
| 内容歧义 | specify 阶段 | 知识范围、层级、分类 | 必须用户确认 |
| 一致性问题 | 发布前检查 | 如何处理检查失败项 | 忽略警告继续 |
| 同步确认 | 发布后 | 是否立即同步 | 否 |

## 工具依赖

- `Read`: 读取本地文件（Claude Code 内置）
- `WebFetch`: 获取 URL 内容（Claude Code 内置）
- `c4a_extract_analyze`: 分析代码目录
- `c4a_query_search`: 查询相关现有知识
- `c4a_store_save`: 保存知识实体
- `c4a_store_feat_lifecycle`: Feature 生命周期操作

## 错误恢复

当流程中断时，支持从失败点恢复：

```
/c4a:know:learn --resume feat-a001-redis-guide
```

**恢复选项**：

| 选项 | 行为 | 适用场景 |
|------|------|----------|
| 从失败点继续 | 保留已完成步骤，从失败步骤重新执行 | 临时错误 |
| 从头开始 | 保留 feat，重置 workflow_steps | 输入内容有误 |
| 删除并重新开始 | 删除 feat 和所有已创建实体 | 完全放弃 |
| 稍后手动处理 | 不自动恢复 | 需要精细控制 |

流程步骤记录在 Feat 元数据的 `workflow_steps` 字段中，支持断点续传。

## 适用场景

- 快速记录技术规范（内容明确）
- 从文档提取知识（结构清晰）
- 从代码提取架构知识（结构稳定）
- 整理团队最佳实践（内容成熟）

## 不适用场景

- 内容需要多次迭代修改 → 使用 `/c4a:feat` 完整流程
- 需要团队评审后再发布 → 使用 `/c4a:feat` 完整流程
- 涉及架构变更 → 使用 `/c4a:feat` 完整流程

## 示例

**从文件录入**:
```
用户: /c4a:know:learn ./docs/redis-guide.md

Agent:
📖 正在读取文件...
✅ 已创建 Feature: feat-a001-redis-guide
📝 类型：纯知识

🔍 分析内容中...
识别到以下知识点：
1. Redis 连接配置
2. 缓存策略
3. 数据结构使用建议

📋 生成 Functional Spec...
📋 生成 Technical Spec + DSL...

🔍 一致性检查...
✅ 所有检查通过

📤 状态流转：draft → approved → published
✅ 已发布

是否同步到知识库？
1. 是，立即同步
2. 否，稍后手动同步
```

**从描述录入**:
```
用户: /c4a:know:learn "Redis 使用规范"

Agent:
📝 请提供更多信息：
- 这是什么层级的知识？（Enterprise/Domain/Project）
- 主要包含哪些内容？
- 是否有相关文档或代码参考？
```

**恢复中断流程**:
```
用户: /c4a:know:learn --resume feat-a001-redis-guide

Agent:
🔍 检查 feat-a001-redis-guide 状态...
📋 workflow_steps:
  ✅ create_feat: completed
  ✅ specify: completed
  ❌ plan: failed (网络错误)
  ⏳ approve: pending
  ⏳ publish: pending

如何处理？
1. 从失败点继续（推荐）
2. 从头开始
3. 删除并重新开始
4. 稍后手动处理
```
