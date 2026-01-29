# Part 10: Skills 体系

> 详细执行计划 - 基于 `v0.3.0/detailed-design/skills-design.md` 及相关设计文档

---

## 关联文件索引

### 设计文档 (v0.3.0/)

| 文件 | 说明 | 关键章节 |
|------|------|---------|
| `concepts.md` | 核心概念定义 | Skills 与 Commands 定义 |
| `architecture.md` | 系统架构 | §1.5 Skills/Commands 分层 |
| `detailed-design/skills-design.md` | Skills 设计入口 | 文档结构索引 |
| `detailed-design/skills/overview.md` | 设计原则 | §1 设计原则, §2 触发方式 |
| `detailed-design/skills/architecture.md` | Skills 体系设计 | §1 Skills 设计, §2 /c4a:model |
| `detailed-design/skills/core-skills.md` | 核心 Skills 详细设计 | feat/specify/plan/analyze/implement |
| `detailed-design/skills/know-skills.md` | 知识 Skills | know:learn/know:search |
| `detailed-design/skills/implementation.md` | 实现规范 | Skill 文件结构/路由表/执行规则 |
| `detailed-design/skills/checklist-format.md` | Checklist 格式 | YAML 格式/字段定义 |
| `detailed-design/skills/scenarios.md` | 三种场景流程 | 需求开发/架构变更/纯知识 |
| `detailed-design/skills/modeling-adr.md` | ADR 关联逻辑 | 架构变更检测/ADR 模板 |
| `detailed-design/skills/visualization.md` | 可视化处理 | 悬空引用/Diff 视图 |
| `detailed-design/skills/future-skills.md` | 未来 Skills | /c4a:ops:rollback (v0.4.0) |

### 现有实现代码 (prompts/)

| 文件 | 说明 | 状态 |
|------|------|:----:|
| `prompts/skills/` | Skills 目录 | 待创建 |
| `prompts/commands/` | Commands 目录 | 待创建 |
| `prompts/c4a.md` | Agent 主提示词 | 待更新 |

---

## 概述

Part 10 实现 Skills 体系，包括 7 个公开 Skills（5 个工作流 + 2 个知识技能）和 1 个内部 Skill（/c4a:model）。Skills 是 Agent 的高层能力封装，通过编排 MCP 工具完成复杂流程。

**核心产物**：
- 5 个工作流 Skills：`/c4a:feat`、`/c4a:specify`、`/c4a:plan`、`/c4a:implement`、`/c4a:analyze`
- 2 个知识 Skills：`/c4a:know:learn`、`/c4a:know:search`
- 1 个内部 Skill：`/c4a:model`（建模规则，内联到父 Skill）
- Skills 路由逻辑更新到 `prompts/c4a.md`
- Skill 文件结构规范

---

## 任务清单

| # | 功能 | 完成 | 描述 |
|---|------|:---:|------|
| 10.1 | Skills 设计原则 | [x] | 路由优先/禁止直接接触 MCP/粒度完整流程 |
| 10.2 | Skills 触发方式 | [x] | 显式命令 vs 自然语言触发 |
| 10.3 | Skill 文件结构规范 | [x] | prompts/skills/{name}/SKILL.md 目录结构 |
| 10.4 | 路由表格式 | [x] | 能力路由/场景路由/默认行为 |
| 10.5 | Skill 执行规则 | [x] | 严格按步骤/用户确认/错误处理 |
| 10.6 | Feat 上下文注入规范 | [x] | System Prompt/Context/MCP 调用校验 |
| 10.7 | 错误处理规范 | [x] | recoverable_actions 处理 |
| 10.8 | /c4a:feat Skill | [x] | Feature 管理（创建/切换/状态流转） |
| 10.9 | /c4a:feat 类型识别 | [x] | 需求开发 vs 架构变更 vs 纯知识 |
| 10.10 | /c4a:feat 上下文切换 | [x] | --switch 参数/会话记忆 |
| 10.11 | /c4a:feat 状态流转 | [x] | --status 参数/一致性检查 |
| 10.12 | /c4a:specify Skill | [x] | Functional Spec 生成 |
| 10.13 | /c4a:plan Skill | [x] | Technical Spec + Contract + Checklist |
| 10.14 | /c4a:plan ADR 检测 | [x] | 架构变更检测/ADR 关联 |
| 10.15 | /c4a:plan 契约补充 | [x] | OpenAPI/AsyncAPI/Proto 生成 |
| 10.16 | /c4a:plan 验收清单 | [x] | Checklist 生成 |
| 10.17 | /c4a:implement Skill | [x] | 实现代码辅助 |
| 10.18 | /c4a:implement 状态校验 | [x] | 仅 approved 状态可执行 |
| 10.19 | /c4a:implement 清单生成 | [x] | 实现清单生成/任务计划 |
| 10.20 | /c4a:analyze Skill | [x] | 一致性检查/影响分析 |
| 10.21 | /c4a:analyze 检查项 | [x] | Spec 完整性/契约完备/DSL 引用/ADR 完备度 |
| 10.22 | /c4a:analyze 悬空引用 | [x] | 悬空引用检测/可视化 |
| 10.23 | /c4a:know:learn Skill | [x] | 快速录入知识（编排多 Skills） |
| 10.24 | /c4a:know:learn 输入识别 | [x] | 描述/文件/URL/目录 |
| 10.25 | /c4a:know:learn 流程控制 | [x] | 置信度判断/暂停点 |
| 10.26 | /c4a:know:learn 错误恢复 | [x] | workflow_steps/断点续传 |
| 10.27 | /c4a:know:search Skill | [x] | 语义搜索知识库 |
| 10.28 | /c4a:model 内部 Skill | [x] | 建模规则（内联到父 Skill） |
| 10.29 | Checklist 格式定义 | [x] | YAML 格式/tasks/progress/risks |
| 10.30 | Checklist MCP 集成 | [x] | c4a_store_feat_checklist 调用 |
| 10.31 | ADR 模板定义 | [x] | ADR 字段/完整性检查 |
| 10.32 | 架构变更检测规则 | [x] | System/Container/DEPENDS_ON 变更 |
| 10.33 | 按依赖范围检查优化 | [x] | 性能优化/延迟检查 |
| 10.34 | 悬空引用可视化 | [x] | Mermaid 样式/CLI 报告 |
| 10.35 | 三种场景流程 | [x] | 需求开发/架构变更/纯知识完整流程 |
| 10.36 | prompts/c4a.md 更新 | [x] | Skills 路由逻辑 |
| 10.37 | CLAUDE.md 更新 | [x] | Skills 使用指南 |
| 10.38 | 单元测试 | [x] | Skill 文件格式验证 |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 10.1 | 设计原则 | `overview.md` | §1 设计原则 | L3-42 | [x] | [x] |
| 10.2 | 触发方式 | `overview.md` | §2 触发方式 | L44-83 | [x] | [x] |
| 10.3 | 文件结构 | `implementation.md` | §Skill 文件结构 | L24-69 | [x] | [x] |
| 10.4 | 路由表格式 | `implementation.md` | §路由表格式 | L71-108 | [x] | [x] |
| 10.5 | 执行规则 | `implementation.md` | §执行规则 | L189-198 | [x] | [x] |
| 10.6 | 上下文注入 | `implementation.md` | §Feat 上下文注入规范 | L240-350 | [x] | [x] |
| 10.7 | 错误处理 | `implementation.md` | §错误处理规范 | L200-238 | [x] | [x] |
| 10.8-10.11 | /c4a:feat | `core-skills.md` | §/c4a:feat | L3-154 | [x] | [x] |
| 10.12 | /c4a:specify | `core-skills.md` | §/c4a:specify | L156-219 | [x] | [x] |
| 10.13-10.16 | /c4a:plan | `core-skills.md` | §/c4a:plan | L221-402 | [x] | [x] |
| 10.17-10.19 | /c4a:implement | `core-skills.md` | §/c4a:implement | L404-533 | [x] | [x] |
| 10.20-10.22 | /c4a:analyze | `core-skills.md` | §/c4a:analyze | L535-687 | [x] | [x] |
| 10.23-10.26 | /c4a:know:learn | `know-skills.md` | §/c4a:know:learn | L3-136 | [x] | [x] |
| 10.27 | /c4a:know:search | `know-skills.md` | §/c4a:know:search | L170-232 | [x] | [x] |
| 10.28 | /c4a:model | `architecture.md` | §/c4a:model | L1-36 | [x] | [x] |
| 10.29-10.30 | Checklist 格式 | `checklist-format.md` | 全文 | L1-277 | [x] | [x] |
| 10.31 | ADR 模板 | `modeling-adr.md` | §ADR 模板 | L243-305 | [x] | [x] |
| 10.32-10.33 | 架构变更检测 | `modeling-adr.md` | §架构变更定义/检测逻辑 | L38-241 | [x] | [x] |
| 10.34 | 悬空引用可视化 | `visualization.md` | §悬空引用 | L1-392 | [x] | [x] |
| 10.35 | 三种场景 | `scenarios.md` | 全文 | L1-88 | [x] | [x] |
| 10.36 | c4a.md 更新 | `implementation.md` | §更新 c4a.md | L396-417 | [x] | [x] |
| 10.37 | CLAUDE.md 更新 | `implementation.md` | §更新 CLAUDE.md | L374-394 | [x] | [x] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| Skill 文件 | `prompts/skills/c4a-feat/SKILL.md` | Feature 管理主 Skill | ✅ |
| Skill 文件 | `prompts/skills/c4a-feat/create.md` | 创建 Feature | ✅ |
| Skill 文件 | `prompts/skills/c4a-feat/switch.md` | 切换上下文 | ✅ |
| Skill 文件 | `prompts/skills/c4a-feat/transition.md` | 状态流转 | ✅ |
| Skill 文件 | `prompts/skills/c4a-specify/SKILL.md` | 功能规格 | ✅ |
| Skill 文件 | `prompts/skills/c4a-plan/SKILL.md` | 技术方案 | ✅ |
| Skill 文件 | `prompts/skills/c4a-implement/SKILL.md` | 实现代码 | ✅ |
| Skill 文件 | `prompts/skills/c4a-analyze/SKILL.md` | 一致性检查 | ✅ |
| Skill 文件 | `prompts/skills/c4a-know-learn/SKILL.md` | 快速录入知识 | ✅ |
| Skill 文件 | `prompts/skills/c4a-know-search/SKILL.md` | 搜索知识库 | ✅ |
| 建模规则 | `prompts/skills/c4a-model/modeling-rules.md` | 建模规则（内联用） | ✅ |
| Agent 提示词 | `prompts/c4a.md` | Skills 路由逻辑 | ✅ |
| 项目文档 | `CLAUDE.md` | Skills 使用指南 | ✅ |
| 测试文件 | `prompts/__tests__/skill-format.test.ts` | Skill 文件格式验证 | ✅ |

---

## 依赖关系

### 前置依赖

| Part | 依赖项 | 接口状态 | 实现状态 | 说明 |
|------|--------|:--------:|:--------:|------|
| Part 03 | MCP Store 工具 | ✅ 完成 | ✅ 完成 | Skills 调用 c4a_store_* |
| Part 04 | MCP Query 工具 | ✅ 完成 | 🔶 Local 完成 | Skills 调用 c4a_query_*（4.5 降级行为挂起，不影响 Local 模式） |
| Part 05 | MCP Extract 工具 | ✅ 完成 | ✅ 完成 | /c4a:plan 调用 c4a_extract_analyze |

> **依赖说明**：
> - **接口状态**：MCP 工具的输入/输出接口定义是否完成
> - **实现状态**：MCP 工具的功能实现是否完成
> - Part 04 的 4.5 降级行为依赖 Part 13 Server 模式，但 Local 模式已完整可用
>
> **结论**：Part 10 前置依赖已就绪，可以开始执行。

### 被依赖

| Part | 依赖方 | 说明 |
|------|--------|------|
| Part 08 | User CLI | CLI 集成 Skills |
| Part 12 | 用户故事 | 端到端测试验证 |

---

## Skills 体系概览

### 工作流 Skills（5 个）

| Skill | 职责 | 触发条件 | 输出 |
|-------|------|---------|------|
| `/c4a:feat` | Feature 管理 | "开发功能"、"创建 ADR" | Feature 目录、PRD/ADR 草稿 |
| `/c4a:specify` | 功能规格 | "定义功能规格" | Functional Spec |
| `/c4a:plan` | 技术方案 | "设计技术方案" | Technical Spec + Contract + Checklist |
| `/c4a:implement` | 实现代码 | "开始实现"（approved 状态） | 实现清单、代码 |
| `/c4a:analyze` | 一致性检查 | "检查一致性" | 检查报告 |

### 知识 Skills（2 个）

| Skill | 职责 | 触发条件 | 输出 |
|-------|------|---------|------|
| `/c4a:know:learn` | 快速录入知识 | "记录知识"、"整理规范" | 知识 DSL |
| `/c4a:know:search` | 搜索知识库 | "搜索 xxx" | 搜索结果 |

### 内部 Skill（1 个）

| Skill | 职责 | 调用方式 | 说明 |
|-------|------|---------|------|
| `/c4a:model` | DSL 建模 | 引用文本 | 独立文件，不可路由，供父 Skill 引用 |

> **`/c4a:model` 定位说明**：
> - 存放于 `prompts/skills/c4a-model/modeling-rules.md`
> - 不注册到路由表，用户无法直接调用
> - 作为参考文本被 `/c4a:specify`、`/c4a:plan` 等 Skill 引用
> - 包含 DSL 建模规则、命名规范、关系定义等

---

## Skill 创建工具

### 使用 skill-creator 创建 Skills

Part 10 的 Skill 文件使用 `skill-creator` 技能来编写，确保格式规范和一致性。

**调用方式**：
```
/skill-creator
```

**创建流程**：
1. 调用 `/skill-creator` 启动技能
2. 提供 Skill 名称和职责描述
3. skill-creator 会引导完成以下内容：
   - 触发条件定义
   - 前置条件检查
   - 工具编排步骤
   - 输出产物定义
   - 下一步建议
4. 生成符合规范的 Skill 文件

**示例**：
```
用户: /skill-creator
用户: 创建 /c4a:feat Skill，用于 Feature 管理

skill-creator 会引导：
- Skill 名称: /c4a:feat
- 职责: Feature 生命周期管理（创建/切换/状态流转）
- 触发条件: "开发功能"、"创建 ADR"、"新建 feat"
- 前置条件: 无（可在任何时候创建新 feat）
- 工具编排: c4a_store_feat_lifecycle → 用户确认 → ...
- 输出: Feature 目录、PRD/ADR 草稿
```

### 并行执行策略

```
执行顺序：Agent-0 → Agent-1~7 并行 → Agent-8
```

#### 第一步：Agent-0（前置准备，必须先完成）

| Agent | 任务 | 产物 |
|-------|------|------|
| Agent-0 | 10.1-10.7 基础设施 + 10.28 /c4a:model + 10.29 Checklist 格式 | Skill 文件规范、建模规则、Checklist 格式 |

**产物文件**：
- `prompts/skills/c4a-model/modeling-rules.md`（建模规则，供后续 Skill 引用）
- Skill 文件结构规范文档

#### 第二步：Agent-1~7 并行（核心 Skills）

| Agent | 任务 | 负责 Skill | 文件路径 |
|-------|------|-----------|---------|
| Agent-1 | 10.8-10.11 | /c4a:feat | `prompts/skills/c4a-feat/` |
| Agent-2 | 10.12 | /c4a:specify | `prompts/skills/c4a-specify/` |
| Agent-3 | 10.13-10.16 | /c4a:plan | `prompts/skills/c4a-plan/` |
| Agent-4 | 10.17-10.19 | /c4a:implement | `prompts/skills/c4a-implement/` |
| Agent-5 | 10.20-10.22 | /c4a:analyze | `prompts/skills/c4a-analyze/` |
| Agent-6 | 10.23-10.26 | /c4a:know:learn | `prompts/skills/c4a-know-learn/` |
| Agent-7 | 10.27 | /c4a:know:search | `prompts/skills/c4a-know-search/` |

**并行条件**：
- Agent-0 完成后才能启动
- 每个 Agent 只修改自己负责的目录，无文件冲突
- 都引用 Agent-0 产出的 `/c4a:model` 建模规则

#### 第三步：Agent-8（集成收尾，等待 Agent-1~7 全部完成）

| Agent | 任务 | 产物 |
|-------|------|------|
| Agent-8 | 10.30 Checklist MCP 集成 + 10.31-10.34 ADR 增强 + 10.35-10.38 集成文档 | 路由表、测试、文档 |

**产物文件**：
- `prompts/c4a.md`（Skills 路由逻辑）
- `CLAUDE.md`（Skills 使用指南）
- `prompts/__tests__/skill-format.test.ts`（测试）

#### 执行时间线

```
时间 ──────────────────────────────────────────────────────►

Agent-0 ████████
         ↓ 完成后
Agent-1  ████████████████
Agent-2  ████████
Agent-3  ████████████████████
Agent-4  ████████████
Agent-5  ████████████████
Agent-6  ████████████████████
Agent-7  ████████
                          ↓ 全部完成后
Agent-8                   ████████████████████
```

#### 注意事项

- Agent-1~7 **必须等待** Agent-0 完成（依赖建模规则和文件规范）
- Agent-8 **必须等待** Agent-1~7 全部完成（需要集成所有 Skills）
- 每个 Agent 使用 `/skill-creator` 创建 Skill 文件

### 简单 Skill（单文件）

```
prompts/skills/
└── c4a-specify/
    └── SKILL.md
```

### 复杂 Skill（目录结构）

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

## 输出
- 产物 1：xxx
- 产物 2：xxx

## 下一步建议
- /c4a:xxx - 说明

## 适用场景
- 场景 1
- 场景 2
```

---

## 执行规则

### 核心规则

1. **严格按步骤执行**：不跳过、不简化
2. **工具确定性**：每个步骤使用明确指定的工具
3. **用户确认**：关键操作（删除、状态流转）必须请求用户确认
4. **错误处理**：根据 `recoverable_actions` 决定处理方式
5. **进度报告**：长流程中及时向用户报告进度
6. **路由优先**：复杂 Skill 必须先执行路由判断
7. **上下文注入**：涉及 Feat 操作的 Skill 必须注入 `current_proposal_id`

### 路由消歧机制

当用户输入可能匹配多个 Skill 时，使用以下规则消歧：

| 规则 | 说明 | 示例 |
|------|------|------|
| **置信度阈值** | 匹配置信度 < 70% 时，主动询问用户确认 | "你是想创建新功能还是记录知识？" |
| **优先级排序** | 工作流 Skills > 知识 Skills > 通用操作 | `/c4a:feat` > `/c4a:know:learn` |
| **互斥检测** | 检测互斥 Skill 组合，提示用户选择 | `/c4a:specify` 与 `/c4a:plan` 不能同时触发 |
| **上下文感知** | 根据当前 Feat 状态推断最可能的 Skill | draft 状态下优先 `/c4a:specify` |

**消歧流程**：
```
用户输入 → 匹配候选 Skills → 计算置信度
    ↓
置信度 >= 70%? → 是 → 执行最高置信度 Skill
    ↓ 否
候选数 <= 3? → 是 → 列出选项让用户选择
    ↓ 否
按优先级取 Top 3 → 列出选项让用户选择
```

### 非线性交互支持

Skills 支持用户在流程中跳转或回退：

| 场景 | 处理方式 |
|------|---------|
| 用户中途切换话题 | 保存当前进度，提示可通过 `/c4a:feat --switch` 恢复 |
| 用户要求回退 | 检查 `workflow_steps`，回退到指定步骤 |
| 用户跳过步骤 | 警告可能的影响，记录跳过原因 |

### Feat 上下文注入（强制）

所有涉及 Feat 操作的 Skill 必须：
1. 在 System Prompt 中注入当前 Feat 上下文
2. 每轮对话注入 Context
3. MCP 工具调用校验 `proposal_id`
4. 检测上下文丢失
5. 话题切换提醒

---

## 三种场景流程

### 场景 1：需求开发

```
/c4a:feat → 创建 feat
    ↓
/c4a:specify → Functional Spec
    ↓
/c4a:plan → Technical Spec + Contract + Checklist
    ↓
/c4a:feat --status=approved → 批准
    ↓
/c4a:implement → 实现清单 + 代码
    ↓
/c4a:feat --status=published → 一致性检查 + 发布
    ↓
c4a sync → 同步到知识库
```

### 场景 2：架构变更

```
/c4a:feat → 创建 ADR feat
    ↓
/c4a:plan → 迁移方案 + ADR
    ↓
/c4a:feat --status=approved → 批准
    ↓
/c4a:implement → 执行迁移
    ↓
/c4a:feat --status=published → 发布
    ↓
c4a sync → 同步
```

### 场景 3：纯知识

```
/c4a:feat → 创建知识 feat
    ↓
/c4a:specify → 知识范围
    ↓
/c4a:plan → DSL 生成
    ↓
/c4a:feat --status=approved → 批准
    ↓
/c4a:feat --status=published → 发布（跳过 implement）
    ↓
c4a sync → 同步
```

---

## ADR 关联逻辑

### 架构变更定义

| 变更类型 | 说明 | 需要 ADR |
|---------|------|:-------:|
| 新增/修改/删除 System | 系统级变更 | ✅ |
| 新增/修改/删除 Container | 服务级变更 | ✅ |
| 新增/修改 DEPENDS_ON（System/Container 级） | 依赖关系变更 | ✅ |
| 技术栈变更 | Container 技术栈修改 | ✅ |
| Component 级变更 | 实现细节 | ❌ |
| SoR/Contract 变更 | 需求/接口设计 | ❌ |

### ADR 检测级别

| 级别 | 触发条件 | 行为 | 说明 |
|------|---------|------|------|
| **Error** | System/Container 新增/删除 | 阻塞，必须创建 ADR | 重大架构变更，必须记录决策 |
| **Warning** | Container 修改、DEPENDS_ON 变更 | 警告，建议创建 ADR | 可通过 `--force` 跳过 |
| **Info** | 技术栈小幅调整 | 提示，可选创建 ADR | 仅记录日志 |

### 检测时机

| 时机 | Skill | 阻塞性 | 说明 |
|------|-------|--------|------|
| 方案设计 | `/c4a:plan` | 提示但不阻塞 | Phase 2 基础检测 |
| 实现过程 | `/c4a:analyze` | 警告 | Phase 4 增强检测 |
| 发布前 | `/c4a:feat --status=published` | 警告，可 `--force` 跳过 | 最终检查 |

> **实现说明**：
> - Phase 2 实现基础 ADR 检测（System/Container 级别变更）
> - Phase 4 实现增强 ADR 检测（依赖范围分析、误报优化）

---

## Checklist 格式

### 存储位置

- **数据源**：数据库 `feats` 表的 `checklist` 字段（唯一权威源）
- **本地文件**：`.context/feat/{feat-id}/checklist.md`（只读视图）

### 任务类型

| type | 说明 |
|------|------|
| `dsl` | DSL 定义（System/Container/Component） |
| `code` | 代码实现 |
| `test` | 测试（单元/集成） |
| `doc` | 文档编写 |
| `contract` | 契约定义（OpenAPI/AsyncAPI/Proto） |

### 任务状态

| status | 说明 |
|--------|------|
| `pending` | 待开始 |
| `in_progress` | 进行中 |
| `completed` | 已完成 |
| `blocked` | 已阻塞 |

---

## 实现顺序

```
Phase 1: 基础设施（10.1-10.7）
├── 10.1 设计原则文档化
├── 10.2 触发方式定义
├── 10.3 Skill 文件结构规范
├── 10.4 路由表格式定义
├── 10.5 执行规则定义
├── 10.6 Feat 上下文注入规范
└── 10.7 错误处理规范

Phase 2: 核心 Skills（10.8-10.22）
├── 10.8-10.11 /c4a:feat Skill
│   └── 类型识别、上下文切换、状态流转
├── 10.12 /c4a:specify Skill
├── 10.13-10.16 /c4a:plan Skill
│   └── ADR 检测、契约补充、验收清单
├── 10.17-10.19 /c4a:implement Skill
│   └── 状态校验、清单生成
└── 10.20-10.22 /c4a:analyze Skill
    └── 检查项、悬空引用

Phase 3: 知识 Skills（10.23-10.27）
├── 10.23-10.26 /c4a:know:learn Skill
│   └── 输入识别、流程控制、错误恢复
└── 10.27 /c4a:know:search Skill

Phase 4: 支撑能力（10.28-10.34）
├── 10.28 /c4a:model 内部 Skill
├── 10.29-10.30 Checklist 格式与 MCP 集成
├── 10.31-10.33 ADR 模板与架构变更检测
└── 10.34 悬空引用可视化

Phase 5: 集成与文档（10.35-10.38）
├── 10.35 三种场景流程验证
├── 10.36 prompts/c4a.md 更新
├── 10.37 CLAUDE.md 更新
└── 10.38 单元测试
```

---

## 验收标准

### 功能验收

- [x] 7 个公开 Skills 可用（5 工作流 + 2 知识）
- [x] /c4a:model 建模规则正确内联
- [x] Skills 路由逻辑正确（自然语言 → Skill）
- [x] Feat 上下文正确注入
- [x] 错误恢复机制可用
- [x] Checklist 生成与更新正确
- [x] ADR 检测与关联正确
- [x] 悬空引用检测与可视化

### 文档验收

- [x] prompts/c4a.md 包含 Skills 路由
- [x] CLAUDE.md 包含 Skills 使用指南
- [x] 每个 Skill 文件格式符合规范

### 测试验收

- [x] 三种场景端到端流程通过
- [x] Skill 文件格式验证测试通过
- [x] 路由消歧测试通过（置信度计算、优先级排序）
- [x] 上下文注入测试通过（proposal_id 传递、丢失检测）
- [x] ADR 检测测试通过（Error/Warning/Info 级别）
- [x] 非线性交互测试通过（跳转、回退、恢复）

---

## 阻塞清单

| 任务 | 阻塞原因 | 状态 | 说明 |
|------|----------|:----:|------|
| 10.30 Checklist MCP 集成 | 依赖 Part 03 c4a_store_feat_checklist | ✅ 已解除 | Part 03 已完成 |
| 10.14 ADR 检测 | 依赖 Part 04 c4a_query_deps | ✅ 已解除 | Part 04 Local 模式已完成 |
| 10.22 悬空引用 | 依赖 Part 04 queryDeps | ✅ 已解除 | Part 04 Local 模式已完成 |

> **结论**：所有阻塞已解除，Part 10 可以完整执行。

---

## 最终验证（提交前必须执行）

**参考设计文档：**
- `v0.3.0/detailed-design/skills-design.md` (索引)
- `v0.3.0/detailed-design/skills/overview.md` (设计原则)
- `v0.3.0/detailed-design/skills/core-skills.md` (核心 Skills)
- `v0.3.0/detailed-design/skills/know-skills.md` (知识 Skills)
- `v0.3.0/detailed-design/skills/implementation.md` (实现规范)

**Review 流程：**
1. 验证每个 Skill 文件格式符合规范
2. 验证 Skills 路由逻辑覆盖所有场景
3. 验证三种场景端到端流程
4. 验证 Feat 上下文注入正确
5. 验证 ADR 检测与关联逻辑

---

## 执行摘要

| 类别 | 数量 | 说明 |
|------|:----:|------|
| 已完成 | 38 | 全部任务 |
| 阻塞 | 0 | 所有阻塞已解除（Part 03/04 已完成） |
| **总计** | **38** | ✅ 全部完成 |

**Agent 分配**：

| Agent | 任务 | 执行阶段 |
|-------|------|---------|
| Agent-0 | 10.1-10.7, 10.28, 10.29 | 第一步（串行） |
| Agent-1 | 10.8-10.11 /c4a:feat | 第二步（并行） |
| Agent-2 | 10.12 /c4a:specify | 第二步（并行） |
| Agent-3 | 10.13-10.16 /c4a:plan | 第二步（并行） |
| Agent-4 | 10.17-10.19 /c4a:implement | 第二步（并行） |
| Agent-5 | 10.20-10.22 /c4a:analyze | 第二步（并行） |
| Agent-6 | 10.23-10.26 /c4a:know:learn | 第二步（并行） |
| Agent-7 | 10.27 /c4a:know:search | 第二步（并行） |
| Agent-8 | 10.30-10.38 集成收尾 | 第三步（串行） |

**执行顺序**：
```
Agent-0 → Agent-1~7 并行 → Agent-8
```

**创建工具**：
- 使用 `/skill-creator` 技能创建 Skill 文件
- 确保格式规范和一致性
