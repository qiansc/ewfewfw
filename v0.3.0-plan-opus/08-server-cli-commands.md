# Part 08 Server CLI Commands - Agent 提示词

> 执行顺序：Agent-0（前置验证）→ Agent-1（CLI 实现）→ Agent-2（集成收尾）

---

## 概述

Part 13 Server Mode 已完成，Part 07 Data Ops 已完成。现在需要补充 Part 08 User CLI 中与 Server 模式相关的命令。

**当前状态**：
- ✅ Part 07 Data Ops 全部完成（18/18 任务）
- ✅ Part 08 User CLI 基础完成（20/21 任务，8.13 rollback 为 v0.4.0）
- ✅ Part 13 Server Mode 全部完成（14/14 任务）
- ✅ `/utils/check-consistency` 端点已实现
- ✅ `/utils/repair` 端点已实现（支持 scope: all|neo4j|milvus）
- ✅ `c4a server check-permissions` 已实现（Part 13 中完成）

**待完成任务**：

| 子模块 | 设计文档 | 核心能力 | 任务编号 |
|--------|---------|---------|---------|
| check-consistency 命令 | [cross-project-transaction.md](../v0.3.0/detailed-design/data-ops/cross-project-transaction.md) §6.6 | 检查 MongoDB/Neo4j/Milvus 一致性 | 08S.1 |
| rebuild-neo4j 命令 | [cross-project-transaction.md](../v0.3.0/detailed-design/data-ops/cross-project-transaction.md) §6.6 | 从 MongoDB 重建 Neo4j | 08S.2 |
| rebuild-milvus 命令 | [cross-project-transaction.md](../v0.3.0/detailed-design/data-ops/cross-project-transaction.md) §6.6 | 从 MongoDB 重建 Milvus | 08S.3 |
| 文档与验证 | - | summary.md 更新 | 08S.4 |

**依赖关系**：
- 依赖 Part 13 Server Mode（已完成）
- 后端 API 已就绪：`/utils/check-consistency`、`/utils/repair`

**关键问题说明**：
- ⚠️ **sync-pending 命令移除**：设计文档要求"同步待处理实体"，但后端 `/utils/repair` 实际是全量重建（遍历所有关系/实体），无法按 `sync_status` 过滤。为避免语义不一致和高成本操作风险，移除此命令。用户可使用 `rebuild-neo4j` / `rebuild-milvus` 明确重建意图。
- ⚠️ **权限系统集成**：所有命令支持 `--user` 参数传递用户 ID，默认从全局配置读取。后端强制校验权限，避免 403 错误。

---

## Agent-0：前置验证（必须先完成）

```
你作为 v0.3.0-plan-opus/08-server-cli-commands.md 里的 Agent-0 负责前置验证任务。

请执行 Part 08 Server CLI Commands 的前置验证任务：

1. 验证后端 API 已就绪（注意：若权限表已存在数据，需确保 test 用户有权限或使用有权限的用户）：
   - curl -X POST http://localhost:8055/utils/check-consistency -H "Content-Type: application/json" -H "X-User-ID: test" -d '{}'
   - curl -X POST http://localhost:8055/utils/repair -H "Content-Type: application/json" -H "X-User-ID: test" -d '{"scope": "all", "dry_run": true}'
   - 若返回 403，请更换为有权限的用户 ID 或清空权限表

2. 阅读现有 CLI 实现：
   - packages/cli/src/commands/server.ts（当前 server 子命令）
   - packages/cli/src/commands/local.ts（参考 local 子命令实现）

3. 确认设计文档要求：
   - v0.3.0/detailed-design/data-ops/cross-project-transaction.md §6.6
   - 需要实现的命令：
     - c4a server check-consistency
     - c4a server rebuild-neo4j
     - c4a server rebuild-milvus
   - sync-pending 移除原因：后端 /utils/repair 是全量重建，无法按 sync_status 过滤

4. 产物：
   - 确认后端 API 可用
   - 记录当前 server.ts 已有子命令
   - 列出需要新增的子命令

完成后告诉我，我会启动 Agent-1 执行。
```

---

## Agent-1：CLI 命令实现（08S.1-08S.4）

```
你作为 v0.3.0-plan-opus/08-server-cli-commands.md 里的 Agent-1 负责实现 CLI 命令。

请在 packages/cli/src/commands/server.ts 中添加以下子命令：

0. 通用：用户 ID 获取逻辑（所有命令共用）：
   ```typescript
   // 在 serverCommand 函数开头添加
   function resolveUserId(options: Record<string, unknown>): string {
     // 使用 --user 参数，否则使用默认值
     if (typeof options.user === "string" && options.user) {
       return options.user;
     }
     // 默认值（无配置来源，GlobalConfig 当前不支持 user_id）
     return "cli-user";
   }
   ```

1. 任务 08S.1 - check-consistency 命令：
   - 调用 `/utils/check-consistency` 端点
   - 支持 --project 参数过滤项目
   - 支持 --user 参数指定用户 ID
   - 支持 --format=json 输出格式

   ```typescript
   case "check-consistency": {
     const projectId = typeof options.project === "string" ? options.project : undefined;
     const format = options.format === "json" ? "json" : "text";
     const userId = resolveUserId(options);

     const baseUrl = resolveStorageBackendUrl(config ?? undefined);
     const response = await fetch(`${baseUrl}/utils/check-consistency`, {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         "X-User-ID": userId,
       },
       body: JSON.stringify({ project_id: projectId }),
     });

     if (!response.ok) {
       const errorText = await response.text();
       emitError(buildErrorResponse("C4A-SERVER-013", `一致性检查失败: ${errorText}`));
       process.exitCode = 1;
       return;
     }

     const result = await response.json() as {
       total: number;
       synced: number;
       pending: number;
       failed: number;
       no_status: number;
       details: Array<{ id: string; neo4j: string; milvus: string }>;
     };

     if (format === "json") {
       io.log(JSON.stringify(result, null, 2));
       return;
     }

     io.log("数据一致性检查结果:");
     io.log(`  总计: ${result.total} 个实体`);
     io.log(`  ✅ 已同步: ${result.synced}`);
     io.log(`  ⏳ 待同步: ${result.pending}`);
     io.log(`  ❌ 失败: ${result.failed}`);
     io.log(`  ⚠️  无状态: ${result.no_status}`);

     if (result.details.length > 0) {
       io.log("");
       io.log("待同步实体:");
       for (const item of result.details.slice(0, 10)) {
         io.log(`  - ${item.id}: Neo4j=${item.neo4j}, Milvus=${item.milvus}`);
       }
       if (result.details.length > 10) {
         io.log(`  ... 还有 ${result.details.length - 10} 个`);
       }
     }
     return;
   }
   ```

2. 任务 08S.2 - rebuild-neo4j 命令：
   - 调用 `/utils/repair` 端点（scope: neo4j）
   - 支持 --user 参数指定用户 ID
   - 支持 --format=json 输出格式
   - 需要确认提示

   ```typescript
   case "rebuild-neo4j": {
     const confirmed = options.yes === true ? true : await confirm("重建 Neo4j 将重新同步所有关系数据，确认继续？");
     if (!confirmed) {
       io.log("已取消操作。");
       return;
     }

     const format = options.format === "json" ? "json" : "text";
     const userId = resolveUserId(options);
     const baseUrl = resolveStorageBackendUrl(config ?? undefined);

     if (format === "text") {
       io.log("正在重建 Neo4j 数据...");
     }

     const response = await fetch(`${baseUrl}/utils/repair`, {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         "X-User-ID": userId,
       },
       body: JSON.stringify({ scope: "neo4j" }),
     });

     if (!response.ok) {
       const errorText = await response.text();
       emitError(buildErrorResponse("C4A-SERVER-014", `Neo4j 重建失败: ${errorText}`));
       process.exitCode = 1;
       return;
     }

     const result = await response.json() as {
       success: boolean;
       scanned: number;
       inconsistencies: Array<{ entity_id: string; issue: string; fixed: boolean }>;
       stats: { neo4j_fixed: number; milvus_fixed: number; failed: number };
     };

     if (format === "json") {
       io.log(JSON.stringify(result, null, 2));
       return;
     }

     io.log("✅ Neo4j 重建完成");
     io.log(`已同步 ${result.stats?.neo4j_fixed ?? 0} 个关系`);
     if (result.stats?.failed > 0) {
       io.log(`⚠️  失败 ${result.stats.failed} 个`);
     }
     return;
   }
   ```

3. 任务 08S.3 - rebuild-milvus 命令：
   - 调用 `/utils/repair` 端点（scope: milvus）
   - 支持 --user 参数指定用户 ID
   - 支持 --format=json 输出格式
   - 需要确认提示

   ```typescript
   case "rebuild-milvus": {
     const confirmed = options.yes === true ? true : await confirm("重建 Milvus 将重新生成所有向量数据，确认继续？");
     if (!confirmed) {
       io.log("已取消操作。");
       return;
     }

     const format = options.format === "json" ? "json" : "text";
     const userId = resolveUserId(options);
     const baseUrl = resolveStorageBackendUrl(config ?? undefined);

     if (format === "text") {
       io.log("正在重建 Milvus 数据...");
     }

     const response = await fetch(`${baseUrl}/utils/repair`, {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         "X-User-ID": userId,
       },
       body: JSON.stringify({ scope: "milvus" }),
     });

     if (!response.ok) {
       const errorText = await response.text();
       emitError(buildErrorResponse("C4A-SERVER-015", `Milvus 重建失败: ${errorText}`));
       process.exitCode = 1;
       return;
     }

     const result = await response.json() as {
       success: boolean;
       scanned: number;
       inconsistencies: Array<{ entity_id: string; issue: string; fixed: boolean }>;
       stats: { neo4j_fixed: number; milvus_fixed: number; failed: number };
     };

     if (format === "json") {
       io.log(JSON.stringify(result, null, 2));
       return;
     }

     io.log("✅ Milvus 重建完成");
     io.log(`已同步 ${result.stats?.milvus_fixed ?? 0} 个向量`);
     if (result.stats?.failed > 0) {
       io.log(`⚠️  失败 ${result.stats.failed} 个`);
     }
     return;
   }
   ```

4. 更新 printHelp 函数：
   ```typescript
   function printHelp(io: CommandIO): void {
     io.log("c4a server <command>");
     io.log("可用子命令:");
     io.log("  status              查看服务状态");
     io.log("  restart             重启服务");
     io.log("  stop                停止服务");
     io.log("  logs [service]      查看日志");
     io.log("  backup              备份数据");
     io.log("  restore <file>      恢复数据");
     io.log("  clean               清理数据");
     io.log("  check-permissions   检查备份文件权限");
     io.log("  check-consistency   检查数据一致性");
     io.log("  rebuild-neo4j       重建 Neo4j 数据");
     io.log("  rebuild-milvus      重建 Milvus 数据");
     io.log("");
     io.log("通用参数:");
     io.log("  --user <id>         指定用户 ID（默认从配置读取）");
     io.log("  --format json       JSON 格式输出");
   }
   ```

5. 添加测试用例：
   - packages/cli/src/__tests__/server.test.ts
   - 测试 check-consistency、rebuild-neo4j、rebuild-milvus
   - Mock fetch 和 confirm 依赖
   - 注意：项目使用 bun:test，不是 Vitest

   ```typescript
   import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
   import { serverCommand } from "../commands/server.js";

   describe("server commands", () => {
     const mockIo = { log: mock(() => {}), error: mock(() => {}) };
     const mockLoadConfig = mock(async () => ({
       server: { installed_at: "2026-01-01T00:00:00Z", url: "http://localhost:8055" },
     }));
     const originalFetch = globalThis.fetch;

     afterEach(() => {
       globalThis.fetch = originalFetch;
     });

     it("check-consistency with --user", async () => {
       const mockFetch = mock(() =>
         Promise.resolve({
           ok: true,
           json: async () => ({ total: 10, synced: 8, pending: 2, failed: 0, no_status: 0, details: [] }),
         } as Response)
       );
       globalThis.fetch = mockFetch;

       await serverCommand(["check-consistency", "--user", "test-user"], {
         io: mockIo,
         loadConfig: mockLoadConfig,
         emitError: mock(() => {}),
       });

       expect(mockFetch).toHaveBeenCalledWith(
         expect.stringContaining("/utils/check-consistency"),
         expect.objectContaining({
           headers: expect.objectContaining({ "X-User-ID": "test-user" }),
         })
       );
     });

     it("rebuild-neo4j with --yes and --format=json", async () => {
       const mockFetch = mock(() =>
         Promise.resolve({
           ok: true,
           json: async () => ({ success: true, scanned: 100, stats: { neo4j_fixed: 100, failed: 0 }, inconsistencies: [] }),
         } as Response)
       );
       globalThis.fetch = mockFetch;

       await serverCommand(["rebuild-neo4j", "--yes", "--format", "json"], {
         io: mockIo,
         loadConfig: mockLoadConfig,
         emitError: mock(() => {}),
       });

       expect(mockIo.log).toHaveBeenCalledWith(expect.stringContaining('"success": true'));
     });
   });
   ```

6. 验证：
   ```bash
   # 类型检查
   bun run typecheck

   # 单元测试
   bun run --filter @c4a/cli test

   # 手动测试（需要 Server 模式运行）
   c4a server check-consistency --user admin
   c4a server rebuild-neo4j --yes --user admin
   c4a server rebuild-milvus --yes --format json --user admin
   ```
```

---

## Agent-2：集成收尾（等待 Agent-1 完成）

```
你作为 v0.3.0-plan-opus/08-server-cli-commands.md 里的 Agent-2 负责集成收尾任务。

请执行 Part 08 Server CLI Commands 的集成收尾任务：

1. 验证所有命令实现：
   - c4a server check-consistency
   - c4a server rebuild-neo4j
   - c4a server rebuild-milvus

2. 运行全量测试：
   ```bash
   bun run typecheck
   bun run --filter @c4a/cli test
   ```

3. 任务 08S.4 - 更新 summary.md：
   - 在 Part 08 备注中添加补充说明
   - 更新 changes/08-user-cli-check-permissions.md 状态

4. 更新 changes/08-user-cli-check-permissions.md：
   - 标记 check-permissions 已完成（Part 13 中实现）
   - 添加新增命令说明
   - 说明 sync-pending 移除原因

5. 验证清单：
   - [x] check-consistency 命令正常工作（含 --user 和 --format=json）
   - [x] rebuild-neo4j 命令正常工作（含 --user 和 --format=json）
   - [x] rebuild-milvus 命令正常工作（含 --user 和 --format=json）
   - [x] 全量测试通过（含 mock 测试）
   - [x] summary.md 已更新

6. 产物：
   - packages/cli/src/commands/server.ts 更新
   - packages/cli/src/__tests__/server.test.ts 更新
   - v0.3.0-plan-opus/summary.md 更新
   - v0.3.0-plan-opus/changes/08-user-cli-check-permissions.md 更新
```

---

## 执行检查清单

| 步骤 | Agent | 任务编号 | 状态 | 完成时间 |
|------|-------|---------|:----:|---------|
| 0 | Agent-0 | 前置验证 | [x] | 2026-02-01 |
| 1 | Agent-1 | 08S.1-08S.3 (CLI 命令) | [x] | 2026-02-01 |
| 2 | Agent-2 | 08S.4 (集成收尾) | [x] | 2026-02-01 |

---

## 任务编号索引

| 编号 | 任务 | Agent | 状态 |
|------|------|-------|:----:|
| 08S.1 | check-consistency 命令 | Agent-1 | [x] |
| 08S.2 | rebuild-neo4j 命令 | Agent-1 | [x] |
| 08S.3 | rebuild-milvus 命令 | Agent-1 | [x] |
| 08S.4 | summary.md 更新 | Agent-2 | [x] |

---

## 已完成任务（无需再做）

以下任务在 Part 13 Server Mode 中已完成：

| 任务 | 实现位置 | 说明 |
|------|---------|------|
| c4a server status | server.ts | 服务状态查看 |
| c4a server restart | server.ts | 重启服务 |
| c4a server stop | server.ts | 停止服务 |
| c4a server logs | server.ts | 查看日志 |
| c4a server backup | server.ts | 备份数据 |
| c4a server restore | server.ts | 恢复数据 |
| c4a server clean | server.ts | 清理数据 |
| c4a server check-permissions | server.ts | 权限预检查 |
| /utils/check-consistency | utils.py | 后端 API |
| /utils/repair | utils.py | 后端 API |

---

## 关键设计决策

### 1. 命令与后端 API 映射

| CLI 命令 | 后端 API | Header |
|----------|---------|--------|
| check-consistency | POST /utils/check-consistency | X-User-ID (必需) |
| rebuild-neo4j | POST /utils/repair | X-User-ID (必需) |
| rebuild-milvus | POST /utils/repair | X-User-ID (必需) |

**Body 参数**：
- check-consistency: `{ project_id?: string }`
- rebuild-neo4j: `{ scope: "neo4j" }`
- rebuild-milvus: `{ scope: "milvus" }`

### 2. 用户 ID 传递

所有命令支持 `--user` 参数指定用户 ID，优先级：
1. `--user` 命令行参数
2. 默认值 `"cli-user"`

> 注：当前 GlobalConfig 不支持 `server.user_id` 字段。如需支持配置文件指定默认用户，需在 v0.4.0 中扩展 GlobalConfig。

### 3. 输出格式

所有命令支持 `--format=json` 参数，便于脚本集成。

### 4. 确认提示

rebuild-neo4j 和 rebuild-milvus 需要用户确认，支持 `--yes` 跳过确认。

### 5. sync-pending 命令移除说明

设计文档要求"同步待处理实体"，但后端 `/utils/repair` 实际是全量重建（遍历所有关系/实体），无法按 `sync_status` 过滤。为避免语义不一致和高成本操作风险，移除此命令。用户可使用 `rebuild-neo4j` / `rebuild-milvus` 明确重建意图。

---

## 与 summary.md 的关联

完成本规划后需要更新 summary.md：

| summary 位置 | 更新内容 |
|-------------|---------|
| Part 08 备注 | 添加 08S.1-08S.4 完成记录 |

---

## Part 07 Data Ops 状态

Part 07 Data Ops 已全部完成（18/18 任务），无需补充工作：

| # | 功能 | 状态 |
|---|------|:----:|
| 7.1-7.4 | 引用解析 + CoW | [x] |
| 7.5-7.8 | 同步导出 | [x] |
| 7.9-7.11 | 冲突回滚 | [x] |
| 7.12-7.14 | 跨项目事务 | [x] |
| 7.15-7.18 | Workflow 恢复 | [x] |

---

## 挂起任务（v0.4.0）

| 任务 | 挂起原因 |
|------|----------|
| c4a rollback | 8.13 为 v0.4.0 计划项 |
