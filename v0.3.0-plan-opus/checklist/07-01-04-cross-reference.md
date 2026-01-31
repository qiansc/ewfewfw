# Part 07 验收清单: 任务 7.1-7.4

**任务范围:** 7.1 - 7.4（跨层级/跨项目引用）
**设计文档:** v0.3.0/detailed-design/data-ops/cross-reference.md
**验收时间:** 2026-01-31

---

## 设计文档对照

### cross-reference.md §1.4 引用格式规范 (L60-78)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| ReferenceFormat/Scope 类型 | L60-78 | packages/storage/src/data-ops/reference/types.ts L5-55 | ✅ |
| parseReference 解析规则 | L60-78 | packages/storage/src/data-ops/reference/parser.ts L13-68 | ✅ |

### cross-reference.md §1.5 解析优先级 (L70-79)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| 优先级解析 + 歧义提示 | L70-79 | packages/storage/src/data-ops/reference/resolver.ts L199-283 | ✅ |

### cross-reference.md §1.11 悬空引用处理 (L229-327)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| draft/approved 警告 | L233-235 | packages/storage/src/data-ops/reference/validator.ts L31-72 | ✅ |
| published 报错 | L234-235 | packages/storage/src/data-ops/reference/validator.ts L53-72 | ✅ |
| 修复建议生成 | L229-327 | packages/storage/src/data-ops/reference/validator.ts L183-195 | ✅ |

### 集成落地（LiteAdapter）

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| LiteAdapter 调用引用解析优先级 | L70-79 | packages/storage/src/lite-adapter/relations.ts L40-206 | ✅ |
| references 字段解析为 REFERENCES | L42-58 | packages/storage/src/lite-adapter/relations.ts L140-225 | ✅ |
| 保存时写入 resolved/resolve_status | L229-327 | packages/storage/src/lite-adapter/relations.ts L234-468 | ✅ |

### cross-reference.md §1.12 Copy-on-Write (L332-520)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| Copy-on-Write 复制逻辑 | L332-520 | packages/storage/src/data-ops/reference/resolver.ts L286-388 | ✅ |

---

## 自动化验证

| 验证项 | 命令 | 结果 |
|--------|------|:----:|
| Storage 测试 | `bun run --filter @c4a/storage test` | ✅ |

---

## 实现产物

| 文件 | 说明 |
|------|------|
| `packages/storage/src/data-ops/reference/types.ts` | 引用类型 + 校验结果类型 |
| `packages/storage/src/data-ops/reference/parser.ts` | 引用格式解析 |
| `packages/storage/src/data-ops/reference/resolver.ts` | 优先级解析 + CoW |
| `packages/storage/src/data-ops/reference/validator.ts` | 悬空引用校验 |
| `packages/storage/src/data-ops/reference/__tests__/parser.test.ts` | 解析测试 |
| `packages/storage/src/data-ops/reference/__tests__/resolver.test.ts` | 优先级/歧义测试 |
| `packages/storage/src/data-ops/reference/__tests__/validator.test.ts` | 悬空引用测试 |
| `packages/storage/src/data-ops/reference/__tests__/copyOnWrite.test.ts` | CoW 测试 |
