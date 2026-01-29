# Part 10 Skills 体系 - Agent 提示词

> 执行顺序：Agent-0 → Agent-1~7 并行 → Agent-8

---

## Agent-0：前置准备（必须先完成）

```
请执行 Part 10 的前置准备任务：

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/overview.md（设计原则）
   - v0.3.0/detailed-design/skills/implementation.md（文件结构、路由表、执行规则）
   - v0.3.0/detailed-design/skills/checklist-format.md（Checklist 格式）

2. 创建 /c4a:model 建模规则文件：
   - 路径：prompts/skills/c4a-model/modeling-rules.md
   - 参考：v0.3.0/detailed-design/skills/architecture.md §/c4a:model

3. 任务编号：10.1-10.7, 10.28, 10.29

4. 产物：
   - prompts/skills/c4a-model/modeling-rules.md
   - 确认 Skill 文件结构规范已理解

完成后告诉我，我会启动 Agent-1~7 并行执行。
```

---

## Agent-1：/c4a:feat Skill

```
请使用 /skill-creator 创建 /c4a:feat Skill。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/core-skills.md §/c4a:feat（L3-154）

2. 参考建模规则：
   - prompts/skills/c4a-model/modeling-rules.md

3. 创建文件：
   - prompts/skills/c4a-feat/SKILL.md（主文件）
   - prompts/skills/c4a-feat/create.md（创建 Feature）
   - prompts/skills/c4a-feat/switch.md（切换上下文）
   - prompts/skills/c4a-feat/transition.md（状态流转）

4. 任务编号：10.8-10.11

5. 职责：Feature 生命周期管理（创建/切换/状态流转）
   - 触发条件："开发功能"、"创建 ADR"、"新建 feat"
   - 工具编排：c4a_store_feat_lifecycle
```

---

## Agent-2：/c4a:specify Skill

```
请使用 /skill-creator 创建 /c4a:specify Skill。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/core-skills.md §/c4a:specify（L156-219）

2. 参考建模规则：
   - prompts/skills/c4a-model/modeling-rules.md

3. 创建文件：
   - prompts/skills/c4a-specify/SKILL.md

4. 任务编号：10.12

5. 职责：Functional Spec 生成
   - 触发条件："定义功能规格"、"写需求"
   - 工具编排：c4a_store_save（保存 SoR）
```

---

## Agent-3：/c4a:plan Skill

```
请使用 /skill-creator 创建 /c4a:plan Skill。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/core-skills.md §/c4a:plan（L221-402）
   - v0.3.0/detailed-design/skills/modeling-adr.md（ADR 检测）

2. 参考建模规则：
   - prompts/skills/c4a-model/modeling-rules.md

3. 创建文件：
   - prompts/skills/c4a-plan/SKILL.md

4. 任务编号：10.13-10.16

5. 职责：Technical Spec + Contract + Checklist 生成
   - 触发条件："设计技术方案"、"写技术设计"
   - 工具编排：c4a_extract_analyze → c4a_store_save → c4a_store_feat_checklist
   - 包含基础 ADR 检测（System/Container 级别变更）
```

---

## Agent-4：/c4a:implement Skill

```
请使用 /skill-creator 创建 /c4a:implement Skill。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/core-skills.md §/c4a:implement（L404-533）

2. 参考建模规则：
   - prompts/skills/c4a-model/modeling-rules.md

3. 创建文件：
   - prompts/skills/c4a-implement/SKILL.md

4. 任务编号：10.17-10.19

5. 职责：实现代码辅助
   - 触发条件："开始实现"、"写代码"
   - 前置条件：Feat 状态必须是 approved
   - 工具编排：c4a_store_feat_checklist（更新进度）
```

---

## Agent-5：/c4a:analyze Skill

```
请使用 /skill-creator 创建 /c4a:analyze Skill。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/core-skills.md §/c4a:analyze（L535-687）
   - v0.3.0/detailed-design/skills/visualization.md（悬空引用）

2. 参考建模规则：
   - prompts/skills/c4a-model/modeling-rules.md

3. 创建文件：
   - prompts/skills/c4a-analyze/SKILL.md

4. 任务编号：10.20-10.22

5. 职责：一致性检查 + 影响分析
   - 触发条件："检查一致性"、"分析影响"
   - 工具编排：c4a_query_deps → c4a_query_impact
   - 检查项：Spec 完整性、契约完备、DSL 引用、ADR 完备度
```

---

## Agent-6：/c4a:know:learn Skill

```
请使用 /skill-creator 创建 /c4a:know:learn Skill。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/know-skills.md §/c4a:know:learn（L3-136）

2. 参考建模规则：
   - prompts/skills/c4a-model/modeling-rules.md

3. 创建文件：
   - prompts/skills/c4a-know-learn/SKILL.md

4. 任务编号：10.23-10.26

5. 职责：快速录入知识
   - 触发条件："记录知识"、"整理规范"
   - 输入识别：描述/文件/URL/目录
   - 工具编排：c4a_store_save
   - 支持 workflow_steps 断点续传
```

---

## Agent-7：/c4a:know:search Skill

```
请使用 /skill-creator 创建 /c4a:know:search Skill。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/know-skills.md §/c4a:know:search（L170-232）

2. 参考建模规则：
   - prompts/skills/c4a-model/modeling-rules.md

3. 创建文件：
   - prompts/skills/c4a-know-search/SKILL.md

4. 任务编号：10.27

5. 职责：语义搜索知识库
   - 触发条件："搜索 xxx"、"查找 xxx"
   - 工具编排：c4a_query_search
```

---

## Agent-8：集成收尾（等待 Agent-1~7 全部完成）

```
请执行 Part 10 的集成收尾任务。

1. 阅读设计文档：
   - v0.3.0/detailed-design/skills/implementation.md §更新 c4a.md（L396-417）
   - v0.3.0/detailed-design/skills/implementation.md §更新 CLAUDE.md（L374-394）
   - v0.3.0/detailed-design/skills/modeling-adr.md（ADR 增强检测）
   - v0.3.0/detailed-design/skills/scenarios.md（三种场景流程）

2. 任务编号：10.30-10.38

3. 产物：
   - 更新 prompts/c4a.md（添加 Skills 路由逻辑）
   - 更新 CLAUDE.md（添加 Skills 使用指南）
   - 创建 prompts/__tests__/skill-format.test.ts（Skill 文件格式验证）

4. 验证：
   - 三种场景流程（需求开发/架构变更/纯知识）端到端验证
   - 路由消歧测试
   - ADR 检测测试（Error/Warning/Info 级别）
```

---

## 执行检查清单

| 步骤 | Agent | 状态 | 完成时间 |
|------|-------|:----:|---------|
| 1 | Agent-0 | [ ] | |
| 2 | Agent-1 | [ ] | |
| 2 | Agent-2 | [ ] | |
| 2 | Agent-3 | [ ] | |
| 2 | Agent-4 | [ ] | |
| 2 | Agent-5 | [ ] | |
| 2 | Agent-6 | [ ] | |
| 2 | Agent-7 | [ ] | |
| 3 | Agent-8 | [ ] | |
