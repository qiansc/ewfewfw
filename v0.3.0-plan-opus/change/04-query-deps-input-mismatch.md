# 变更记录：c4a_query_deps 输入参数差异

日期：2026-01-29

## 发现的问题

`v0.3.0/detailed-design/mcp/query.md` §4.2（L18-21）描述输入为：
- `id`
- `direction`
- `depth`

但当前计划与实现使用：
- `id`
- `source_project`
- `direction`
- `depth`
- `proposal_id`

## 处理方式

本次任务 4.4 按计划实现 `source_project/proposal_id` 以对齐 StorageAdapter 的 DepsParams。

## 待确认

- 是否更新设计文档以反映 `source_project/proposal_id`？
