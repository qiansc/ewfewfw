## 核心 Skills 详细设计

> **重要约定**：本文档中所有 MCP 工具调用示例均省略了 `proposal_id` 参数以保持简洁。
> 实际执行时，**必须**传递当前 Feature 的 `proposal_id`（如 `feat-a001-user-login`）。
> 详见 [implementation.md#feat-上下文注入规范](./implementation.md#feat-上下文注入规范强制)。

### `/c4a:feat` - Feature 管理

**职责**：
1. 创建/修改 Feature（自动判断类型）
2. 切换工作上下文
3. 生命周期流转（含一致性检查）

#### 1. 创建/修改 Feature

**触发条件**：
- 用户说"我想开发一个功能"
- 用户说"我想整理业务知识"
- 用户说"我想升级数据库"

**自动识别类型**：

| 关键词 | 类型 | 流程 |
|--------|------|------|
| "实现"、"开发"、"功能" | 需求开发 | `feat` → `specify` → `plan` → `implement` → `feat --status=published` → `sync` |
| "迁移"、"升级"、"重构" | 架构变更 (ADR) | `feat` (ADR) → `plan` → `implement` → `feat --status=published` → `sync` |
| "整理"、"记录"、"规范" | 纯知识 | `feat` → `specify` → `plan` → `feat --status=published` → `sync` |

**工具编排**：
```
1. 分析用户描述，识别类型
2. 生成 Feature ID（如 feat-a001-user-login）
3. 创建目录结构：.context/feat/feat-xxx/
4. 根据类型生成初步内容：
   - 需求开发：PRD 草稿
   - 架构变更：ADR 草稿 + 影响分析
   - 纯知识：知识文档草稿
5. c4a_query_search 查询相关现有知识
6. 询问用户确认并建议下一步
```

**输出**：
- Feature 创建确认
- Feature ID
- 初步文档草稿
- 下一步建议

**示例**：
```
用户: "我想开发一个用户登录功能"

Agent:
✅ 已创建 Feature: feat-a001-user-login
📝 类型：需求开发
📂 目录：.context/feat/feat-a001-user-login/

下一步建议：
/c4a:specify - 定义功能规格
```

---

#### 2. 切换上下文

**触发条件**：
- 用户说"切换到 feat-xxx"
- 用户说"我要继续做 feat-xxx"

**命令格式**：
```
/c4a:feat --switch feat-a001-xxx
```

**工具编排**：
```
1. 验证 Feature 是否存在
2. 设置当前工作上下文
3. 展示 Feature 状态和进度
4. 建议下一步操作
```

**输出**：
- 切换确认
- Feature 状态概览
- 下一步建议

---

#### 3. 生命周期流转（含一致性检查）

**触发条件**：
- 用户说"批准这个方案" → `--status=approved`
- 用户说"发布" → `--status=published`

**命令格式**：
```
/c4a:feat --status=approved   # draft → approved（批准方案）
/c4a:feat --status=published  # approved → published（发布，需先 approved）
```

**状态流转规则**：
- `--status=approved`：仅接受 `draft` 状态
- `--status=published`：仅接受 `approved` 状态，如当前是 `draft` 则报错并提示先批准

**工具编排（`--status=published`）**：

> 前置条件：feat 状态必须为 `approved`。如果是 `draft`，报错并提示先执行 `--status=approved`。

```
1. 状态检查：
   - 检查当前 feat 状态
   - 如果是 draft，报错："请先执行 /c4a:feat --status=approved 批准方案"
   - 如果是 approved，继续执行

2. 一致性检查（内部调用 /c4a:analyze）：
   a. Functional Spec 完整性检查
   b. Technical Spec 完整性检查
   c. 契约完备度检查
   d. DSL 验证（语法、引用、字段规范）
   e. Checklist 覆盖度检查（如有）

3. **发布前同步**（防止本地未同步的修改丢失）：
   - 计算本地 feat 内容的 content_hash
   - 通过 Bash 执行 `c4a sync` 确保本地修改已上传
   - 检查 sync 命令的返回状态，如果同步失败，提示用户手动处理

4. 如有问题：
   - 列出所有问题（错误 ❌ 和警告 ⚠️）
   - 询问用户操作：
     1. 修复问题后再发布
     2. 忽略警告，继续发布
     3. 取消发布

5. 流转状态（内部自动触发 merge）：
   - c4a_store_feat_lifecycle(action="transition", to_status="published", expected_content_hash=<本地哈希>)
     * 工具内部先校验 content_hash，不一致则拒绝发布
     * 校验通过后自动调用 c4a_store_feat_merge(strategy="auto")
     * 如有冲突，返回冲突信息，询问用户处理方式
     * merge 成功后，自动流转状态并清理远程 checklist

   > **原子性保证**：`c4a_store_feat_lifecycle` 内部使用数据库事务（MongoDB 4.0+ 多文档事务）确保"状态流转 + 合并 + 清理"的原子性。如果任一步骤失败，整个操作回滚。
   >
   > **异常恢复**：如果因网络中断等原因导致事务状态不确定，可使用 `c4a feat repair <feat-id>` 命令检测并修复不一致状态。

6. 如有合并冲突：
   - 展示冲突详情（实体 ID、冲突类型、两个版本的差异）
   - 询问用户操作：
     1. 保留 feat 版本（keep_feat）
     2. 保留主分支版本（keep_main）
     3. 取消发布，手动解决
   - 调用 c4a_store_feat_merge(conflict_resolution=[...]) 解决冲突
   - 再次调用 c4a_store_feat_lifecycle 完成发布

7. 提示同步：
   - 建议执行 c4a sync（CLI 命令）
```

**输出**：
- 一致性检查报告
- 合并结果（成功合并的实体列表）
- 状态流转确认
- 同步建议

**示例（无冲突）**：
```
用户: "/c4a:feat --status=published"

Agent:
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
✅ 契约完备
✅ DSL 引用正确

📤 正在发布...
✅ 合并成功：auth-service, jwt-component
✅ 状态流转：approved → published

💡 建议执行 c4a sync 同步到知识库
```

**示例（有冲突）**：
```
用户: "/c4a:feat --status=published"

Agent:
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
✅ 契约完备
✅ DSL 引用正确

📤 正在发布...
⚠️ 检测到合并冲突：

1. auth-service
   - 冲突类型：内容冲突
   - 主分支版本：version=1.0.0, database=mysql
   - feat 版本：version=2.0.0, database=postgresql
   - 建议：保留 feat 版本（包含最新变更）

? 如何处理冲突？
  > 保留 feat 版本（推荐）
    保留主分支版本
    取消发布，手动解决

用户: 保留 feat 版本

Agent:
✅ 冲突已解决
✅ 合并成功：auth-service, jwt-component
✅ 状态流转：approved → published

💡 建议执行 c4a sync 同步到知识库
```

---

### `/c4a:specify` - 功能规格

**职责**：生成/调整 Functional Spec（功能规格）

**触发条件**：
- 从 `feat` 流转过来
- 用户说"定义功能规格"

**工具编排**：
```
1. c4a_store_read 读取 Feature 信息
2. 与用户对话澄清功能需求：
   - 功能范围和边界
   - 用户场景和流程
   - 验收标准
   - 业务规则
3. c4a_query_search 查询相关业务知识
4. Agent 基于模板 生成 Functional Spec：
   - Product 定义
   - Business Process 描述
   - Business SoR（业务规则）
5. c4a_store_save 保存到 feat 目录
6. 生成功能规格文档（Markdown）
```

**输出**：
- Functional Spec
- 功能规格文档（Markdown）
- 下一步建议：`/c4a:plan` 设计技术方案

**适用场景**：
- 需求开发：定义功能需求
- 纯知识：定义知识范围和结构

---

### `/c4a:plan` - 技术方案

**职责**：生成 Technical Spec + 契约 + 验收清单

**触发条件**：
- 从 `specify` 流转过来
- 用户说"设计技术方案"

**工具编排**：
```
1. c4a_store_read 读取 Functional Spec
2. 技术调研：
   - c4a_query_search 查询现有架构
   - c4a_extract_analyze 分析相关代码（如有）
     > **降级处理**：如果代码库为空（Greenfield 项目）或 c4a_extract_analyze 返回空，
     > 平滑过渡到"纯设计模式"，跳过代码分析步骤，直接进入技术方案设计。
3. 架构变更检测（智能检查）：
   - 检测是否有以下架构变更：
     * 新增/修改/删除 System
     * 新增/修改/删除 Container
     * 新增/修改 DEPENDS_ON 关系（System 或 Container 级别）
     * 修改 Container 的技术栈（如数据库迁移、框架升级）
   - 如检测到架构变更：
     * c4a_query_impact 分析影响面
     * 检查当前 feat 是否已有 ADR
     * 如无 ADR，强制提示用户："检测到架构变更，建议补充 ADR 说明原因"
     * 提供 ADR 模板，引导用户填写
4. 技术方案设计：
   - 与用户讨论技术选型
   - Agent 基于模板 生成 Container/Component DSL
   - 关联 code_path（如有）
5. 契约补充：
   - 检查契约完整性
   - 询问用户补充缺失的契约
   - 契约生成方式：
     * 有代码：c4a_extract_contract 从代码提取契约
     * 无代码（Greenfield）：Agent 基于用户描述生成契约模板，引导用户补充细节
   - 契约类型选择（Agent 根据技术方案自动推断，用户可覆盖）：
     * HTTP API → OpenAPI
     * 异步消息 → AsyncAPI
     * RPC 接口 → Proto
6. 生成验收清单：
   - 功能验收点（来自 Functional Spec）
   - 技术验收点（来自 Technical Spec）
   - 契约验收点（来自 Contract）
7. c4a_store_save 保存所有产物
```

**输出**：
- Technical Spec DSL（Container + Component）
- 契约文件（OpenAPI/AsyncAPI/Proto）
- 验收清单（Markdown）
- 技术方案文档（Markdown）
- 如有架构变更，提示创建 ADR（强制提示，可选择稍后补充）

**下一步建议**：
- 需求开发/架构变更：`/c4a:feat --status=approved` 批准方案，然后 `/c4a:implement` 实现代码
- 纯知识：`/c4a:feat --status=approved` 批准方案，然后 `/c4a:feat --status=published` 发布

**适用场景**：
- 需求开发：设计技术方案
- 架构变更：制定变更方案
- 纯知识：生成技术规格和 DSL

---

---

### `/c4a:analyze` - 一致性检查

**职责**：在 plan 后到 publish 前的实现过程中，随时检查 Spec、契约、实现清单和实际实现的一致性。

**触发条件**：
- 用户主动调用（`/c4a:analyze`）
- `/c4a:feat --status=published` 发布前自动调用

**使用时机**：
- `/c4a:plan` 完成后，开始实现前
- `/c4a:implement` 实现过程中，随时检查
- `/c4a:feat --status=published` 发布前（强制）

**工具编排**：
```
1. 调用 c4a_store_validate 执行服务端检查：
   c4a_store_validate({
     proposal_id: current_feat_id,
     checks: [
       "functional_spec",
       "technical_spec",
       "contracts",
       "references",
       "adr_completeness",
       "checklist"
     ],
     options: { include_suggestions: true }
   })

2. 展示检查报告：
   - 根据返回的 summary.status 显示整体状态
   - 按 checks 各项展示详细结果
   - 展示 suggestions 修复建议

3. 如有错误或警告，询问用户处理方式
```

> **设计说明**：所有检查逻辑在服务端 `c4a_store_validate` 中执行，避免 Agent 拉取大量实体到 Context 中自行分析。详见 [mcp-tools.md#c4a_store_validate](./mcp-tools.md#317-c4a_store_validate架构一致性检查)。

**输出**：
```typescript
interface AnalyzeResult {
  passed: boolean;  // 是否通过（无错误）
  summary: {
    errors: number;
    warnings: number;
    tips: number;
  };
  checks: {
    functional_spec: CheckResult;
    technical_spec: CheckResult;
    contracts: CheckResult;
    references: CheckResult;
    adr_completeness: CheckResult;
    checklist: ChecklistProgress;  // 注意：类型不同于其他检查项
  };
  suggestions: string[];  // 修复建议
}

interface CheckResult {
  status: 'pass' | 'warning' | 'error';
  issues: CheckIssue[];
}

interface CheckIssue {
  level: 'error' | 'warning' | 'tip';
  message: string;
  entity_id?: string;
  suggestion?: string;
}

interface ChecklistProgress {
  total: number;
  completed: number;
  in_progress: number;
  blocked: number;
  pending: number;
  completion_rate: number;  // 完成率 0-100
}
```

**用户交互**：

**场景 1：全部通过**
```
用户: "/c4a:analyze"

Agent:
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
✅ 契约完备
✅ DSL 引用正确
✅ ADR 完备度检查通过
📊 实现进度：8/10 (80%)

✅ 检查通过，可以继续实现或发布
```

**场景 2：有警告（缺少 ADR）**
```
用户: "/c4a:analyze"

Agent:
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
⚠️ 契约完备度：缺少 1 个 OpenAPI 契约
   - Component 'order-processor' 缺少 /api/orders 接口契约
   建议：创建 OpenAPI 契约描述该接口
✅ DSL 引用正确
⚠️ ADR 完备度：检测到架构变更，但未找到关联的 ADR
   - 新增 Container: payment-service
   - 新增 DEPENDS_ON 关系: order-service → payment-service
   建议：创建 ADR 记录架构变更的背景和决策原因
📊 实现进度：5/10 (50%)

⚠️ 检查通过，但有 2 个警告

? 如何处理？
  > 忽略警告，继续
    修复警告后继续
    查看详细信息
```

**场景 3：有错误**
```
用户: "/c4a:analyze"

Agent:
🔍 一致性检查中...

✅ Functional Spec 完整
❌ Technical Spec 完整性：发现 2 个错误
   1. Container 'auth-service' 未关联 System
      建议：设置 data.system_id = 'e-commerce-system'
   2. Component 'jwt-validator' 的 container_id 不存在
      建议：检查 container_id 拼写或创建该 Container
⚠️ 契约完备度：缺少 1 个契约
⚠️ ADR 完备度：检测到架构变更，但未找到关联的 ADR
   - 修改 Container 技术栈: database-service (MySQL → PostgreSQL)
   建议：创建 ADR 记录数据库迁移的背景、选项和决策
✅ DSL 引用正确
📊 实现进度：3/10 (30%)

❌ 检查失败，发现 2 个错误

? 如何处理？
  > 修复错误后继续
    查看详细信息
    取消操作
```

**适用场景**：
- 方案设计完成后，开始实现前（确保方案完整）
- 实现过程中（随时检查进度和一致性）
- 发布前（**强制检查**，确保质量）

**与其他 Skill 的关系**：
- `/c4a:plan` 完成后，建议调用 `/c4a:analyze` 检查方案完整性
- `/c4a:implement` 不再内置一致性检查，用户可随时调用 `/c4a:analyze`
- `/c4a:feat --status=published` 发布前**强制**调用 `/c4a:analyze`，特殊场景可通过 `--force` 跳过

---

### `/c4a:implement` - 实现代码

**职责**：生成实现清单、辅助代码实现、更新实现进度

**触发条件**：
- 从 `plan` 流转过来
- 用户说"开始实现"

**前置条件**：
- Feature 状态必须为 `approved`
- 如果是 `draft`，提示用户先执行 `/c4a:feat --status=approved` 批准方案

**工具编排**：
```
1. 状态检查（必须）：
   - 检查当前 Feature 状态
   - 如果是 draft：
     * 提示："方案尚未批准，请先执行 /c4a:feat --status=approved 批准方案"
     * 终止流程
   - 如果是 approved，继续执行

2. 生成/读取实现清单：
   - 调用 c4a_store_feat_checklist 检查数据库中是否已存在 checklist
   - 如不存在，生成实现清单：
     * c4a_store_read 读取 Technical Spec
     * 分析 Container/Component 和 Contract
     * 生成实现步骤清单
     * 调用 c4a_store_feat_checklist 保存到数据库
   - 如已存在，读取并展示当前进度

3. 实现辅助：
   - 生成实现指南（Markdown）
   - 在实现过程中：
     * 用户遇到问题时，c4a_query_search 查询相关知识
     * 回答实现细节问题
   - 实现完成后：
     * 询问是否有与设计不符的地方
     * 如有，更新 DSL
     * c4a_store_save 保存更新
     * 调用 c4a_store_feat_checklist 更新任务状态

4. 进度跟踪：
   - 用户可随时调用 `/c4a:implement --status` 查看进度
   - 用户完成任务后，调用 `/c4a:implement --complete <task-id>` 标记完成
   - 用户遇到阻塞，调用 `/c4a:implement --block <task-id> <reason>` 标记阻塞
```

**输出**：
- 实现清单（数据库存储，可渲染为 checklist.md）
- 实现指南（Markdown）
- 实时问答支持
- 更新后的 DSL（如有变更）
- 下一步建议：`/c4a:analyze` 检查一致性，或 `/c4a:feat --status=published` 发布

**适用场景**：
- 需求开发：实现代码
- 架构变更：执行变更

**示例（首次调用）**：
```
用户: "/c4a:implement"

Agent:
📋 当前 Feature: feat-a001-user-login
📄 状态：approved ✅

📝 生成实现清单...
已保存到数据库（可执行 c4a feat render 渲染到本地）

实现步骤（共 10 项）：
1. [pending] 创建 auth-service Container
2. [pending] 实现 JWT 认证组件
3. [pending] 创建登录接口 /api/auth/login
4. [pending] 创建 OpenAPI 契约
5. [pending] 编写单元测试
...

💡 建议：
- 使用 /c4a:implement --complete <task-id> 标记任务完成
- 使用 /c4a:analyze 随时检查一致性
- 完成后使用 /c4a:feat --status=published 发布
```

**示例（查看进度）**：
```
用户: "/c4a:implement --status"

Agent:
📊 实现进度：feat-a001-user-login

总进度：5/10 (50%)
- ✅ 已完成：5
- 🔄 进行中：2
- 🚫 已阻塞：1
- ⏳ 待开始：2

详细状态：
1. ✅ 创建 auth-service Container
2. ✅ 实现 JWT 认证组件
3. 🔄 创建登录接口 /api/auth/login
4. 🔄 创建 OpenAPI 契约
5. 🚫 编写单元测试 (阻塞原因：等待测试环境)
...

💡 建议：使用 /c4a:analyze 检查当前一致性
```

---

