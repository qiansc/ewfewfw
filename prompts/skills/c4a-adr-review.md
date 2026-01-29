# ADR 评审流程

**目标 ADR**: $ARGUMENTS

---

## 文件输出约束

**重要**：如果用户要求输出报告、分析结果或任何临时性文件，**必须保存到当前 ADR 的目录下**，与 ADR 文件位置保持一致。

| ADR 状态 | ADR 文件位置 | 输出文件位置 |
|---------|-------------|-------------|
| draft | `.c4a/drafts/<adr-id>/` | `.c4a/drafts/<adr-id>/` |
| approved | `.c4a/approved/<adr-id>/` | `.c4a/approved/<adr-id>/` |

**示例**：
- 用户说「生成评审报告」→ 保存到 `.c4a/drafts/adr-003/review-report.md`
- 用户说「导出影响分析」→ 保存到 `.c4a/drafts/adr-003/impact-analysis.md`
- 用户说「保存当前讨论」→ 保存到 `.c4a/drafts/adr-003/discussion-notes.md`

**禁止**：不要将 ADR 相关的临时文件保存到项目根目录、`.tmp/` 或其他位置。

---

## 1. 识别用户意图

根据 `$ARGUMENTS` 智能路由：

| $ARGUMENTS 值 | 行为 |
|---------------|------|
| 空 / "help" / "帮助" / "?" | 显示功能介绍 |
| ADR ID (如 `adr-001`) | 开始评审指定 ADR |

**显示帮助（用户输入 help 时）：**
```
📖 /c4a/adr/review 功能介绍

ADR 评审的交互式流程，支持以下操作：
  1. 查看 - 展示 ADR 内容和验证结果
  2. 澄清 - 解释设计决策背景
  3. 影响分析 - 查询现有架构的潜在影响
  4. 范围检查 - 确保 ADR 聚焦决策
  5. 修改 - 更新 DSL 文件内容
  6. 批准 - 将 ADR 从 draft 转为 approved
  7. 拒绝 - 将 ADR 归档为 rejected
  8. 发布 - 将 ADR 从 approved 转为 published

用法：
  /c4a/adr/review adr-001    评审指定 ADR

评审模式中的命令：
  "验证"          重新验证 DSL 文件
  "影响分析"      查询现有架构的潜在影响
  "范围检查"      检查 ADR 抽象度
  "配置检查"      检查 MCP 配置一致性（新增容器时必须）
  "修改 xxx"      更新指定内容
  "批准"          批准 ADR
  "拒绝"          拒绝 ADR
  "发布"          发布 ADR（需先批准，自动执行配置检查）
```

## 2. 读取 ADR 及关联文件

- 调用 c4a_local_read_file(id: $ARGUMENTS, type: "adr")
- 调用 c4a_local_list_files(status: "draft") 查看相关文件
- 对每个关联文件调用 c4a_local_read_file

## 3. 自动验证 DSL

**重要**：验证是评审的核心环节，必须确保所有文件符合 Schema。

- 对所有文件调用 c4a_dsl_validate
- 如有错误，在评审材料中**醒目标注**
- 常见验证错误及修复方法见文档末尾「Schema 约束」章节

## 4. 影响分析（可选，需要数据库可用）

**时机**：展示评审材料时，如果数据库可用，自动进行影响分析。

**步骤**：
1. 从 ADR 内容中提取关键词（技术选型、涉及的容器）
2. 调用 `c4a_query_search(query: <关键词>)` 查询相关实体
3. 如果 ADR 涉及修改现有容器，调用 `c4a_query_impact(entity_id: <容器id>)` 分析影响

**降级处理**：如果数据库不可用，跳过此步骤，只展示本地文件信息。

## 5. 范围检查（ADR 抽象度守护）

**检查时机**：展示评审材料时自动执行。

检查 ADR 内容是否过于具体，以下内容**不应出现在 ADR 中**：

| 过于具体的内容 | 应该如何处理 |
|---------------|-------------|
| 具体的代码实现（函数名、类名） | 移除，这是实现阶段的事 |
| 详细的 API 设计（字段、参数） | 概括为「提供 xxx API」，细节放 Contract |
| 配置项、环境变量清单 | 移除，放入容器文档或 README |
| 部署步骤、运维命令 | 移除，放入 knowledge.how |
| 具体的依赖版本号 | 只保留主要技术选型（如 Python 3.11） |
| 详细的数据模型字段 | 概括为「存储 xxx 数据」，细节放 Schema |

**如果检测到问题，在评审材料中提示：**
```
⚠️ ADR 范围建议
检测到以下内容可能过于具体，建议精简：
  - ...
```

## 6. 检查调研文档

- 检查 .c4a/research/ 是否有相关文档
- 如有，询问是否参考

## 7. 展示评审材料

```
📋 ADR <adr-id> 评审

## 基本信息
- 编号: <adr-id>
- 标题: <title>
- 状态: draft
- 创建时间: <date>

## ADR 内容

### 背景
<context 内容>

### 决策
<decision 内容>

### 影响
- 新增容器: <list>
- 修改容器: <list>

## 文件验证
✅ <adr-id>.c4a.yaml - 有效
❌ containers/<xxx>.c4a.yaml - 无效
   └─ 错误: <错误信息>
   └─ 修复建议: <根据 Schema 约束章节给出>

## 架构影响分析（如数据库可用）
🔍 相关现有容器：
  - c4a-data-mcp: 当前使用同步 HTTP，可能需要适配
  - c4a-code-mcp: 有数据依赖关系

🔗 依赖链：
  c4a-dsl-mcp → c4a-data-mcp → MongoDB

⚠️ ADR 范围建议（如有问题）
检测到以下内容可能过于具体：
  - "createUser(name, email)" → 建议改为「提供用户注册 API」

---
📝 评审模式已开启
```

## 8. 进入对话模式，响应用户指令

| 用户说 | 执行动作 |
|--------|----------|
| **查看类** | |
| "验证" / "validate" | 重新执行 DSL 验证，报告结果 |
| "看下 xxx 文件" | 展示指定文件完整内容 |
| "显示 xxx" | 展示指定内容 |
| "影响分析" | 重新查询现有架构的潜在影响 |
| "范围检查" | 重新检查 ADR 抽象度 |
| **澄清类** | |
| "为什么..." | 解释设计决策背景 |
| "xxx 是什么意思" | 澄清概念或术语 |
| "这个决策的影响是什么" | 分析决策影响范围 |
| **修改类** | |
| "修改 xxx" | 更新 DSL 文件对应部分，修改后必须重新验证 |
| "把 A 改成 B" | 执行具体修改，修改后必须重新验证 |
| "添加 xxx" | 在 DSL 中添加内容，添加后必须重新验证 |
| "删除 xxx" | 从 DSL 中移除内容 |
| "精简" / "做减法" | 自动精简过于具体的内容 |
| **决策类** | |
| "批准" / "approve" | → 执行批准流程 |
| "拒绝" / "reject" | → 执行拒绝流程 |
| "发布" / "release" | → 执行发布流程（需已批准） |

## 9. 修改流程（用户说"修改 xxx"时）

**重要**：任何修改都必须确保符合 Schema。

1. 理解用户修改意图
2. 调用 c4a_local_read_file 获取当前内容
3. 修改内容，确保符合 Schema 约束
4. 调用 c4a_local_write_file(validate: true) 写入
5. 如果验证失败，根据错误修正后重试
6. 输出修改结果：
   ```
   ✅ 已更新 <file>

   变更内容:
   - <what changed>

   验证结果: ✅ 通过
   ```

## 10. 精简流程（用户说"精简"或"做减法"时）

1. 分析当前 ADR 内容，识别过于具体的部分
2. 生成精简建议，展示给用户确认：
   ```
   📋 建议精简以下内容：

   原文                              → 建议改为
   ─────────────────────────────────────────────
   createUser(name, email, pwd)      → 提供用户注册 API
   PORT=8080, DB_HOST=localhost      → (移除，放入容器配置)
   UserSchema { id, name, email }    → 存储用户基本信息

   确认修改？
     1. 全部采纳
     2. 选择部分
     3. 取消
   ```
3. 根据用户选择执行修改
4. 重新验证并报告结果

## 11. 批准流程（用户说"批准"时）

- 再次验证所有文件，**确保无错误**
- **如有验证错误，必须修复后才能批准**
- 执行范围检查，如有问题提醒用户（不强制）
- 收集批准信息：批准人、评审人
- 调用 c4a_local_transition_status(to_status: "approved")
- 输出：
  ```
  ✅ ADR <adr-id> 已批准

  📁 文件已移动: .c4a/drafts/<adr-id>/ → .c4a/approved/<adr-id>/
  📊 状态: approved
  👤 批准人: <name>

  🔜 下一步:
    - 说"发布"立即发布
    - 或完成代码实现后再发布
  ```

## 12. 拒绝流程（用户说"拒绝"时）

- 询问拒绝原因
- 调用 c4a_local_transition_status(to_status: "archived", metadata: {reason: "rejected: ..."})
- 输出：
  ```
  ❌ ADR <adr-id> 已拒绝

  📁 文件已移动: .c4a/drafts/<adr-id>/ → .c4a/archive/<adr-id>/
  📊 状态: archived (rejected)
  📝 原因: <reason>
  ```

## 13. 发布流程（用户说"发布"时）

- 检查当前状态是否为 approved
- 如果是 draft，提示需要先批准
- **再次验证所有文件，确保无错误**
- **执行配置一致性检查（见第 14 节）**，如有问题阻止发布
- 确认发布：
  ```
  ⚠️ 发布后将：
    - 移动到 .c4a/published/ 目录
    - 状态变为 published（不可修改）
    - 成为权威版本

  确认发布？
    1. 确认发布
    2. 取消
  ```
- 调用 c4a_local_transition_status(to_status: "published")
- 输出：
  ```
  ✅ ADR <adr-id> 已发布

  📁 文件位置:
    .c4a/published/adr/<adr-id>.c4a.yaml
    .c4a/published/container/<container-id>.c4a.yaml

  📊 状态: published

  🔜 下一步: 同步到知识库（见下方流程）
  ```

## 14. 配置一致性检查（发布前必须执行）

**重要**：如果 ADR 涉及新增或修改 MCP 容器，必须检查 `c4a.config.yaml` 是否相应更新。

**检查时机**：用户说「发布」时，在状态流转前执行。

**检查逻辑**：
1. 从 ADR 的 `affects` 字段获取涉及的容器
2. 读取这些容器的 DSL，检查是否是 MCP 服务（`technology.protocol: MCP`）
3. 读取 `c4a.config.yaml`，检查 `mcpServers` 中是否有对应配置
4. 如有缺失，**阻止发布**并提示用户

**检查输出**：
```
🔍 配置一致性检查

涉及的 MCP 容器：
  ✅ c4a-data-mcp - 已在 c4a.config.yaml 中配置
  ❌ c4a-visual-mcp - 缺少配置！

⚠️ 发现配置缺失，请先更新 c4a.config.yaml：

mcpServers:
  c4a-visual-mcp:
    command: bun
    args: ["run", "./packages/mcp-visual/src/index.ts"]
    transport: stdio

更新后重新执行「发布」。
```

**跳过条件**：
- ADR 不涉及容器变更（`affects` 为空或无 container 类型）
- 涉及的容器不是 MCP 服务

---

## 15. 同步到知识库流程（发布后执行）

**重要**：发布后需要将 **所有 published 目录下的文件**（包括 System、Container、ADR）同步到知识库。

**⚠️ 避免使用 `c4a_store_sync` 批量同步（mode=full）**，该操作可能因文件数量较多导致 MCP 请求超时。

**⚠️ 必须串行同步，禁止并发调用**：每次只调用一个 `c4a_store_sync`（direction="import"），等待返回结果后再调用下一个。并发调用会导致服务过载超时！

**推荐的逐文件同步流程**：

```
1. 调用 c4a_local_list_files(status="published") 获取所有已发布文件
2. 【串行】对每个文件逐一调用 c4a_store_sync(path="xxx", direction="import")
   - 调用第 1 个文件 → 等待结果返回 → 报告进度
   - 调用第 2 个文件 → 等待结果返回 → 报告进度
   - ...依此类推，一次只能调用一个！
3. 全部完成后，汇总报告同步结果
```

**❌ 错误示例（并发调用会导致超时）**：
```
// 不要这样做！一次调用多个会超时！
同时调用:
  c4a_store_sync(path=file1, direction="import")
  c4a_store_sync(path=file2, direction="import")
  c4a_store_sync(path=file3, direction="import")
```

**✅ 正确示例（串行调用）**：
```
📤 开始同步到知识库...

正在同步 10 个文件（串行执行）:

[1/10] 调用 c4a_store_sync(path=".c4a/published/system/c4a.c4a.yaml", direction="import")
  ✅ system/c4a.c4a.yaml (created)

[2/10] 调用 c4a_store_sync(path=".c4a/published/container/c4a-cli.c4a.yaml", direction="import")
  ✅ container/c4a-cli.c4a.yaml (created)

... 依次同步每个文件 ...

📊 同步完成: 10 个文件全部成功
```

**注意**：
- 必须同步**所有** published 文件，不要只同步当前 ADR
- **一次只调用一个文件**，等待结果后再调用下一个
- 如果某个文件同步失败，继续同步其他文件，最后汇总报告错误

---

## Schema 约束（验证错误修复指南）

### ADR 常见错误

| 错误信息 | 原因 | 修复方法 |
|----------|------|----------|
| `adr/id must match pattern ^ADR-[0-9]{3,4}$` | id 格式错误 | 改为 `ADR-001` 格式（大写） |
| `alternatives must be array of objects` | alternatives 是字符串数组 | 改为 `[{name: "xxx", description: "..."}]` |
| `must NOT have additional properties` | 有 Schema 不允许的字段 | 移除 `references` 等非法字段 |
| `consequences/neutral must be array` | neutral 是字符串不是数组 | 改为 `["xxx"]` 数组格式 |

**ADR 正确格式**：
```yaml
adr:
  id: ADR-001          # 大写 ADR + 3-4 位数字
  title: 决策标题
  status: draft
  date: 2026-01-07

alternatives:          # object 数组
  - name: 方案名称
    description: 方案描述

consequences:
  positive: []         # string 数组
  negative: []         # string 数组
  neutral: []          # string 数组
```

### Container 常见错误

| 错误信息 | 原因 | 修复方法 |
|----------|------|----------|
| `technology must be object` | technology 是数组 | 改为 `{language, protocol, ...}` 格式 |
| `must NOT have additional properties` | 有 Schema 不允许的字段 | 移除 `status`, `interfaces`, `data_flows` 等 |

**Container 正确格式**：
```yaml
container:
  id: my-container
  name: My Container
  description: 描述
  technology:          # 必须是 object
    language: TypeScript
    framework: Express
    runtime: Bun
    protocol: HTTP
```

**禁止的字段**：
- `status` - 状态由目录位置决定
- `external` - 仅外部系统使用
- `interfaces` - 放入 knowledge.how
- `data_flows` - 使用 relationships
- `platforms` - 放入 knowledge
- `core_modules` - 由代码分析生成
