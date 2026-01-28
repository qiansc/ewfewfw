# 存储与同步：`c4a_store_*`（设计层）

本目录包含 Store 工具的完整设计文档，按功能模块拆分：

| 文件 | 内容 | 工具 |
|------|------|------|
| [store-crud.md](store-crud.md) | CRUD 基础操作 | `save`, `read`, `list`, `delete` |
| [store-sync.md](store-sync.md) | 同步操作 | `sync`, `plan_sync` |
| [store-feat-lifecycle.md](store-feat-lifecycle.md) | Feat 生命周期与合并 | `feat_lifecycle`, `feat_merge` |
| [store-feat-checklist.md](store-feat-checklist.md) | Checklist 与工作流 | `feat_checklist`, `update_workflow_step`, 并发预警 |
| [store-utils.md](store-utils.md) | 工具类操作 | `read_history`, `backup`, `restore`, `repair`, `validate` |

## 工具速查

| 工具 | 用途 | 详细文档 |
|------|------|---------|
| `c4a_store_save` | 保存/更新实体 | [store-crud.md](store-crud.md#31-c4a_store_save保存更新实体) |
| `c4a_store_read` | 读取实体/列表 | [store-crud.md](store-crud.md#32-c4a_store_read读取实体列表) |
| `c4a_store_list` | 列出实体概要 | [store-crud.md](store-crud.md#33-c4a_store_list列出实体概要) |
| `c4a_store_delete` | 删除实体 | [store-crud.md](store-crud.md#34-c4a_store_delete删除实体) |
| `c4a_store_sync` | 文件系统 ↔ 数据库（Local 模式） | [store-sync.md](store-sync.md#35-c4a_store_sync文件系统--数据库) |
| `c4a_store_plan_sync` | 同步计划（Server/Remote 模式） | [store-sync.md](store-sync.md#351-c4a_store_plan_syncserverremote-模式同步计划) |
| `c4a_store_feat_lifecycle` | Feat 生命周期管理 | [store-feat-lifecycle.md](store-feat-lifecycle.md#36-c4a_store_feat_lifecyclefeat-生命周期管理创建流转删除) |
| `c4a_store_feat_merge` | Feat 合并与冲突解决 | [store-feat-lifecycle.md](store-feat-lifecycle.md#37-c4a_store_feat_mergefeat-合并与冲突解决) |
| `c4a_store_feat_checklist` | Checklist 管理 | [store-feat-checklist.md](store-feat-checklist.md#38-c4a_store_feat_checklistchecklist-管理) |
| `c4a_store_update_workflow_step` | 原子更新 workflow 步骤 | [store-feat-checklist.md](store-feat-checklist.md#39-c4a_store_update_workflow_step原子更新-workflow-步骤状态) |
| `c4a_store_read_history` | 查询实体变更历史 | [store-utils.md](store-utils.md#311-c4a_store_read_history查询实体变更历史) |
| `c4a_store_backup` | 备份数据 | [store-utils.md](store-utils.md#313-c4a_store_backup备份数据) |
| `c4a_store_restore` | 恢复数据 | [store-utils.md](store-utils.md#314-c4a_store_restore恢复数据) |
| `c4a_store_repair` | 修复数据一致性 | [store-utils.md](store-utils.md#315-c4a_store_repair修复数据一致性) |
| `c4a_store_validate` | 架构一致性检查 | [store-utils.md](store-utils.md#316-c4a_store_validate架构一致性检查) |
