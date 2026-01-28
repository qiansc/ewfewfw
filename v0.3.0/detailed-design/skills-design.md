# C4A Skills 设计方案

> 本文档讨论如何通过 Skills 封装用户故事，让用户和 Agent 能够自然、稳定地完成架构知识管理任务。

## 文档结构

详细设计文档已按功能模块拆分到 `skills/` 目录：

| 文件 | 内容 |
|------|------|
| [skills/overview.md](skills/overview.md) | 设计概述、问题陈述、设计原则、触发方式 |
| [skills/architecture.md](skills/architecture.md) | Skills 体系设计、内部 Skill、工作流程 |
| [skills/know-skills.md](skills/know-skills.md) | 知识技能详细设计 (`/c4a:know:learn`, `/c4a:know:search`) |
| [skills/core-skills.md](skills/core-skills.md) | 核心 Skills 详细设计 (`/c4a:feat`, `/c4a:specify`, `/c4a:plan`, `/c4a:analyze`, `/c4a:implement`) |
| [skills/checklist-format.md](skills/checklist-format.md) | 实现清单格式 (checklist.md) |
| [skills/scenarios.md](skills/scenarios.md) | 三种场景的完整流程 |
| [skills/implementation.md](skills/implementation.md) | Skills 实现规范、路由、集成 |
| [skills/summary.md](skills/summary.md) | 总结、prompts 目录规划 |
| [skills/modeling-adr.md](skills/modeling-adr.md) | 建模阶段、ADR 与架构变更关联逻辑 |
| [skills/visualization.md](skills/visualization.md) | 悬空引用可视化、Diff 视图 |
| [skills/future-skills.md](skills/future-skills.md) | 未实现的 Skills（计划中） |

## Skills 速查表

### 工作流 Skills（5个）

| Skill | 用途 | 详细文档 |
|-------|------|---------|
| `/c4a:feat` | Feature 管理（创建/修改/切换/流转） | [core-skills.md](skills/core-skills.md) |
| `/c4a:specify` | 功能规格（Functional Spec） | [core-skills.md](skills/core-skills.md) |
| `/c4a:plan` | 技术方案（Technical Spec + 契约 + 验收清单） | [core-skills.md](skills/core-skills.md) |
| `/c4a:analyze` | 一致性检查 | [core-skills.md](skills/core-skills.md) |
| `/c4a:implement` | 实现代码辅助 | [core-skills.md](skills/core-skills.md) |

### 知识技能 Skills（2个）

| Skill | 用途 | 详细文档 |
|-------|------|---------|
| `/c4a:know:learn` | 快速录入知识 | [know-skills.md](skills/know-skills.md) |
| `/c4a:know:search` | 搜索知识库 | [know-skills.md](skills/know-skills.md) |

### 内部 Skill（1个）

| Skill | 用途 | 详细文档 |
|-------|------|---------|
| `/c4a:model` | 建模能力（将自然语言转换为 DSL 实体） | [architecture.md](skills/architecture.md) |
