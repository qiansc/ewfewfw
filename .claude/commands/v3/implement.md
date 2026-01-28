---
description: v0.3.0 实现任务执行（按需加载、批量验证）
argument-hint: [part-number] [task-number]
---

**使用工具**: `Read`, `Edit`, `Write`, `Bash`, `TodoWrite`

**参数**: $ARGUMENTS

# v0.3.0 实现指南

> **核心原则**: 按需加载、单任务执行、批量验证

---

## Phase 0: 参数解析

根据 `$ARGUMENTS` 确定起始位置：

| $ARGUMENTS | 行为 |
|------------|------|
| 空 | 读取 summary.md 确定当前进度 |
| `6` | 从 Part 06 的第一个未完成任务开始 |
| `6 3` | 从 Part 06 任务 6.3 开始 |
| `status` | 显示当前进度摘要 |
| `help` | 显示帮助信息 |

---

## Phase 1: 会话初始化

**CRITICAL: 必须完成以下步骤才能开始任务**

**Actions**:
1. 使用 `Read` 读取 `v0.3.0-plan-opus/summary.md`
2. 确定当前 Part 和起始任务编号
3. 使用 `Read` 读取对应的详细计划文件（如 `v0.3.0-plan-opus/06-local-mode.md`）
4. 使用 `TodoWrite` 创建 **仅包含下一个任务** 的 todo

**输出格式**:
```
📍 当前位置: Part 06 - Local 模式实现
📋 下一个任务: 6.1 模式对比
📄 设计文档: v0.3.0/detailed-design/local-mode/sqlite-schema.md L1-26

准备开始任务 6.1，是否继续？
```

**DO NOT proceed to Phase 2 until user confirms.**

---

## Phase 2: 单任务执行（循环）

**CRITICAL: 每次只执行一个任务，只加载需要的文档章节**

### Step 2.1: 加载设计文档（按需）

使用 `Read` 工具读取设计文档的 **指定行号范围**：

```
❌ 禁止: Read 整个文件
✅ 正确: Read file_path + offset + limit 只读取任务引用的章节
```

**示例**:
- 任务 6.1 → 读取 `sqlite-schema.md` L1-26（约 26 行）
- 任务 6.3 → 读取 `sqlite-schema.md` L76-100（约 25 行）

### Step 2.2: 标记已读

使用 `Edit` 工具在计划文件中勾选 "已读":
```
| 6.1 | 概述 + 模式对比 | §1.1 概述 | L1-26 | [x] | [ ] |
```

### Step 2.3: 实现任务

按设计文档实现功能：
- 写代码到指定文件
- 遇到设计问题 → 记录到 `v0.3.0-plan-opus/change/` 目录

### Step 2.4: 标记已实现

使用 `Edit` 工具在计划文件中勾选 "已实现":
```
| 6.1 | 概述 + 模式对比 | §1.1 概述 | L1-26 | [x] | [x] |
```

### Step 2.5: 更新 Todo

使用 `TodoWrite` 标记当前任务完成，添加下一个任务。

### Step 2.6: 判断验证断点

**断点触发条件（满足任一即触发）**:

| 条件 | 说明 |
|------|------|
| 已完成任务数 ≥ 10 | 强制断点 |
| 已完成任务数 ≥ 3 且到达逻辑边界 | 如：完成一组表定义 |
| 已完成任务数 ≥ 3 且下一任务关联性低 | 当前任务组独立 |

**判断结果**:
- 未到断点 → 回到 Step 2.1，执行下一个任务
- 到达断点 → 进入 Phase 3

---

## Phase 3: 批量验证

**DO NOT skip this phase when checkpoint is reached**

### Step 3.1: 自动化验证

使用 `Bash` 执行:
```bash
pnpm typecheck && pnpm test && pnpm build
```

### Step 3.2: 生成验收清单

使用 `Write` 工具生成验收清单到 `v0.3.0-plan-opus/checklist/` 目录：

```markdown
# Part 06 验收清单: 任务 6.1-6.5

**任务范围:** 6.1 - 6.5
**设计文档:** sqlite-schema.md
**验收时间:** 2026-01-27 10:00

## 设计文档对照

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| entities 表 | L76-100 | sqlite-store.ts | [x] |
| metadata 表 | L101-125 | sqlite-store.ts | [x] |

## 自动化验证

| 验证项 | 结果 |
|--------|:----:|
| pnpm typecheck | ✅ |
| pnpm test | ✅ |
| pnpm build | ✅ |

## 结论: ✅ 通过
```

### Step 3.3: 验证结果处理

- **验证失败** → 修复问题，重新执行 Phase 3
- **验证通过** → 回到 Phase 2 继续下一批任务

---

## Phase 4: 会话结束

**Actions**:
1. 确保所有已完成任务的状态都已更新
2. 使用 `Edit` 更新 `v0.3.0-plan-opus/summary.md`
3. 输出会话总结

**输出格式**:
```
📊 本次会话完成情况

✅ 完成任务: 6.1 - 6.10 (10 个)
📄 验收清单: checklist/06-01-10-sqlite-schema.md
🔜 下一步: 继续任务 6.11 (Embedding 生成)

验收状态: ✅ 全部通过
```

---

## 关键文件索引

| 文件 | 用途 |
|------|------|
| `v0.3.0-plan-opus/summary.md` | 整体进度 |
| `v0.3.0-plan-opus/06-local-mode.md` | Part 06 详细计划 |
| `v0.3.0/detailed-design/local-mode/*.md` | 设计文档 |
| `v0.3.0-plan-opus/checklist/` | 验收清单 |
| `v0.3.0-plan-opus/change/` | 设计变更记录 |

---

## 禁止行为

```
❌ 一次性读取整个设计文档
❌ 一次性规划所有任务到 TodoWrite
❌ 跳过验证断点继续执行
❌ 不更新计划文件的勾选状态
❌ 直接修改 v0.3.0/ 目录下的设计文档
```

## 正确行为

```
✅ 只读取当前任务需要的文档章节（使用 offset + limit）
✅ TodoWrite 只包含当前正在执行的 1 个任务
✅ 每完成一个任务立即更新计划文件
✅ 3-10 个任务后暂停进行批量验证
✅ 设计问题记录到 change/ 目录
```
