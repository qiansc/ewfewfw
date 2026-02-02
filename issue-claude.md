# C4A v0.3.0 设计文档与代码实现一致性检查报告

> 检查日期：2026-02-02
> 检查范围：v0.3.0/architecture.md, concepts.md, user-stories.md, product.md, detailed-design/*

---

## 目录

1. [高优先级问题](#1-高优先级问题)
2. [中优先级问题](#2-中优先级问题)
3. [低优先级问题](#3-低优先级问题)
4. [按模块分类](#4-按模块分类)

---

## 1. 高优先级问题

### 1.1 Storage 适配层 - SQL JOIN 条件错误

**问题描述**：设计文档要求使用空字符串 `''` 代替 NULL（哨兵值模式），但代码在 JOIN 条件中使用 `IS` 操作符（用于 NULL 比较），这在 SQLite 中会导致 JOIN 失败。

**影响**：数据查询结果可能不正确

**涉及文件**：
- `packages/storage/src/lite-adapter/crud-save.ts:153,160` - `AND e.proposal_id IS m.proposal_id`
- `packages/storage/src/lite-adapter/crud-read.ts:151,165,186,196,254` - 多处使用 `IS` 操作符
- 以及其他 20+ 处类似问题

**修复建议**：将所有 `IS` 操作符改为 `=` 操作符

---

### 1.2 mcp-query - 参数命名不一致

**问题描述**：设计文档要求 `c4a_query_search` 参数名为 `type_filter`，但实现使用 `scope`

**设计文档**：`v0.3.0/detailed-design/mcp/query.md:7` - `type_filter?: string`

**实际实现**：`packages/mcp-query/src/schemas.ts:44` - `scope: QuerySearchScopeSchema.optional()`

**影响**：MCP 工具参数名与设计不符，可能导致 Agent 调用时参数错误

---

### 1.3 mcp-query - Local Mode degraded 标志错误

**问题描述**：Local Mode 影响分析总是返回 `degraded: false`，但设计要求返回 `degraded: true`

**设计文档**：`v0.3.0/detailed-design/mcp/query.md:145-146` - 应返回 `degraded: true, degraded_reason: "LOCAL_MODE_SIMPLIFIED"`

**实际实现**：`packages/storage/src/lite-adapter/graph-operations.ts:138` - 返回 `degraded: false`

---

### 1.4 mcp-visual - 工具暴露策略不一致

**问题描述**：设计文档要求只对 Agent 暴露 `c4a_visual_generate` 和 `c4a_visual_render_c4`，其他工具应为内部工具

**设计文档**：`v0.3.0/detailed-design/mcp/visual.md:105-118`

**实际实现**：`packages/mcp-visual/src/server.ts` - 所有 10 个工具都注册为 MCP 工具，对 Agent 完全暴露

**不应暴露的工具**：
- `c4a_visual_render`
- `c4a_visual_list_templates`
- `c4a_visual_render_template`
- `c4a_visual_save`
- `c4a_visual_get_reference`
- `c4a_visual_cleanup`
- `c4a_visual_storage_stats`
- `c4a_visual_get_style`

---

### 1.5 mcp-visual - 存储路径不一致

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

---

### 1.6 storage-backend - Feat 端点缺少权限检查

**问题描述**：`feat.py` 中的所有端点都缺少权限检查机制

**设计文档**：`v0.3.0/detailed-design/permissions/cross-project-auth.md` - 发布 feat 需要所有涉及项目的 admin 权限

**涉及文件**：
- `packages/storage-backend/src/routes/feat.py:67-110` - `feat_lifecycle` 无权限检查
- `packages/storage-backend/src/routes/feat.py:113-115` - `feat_merge` 无权限检查
- `packages/storage-backend/src/routes/feat.py:118-176` - `feat_checklist` 无权限检查
- `packages/storage-backend/src/routes/feat.py:179-209` - `update_workflow_step` 无权限检查

---

### 1.7 错误响应格式不完整

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

---

### 1.8 CLI - 调试命令缺少依赖检查

**问题描述**：`debug:dsl`, `debug:code`, `debug:data` 命令没有调用 `checkDependencies()`

**设计文档**：`v0.3.0/detailed-design/cli/dev-cli.md:167-180`
- `debug:dsl` 应检查 `bun`
- `debug:code` 应检查 `bun`
- `debug:data` 应检查 `uv`

**实际实现**：`packages/cli-dev/src/commands/index.ts:424-446` - 直接运行，不检查依赖

---

## 2. 中优先级问题

### 2.1 mcp-query - 缺少 source_project 参数定义

**问题描述**：`QueryDepsInputSchema` 和 `QueryImpactInputSchema` 中缺少 `source_project` 参数定义

**涉及文件**：`packages/mcp-query/src/schemas.ts:58-64`

**影响**：参数验证可能不完整

---

### 2.2 mcp-query - 缺少 max_depth_allowed 字段

**问题描述**：Local Mode 简化版影响分析返回格式中缺少 `max_depth_allowed` 字段

**设计文档**：`v0.3.0/detailed-design/mcp/query.md:91` - 降级模式返回应包含 `max_depth_allowed: 1`

**实际实现**：`packages/mcp-query/src/tools/impact.ts:47-55` - 没有此字段

---

### 2.3 mcp-query - 降级逻辑重复

**问题描述**：`c4a_query_impact` 中有重复的降级检查逻辑

**涉及文件**：`packages/mcp-query/src/tools/impact.ts:19,38`
- 第 19 行: `if (context.degraded && !isLocal())` 检查后返回错误
- 第 38 行: `if (degraded && !isLocal())` 再次检查并返回相同错误

---

### 2.4 Storage - relations 表可能存储 NULL 值

**问题描述**：relations 表的 UNIQUE 索引包含 `from_project` 和 `to_project` 字段，但这些字段在某些查询中使用 `IFNULL()` 处理，暗示可能存在 NULL 值

**涉及文件**：
- `packages/storage/src/sqlite-store.ts:376-377` - UNIQUE 索引定义
- `packages/storage/src/lite-adapter/relations.ts:458,474` - 使用 `IFNULL()` 处理

---

### 2.5 mcp-extract - Tree-sitter WASM 配置误导

**问题描述**：`copy-wasm.js` 中列出了 TypeScript WASM 文件，但实际不存在也不需要

**涉及文件**：`packages/mcp-extract/scripts/copy-wasm.js:31-51`
- 列出了 `tree-sitter-typescript.wasm` 和 `tree-sitter-tsx.wasm`
- 但 TypeScript 使用编译器 API，不需要 WASM

**修复建议**：清理 copy-wasm.js 中的 TypeScript WASM 相关代码和注释

---

### 2.6 CLI - start.sh 有硬性依赖检查

**问题描述**：设计要求依赖检查按需执行，但 `start.sh` 中仍有强制的 bun 检查

**设计文档**：`v0.3.0/detailed-design/cli/dev-cli.md:139-165` - 依赖检查应按需执行

**实际实现**：`start.sh:32-39` - 强制检查 bun

---

### 2.7 storage-backend - 缺少 C4A_PERMISSION_ALLOW_EMPTY 配置

**问题描述**：`config.py` 中未定义 `C4A_PERMISSION_ALLOW_EMPTY` 环境变量配置

**设计文档**：`v0.3.0/detailed-design/permissions/cross-project-auth.md:1.1.4` - 需要支持此环境变量

**实际实现**：仅在 `PermissionService.__init__` 中直接读取环境变量，未在配置类中定义

---

### 2.8 Core - MCP 包错误码未定义

**问题描述**：MCP 包（extract、query、visual）使用了未在 `core/types/errors.ts` 中定义的错误码

**涉及文件**：
- `packages/mcp-extract/src/server.ts:159` - 使用 `C4A-EXTRACT-001`
- `packages/mcp-query/src/server.ts:135` - 使用 `C4A-QUERY-001`
- `packages/mcp-visual/src/server.ts:368` - 使用 `C4A-VISUAL-001`

---

### 2.9 Core - ErrorResponse 类型定义重复

**问题描述**：多个包重复定义了 ErrorResponse 类型

**涉及文件**：
- `packages/core/src/types/errors.ts:307-320` - 标准定义
- `packages/mcp-store/src/server.ts:510-526` - 重复定义
- `packages/cli/src/utils/errorResponse.ts:5-21` - 重复定义
- `packages/cli-dev/src/utils/errorResponse.ts:5-21` - 重复定义

**修复建议**：统一从 `@c4a/core/types` 导入

---

### 2.10 Core - recoverable_actions 未实现

**问题描述**：错误响应中未填充 `recoverable_actions` 字段

**涉及文件**：
- `packages/core/src/types/errors.ts:353-361` - `C4AError.toResponse()` 没有返回 recoverable_actions
- `packages/mcp-store/src/server.ts:528-535` - buildErrorResponse 没有构建 recoverable_actions

---

## 3. 低优先级问题

### 3.1 CLI - 用户 CLI 缺少 rollback 命令

**问题描述**：设计文档要求实现 `c4a rollback <feat-id>` 命令（v0.4.0 计划）

**设计文档**：`v0.3.0/detailed-design/cli/user-cli.md:244`

**当前状态**：命令列表中不存在 rollback 相关代码

---

### 3.2 CLI - debug 子菜单命令 ID 不一致

**问题描述**：菜单中子项标签与命令 ID 不一致

**设计文档**：`v0.3.0/detailed-design/cli/dev-cli.md:44-46` - 命令为 `debug:code`, `debug:store`, `debug:query`

**实际实现**：`packages/cli-dev/src/menuData.ts:22-26` - 命令 ID 为 `debug:dsl`, `debug:code`, `debug:data`

---

### 3.3 mcp-extract - 环境变量命名通用化

**问题描述**：代码使用通用模式生成环境变量名，与设计文档明确列出的变量名不完全一致

**设计文档**：`v0.3.0/detailed-design/mcp/code.md:69-70` - 明确指定 `C4A_TREE_SITTER_GO_WASM` / `C4A_TREE_SITTER_PYTHON_WASM`

**实际实现**：`packages/mcp-extract/src/parsers/treeSitter.ts:68` - 使用 `C4A_TREE_SITTER_${languageKey.toUpperCase()}_WASM`

**影响**：功能上可行，但与设计文档不完全一致

---

### 3.4 Storage - 类型标注与设计不一致

**问题描述**：relations 表查询返回的 `from_project` 和 `to_project` 类型标注为 `string | null`，但根据设计应始终是字符串

**涉及文件**：`packages/storage/src/lite-adapter/relations.ts:462,464,479,481`

---

### 3.5 Core - 安全工具未被充分使用

**问题描述**：`packages/core/src/utils/security.ts` 中定义了 `validatePath`、`safeReadFile`、`escapeHtml`、`escapeMermaidString`，但在 MCP 包中没有找到这些函数的使用

**设计要求**：
- 涉及文件路径的工具必须使用 `validatePath`
- 所有可视化输出必须使用 `escapeHtml` 或 `escapeMermaidString`

---

### 3.6 Core - CLI 包的 buildErrorResponse 签名不一致

**问题描述**：两个 CLI 包的 buildErrorResponse 函数签名不一致

**涉及文件**：
- `packages/cli/src/utils/errorResponse.ts:23-36` - 接受 `recoverableActions` 参数
- `packages/cli-dev/src/utils/errorResponse.ts:23-33` - 不接受 `recoverableActions` 参数

---

## 4. 按模块分类

### 4.1 packages/storage

| 问题 | 严重性 | 状态 |
|------|--------|------|
| SQL JOIN 条件使用 IS 而非 = | 高 | 待修复 |
| relations 表可能存储 NULL 值 | 中 | 待修复 |
| 类型标注 string \| null 与设计不符 | 低 | 待修复 |
| Local Mode degraded 标志错误 | 高 | 待修复 |

### 4.2 packages/mcp-store

| 问题 | 严重性 | 状态 |
|------|--------|------|
| 错误响应格式不完整 | 高 | 待修复 |
| 错误码硬编码 | 高 | 待修复 |
| 缺少 request_id 生成 | 中 | 待修复 |
| 缺少 recoverable_actions | 中 | 待修复 |

### 4.3 packages/mcp-query

| 问题 | 严重性 | 状态 |
|------|--------|------|
| 参数命名 type_filter vs scope | 高 | 待修复 |
| 缺少 source_project 参数定义 | 中 | 待修复 |
| 缺少 max_depth_allowed 字段 | 中 | 待修复 |
| 降级逻辑重复 | 中 | 待修复 |

### 4.4 packages/mcp-visual

| 问题 | 严重性 | 状态 |
|------|--------|------|
| 工具暴露策略不一致（8个工具不应暴露） | 高 | 待修复 |
| 存储路径不一致 | 高 | 待修复 |

### 4.5 packages/mcp-extract

| 问题 | 严重性 | 状态 |
|------|--------|------|
| copy-wasm.js 误导性代码 | 中 | 待修复 |
| 环境变量命名通用化 | 低 | 可接受 |

### 4.6 packages/storage-backend

| 问题 | 严重性 | 状态 |
|------|--------|------|
| Feat 端点缺少权限检查 | 高 | 待修复 |
| 缺少 C4A_PERMISSION_ALLOW_EMPTY 配置 | 中 | 待修复 |

### 4.7 packages/cli & packages/cli-dev

| 问题 | 严重性 | 状态 |
|------|--------|------|
| 调试命令缺少依赖检查 | 高 | 待修复 |
| start.sh 有硬性依赖检查 | 中 | 待修复 |
| 缺少 rollback 命令 | 低 | v0.4.0 计划 |
| debug 子菜单命令 ID 不一致 | 低 | 待修复 |

### 4.8 packages/core

| 问题 | 严重性 | 状态 |
|------|--------|------|
| MCP 包错误码未定义 | 中 | 待修复 |
| ErrorResponse 类型定义重复 | 中 | 待修复 |
| recoverable_actions 未实现 | 中 | 待修复 |
| 安全工具未被充分使用 | 低 | 待修复 |
| CLI 包 buildErrorResponse 签名不一致 | 低 | 待修复 |

---

## 统计汇总

| 严重性 | 数量 |
|--------|------|
| 高优先级 | 8 |
| 中优先级 | 10 |
| 低优先级 | 6 |
| **总计** | **24** |

---

## 建议修复顺序

1. **立即修复**（影响数据正确性）：
   - Storage SQL JOIN 条件错误
   - mcp-query 参数命名不一致
   - Local Mode degraded 标志错误

2. **尽快修复**（影响功能完整性）：
   - mcp-visual 工具暴露策略
   - storage-backend 权限检查
   - 错误响应格式

3. **计划修复**（影响代码质量）：
   - 错误码统一定义
   - 类型定义去重
   - 安全工具使用

4. **后续版本**：
   - rollback 命令（v0.4.0）
