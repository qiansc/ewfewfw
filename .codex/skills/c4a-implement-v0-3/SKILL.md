---
name: c4a-implement-v0-3
description: "在 c4a 仓库执行 v0.3.0 计划实现任务的专用流程：按 .claude/commands/v3/implement.md 进行会话初始化、单任务循环、批量验证与会话结束；按需读取设计文档、更新计划勾选与 TodoWrite（如有）、记录变更。用于实施 v0.3.0-plan-opus 任务时触发。"
---

# C4A v0.3.0 实现流程

## 概览

遵循 v0.3.0 实现指南执行任务：按需加载、单任务执行、批量验证，并同步更新计划与汇总。

## 工作流（按阶段执行）

### Phase 0: 参数解析

- `$ARGUMENTS` 为空：读取 `v0.3.0-plan-opus/summary.md` 确定进度
- `status` / `help`：输出对应摘要或帮助
- `6` 或 `6 3`：按 Part/任务号定位起始任务

### Phase 1: 会话初始化（必须完成）

- 读取 `v0.3.0-plan-opus/summary.md` 与对应 Part 详细计划
- 使用 `TodoWrite` 仅创建 **下一个任务** 的 todo，如无 TodoWrite 则用文本来表达
- 输出当前位置与任务信息，并在进入 Phase 2 前等待用户确认

### Phase 2: 单任务执行（循环）

- **按需读取设计文档**：仅用 `Read` 的 offset + limit 读取任务引用的行号范围，禁止整文件读取
- 在计划表中勾选“已读”与“已实现”
- 按设计实现：写代码、按需修改；发现设计问题 → 记录到 `v0.3.0-plan-opus/change/`
- `TodoWrite` 完成当前任务并添加下一个任务，如无 TodoWrite 则用文本来表达
- 判断验证断点：满足条件则进入 Phase 3，否则继续下一任务

### Phase 3: 批量验证

- 运行自动化验证（遵循仓库约定，使用 `bun run <script>`）
- 生成验收清单到 `v0.3.0-plan-opus/checklist/`
- 验证失败则修复并重复本阶段；通过后回到 Phase 2

### Phase 4: 会话结束

- 更新 `v0.3.0-plan-opus/summary.md`
- 输出会话总结（完成任务范围、验收清单、下一步）

## 关键规则

- **单任务原则**：一次只执行一个任务
- **按需加载**：只读指定行号范围
- **计划同步**：每个任务都更新“已读/已实现”勾选
- **验证断点**：到达断点必须批量验证
- **禁止修改设计文档**：`v0.3.0/` 下文件只读
- **命令约定优先**：若文档示例与仓库约定冲突，以仓库约定为准（使用 `bun run`）

## 参考路径

- 实现指南：`.claude/commands/v3/implement.md`
- 进度汇总：`v0.3.0-plan-opus/summary.md`
- 详细计划：`v0.3.0-plan-opus/*.md`
- 设计文档：`v0.3.0/detailed-design/**`
