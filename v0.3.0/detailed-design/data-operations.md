# 数据操作详细设计

> **相关文档**：
> - 架构设计：[../architecture.md](../architecture.md)
> - Local 模式实现：[local-mode.md](./local-mode.md)

## 文档结构

详细设计文档已按功能模块拆分到 `data-ops/` 目录：

| 文件 | 内容 | 行数 |
|------|------|------|
| [data-ops/cross-reference.md](data-ops/cross-reference.md) | 跨层级和跨项目引用 | 845 |
| [data-ops/sync-export.md](data-ops/sync-export.md) | 同步导出策略 | 300 |
| [data-ops/conflict-rollback.md](data-ops/conflict-rollback.md) | feat 冲突解决、回滚机制 | 190 |
| [data-ops/cross-project-transaction.md](data-ops/cross-project-transaction.md) | 跨项目 feat、跨库事务与补偿机制 | 338 |
| [data-ops/workflow-recovery.md](data-ops/workflow-recovery.md) | Workflow 错误恢复机制 | 574 |

## 内容速查

| 主题 | 详细文档 |
|------|---------|
| 引用解析规则 | [cross-reference.md](data-ops/cross-reference.md) |
| Copy-on-Write 机制 | [cross-reference.md](data-ops/cross-reference.md) |
| 同步策略 | [sync-export.md](data-ops/sync-export.md) |
| 冲突检测与解决 | [conflict-rollback.md](data-ops/conflict-rollback.md) |
| 回滚机制 | [conflict-rollback.md](data-ops/conflict-rollback.md) |
| 跨项目 feat | [cross-project-transaction.md](data-ops/cross-project-transaction.md) |
| 事务补偿 | [cross-project-transaction.md](data-ops/cross-project-transaction.md) |
| Workflow 断点续传 | [workflow-recovery.md](data-ops/workflow-recovery.md) |
| 步骤幂等性 | [workflow-recovery.md](data-ops/workflow-recovery.md) |
| 实体清理机制 | [workflow-recovery.md](data-ops/workflow-recovery.md) |
