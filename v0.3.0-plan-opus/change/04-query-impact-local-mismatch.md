# 变更记录：Local Mode impact 返回字段差异

日期：2026-01-29

## 发现的问题

`v0.3.0/detailed-design/mcp/query.md` §4.5.2（L125-155）示例返回字段为：
- `project`
- `impact_type`（breaking/potential）

但当前计划与类型定义使用：
- `source_project`
- `impact_level`（direct/indirect）

## 处理方式

本次实现先对齐现有 StorageAdapter 与计划字段（impact_level/source_project）。

## 待确认

- 是否更新设计文档示例字段（impact_type → impact_level，project → source_project）？
