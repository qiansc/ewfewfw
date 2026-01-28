## 知识技能 Skills 详细设计

### `/c4a:know:learn` - 快速录入知识

**定位**：知识技能 Skill，通过编排多个工作流 Skills 实现纯知识场景的快速录入。引导用户按照流程执行，在关键检查点和澄清点暂停，无需干涉时自动进入下一步。

**职责**：自动编排 `/c4a:feat` → `/c4a:specify` → `/c4a:plan` → `/c4a:feat --status=approved` → `/c4a:feat --status=published` 的全流程

**流程控制策略**：

| 场景 | 行为 |
|------|------|
| 内容明确（置信度 > 90%） | 自动执行，进入下一步 |
| 内容歧义（置信度 < 90%） | 暂停，询问用户澄清 |
| 一致性警告 | 显示警告，默认继续（可配置为暂停） |
| 同步确认 | 默认否，可配置为自动同步 |

**触发方式**：
- 自然语言：用户说"我想快速记录 Redis 规范"、"帮我整理这份文档的知识"
- 命令：`/c4a:know:learn <description|file-path|url|directory>`

**命令格式**：
```
/c4a:know:learn <description>           # 从描述创建知识
/c4a:know:learn <file-path>             # 从本地文件提取知识
/c4a:know:learn <url>                   # 从 URL 提取知识
/c4a:know:learn <directory>             # 从代码目录提取知识
```

**示例**：
```
/c4a:know:learn "Redis 使用规范"
/c4a:know:learn ./docs/redis-guide.md
/c4a:know:learn https://redis.io/docs/latest/commands
/c4a:know:learn ./src/services/auth/
```

**工具编排**：

> **说明**：Skill 可同时使用 C4A MCP 工具（`c4a_*`）和 Claude Code 内置工具（`Read`、`WebFetch` 等）。

```
1. 识别输入类型：
   - 描述文本 → 与用户对话获取详情
   - 文件路径 → Read 读取内容（Claude Code 内置）
   - URL → WebFetch 获取内容（Claude Code 内置）
   - 目录 → c4a_code_analyze 分析代码（C4A MCP）

2. 调用 /c4a:feat（内部）：
   - 创建 Feature：feat-xxx-<slug>
   - 类型标记：纯知识
   - 生成知识文档草稿

3. 调用 /c4a:specify（内部）：
   - 分析内容，提取知识结构
   - 生成 Functional Spec
   - 如有歧义，暂停询问用户

4. 调用 /c4a:plan（内部）：
   - c4a_query_search 查询相关现有知识
   - Agent 基于模板 生成 DSL：
     * System（如果是产品级）
     * Container（如果是模块级）
     * Component（如果是组件级）
   - c4a_store_save 保存为 draft 状态（写入数据库，并带上 proposal_id/feat_id）
   - 自动双写到 `.context/feat/...` 供版本控制与审阅

5. 调用 /c4a:feat --status=approved（内部）：
   - 批准方案：draft → approved

6. 调用 /c4a:feat --status=published（内部）：
   - 一致性检查
   - 如有问题，询问用户处理方式
   - 状态流转：approved → published

7. 询问用户：是否同步到知识库？
   - 是 → 通过 Bash 执行 `c4a sync`（CLI 命令，适用于所有模式）
   - 否 → 提示后续可以手动执行 c4a sync
```

**交互点（最多 3 个）**：

| 交互点 | 时机 | 询问内容 | 默认行为 |
|--------|------|---------|---------|
| 1. 内容歧义 | specify 阶段 | 知识范围、层级、分类等 | 无默认，必须用户确认 |
| 2. 一致性问题 | 发布前检查 | 如何处理检查失败项 | 默认"忽略警告继续" |
| 3. 同步确认 | 发布后 | 是否立即同步到知识库 | 默认"否" |

**输出**：
- Feature 创建确认
- 知识 DSL（已发布）
- 知识文档（Markdown）
- 同步结果（如用户选择同步）

**错误恢复机制**：

当 `/c4a:know:learn` 在多步骤编排中失败时，支持从失败点恢复。

**核心设计**：
- 将流程步骤记录在 Feat 元数据的 `workflow_steps` 字段中
- 支持断点续传、跨机器恢复、幂等重试、原子清理
- `workflow_steps` 是纯运行时状态，仅存在于数据库，不同步到本地文件

**恢复选项**：

| 选项 | 行为 | 适用场景 |
|------|------|----------|
| 从失败点继续 | 保留已完成步骤，从失败步骤重新执行 | 临时错误（网络、权限等） |
| 从头开始 | 保留 feat，重置 workflow_steps | 输入内容有误 |
| 删除 feat 并重新开始 | 删除 feat 和所有已创建实体 | 完全放弃当前尝试 |
| 稍后手动处理 | 不自动恢复 | 需要精细控制 |

**恢复命令**：

```bash
/c4a:know:learn --resume feat-a001-redis-guide
```

> **详细实现**：数据结构、原子更新、完成判定、实体清理等实现细节见 [Workflow 错误恢复机制](../data-ops/workflow-recovery.md)

**与 `/c4a:feat` 的关系**：
- `/c4a:know:learn` 是纯知识场景的快捷入口，自动化程度更高
- 内部编排 `/c4a:feat` → `/c4a:specify` → `/c4a:plan` → `/c4a:feat --status=published` 的逻辑
- 如果用户需要更精细的控制（如分步审查、多次修改），应使用完整的 `/c4a:feat` 流程

**适用场景**：
- 快速记录技术规范（内容明确，无需反复修改）
- 从文档提取知识（文档结构清晰）
- 从代码提取架构知识（代码结构稳定）
- 整理团队最佳实践（内容已成熟）

**不适用场景**：
- 内容需要多次迭代修改
- 需要团队评审后再发布
- 涉及架构变更（应使用 `/c4a:feat` 完整流程）

**示例完整流程**：
```
用户: /c4a:know:learn ./docs/redis-guide.md

Agent:
📖 正在读取文件...

✅ 已创建 Feature: feat-a001-redis-guide
📝 类型：纯知识
📂 目录：.context/feat/feat-a001-redis-guide/

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

---

### `/c4a:know:search` - 搜索知识库

**定位**：知识技能 Skill，提供语义搜索能力，快速查找相关知识。

**职责**：语义搜索知识库，返回相关实体和文档

**触发方式**：
- 自然语言：用户说"搜索订单相关的知识"、"查找 Redis 的使用规范"
- 命令：`/c4a:know:search <query>`

**命令格式**：
```
/c4a:know:search <query>              # 语义搜索
/c4a:know:search <query> --scope=<scope>  # 限定范围搜索
/c4a:know:search <query> --type=<type>    # 限定类型搜索
```

**示例**：
```
/c4a:know:search "订单状态机"
/c4a:know:search "Redis 缓存" --scope=enterprise
/c4a:know:search "认证服务" --type=container
```

**工具编排**：
```
1. c4a_query_search 语义搜索
2. 按相关度排序结果
3. 展示匹配的实体（ID、类型、摘要）
4. 提供详细查看选项
```

**输出**：
- 搜索结果列表
- 每个结果的摘要
- 详细查看建议

**示例完整流程**：
```
用户: /c4a:know:search "订单状态机"

Agent:
🔍 搜索中...

找到 3 个相关结果：

1. [Process] order-state-machine (Domain 层)
   描述：电商行业通用的订单状态流转
   相关度：95%

2. [SoR] order-status-rules (Enterprise 层)
   描述：订单状态变更规则
   相关度：87%

3. [Container] order-service (Project 层)
   描述：订单服务，实现订单状态管理
   相关度：78%

输入序号查看详情，或继续搜索其他关键词
```

---

