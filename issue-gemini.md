# C4A v0.3.0 设计与实现一致性检查报告

本报告由 Gemini 3 Pro 生成，旨在全面检查 v0.3.0 版本设计文档与最终代码实现的一致性，并指出代码中不合理的地方。

## 检查范围

- v0.3.0/concepts.md
- v0.3.0/product.md
- v0.3.0/user-stories.md
- v0.3.0/architecture.md
- v0.3.0/detailed-design/ (包括 CLI, Data Ops, Local Mode, MCP, Permissions, Skills 分组)
- 核心代码包：cli, core, storage, mcp-store, mcp-query, storage-backend

## 检查结果汇总

总体而言，代码实现与架构文档高度一致。主要的分层架构（CLI -> MCP -> Adapter -> Storage）、Local/Server 双模式、Feat 隔离机制（包括向量搜索的复合 ID 设计）、Sync 同步逻辑（Local/Server 差异）均已在代码中正确体现。

以下是发现的具体问题：

### 1. 功能缺失 (Functional Gaps)

#### [Critical] Local 模式下层级关系未自动建立
- **文档**: `v0.3.0/concepts.md` §6 提到 `CONTAINS` 关系由 `system_id`/`container_id` 字段自动生成。`v0.3.0/user-stories-validate.md` 也明确记录了此问题为"待改进项"。
- **代码**: `packages/storage/src/lite-adapter/relations.ts` 中的 `parseRelations` 函数实现了 `CORRESPONDS` 和 `REFERENCES` 的自动解析，以及 `relationships` 字段的解析，但**缺失**了基于 `container.system_id` 和 `component.container_id` 自动创建 `CONTAINS` 关系的逻辑。
- **影响**: 用户在定义 System/Container/Component 时，即使填写了 ID 引用，图数据库中也缺乏层级关系，导致 `c4a_query_deps` 和架构图生成功能无法正确反映系统结构。

### 2. 设计与实现不一致 (Inconsistencies)

#### [Minor] MCP Query 错误码硬编码
- **文档**: `v0.3.0/detailed-design/permissions/error-codes.md` 定义了标准错误码（如 `C4A-SYS-003` 等），未定义 `C4A-QUERY-*` 类错误码。
- **代码**: `packages/mcp-query/src/server.ts` 中的 `buildErrorResponse` 函数硬编码了错误码 `C4A-QUERY-001`，未复用 `packages/core/src/types/errors.ts` 中的标准定义。
- **建议**: 使用 `SYS_ERROR_CODES.INTERNAL_ERROR` 或在 `errors.ts` 中正式定义 Query 类错误码。

### 3. 代码质量与清理 (Code Quality & Cleanup)

#### [Minor] 空的中间件文件
- **文件**: `packages/storage-backend/src/middleware/permission_check.py`
- **问题**: 该文件为空。实际的权限检查逻辑似乎已在 `routes/entities.py` 中通过 `services/permission.py` 和 `middleware/auth.py` 实现。
- **建议**: 如果该文件不再使用，应将其删除以避免混淆。

### 4. 文档一致性 (Documentation Consistency)

#### [Info] Contract 和 ADR 状态更新已同步
- **文档**: `v0.3.0/concepts.md` 的附录中记录了 Contract (`implemented`) 和 ADR (`superseded`) 的状态修正。
- **代码**: `packages/core/src/schemas/c4a-contract.schema.json` 和 `c4a-adr.schema.json` 已正确包含这些状态。
- **结论**: 此处文档与代码一致，无需修改。

## 修复建议

### 1. 修复自动关系建立逻辑

在 `packages/storage/src/lite-adapter/relations.ts` 的 `parseRelations` 函数中添加以下逻辑：

```typescript
// Auto-create CONTAINS relation for system_id (Container -> System)
const systemId = isPlainObject(data.system) ? undefined : (data.system_id as string | undefined);
if (entityType === 'container' && systemId) {
  // 注意关系方向：System CONTAINS Container (Outgoing from System to Container)
  // 但当前是在保存 Container，所以是从 System 指向 Container 的 Incoming 关系
  addIncoming(systemId, 'CONTAINS');
}

// Auto-create CONTAINS relation for container_id (Component -> Container)
const containerId = data.container_id as string | undefined;
if (entityType === 'component' && containerId) {
  // Container CONTAINS Component
  addIncoming(containerId, 'CONTAINS');
}
```

### 2. 标准化 MCP Query 错误码

修改 `packages/mcp-query/src/server.ts`，引入 `packages/core/src/types/errors.ts`：

```typescript
import { SYS_ERROR_CODES } from "@c4a/core/types";

function buildErrorResponse(error: unknown): ErrorResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: SYS_ERROR_CODES.INTERNAL_ERROR, // 或其他合适映射
    message,
    timestamp: new Date().toISOString(),
  };
}
```

### 3. 清理 Python 后端
删除 `packages/storage-backend/src/middleware/permission_check.py`。
