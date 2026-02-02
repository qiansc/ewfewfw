# Part 11 Lite 验收清单

**验证时间:** 2026-02-02 08:58
**范围:** Gateway 错误码 + 安全工具 + 统一导出

---

## 1. 关键功能检查

- Gateway 错误码（SYS-006~009）已添加：`packages/core/src/types/errors.ts`
- DSL 注入防护可用：`packages/core/src/utils/security.ts`（`escapeHtml` / `escapeMermaidString`）
- 路径安全校验可用：`packages/core/src/utils/security.ts`（`validatePath` / `safeReadFile`）
- 安全工具测试覆盖：`packages/core/src/utils/__tests__/security.test.ts`
- 统一导出已更新：`packages/core/src/utils/index.ts`、`packages/core/src/index.ts`

## 2. 自动化验证

执行命令：

```bash
bun run test
bun run typecheck
bun run build
```

结果：
- `bun run test` 通过（含 5 个 Server mode integration 相关 skip）
- `bun run typecheck` 通过
- `bun run build` 通过
