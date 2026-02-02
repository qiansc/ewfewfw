## Skills 实现规范

### 创建 Skill 的方式

**优先使用 skill-creator 工具**：

```bash
# 创建新 Skill（推荐）
skill-creator create <skill-name>

# 从模板创建
skill-creator create <skill-name> --template <template-name>

# 验证 Skill 配置
skill-creator validate <skill-name>
```

skill-creator 会自动：
1. 生成标准格式的 Skill 文件
2. 创建必要的子目录结构
3. 生成路由表（如果是复杂 Skill）
4. 验证配置完整性

### Skill 文件结构

**Skills**（Agent 提示词）：

> **统一规范**：所有 Skill 都采用目录结构，便于转换器处理和后续扩展。详见 [summary.md#prompts-目录规划](./summary.md#prompts-目录规划)。

```
prompts/skills/
├── c4a-feat/                # Feature 管理
│   ├── SKILL.md             # 主提示词
│   ├── references/          # 参考文档（可选）
│   └── examples/            # 示例（可选）
├── c4a-specify/
│   └── SKILL.md             # 功能规格
├── c4a-plan/
│   └── SKILL.md             # 技术方案
├── c4a-implement/
│   └── SKILL.md             # 实现代码
└── ...
```

**Commands**（CLI 命令设计文档）：

```
prompts/commands/
├── sync.md              # c4a sync 命令设计
├── status.md            # c4a status 命令设计
└── help.md              # c4a help 命令设计
```

**复杂 Skill**（多能力/多状态）：使用子文件 + 路由表

当一个 Skill 具有多个并行能力或多状态流程时，可在目录内添加子文件和路由表：

```
prompts/skills/
└── c4a-feat/
    ├── SKILL.md                 # 主提示词 + 路由表
    ├── create.md                # 创建 Feature
    ├── switch.md                # 切换上下文
    ├── transition.md            # 状态流转
    └── routes/                  # 可选：按场景拆分
        ├── requirement.md       # 需求开发场景
        ├── adr.md               # 架构变更场景
        └── knowledge.md         # 纯知识场景
```

### 路由表格式

复杂 Skill 在 `SKILL.md` 中包含路由表：

```markdown
# /c4a:feat 路由表

## 能力路由

根据用户输入或参数，路由到对应的子 Skill：

| 触发条件 | 路由到 | 说明 |
|---------|--------|------|
| `--create` 或 "创建/新建" | create.md | 创建新 Feature |
| `--switch <id>` 或 "切换到" | switch.md | 切换工作上下文 |
| `--status=<status>` 或 "发布/批准" | transition.md | 状态流转 |

## 场景路由

根据用户描述自动识别场景：

| 关键词 | 场景 | 路由到 |
|--------|------|--------|
| "实现"、"开发"、"功能" | 需求开发 | routes/requirement.md |
| "迁移"、"升级"、"重构" | 架构变更 | routes/adr.md |
| "整理"、"记录"、"规范" | 纯知识 | routes/knowledge.md |

## 默认行为

如果无法识别，默认路由到 `create.md`，并询问用户确认场景类型。
```

**路由表设计原则**：

1. **明确优先级**：参数路由 > 关键词路由 > 默认行为
2. **互斥性**：同一输入只能匹配一个路由
3. **兜底机制**：必须有默认行为处理未知情况
4. **可扩展**：新增能力时只需添加路由条目和对应文件

### 多状态流程拆分

当 Skill 涉及多个状态时，可按状态拆分提示词文件：

```
prompts/skills/
└── c4a-feat/
    ├── SKILL.md
    ├── states/                  # 按状态拆分
    │   ├── draft.md             # draft 状态的操作
    │   ├── approved.md          # approved 状态的操作
    │   └── published.md         # published 状态的操作
    └── transitions/             # 状态转换
        ├── draft-to-approved.md
        └── approved-to-published.md
```

**状态路由表示例**：

```markdown
## 状态路由

根据当前 Feature 状态，路由到对应处理：

| 当前状态 | 可执行操作 | 路由到 |
|---------|-----------|--------|
| draft | 编辑、删除、批准 | states/draft.md |
| approved | 实现、发布、撤回 | states/approved.md |
| published | 查看、废弃 | states/published.md |

## 状态转换路由

| 转换 | 前置条件 | 路由到 |
|------|---------|--------|
| draft → approved | 一致性检查通过 | transitions/draft-to-approved.md |
| approved → published | 实现完成 | transitions/approved-to-published.md |
```

### Skill 文件格式

```markdown
# [Skill 名称]

## 职责

简要说明这个 Skill 的职责

## 触发条件

- 用户说"xxx"
- 场景：xxx

## 前置条件

- 需要已有 xxx
- 数据库状态：xxx

## 工具编排

1. 步骤 1：调用 tool_a(...)
2. 步骤 2：与用户交互
3. 步骤 3：调用 tool_b(...)
...

## 输出

- 产物 1：xxx
- 产物 2：xxx

## 下一步建议

- /c4a:xxx - 说明

## 适用场景

- 场景 1
- 场景 2
```

### 执行规则

1. **严格按步骤执行**：不跳过、不简化
2. **工具确定性**：每个步骤使用明确指定的工具
3. **用户确认**：关键操作（删除、状态流转）必须请求用户确认
4. **错误处理**：工具调用失败时，根据错误类型和 `recoverable_actions` 决定处理方式（详见下方规范）
5. **进度报告**：长流程中，及时向用户报告进度
6. **路由优先**：复杂 Skill 必须先执行路由判断，再加载对应子 Skill
7. **路由透明**：路由过程对用户透明，但在调试模式下可展示路由决策
8. **上下文注入**：涉及 Feat 操作的 Skill 必须注入 `current_proposal_id`（见下方规范）

### 错误处理规范

> **分层职责**：MCP 工具返回结构化错误和 `recoverable_actions`，Skill/Agent 层决定如何呈现交互选项。
> 详见 [error-recovery.md#2.2.1](../permissions/error-recovery.md#221-错误处理的分层职责)。

**Agent 错误处理策略**（按错误类别）：

| 错误类别 | Agent 行为 | 说明 |
|---------|-----------|------|
| `INPUT` | 检查参数，修正后重试 | 参数错误，查看 `details.field` 定位问题 |
| `DATA` | 检查数据依赖，可能需要先创建/修复数据 | 数据一致性问题 |
| `SYS` | 等待后重试，或报告系统问题 | 系统故障，非 Agent 可解决 |
| `BIZ` | 根据 `recoverable_actions` 决定下一步 | 业务规则限制 |
| `PERM` | 提示用户权限不足，无法自动恢复 | 需要人工授权 |

**处理 `recoverable_actions`**：

当 MCP 工具返回 `recoverable_actions` 时，Skill 应：

1. 解析可用的恢复操作
2. 根据操作类型决定是否自动执行或询问用户
3. 向用户展示选项时，使用 `label` 作为显示文本

```typescript
// Skill 处理示例
if (error.recoverable_actions?.length > 0) {
  // 展示选项给用户
  const options = error.recoverable_actions.map(a => a.label);
  const choice = await askUser("如何处理？", options);

  // 执行用户选择的操作
  const action = error.recoverable_actions[choice];
  if (action.action === "retry") {
    await retryWithParams(action.params);
  } else if (action.action === "force") {
    await executeWithForce(action.params);
  }
}
```

### Feat 上下文注入规范（强制）

> **背景**：CoW（Copy-on-Write）机制强依赖 `proposal_id` 参数。如果 Agent 在多轮对话中"忘记"当前的 feat_id，或用户切换话题但未通知 Agent，可能导致：
> - 错误地读取主分支数据（而非 feat 分支）
> - 写入错误位置（主分支而非 feat 分支）
> - 数据污染和一致性问题

**强制要求**：所有涉及 Feat 操作的 Skill（`/c4a:feat`、`/c4a:specify`、`/c4a:plan`、`/c4a:implement`、`/c4a:analyze`）必须在 Prompt 中包含以下上下文注入机制：

#### 1. System Prompt 注入

Skill 的 System Prompt 必须包含当前 Feat 上下文：

```markdown
## 当前工作上下文

{{#if current_proposal_id}}
**当前 Feature**: `{{current_proposal_id}}`
**Feature 状态**: `{{current_proposal_status}}`

⚠️ 所有 MCP 工具调用必须传递 `proposal_id: "{{current_proposal_id}}"`
{{else}}
**当前 Feature**: 无（主分支模式）

⚠️ 当前未选择 Feature，写入操作将直接影响主分支。如需在 Feature 分支工作，请先执行 `/c4a:feat --switch <id>` 或 `/c4a:feat --create`。
{{/if}}
```

#### 2. 每轮对话 Context 注入

CLI/IDE 集成层必须在每轮对话的 Context 中注入当前 Feat 状态：

```typescript
// CLI 层实现示例
function buildConversationContext(): string {
  const currentFeat = sessionStore.getCurrentFeat();

  if (currentFeat) {
    return `
[C4A Context]
current_proposal_id: ${currentFeat.id}
current_proposal_status: ${currentFeat.status}
current_proposal_title: ${currentFeat.title}
`;
  }

  return `
[C4A Context]
current_proposal_id: null
mode: main_branch
`;
}
```

> **实现对齐**：config-generator 在生成 Skills 命令时会读取 `.context/feat/current.json`，
> 或使用环境变量 `C4A_CURRENT_PROPOSAL_ID` / `C4A_CURRENT_PROPOSAL_STATUS` / `C4A_CURRENT_PROPOSAL_TITLE`
> 渲染模板变量，确保 `{{current_proposal_id}}` 等占位符可用。

#### 3. MCP 工具调用校验

Skill Prompt 必须包含工具调用校验规则：

```markdown
## 工具调用规则

在调用以下 MCP 工具时，**必须**传递 `proposal_id` 参数：

| 工具 | proposal_id 要求 |
|------|-----------------|
| `c4a_store_save` | 必须传递 `current_proposal_id` |
| `c4a_store_read` | 必须传递 `current_proposal_id`（除非明确需要读取主分支） |
| `c4a_store_list` | 必须传递 `current_proposal_id` |
| `c4a_store_delete` | 必须传递 `current_proposal_id` |
| `c4a_store_feat_checklist` | 必须传递 `current_proposal_id` |

**错误示例**（禁止）：
```json
{ "type": "container", "id": "auth-service", "data": {...} }
```

**正确示例**：
```json
{ "type": "container", "id": "auth-service", "proposal_id": "feat-a001-user-login", "data": {...} }
```
```

#### 4. 上下文丢失检测

Skill 必须在执行前检测上下文是否有效：

```markdown
## 前置检查

1. 检查 `current_proposal_id` 是否存在
2. 如果不存在，询问用户：
   - "当前未选择 Feature，是否要创建新 Feature 或切换到已有 Feature？"
3. 如果存在，验证 Feature 状态是否允许当前操作
```

#### 5. 上下文切换提醒

当用户话题明显切换时，Skill 应主动提醒：

```markdown
## 话题切换检测

如果用户提到的实体或功能与当前 Feature (`{{current_proposal_id}}`) 无关，应提醒：

"您提到的 [xxx] 似乎与当前 Feature `{{current_proposal_id}}` 无关。是否要：
1. 继续在当前 Feature 中工作
2. 切换到其他 Feature
3. 创建新 Feature"
```

> **设计原则**：宁可多问一次，也不要在错误的上下文中执行操作。上下文错误导致的数据污染比多一次确认的成本高得多。

### 何时需要拆分

判断 Skill 是否需要拆分为目录结构：

| 情况 | 是否拆分 | 说明 |
|------|---------|------|
| 单一流程，无分支 | 否 | 使用单文件 |
| 2-3 个简单分支 | 否 | 在单文件中用条件判断 |
| 多个并行能力（>3） | 是 | 拆分为目录 + 路由表 |
| 多状态流程 | 是 | 按状态拆分 |
| 多场景差异大 | 是 | 按场景拆分 |
| 提示词超过 500 行 | 是 | 拆分以提高可维护性 |

---

## 与现有系统的集成

### 1. 废弃现有 Skills

现有的 22 个 Skills 过于原子化，全部废弃，替换为新的 7 个 Skills（5 个工作流 + 2 个知识技能）。

### 2. 更新 CLAUDE.md

在 `CLAUDE.md` 中添加 Skills 和 Commands 使用指南：

```markdown
## Skills 和 Commands 使用

C4A 提供以下 Skills 和 Commands 来完成架构知识管理任务：

### 核心 Skills（自然语言交互）
- `/c4a:feat` - Feature 管理（创建/修改/切换/流转）
- `/c4a:specify` - 功能规格
- `/c4a:plan` - 技术方案
- `/c4a:implement` - 实现代码

### CLI Commands
- `c4a sync` - 同步到知识库
- `c4a status` - 查看状态
- `c4a help` - 帮助信息

用户通过 Skills 完成复杂流程，通过 Commands 执行工具类操作。
```

### 3. 更新 c4a.md Agent Prompt

在 `prompts/c4a.md` 中添加 Skills 路由逻辑：

```markdown
## Skills 路由

当用户描述需求时，自动识别意图并路由到对应 Skill 或 Command：

| 用户意图 | 路由到 |
|---------|--------|
| "我想开发一个功能" | /c4a:feat |
| "我想整理知识" | /c4a:know:learn |
| "我想升级/迁移" | /c4a:feat (ADR) |
| "定义功能规格" | /c4a:specify |
| "设计技术方案" | /c4a:plan |
| "开始实现" | /c4a:implement |
| "发布" | /c4a:feat --status=published |
| "同步到知识库" | c4a sync |
| "查看状态" | c4a status |
| "搜索 xxx" | /c4a:know:search |
```

---

## 实施计划

### Phase 1: 核心流程（5 个 Skills）

**目标**：完成核心流程，验证设计有效性

| 类型 | 名称 | 工作量 | 说明 |
|------|------|--------|------|
| Skill | `/c4a:feat` | 大 | Feature 管理，包含类型识别、上下文切换、一致性检查 |
| Skill | `/c4a:specify` | 中 | 功能规格生成 |
| Skill | `/c4a:plan` | 大 | 技术方案，包含 ADR 检测、契约补充、验收清单生成 |
| Skill | `/c4a:implement` | 大 | 实现代码，包含实现清单生成、任务计划 |
| Skill | `/c4a:know:learn` | 中 | 快速录入知识，编排 feat/specify/plan/publish 流程 |

**交付物**：
1. 5 个 Skill 文件
2. 更新 CLAUDE.md 和 c4a.md
3. 端到端测试：完整走一遍三种场景（需求开发、架构变更、纯知识）

### Phase 2: 辅助功能（2 个 Skills + 3 个 CLI 命令）

**目标**：完善辅助功能

| 类型 | 名称 | 工作量 | 说明 |
|------|------|--------|------|
| Skill | `/c4a:know:search` | 小 | 语义搜索知识库 |
| Skill | `/c4a:analyze` | 中 | 一致性检查和影响分析 |
| CLI | `c4a sync` | 中 | 同步到知识库 |
| CLI | `c4a status` | 小 | 状态概览 |
| CLI | `c4a help` | 小 | 帮助信息 |

**交付物**：
1. 2 个 Skill 文件 + 3 个 CLI 命令设计文档
2. 优化 Skills 路由逻辑
3. 补充文档和示例

### Phase 3: 优化和完善

**目标**：基于使用反馈优化

1. 收集使用数据
2. 优化 Skills 逻辑
3. 补充边缘场景处理
4. 性能优化（如有需要）

---
