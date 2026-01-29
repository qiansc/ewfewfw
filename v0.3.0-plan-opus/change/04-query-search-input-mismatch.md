# 变更记录：c4a_query_search 输入参数差异

日期：2026-01-29

## 发现的问题

`v0.3.0/detailed-design/mcp/query.md` §4.1（L3-16）描述输入为：
- `query`
- `type_filter`
- `limit`（默认 20）
- `offset`（默认 0）

但当前计划与代码类型（SearchParams）使用：
- `query`
- `scope`
- `proposal_id`
- `limit`
已补充 `offset`，但 `proposal_id` 在设计文档中未体现。

## 处理方式

本次任务已实现 `offset`，并保持 `scope/proposal_id` 以对齐现有 StorageAdapter。

## 待确认

- 是否更新设计文档以反映 `scope/proposal_id`？
- 是否在后续任务中补充 `type_filter` 兼容处理或统一命名为 `scope`？
