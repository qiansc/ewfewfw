# 变更记录：c4a_query_impact 输入参数差异

日期：2026-01-29

## 发现的问题

`v0.3.0/detailed-design/mcp/query.md` §4.3（L23-26）描述输入为：
- `id`
- `change_type`
- `depth`

但当前计划与实现使用：
- `id`
- `source_project`
- `change_type`（upgrade|deprecate|remove）
- `depth`
- `proposal_id`

## 处理方式

本次任务 4.7 按计划实现 `source_project/proposal_id`，并收敛 `change_type` 枚举。

## 待确认

- 是否更新设计文档以反映 `source_project/proposal_id`？
