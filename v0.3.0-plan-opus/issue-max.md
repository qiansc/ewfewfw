# C4A v0.3.0 设计文档与代码实现一致性检查报告（综合版）

> 检查日期：2026-02-02
> 检查来源：Claude Opus 4.5、Gemini 3 Pro、Sonnet 3.5、Codex 综合分析
> 检查范围：v0.3.0/architecture.md, concepts.md, user-stories.md, product.md, detailed-design/*

---

## 目录

1. [P0 - 阻塞性问题](#1-p0---阻塞性问题)
2. [P1 - 高优先级问题](#2-p1---高优先级问题)
3. [P2 - 中优先级问题](#3-p2---中优先级问题)
4. [P3 - 低优先级问题](#4-p3---低优先级问题)
5. [按模块分类汇总](#5-按模块分类汇总)
6. [实现完成度评估](#6-实现完成度评估)
7. [修复建议](#7-修复建议)

---

## 1. P0 - 阻塞性问题

> 这些问题会导致核心功能不可用或存在严重安全风险，必须立即修复。

### 1.1 [安全] Server 模式权限检查已覆盖 Feat 端点（基础版）

**问题描述**：设计文档要求 Server 模式实现完整的权限控制，现已补齐 Feat 端点的基础权限校验，但仍处于“基础版”（无独立中间件/细粒度策略）。

**设计文档**：
- `v0.3.0/detailed-design/permissions/cross-project-auth.md` §1.1-1.7
- 要求：发布 feat 需要所有涉及项目的 admin 权限
- 要求：跨项目操作需要权限校验

**实际实现**：
- ✅ `packages/storage-backend/src/routes/entities.py` - save/read/delete 已调用 `PermissionService.check_permission`
- ✅ `packages/storage-backend/src/routes/sync.py` / `routes/utils.py` - 部分接口已有权限检查
- ✅ `packages/storage-backend/src/routes/feat.py` - Feat lifecycle/merge/checklist/workflow 已接入权限校验
- ❌ `packages/storage-backend/src/middleware/permission_check.py` - 空文件
- ⚠️ `packages/storage-backend/src/services/permission.py` - 已支持 `C4A_PERMISSION_ALLOW_EMPTY`

**影响**：
- Feat 相关接口的权限风险已收敛
- 仍需补齐中间件化/统一拦截（非阻塞）

**状态**：已修复（Feat 端点权限已接入，仍为基础版）
**来源**：现状对照代码

---

### 1.2 [数据] Storage SQL JOIN 条件风格不一致

**问题描述**：设计文档要求使用空字符串 `''` 代替 NULL（哨兵值模式），但代码在 JOIN 条件中使用 `IS` 操作符。虽然 SQLite 中 `IS` 对非 NULL 值也可等价于 `=`，但语义/风格不一致，需确认是否存在实际 bug。

**设计文档**：`v0.3.0/detailed-design/local-mode/sqlite-schema.md` §2.1 - 空字符串哨兵值

**实际实现**：
- ✅ 已将 `proposal_id IS ...` 的 JOIN 条件统一为 `=`（覆盖 `crud-save`、`crud-read`、`relations`、`search-operations`、`dataOpsContext` 等）
- 保留 `IS NULL/IS NOT NULL` 语义不变

**影响**：语义与哨兵值设计一致，查询一致性提升

**状态**：已修复
**来源**：Claude 报告 + 现状对照代码

---

### 1.3 [功能] Local 模式层级关系（CONTAINS）已补齐

**问题描述**：设计文档要求保存 Container/Component 时自动创建 CONTAINS 关系，现已在解析阶段补齐。

**设计文档**：
- `v0.3.0/concepts.md` §6 - `CONTAINS` 关系由 `system_id`/`container_id` 字段自动生成
- `v0.3.0/user-stories-validate.md` - 已记录为"待改进项"

**实际实现**：
- ✅ `packages/storage/src/lite-adapter/relations.ts` - 已根据 `system_id` / `container_id` 自动生成 `CONTAINS`

**影响**：
- 图数据库中缺乏层级关系
- `c4a_query_deps` 和架构图生成功能无法正确反映系统结构

**状态**：已修复
**来源**：Gemini 报告 + 现状对照代码

---

### 1.4 [功能] ADR 检查逻辑仅 Local 部分实现

**问题描述**：设计文档要求 `c4a_store_save` 支持 ADR 强制检查，目前仅 Local 实现了基本校验，仍缺少配置驱动与 Server 端实现。

**设计文档**：`v0.3.0/detailed-design/mcp/store-crud.md` §3.1
```markdown
检查规则：
- 如果 `enforce_adr=true` 或项目配置 `adr_policy.enforce=true`：
  - 检查是否存在关联的 ADR（通过 `REFERENCES` 关系）
  - 如果没有 ADR：返回错误或警告
```

**实际实现**：
- ✅ `packages/storage/src/lite-adapter/crud-save.ts` - ADR 检查支持 `enforce_adr` + `adr_policy.on_missing`
- ✅ `packages/mcp-store/src/tools/save.ts` - 读取 `.context/.c4a.yaml` 的 `adr_policy` 并传递给存储层
- ✅ `packages/storage-backend/src/routes/entities.py` - Server 端 ADR 检查已实现

**影响**：Local/Server 两端 ADR 检查行为一致，可按项目策略生效

**状态**：已修复
**来源**：Sonnet 报告 + 现状对照代码

---

### 1.5 [功能] c4a_store_validate 已在 Server 端实现基础检查

**问题描述**：设计文档要求 validate 工具支持多种检查项，当前 Server 端已实现基础检查（启发式），不再是 stub。

**设计文档**：`prompts/skills/c4a-analyze/SKILL.md`
```typescript
c4a_store_validate({
  checks: ["functional_spec", "technical_spec", "contracts",
           "references", "adr_completeness", "checklist"],
  options: { include_suggestions: true }
})
```

**实际实现**：
- ✅ `packages/storage/src/lite-adapter/utilsValidate.ts` - Local 完整检查
- ✅ `packages/storage-backend/src/routes/utils.py:/validate` - Server 基础检查已实现

**影响**：Server/Remote 模式下 `c4a_store_validate` 可用（启发式实现）

**状态**：已修复（Server 已实现基础检查）
**来源**：现状对照代码

---

### 1.6 [功能] Server/Remote 同步流程不可用（计划延后）

**问题描述**：设计文档要求的同步计划执行逻辑未实现。

**设计文档**：`v0.3.0/detailed-design/mcp/store-sync.md` §3.5
- 要求 `execute=true` 返回 `actions/new_snapshot`
- 支持下载/删除/冲突处理

**实际实现**：
- `packages/storage-backend/src/routes/sync.py` 的 `plan_sync`
- 只计算上传/冲突，无执行逻辑
- 返回结构为 `plan`，不含 `actions`/`new_snapshot`/`execute`

**影响**：Server/Remote 模式同步“执行阶段”不可用，但按计划可延后到 v0.4.0

**状态**：降级为 P2（计划延后）
**来源**：Codex 报告

---

### 1.7 [功能] Remote 模式仅部分实现

**问题描述**：Remote 模式已有基础支持（配置 + Adapter 复用），但仍缺少完整 MCP 配置与服务编排。

**设计文档**：`v0.3.0/architecture.md` §1.1
- Remote 模式：连接远程 C4A 服务，通过 HTTP API 访问

**实际实现**：
- ✅ `packages/storage/src/get-adapter.ts` - 支持 `mode=remote`（复用 `ServerAdapter`，读取 `remote.url`）
- ✅ `packages/cli/src/commands/init.ts` - 可配置 `remote.url`
- ✅ `packages/cli/src/commands/init.ts` - remote 配置已补齐 store/query/visual MCP
- ⚠️ 未实现专用 `RemoteAdapter`，仅复用 Server

**影响**：Remote 模式配置已完善，但仍复用 ServerAdapter（无专用适配层）

**状态**：部分修复（配置补齐，仍复用 ServerAdapter）
**来源**：Sonnet、Codex 报告 + 现状对照代码

---

### 1.8 [功能] CLI 模板与 DSL Schema 不一致

**问题描述**：CLI 生成的模板格式与 JSON Schema 定义不匹配，会导致验证失败。

**设计文档**：`v0.3.0/architecture.md` §2.7 - 要求 `schema: c4a/v1` + `type: software-system` + 嵌套结构

**实际实现**：
- ✅ `packages/cli/src/core/templates.ts` 已按 Schema 输出嵌套结构
- ✅ `schema: c4a/v1` + `type`/`{system|container|component|adr|process|sor}` 完整字段
- ✅ component `technology` 类型已与 Schema 对齐（string）

**影响**：模板可直接通过 Schema 校验（待填写 TODO 字段）

**状态**：已修复
**来源**：Codex 报告 + 现状对照代码

---

### 1.9 [功能] c4a_store_save 参数约束仅部分落地

**问题描述**：参数约束已在 Zod refine 中定义，但 MCP tool 使用 `.shape` 未触发校验；Adapter 也未禁止 data/content 同时输入。

**设计文档**：`v0.3.0/detailed-design/mcp/store-crud.md` §3.1
- `data` 和 `content` 互斥规则
- `id` 可省略时自动生成

**实际实现**：
- ✅ `packages/mcp-store/src/tools/save.ts` - 使用 `StoreSaveInputSchemaWithRefine` 做运行时校验
- ✅ `packages/storage/src/lite-adapter/crud-save.ts` / `storage-backend/routes/entities.py` - data/content 互斥校验 + format 要求
- ✅ `id` 缺失时自动生成（语义化或序号 ID）

**影响**：参数约束与自动 ID 生效，行为与设计一致

**状态**：已修复
**来源**：Codex 报告 + 现状对照代码

---

### 1.10 [功能] Server 端删除语义已对齐（feat 软删除）

**问题描述**：设计要求 feat 内删除主分支已存在实体时应软删除，现已在 Server 端对齐。

**设计文档**：`v0.3.0/detailed-design/mcp/store-crud.md` §3.4
- feat 内删除主分支已存在实体 → 转换为软删除（设置 `status: "archived"`）

**实际实现**：`packages/storage-backend/src/routes/entities.py` - feat 删除主分支实体时改为 `status=archived`

**影响**：feat 删除语义已对齐

**状态**：已修复
**来源**：Codex 报告 + 现状对照代码

---

### 1.11 [安全] Server 端路径穿越校验已补齐

**问题描述**：设计要求对文件路径进行安全校验，现已在 Server 端补齐基础校验。

**设计文档**：`v0.3.0/detailed-design/permissions/error-codes.md` §5.5
- 对 sync/backup/restore/plan_sync 路径进行 traversal 校验

**实际实现**：
- ✅ `packages/storage-backend/src/routes/utils.py` - backup/restore 路径校验
- ✅ `packages/storage-backend/src/routes/sync.py` - sync/plan_sync 路径校验

**影响**：路径逃逸风险已收敛

**状态**：已修复
**来源**：Codex 报告 + 现状对照代码

---

## 2. P1 - 高优先级问题

> 这些问题影响重要功能的正确性，应尽快修复。

### 2.1 [API] mcp-query 参数命名不一致

**问题描述**：设计文档要求参数名为 `type_filter`，但实现使用 `scope`

**设计文档**：`v0.3.0/detailed-design/mcp/query.md:7` - `type_filter?: string`

**实际实现**：`packages/mcp-query/src/schemas.ts:44` - `scope: QuerySearchScopeSchema.optional()`

**影响**：MCP 工具参数名与设计不符，可能导致 Agent 调用时参数错误

**来源**：Claude、Sonnet 报告

---

### 2.2 [API] mcp-visual 工具暴露策略不一致

**问题描述**：设计文档要求只对 Agent 暴露 2 个工具，但实际暴露了全部 10 个。

**设计文档**：`v0.3.0/detailed-design/mcp/visual.md` §5.3
- **应暴露**：`c4a_visual_generate`、`c4a_visual_render_c4`
- **不应暴露**（内部工具）：其他 8 个

**实际实现**：`packages/mcp-visual/src/server.ts` - 所有 10 个工具都注册为 MCP 工具

**不应暴露的工具**：
- `c4a_visual_render`
- `c4a_visual_list_templates`
- `c4a_visual_render_template`
- `c4a_visual_save`
- `c4a_visual_get_reference`
- `c4a_visual_cleanup`
- `c4a_visual_storage_stats`
- `c4a_visual_get_style`

**来源**：Claude、Sonnet、Codex 报告

---

### 2.3 [API] mcp-visual 存储路径不一致

**问题描述**：存储路径与设计文档不符

**设计文档要求**：
- cache: `.context/cache/images/`
- permanent: `.context/images/`
- report: `.context/reports/{report_id}/images/`

**实际实现** (`packages/mcp-visual/src/storage/storage-manager.ts:20-21`)：
```typescript
const STORAGE_PATHS = {
  cache: "cache/visual/temp",      // 应为 cache/images/
  permanent: "assets/images",       // 应为 images/
  report: "reports",                // 缺少 /images/ 后缀
};
```

**来源**：Claude、Sonnet 报告

---

### 2.4 [数据] Local Mode degraded 标志错误

**问题描述**：Local Mode 影响分析应返回 `degraded: true`，此前实现返回 `false`。

**设计文档**：`v0.3.0/detailed-design/mcp/query.md:145-146`
- 应返回 `degraded: true, degraded_reason: "LOCAL_MODE_SIMPLIFIED"`

**实际实现**：`packages/mcp-query/src/tools/impact.ts` - Local Mode 返回 `degraded: true`（已修复）

**状态**：已修复（建议从待修复清单移除）
**来源**：Claude 报告 + 现状对照代码

---

### 2.5 [错误处理] 错误响应格式不完整

**问题描述**：`buildErrorResponse()` 函数实现过于简化，未完全遵循设计规范

**设计文档要求**：错误响应应包含 `code`、`message`、`details`、`timestamp`、`request_id`、`recoverable_actions`

**实际实现** (`packages/mcp-store/src/server.ts:528-535`)：
```typescript
function buildErrorResponse(error: unknown): ErrorResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "C4A-STORE-001",  // 硬编码！
    message,
    timestamp: new Date().toISOString(),
    // 缺少：details, request_id, recoverable_actions
  };
}
```

**影响**：所有错误都被映射为同一个错误码，无法区分错误类型

**来源**：Claude、Sonnet、Gemini、Codex 均报告

---

### 2.6 [CLI] 调试命令缺少依赖检查

**问题描述**：`debug:dsl`, `debug:code`, `debug:data` 命令没有调用 `checkDependencies()`

**设计文档**：`v0.3.0/detailed-design/cli/dev-cli.md:167-180`
- `debug:dsl` 应检查 `bun`
- `debug:code` 应检查 `bun`
- `debug:data` 应检查 `uv`

**实际实现**：`packages/cli-dev/src/commands/index.ts:424-446` - 直接运行，不检查依赖

**来源**：Claude、Sonnet 报告

---

### 2.7 [配置] 服务端口文档与实现不一致

**问题描述**：文档写 `storage-backend` 为 8050，但实际为 8055

**设计文档**：`v0.3.0/architecture.md` §1.1/§6 - 端口 8050

**实际实现**：
- `docker/docker-compose.server.yml` - 暴露为 8055
- `packages/cli/src/commands/install.ts` - 写死 8055

**影响**：按文档配置将无法连通服务端

**来源**：Codex 报告

---

### 2.8 [配置] Server 模式缺少 visual MCP 服务

**问题描述**：文档包含 `c4a-visual-mcp`，但 Docker Compose 未部署

**设计文档**：`v0.3.0/architecture.md` §1.1/§1.4 - MCP 服务应含 store/query/visual

**实际实现**：`docker/docker-compose.server.yml` - 仅启动 store/query，缺少 visual

**影响**：可视化能力在 Server 场景不可用

**来源**：Codex 报告

---

### 2.9 [功能] Feat 生命周期与合并逻辑未实现

**问题描述**：Server 端 feat 相关端点返回空结果或缺少关键逻辑

**设计文档**：`v0.3.0/detailed-design/mcp/store-feat-lifecycle.md` §3.6/§3.7

**实际实现**：
- `packages/storage-backend/src/routes/feat.py` 的 `feat_merge` 直接返回空结果
- `feat_lifecycle` 未做流转合法性校验或实体状态联动

**影响**：feat 发布/合并设计不可用

**来源**：Sonnet、Codex 报告

---

### 2.10 [功能] 状态机校验未实现

**问题描述**：设计要求状态流转不可跳跃且 published 不可直接修改，但代码未实现

**设计文档**：`v0.3.0/concepts.md` §3 - 知识生命周期强制规则

**实际实现**：
- `packages/storage/src/lite-adapter/crud-save.ts` - 无状态机校验
- `packages/storage-backend/src/routes/entities.py` - 无状态机校验
- 主分支默认直接写入 `published`

**影响**：生命周期规则形同虚设，发布态可被直接覆盖

**来源**：Codex 报告

---

### 2.11 [功能] Server/Remote 模式传输与配置不一致

**问题描述**：CLI 在 Server/Remote 模式下的 MCP 调用方式与设计文档不一致。

**设计文档**：`v0.3.0/detailed-design/cli/mcp-mapping.md` §4.1/§4.2
- Server/Remote 应使用 HTTP 调用 MCP

**实际实现**：
- `packages/cli/src/commands/sync.ts` 和 `status.ts` 在 server 模式使用 `stdio`
- `packages/cli/src/core/mcp-client.ts` 只解析 mcp-store 入口
- remote init 未配置 query/visual/extract

**影响**：Server 模式下 MCP 调用路径与文档不一致，query/visual 未被使用

**来源**：Codex 报告

---

### 2.12 [功能] Skills 执行引擎/proposal_id 注入缺失

**问题描述**：Skills 提示词依赖模板变量（如 `{{current_proposal_id}}`），但没有找到注入实现。

**设计文档**：`v0.3.0/detailed-design/skills/core-skills.md` 开头说明
- 所有 MCP 工具调用必须传递当前 Feature 的 `proposal_id`

**实际实现**：
- Skills 提示词文件使用了 `{{current_proposal_id}}` 等模板变量
- 没有找到负责注入这些模板变量的代码
- 没有找到 Skill 执行引擎的实现

**影响**：Skills 提示词无法正确获取当前 Feature 上下文，可能导致 Agent 在错误的 proposal_id 下操作

**来源**：Sonnet 报告

---

## 3. P2 - 中优先级问题

> 这些问题影响功能完整性或代码质量，应计划修复。

### 3.1 [API] mcp-query 缺少 source_project 参数定义

**问题描述**：`QueryDepsInputSchema` 和 `QueryImpactInputSchema` 中缺少 `source_project` 参数定义

**涉及文件**：`packages/mcp-query/src/schemas.ts:58-64`

**影响**：参数验证可能不完整

**状态**：已修复（`QueryDepsInputSchema`/`QueryImpactInputSchema` 已加入 `source_project`）
**来源**：Claude 报告 + 现状对照代码

---

### 3.2 [API] mcp-query 缺少 max_depth_allowed 字段

**问题描述**：Local Mode 简化版影响分析返回格式中缺少 `max_depth_allowed` 字段

**设计文档**：`v0.3.0/detailed-design/mcp/query.md:91` - 降级模式返回应包含 `max_depth_allowed: 1`

**实际实现**：`packages/mcp-query/src/tools/impact.ts:47-55` - 没有此字段

**状态**：已修复（Local Mode 简化版影响分析返回包含 `max_depth_allowed`）
**来源**：Claude、Sonnet 报告

---

### 3.3 [代码质量] mcp-query 降级逻辑重复

**问题描述**：`c4a_query_impact` 中有重复的降级检查逻辑

**涉及文件**：`packages/mcp-query/src/tools/impact.ts:19,38`
- 第 19 行: `if (context.degraded && !isLocal())` 检查后返回错误
- 第 38 行: `if (degraded && !isLocal())` 再次检查并返回相同错误

**来源**：Claude、Sonnet 报告

---

### 3.4 [数据] Storage relations 表可能存储 NULL 值

**问题描述**：relations 表的 UNIQUE 索引包含 `from_project` 和 `to_project` 字段，但这些字段在某些查询中使用 `IFNULL()` 处理，暗示可能存在 NULL 值

**涉及文件**：
- `packages/storage/src/sqlite-store.ts:376-377` - UNIQUE 索引定义
- `packages/storage/src/lite-adapter/relations.ts:458,474` - 使用 `IFNULL()` 处理

**来源**：Claude、Sonnet 报告

---

### 3.5 [配置] mcp-extract Tree-sitter WASM 配置误导

**问题描述**：`copy-wasm.js` 中列出了 TypeScript WASM 文件，但实际不存在也不需要

**涉及文件**：`packages/mcp-extract/scripts/copy-wasm.js:31-51`
- 列出了 `tree-sitter-typescript.wasm` 和 `tree-sitter-tsx.wasm`
- 但 TypeScript 使用编译器 API，不需要 WASM

**修复建议**：清理 copy-wasm.js 中的 TypeScript WASM 相关代码和注释

**状态**：已修复（移除 TypeScript WASM 提示）
**来源**：Claude 报告

---

### 3.6 [CLI] start.sh 有硬性依赖检查

**问题描述**：设计要求依赖检查按需执行，但 `start.sh` 中仍有强制的 bun 检查

**设计文档**：`v0.3.0/detailed-design/cli/dev-cli.md:139-165` - 依赖检查应按需执行

**实际实现**：`start.sh:32-39` - 强制检查 bun

**状态**：已修复（移除 start.sh 中的 bun 强制检查，依赖按命令执行时检查）
**来源**：Claude、Sonnet 报告

---

### 3.7 [配置] storage-backend 缺少 C4A_PERMISSION_ALLOW_EMPTY 配置

**问题描述**：`config.py` 中未定义 `C4A_PERMISSION_ALLOW_EMPTY`，但权限服务已直接读取环境变量

**设计文档**：`v0.3.0/detailed-design/permissions/cross-project-auth.md:1.1.4` - 需要支持此环境变量

**实际实现**：`PermissionService` 已读取 `C4A_PERMISSION_ALLOW_EMPTY`，但未在 `config.py` 统一配置

**状态**：已修复（配置层新增 C4A_PERMISSION_ALLOW_EMPTY）
**来源**：Claude 报告 + 现状对照代码

---

### 3.8 [错误处理] MCP 包错误码未定义

**问题描述**：MCP 包（extract、query、visual）使用了未在 `core/types/errors.ts` 中定义的错误码

**涉及文件**：
- `packages/mcp-extract/src/server.ts:159` - 使用 `C4A-EXTRACT-001`
- `packages/mcp-query/src/server.ts:135` - 使用 `C4A-QUERY-001`
- `packages/mcp-visual/src/server.ts:368` - 使用 `C4A-VISUAL-001`

**状态**：已修复（errors.ts 补齐 EXTRACT/QUERY/VISUAL 错误码）
**来源**：Claude、Sonnet、Gemini 报告

---

### 3.9 [代码质量] ErrorResponse 类型定义重复

**问题描述**：多个包重复定义了 ErrorResponse 类型

**涉及文件**：
- `packages/core/src/types/errors.ts:307-320` - 标准定义
- `packages/mcp-store/src/server.ts:510-526` - 重复定义
- `packages/cli/src/utils/errorResponse.ts:5-21` - 重复定义
- `packages/cli-dev/src/utils/errorResponse.ts:5-21` - 重复定义

**修复建议**：统一从 `@c4a/core/types` 导入

**状态**：已修复（CLI/CLI-dev/mcp-store 统一使用 core 类型）
**来源**：Claude、Sonnet 报告

---

### 3.10 [错误处理] recoverable_actions 未实现

**问题描述**：错误响应中未填充 `recoverable_actions` 字段

**涉及文件**：
- `packages/core/src/types/errors.ts:353-361` - `C4AError.toResponse()` 没有返回 recoverable_actions
- `packages/mcp-store/src/server.ts:528-535` - buildErrorResponse 没有构建 recoverable_actions

**状态**：已修复（C4AError.toResponse 返回 recoverable_actions；mcp-store 使用 core 统一构建）
**来源**：Claude、Sonnet 报告

---

### 3.11 [文档] feats 表缺少设计文档

**问题描述**：`feats` 表在代码中存在但设计文档中没有说明

**状态**：已记录变更提案（`v0.3.0-plan-opus/change/2026-02-02-p2-doc-consistency.md`）
**来源**：Sonnet 报告

---

### 3.12 [文档] workflow_states 和 compensation_logs 表未在文档中说明

**问题描述**：这两个表在代码中存在但设计文档中没有说明

**状态**：已记录变更提案（`v0.3.0-plan-opus/change/2026-02-02-p2-doc-consistency.md`）
**来源**：Sonnet 报告

---

### 3.13 [文档] entities 表增加了未文档化的字段

**问题描述**：`orphaned` 和 `orphaned_at` 字段在设计文档中完全没有提及

**状态**：已记录变更提案（`v0.3.0-plan-opus/change/2026-02-02-p2-doc-consistency.md`）
**来源**：Sonnet 报告

---

### 3.14 [功能] 悬空引用处理机制未完整实现

**问题描述**：设计文档要求的悬空引用自动解析功能未实现

**设计文档**：`v0.3.0/detailed-design/data-ops/cross-reference.md` §1.11

**实际实现**：
- `relations` 表没有 `resolved` 字段
- 没有自动解析悬空引用的代码
- `c4a_store_validate` 工具中没有检查悬空引用

**状态**：已修复（保存/导入实体时自动解析悬空引用并更新 relations）
**来源**：Sonnet 报告

---

### 3.15 [功能] Server 端关系解析未实现

**问题描述**：Server 端保存实体时不解析和写入关系

**设计文档**：`v0.3.0/concepts.md` §7 - 保存时自动写入关系

**实际实现**：`packages/storage-backend/src/routes/entities.py` 未解析 DSL 也未写 relations/neo4j 关系

**影响**：Server/Remote 的 deps/impact 查询不完整

**状态**：已修复（Server 保存时解析 relationships/references 并写入 relations/neo4j）
**来源**：Codex 报告

---

### 3.16 [功能] Server 端变更历史返回空数组

**问题描述**：`c4a_store_read_history` 在 Server 端返回空数组

**状态**：已修复（新增 entity_history 记录与查询）
**来源**：Codex 报告

---

### 3.17 [配置] c4a init 输出文件与文档不一致

**问题描述**：文档要求 `.mcp.json` + `.claude/settings.local.json`，但实际写入 `claude.json`

**来源**：Codex 报告

---

### 3.18 [配置] c4a init 未写入 server.url 配置

**问题描述**：server 模式初始化后缺少 `server.url` 配置

**影响**：server 模式初始化后直接调用存储将报错

**来源**：Codex 报告

---

### 3.19 [配置] c4a init 未创建完整目录结构

**问题描述**：文档要求的 `.context/.schemas/`、`assets/`、`technical/contracts/` 等目录未创建

**来源**：Codex 报告

---

### 3.20 [数据] 内容哈希计算口径不一致

**问题描述**：CLI 和存储侧的哈希计算逻辑不一致

**影响**：Server/Remote 同步的冲突检测可能出现误判或漏判

**来源**：Codex 报告

---

### 3.21 [文档] spec_uri 同步范围描述矛盾

**问题描述**：concepts.md 与 architecture.md 对 Contract 的 spec_uri 同步范围描述矛盾。

**设计文档**：
- `v0.3.0/concepts.md` §8.1 - `spec_uri` 指向的文件**不在 C4A 同步范围内**
- `v0.3.0/architecture.md` §2.5 - `technical/contracts/` 目录存放 Contract 规格文件（可选）

**问题**：如果不参与同步，为什么要放在 `.context/` 目录下？

**建议**：明确 `spec_uri` 的两种使用模式（外部 URI vs 本地相对路径）

**来源**：Sonnet 报告

---

### 3.22 [文档] expected_content_hash 计算口径未定义

**问题描述**：设计文档未说明 `computeFeatContentHash` 的计算方式和获取路径。

**设计文档**：`v0.3.0/detailed-design/mcp/store-feat-lifecycle.md` §3.6
- 提到 `expected_content_hash` 用于同步校验
- 未说明计算方式（对所有 feat 内实体的哈希值求和？还是对整个 feat 目录计算？）
- 未说明 Agent 如何获取此值

**来源**：Sonnet 报告

---

### 3.23 [文档] Checklist 清理时机描述不一致

**问题描述**：设计文档中 Checklist 清理时机的描述存在矛盾。

**设计文档**：`v0.3.0/detailed-design/mcp/store-feat-lifecycle.md` §3.6
- 职责说明：流转到 `published` 或 `archived` 时，自动删除远程 checklist
- 代码示例：只在流转到 `published` 时清理

**问题**：archived 时是否也清理？如果是，代码在哪里？

**来源**：Sonnet 报告

---

### 3.24 [数据] source_project 缺失时处理不符合设计

**问题描述**：设计要求 source_project 缺失时报错，但代码使用默认值。

**设计文档**：`v0.3.0/detailed-design/permissions/cross-project-auth.md` §1.1.1
- 如果 `targetProject` 为空且无法从配置获取，应抛出 `DataIntegrityError`

**实际实现**：`packages/storage/src/lite-adapter/crud-operations.ts` 的 `save()` 函数
- 有 `source_project` 自动填充逻辑
- **但没有抛出错误的逻辑，直接使用默认值 'default'**

**影响**：可能创建归属不明确的实体

**来源**：Sonnet 报告

---

### 3.25 [文档] scope:project/ 与 project:{project_id}/ 语义冲突

**问题描述**：跨层级引用规范中两种格式语义重复且易混淆。

**设计文档**：`v0.3.0/detailed-design/data-ops/cross-reference.md` §1.4
- `scope:{scope}/{id}` - 指定层级（Domain/Enterprise）
- `project:{project_id}/{id}` - 指定项目

**问题**：`scope:project/xxx` 与 `project:{project_id}/xxx` 语义重复
- 前者是指定实体的 scope 字段
- 后者是指定实体的 source_project

**建议**：移除 `scope:project/` 格式，或明确两者区别

**来源**：Sonnet 报告

---

### 3.26 [文档] feats.project_ids 字段语义/格式不明

**问题描述**：`feats` 表的 `project_ids` 字段用途和格式不明确。

**实际实现**：
```sql
CREATE TABLE IF NOT EXISTS feats (
  ...
  project_ids TEXT  -- 字段用途不明确
);
```

**问题**：
- 字段名是复数形式，暗示可能存储多个项目 ID
- 数据类型是 TEXT，不清楚是 JSON 数组还是逗号分隔的字符串
- 文档中没有说明这个字段的用途和格式

**来源**：Sonnet 报告

---

### 3.27 [文档] data 扁平化描述与代码不一致

**问题描述**：设计文档说 data 字段"已扁平化"，但代码使用嵌套路径提取。

**设计文档**：`v0.3.0/detailed-design/local-mode/sqlite-schema.md` §2.3.2
- converter 输出的 `data` 字段已扁平化，`name`/`description`/`tags` 位于顶层

**实际实现**：`packages/storage/src/sqlite-store.ts` FTS 触发器
```sql
COALESCE(json_extract(NEW.data, '$.name'), '') || ...
```
- 使用 `json_extract(NEW.data, '$.name')`，说明 name 在 data 对象内部

**影响**：开发者不清楚 data 字段的真实结构

**来源**：Sonnet 报告

---

### 3.28 [功能] Checklist 不参与同步导致多人协作可见性问题

**问题描述**：Checklist 不参与同步，多人协作时可能看到过期内容。

**设计文档**：`v0.3.0/detailed-design/skills/checklist-format.md` 开头说明
- Checklist 不参与同步，Agent 通过 MCP 直接操作数据库
- CLI 的 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 Markdown 文件

**问题场景**：
1. 用户 A 在机器 A 上更新 Checklist（写入数据库）
2. 用户 B 在机器 B 上执行 `c4a sync`
3. 用户 B 的本地 `checklist.md` 不会更新（因为不参与同步）
4. 用户 B 需要手动执行 `c4a feat render` 才能看到最新的 Checklist

**建议**：`c4a sync` 后自动执行 `c4a feat render` 更新本地 Checklist

**来源**：Sonnet 报告

---

## 4. P3 - 低优先级问题

> 这些问题影响较小，可延后修复。

### 4.1 [CLI] 用户 CLI 缺少 rollback 命令（计划延后）

**问题描述**：设计文档注明 `c4a rollback <feat-id>` 为 v0.4.0 计划，当前不纳入 v0.3.0 待修复。

**状态**：计划延后（v0.4.0）
**来源**：计划文档（summary.md Part 08）

---

### 4.2 [CLI] debug 子菜单命令 ID 不一致

**问题描述**：菜单中子项标签与命令 ID 不一致

**来源**：Claude、Sonnet 报告

---

### 4.3 [配置] mcp-extract 环境变量命名通用化

**问题描述**：代码使用通用模式生成环境变量名，与设计文档明确列出的变量名不完全一致

**来源**：Claude 报告

---

### 4.4 [类型] Storage 类型标注与设计不一致

**问题描述**：relations 表查询返回的 `from_project` 和 `to_project` 类型标注为 `string | null`

**来源**：Claude、Sonnet 报告

---

### 4.5 [安全] Core 安全工具未被充分使用

**问题描述**：`validatePath`、`safeReadFile`、`escapeHtml`、`escapeMermaidString` 已实现但未被使用

**来源**：Claude、Sonnet 报告

---

### 4.6 [代码质量] CLI 包的 buildErrorResponse 签名不一致

**问题描述**：两个 CLI 包的 buildErrorResponse 函数签名不一致

**来源**：Claude、Sonnet 报告

---

### 4.7 [代码质量] SQLiteStore 单例模式配置不一致问题

**问题描述**：后续调用 `getInstance()` 传入的 config 会被忽略

**来源**：Sonnet 报告

---

### 4.8 [代码质量] FTS5 索引提取字段过于简化

**问题描述**：FTS 索引只提取 name, description, tags，遗漏了 ADR 的 title/context/decision 等

**来源**：Sonnet 报告

---

### 4.9 [代码质量] graph_cache 表没有清理机制

**问题描述**：有 `expires_at` 字段但没有定期清理过期缓存的逻辑

**来源**：Sonnet 报告

---

### 4.10 [文档] Checklist 结构与文档不一致

**问题描述**：文档示例按阶段 `phases` 组织，但实际 schema 为 `items`

**状态**：已修复（文档已统一为 `items`）
**来源**：Codex 报告 + 现状对照代码

---

### 4.11 [文档] JSON Schema 中的 relationships 字段设计不一致

**问题描述**：JSON Schema 定义了 `relationships` 字段，但 concepts.md 说明关系由 relations 表维护

**来源**：Sonnet 报告

---

### 4.12 [文档] 空的中间件文件

**问题描述**：`packages/storage-backend/src/middleware/permission_check.py` 文件为空

**来源**：Gemini 报告

---

### 4.13 [类型] ProposalIdSchema 允许 null 和 optional 同时存在

**问题描述**：类型是 `string | null | undefined`，增加使用复杂度

**来源**：Sonnet 报告

---

### 4.14 [文档] 设计文档碎片化/追溯链接缺失

**问题描述**：设计文档过度拆分，缺少代码追溯链接。

**观察**：
- `detailed-design/` 目录下有 30+ 个设计文档
- 很多文档只有几百行，且相互引用频繁
- 设计文档中很少有指向具体代码文件的链接

**影响**：
- 学习成本高
- 容易遗漏关键信息
- 开发者需要手动搜索代码才能找到实现

**建议**：
- 考虑合并一些高度相关的文档
- 在设计文档中添加"实现位置"章节

**来源**：Sonnet 报告

---

### 4.15 [文档] 设计文档用词不当

**问题描述**：设计文档中大量使用"建议"、"推荐"等词汇，但实际是必需定义。

**观察**：
- "输入（建议）"
- "返回（JSON，建议）"
- "检查项（推荐）"

**问题**：这些标记为"建议"的内容实际上是 MCP 工具的必需定义，使用"建议"会让开发者误以为可以省略或修改。

**建议**：将"建议"改为"定义"或"规范"

**来源**：Sonnet 报告

---

### 4.16 [设计] LLM 能力假设过高

**问题描述**：设计文档假设了 Agent 能力超出当前 LLM 的实际能力。

**观察**：设计文档假设 Agent 能够：
- 自动识别用户意图并路由到正确的 Skill
- 在多步骤编排中正确维护上下文
- 理解复杂的业务语义并做出决策
- 自动检测架构变更并提示创建 ADR

**问题**：这些能力超出了当前 LLM 的稳定性，实际使用中可能出现路由错误、上下文丢失、决策失误等问题。

**建议**：
- 在设计文档中增加"限制说明"章节
- 提供更多的用户确认点，而非完全自动化

**来源**：Sonnet 报告（主观判断）

---

## 5. 按模块分类汇总

### 5.1 packages/storage

| 问题 | 优先级 | 来源 |
|------|--------|------|
| SQL JOIN 条件风格不一致 | P0 | Claude |
| CONTAINS 关系未自动建立（已修复） | P0 | Gemini |
| Local Mode degraded 标志错误（已修复） | P1 | Claude |
| relations 表可能存储 NULL 值 | P2 | Claude |
| source_project 缺失时处理不符合设计 | P2 | Sonnet |
| 类型标注 string \| null 与设计不符 | P3 | Claude |

### 5.2 packages/mcp-store

| 问题 | 优先级 | 来源 |
|------|--------|------|
| c4a_store_save 参数约束未落地（部分修复） | P0 | Codex |
| 错误响应格式不完整 | P1 | Claude, Codex |
| 错误码硬编码 | P1 | Claude, Gemini |
| 缺少 request_id 生成 | P2 | Claude |
| 缺少 recoverable_actions | P2 | Claude |

### 5.3 packages/mcp-query

| 问题 | 优先级 | 来源 |
|------|--------|------|
| 参数命名 type_filter vs scope | P1 | Claude |
| 缺少 source_project 参数定义（已修复） | P2 | Claude |
| 缺少 max_depth_allowed 字段 | P2 | Claude |
| 降级逻辑重复 | P2 | Claude |

### 5.4 packages/mcp-visual

| 问题 | 优先级 | 来源 |
|------|--------|------|
| 工具暴露策略不一致（8个工具不应暴露） | P1 | Claude, Codex |
| 存储路径不一致 | P1 | Claude |

### 5.5 packages/mcp-extract

| 问题 | 优先级 | 来源 |
|------|--------|------|
| copy-wasm.js 误导性代码 | P2 | Claude |
| 环境变量命名通用化 | P3 | Claude |

### 5.6 packages/storage-backend

| 问题 | 优先级 | 来源 |
|------|--------|------|
| 权限检查已覆盖 Feat（基础版，已修复） | P0 | Claude, Codex |
| 路径穿越校验缺失（已修复） | P0 | Codex |
| Server 端删除语义不符（已修复） | P0 | Codex |
| Feat 生命周期与合并逻辑未实现 | P1 | Codex |
| 状态机校验未实现 | P1 | Codex |
| 关系解析未实现 | P2 | Codex |
| 变更历史返回空数组 | P2 | Codex |
| 缺少 C4A_PERMISSION_ALLOW_EMPTY 配置（部分修复） | P2 | Claude |

### 5.7 packages/cli & packages/cli-dev

| 问题 | 优先级 | 来源 |
|------|--------|------|
| CLI 模板与 DSL Schema 不一致 | P0 | Codex |
| 调试命令缺少依赖检查 | P1 | Claude |
| Server/Remote 模式传输与配置不一致 | P1 | Codex |
| start.sh 有硬性依赖检查 | P2 | Claude |
| c4a init 输出文件与文档不一致 | P2 | Codex |
| c4a init 未写入 server.url 配置 | P2 | Codex |
| c4a init 未创建完整目录结构 | P2 | Codex |
| 缺少 rollback 命令（延后 v0.4.0） | P3 | 计划文档 |
| debug 子菜单命令 ID 不一致 | P3 | Claude |

### 5.8 packages/core

| 问题 | 优先级 | 来源 |
|------|--------|------|
| MCP 包错误码未定义 | P2 | Claude, Gemini |
| ErrorResponse 类型定义重复 | P2 | Claude |
| recoverable_actions 未实现 | P2 | Claude |
| 安全工具未被充分使用 | P3 | Claude |
| CLI 包 buildErrorResponse 签名不一致 | P3 | Claude |

### 5.9 Docker/配置

| 问题 | 优先级 | 来源 |
|------|--------|------|
| 服务端口文档与实现不一致 (8050 vs 8055) | P1 | Codex |
| Server 模式缺少 visual MCP 服务 | P1 | Codex |

### 5.10 跨模块/架构

| 问题 | 优先级 | 来源 |
|------|--------|------|
| Remote 模式仅部分实现 | P0 | Sonnet, Codex |
| ADR 检查逻辑仅 Local 部分实现 | P0 | Sonnet |
| c4a_store_validate 已实现 Server 基础检查 | P0 | Sonnet |
| Server/Remote 同步流程不可用（计划延后） | P2 | Codex |
| Skills 执行引擎/proposal_id 注入缺失 | P1 | Sonnet |
| 内容哈希计算口径不一致 | P2 | Codex |

### 5.11 文档问题

| 问题 | 优先级 | 来源 |
|------|--------|------|
| spec_uri 同步范围描述矛盾 | P2 | Sonnet |
| expected_content_hash 计算口径未定义 | P2 | Sonnet |
| Checklist 清理时机描述不一致 | P2 | Sonnet |
| scope:project/ 与 project:{project_id}/ 语义冲突 | P2 | Sonnet |
| feats.project_ids 字段语义/格式不明 | P2 | Sonnet |
| data 扁平化描述与代码不一致 | P2 | Sonnet |
| Checklist 不参与同步导致多人协作可见性问题 | P2 | Sonnet |
| feats 表缺少设计文档 | P2 | Sonnet |
| workflow_states 和 compensation_logs 表未在文档中说明 | P2 | Sonnet |
| entities 表增加了未文档化的字段 | P2 | Sonnet |
| 设计文档碎片化/追溯链接缺失 | P3 | Sonnet |
| 设计文档用词不当 | P3 | Sonnet |
| LLM 能力假设过高 | P3 | Sonnet |

---

## 6. 实现完成度评估

> **注意**：以下完成度为主观估算值，基于四份报告的综合分析。

基于四份报告的综合分析，v0.3.0 各功能模块的实现完成度如下：

| 功能模块 | 设计完成度 | 实现完成度 | 差距说明 |
|---------|-----------|-----------|---------|
| **核心 CRUD** | 100% | 80% | 基本实现，ADR 检查仅 Local 生效，状态机校验缺失，参数约束未落地 |
| **Feat 生命周期** | 100% | 65% | 基本流程完整，权限检查缺失，合并逻辑未实现 |
| **同步机制** | 100% | 50% | Local 模式基本完整，Server 模式同步流程不可用，哈希口径不一致 |
| **权限控制** | 100% | 20% | 实体 CRUD 已接入权限校验，Feat/跨项目审批缺失，路径安全校验缺失 |
| **Skills 系统** | 100% | 60% | 提示词完整，模板变量注入机制缺失 |
| **一致性检查** | 100% | 40% | Local 已实现，Server 端仍是 stub |
| **悬空引用** | 100% | 20% | 设计完整，实现很少 |
| **可视化** | 100% | 70% | 基本实现，暴露策略未实现，路径不一致 |
| **Remote 模式** | 100% | 20% | 复用 ServerAdapter，remote MCP 配置不完整 |

**总体实现完成度：约 50-60%**（主观估算）

---

## 7. 修复建议

### 7.1 立即修复（P0）

1. **权限检查** - 在 `storage-backend/routes/feat.py` 中集成 `PermissionService`
2. **SQL JOIN 条件** - 确认 `IS` vs `=` 是否存在实际 bug，统一风格
3. **CONTAINS 关系** - 在 `parseRelations` 中添加基于 `system_id`/`container_id` 的自动关系创建
4. **ADR 检查** - 补齐 `adr_policy` 配置读取与 Server 端实现
5. **validate 工具** - 补齐 Server 端 validate 检查逻辑
6. **Remote 模式** - 补齐 remote MCP 配置（query/visual）或在文档中明确限制
7. **CLI 模板** - 统一模板格式与 JSON Schema
8. **参数约束** - 在 MCP 层启用互斥校验，并补齐 `id` 自动生成

### 7.2 尽快修复（P1）

1. **mcp-query 参数命名** - 将 `scope` 改为 `type_filter` 或更新设计文档
2. **mcp-visual 工具暴露** - 实现工具可见性分层控制
3. **mcp-visual 存储路径** - 修正 `STORAGE_PATHS` 常量
4. **错误响应格式** - 增强 `buildErrorResponse()` 函数
5. **服务端口** - 统一文档和代码中的端口配置
6. **visual MCP 服务** - 在 Docker Compose 中添加 visual 服务
7. **Server/Remote 传输** - 统一 MCP 调用方式
8. **Skills 执行引擎** - 实现模板变量注入机制

### 7.3 计划修复（P2）

1. 错误码统一定义
2. 类型定义去重
3. 文档补充（feats 表、workflow_states 表、spec_uri 同步范围等）
4. 悬空引用处理
5. 内容哈希计算统一
6. source_project 缺失时的错误处理
7. Checklist 清理时机统一
8. expected_content_hash 计算口径定义
9. Server/Remote 同步执行逻辑（按计划延后 v0.4.0）

### 7.4 后续版本（P3）

1. rollback 命令（v0.4.0 计划，不纳入本次修复）
2. 代码质量优化
3. 安全工具使用
4. 设计文档整合与追溯链接
5. 文档用词规范化

---

## 统计汇总

> **说明**：下表统计包含“已修复/部分修复”条目，尚未重新剔除。

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P0 - 阻塞性问题 | 11 | 16% |
| P1 - 高优先级问题 | 12 | 18% |
| P2 - 中优先级问题 | 28 | 41% |
| P3 - 低优先级问题 | 17 | 25% |
| **总计** | **68** | **100%** |

---

## 8. 待修复清单（仅未完成）

> 说明：已完成项用 [x] 标记。

### P0 - 阻塞性问题

| 模块 | 问题 | 备注 |
|------|------|------|
| - | 暂无 | - |

### P1 - 高优先级问题

| 模块 | 问题 | 备注 |
|------|------|------|
| mcp-query | [x] 参数命名不一致 | `type_filter` vs `scope` ✅ 已修复 |
| mcp-visual | [x] 工具暴露策略不一致 | 应限制仅 2 个工具暴露 ✅ 已修复 |
| mcp-visual | [x] 存储路径不一致 | `cache/visual/temp` 等需对齐 ✅ 已修复 |
| mcp-store | [x] 错误响应格式不完整 | `buildErrorResponse()` 缺字段 ✅ 已修复 |
| cli-dev | [x] 调试命令缺依赖检查 | debug:* 未调用 checkDependencies ✅ 已修复 |
| 文档/配置 | [x] 服务端口不一致 | 8050 vs 8055 ✅ 已修复 |
| docker | [x] Server 缺 visual MCP | docker-compose 未包含 visual ✅ 已修复 |
| storage-backend | [x] Feat 生命周期/合并缺失 | `feat_merge`/`feat_lifecycle` 未实现 ✅ 已修复 |
| storage/storage-backend | [x] 状态机校验未实现 | published 仍可被直接改 ✅ 已修复 |
| cli | [x] Server/Remote 传输不一致 | Server 仍走 stdio ✅ 已修复 |
| skills | [x] proposal_id 注入缺失 | 模板变量未注入 ✅ 已修复 |

### P2 - 中优先级问题

| 模块 | 问题 | 备注 |
|------|------|------|
| - | 暂无 | - |

### P3 - 低优先级问题

| 模块 | 问题 | 备注 |
|------|------|------|
| cli-dev | [x] debug 子菜单 ID 不一致 | menu 与命令不匹配 |
| mcp-extract | [x] 环境变量命名通用化 | 与文档不一致 |
| storage | [x] relations 类型标注不一致 | string \| null |
| core | [x] 安全工具未使用 | validatePath/escapeHtml 等 |
| cli | [x] buildErrorResponse 签名不一致 | cli/cli-dev |
| storage | [x] SQLiteStore 单例配置不一致 | getInstance 忽略后续配置 |
| storage | [x] FTS 索引字段过简 | ADR/Process 字段未索引 |
| storage | [x] graph_cache 无清理机制 | expires_at 未使用 |
| 文档 | [x] JSON Schema relationships 冲突 | DSL vs relations 表 |
| storage-backend | [x] permission_check.py 为空 | 未使用中间件 |
| mcp-store | [x] ProposalIdSchema 过宽 | null + optional |
| 文档 | [x] 设计文档碎片化 | 缺追溯链接 |
| 文档 | [x] 文档用词“建议”误导 | 实际是规范 |
| 文档/设计 | [x] LLM 能力假设过高 | 需限制说明 |

## 附录：检查来源说明

| 来源 | 模型 | 特点 |
|------|------|------|
| Claude | Claude Opus 4.5 | 深度代码分析，SQL 问题发现 |
| Gemini | Gemini 3 Pro | 架构一致性，CONTAINS 关系问题 |
| Sonnet | Claude Sonnet 3.5 | 全面覆盖，文档与代码对比 |
| Codex | Codex | 配置一致性，Server 模式问题 |

> **说明**：部分问题的"来源"标注可能不完全准确，仅供参考。实际问题发现可能来自多个模型的交叉验证。

**报告生成日期**：2026-02-02
