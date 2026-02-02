# 详细设计索引与实现映射

本文件用于减少文档碎片化带来的查找成本，并提供“设计 → 实现”的快速追溯路径。

## 模块索引

- **MCP 工具**：`mcp-tools.md` 与 `mcp/*.md`
- **CLI**：`cli-design.md` 与 `cli/*.md`
- **Skills**：`skills-design.md` 与 `skills/*.md`
- **数据操作**：`data-operations.md` 与 `data-ops/*.md`
- **Local 模式**：`local-mode.md` 与 `local-mode/*.md`
- **权限与错误**：`permissions-and-errors.md` 与 `permissions/*.md`

## 实现位置速查

| 设计域 | 关键文档 | 主要实现位置 |
|------|---------|-------------|
| MCP Store | `mcp/store-crud.md` `mcp/store-feat-lifecycle.md` `mcp/store-sync.md` `mcp/store-utils.md` | `packages/mcp-store/src` `packages/storage/src/lite-adapter` `packages/storage-backend/src/routes/entities.py` `packages/storage-backend/src/routes/feat.py` `packages/storage-backend/src/routes/utils.py` `packages/storage-backend/src/routes/sync.py` |
| MCP Query | `mcp/query.md` | `packages/mcp-query/src` `packages/storage/src/lite-adapter` `packages/storage-backend/src/routes/search.py` `packages/storage-backend/src/routes/graph.py` |
| MCP Visual | `mcp/visual.md` | `packages/mcp-visual/src` |
| MCP Extract | `mcp/code.md` | `packages/mcp-extract/src` |
| CLI（用户） | `cli-design.md` `cli/user-cli.md` | `packages/cli/src` |
| CLI（开发） | `cli/dev-cli.md` | `packages/cli-dev/src` `start.sh` |
| Local 模式 | `local-mode/sqlite-schema.md` `local-mode/graph-query.md` | `packages/storage/src/sqlite-store.ts` `packages/storage/src/in-memory-graph.ts` `packages/storage/src/lite-adapter` |
| 数据操作 | `data-ops/*.md` | `packages/storage/src/data-ops` |
| 权限与错误 | `permissions/*.md` | `packages/storage-backend/src/services/permission.py` `packages/storage-backend/src/dependencies.py` `packages/core/src/types/errors.ts` `packages/cli/src/utils/errorResponse.ts` |
| Skills | `skills/*.md` | `prompts/skills` `prompts/skill-templates` |

## 追溯规范（后续文档维护）

1. 设计文档新增或修改时，优先补充 “实现位置” 引用
2. 核心流程（存储、同步、权限）必须指向至少一个代码入口文件
3. 如果实现尚未落地，明确标注 “未实现/计划中”
