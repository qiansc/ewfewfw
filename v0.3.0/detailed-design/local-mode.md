# Local 模式实现细节

> **相关文档**：
> - 架构设计：[../architecture.md](../architecture.md)
> - Skills 设计：[skills-design.md](./skills-design.md)

## 文档结构

详细设计文档已按功能模块拆分到 `local-mode/` 目录：

| 文件 | 内容 |
|------|------|
| [local-mode/sqlite-schema.md](local-mode/sqlite-schema.md) | 概述、SQLite 表结构 |
| [local-mode/vector-search.md](local-mode/vector-search.md) | 向量搜索实现 |
| [local-mode/graph-query.md](local-mode/graph-query.md) | 图查询实现 |
| [local-mode/mode-switch.md](local-mode/mode-switch.md) | 模式切换、性能、限制 |
| [local-mode/appendix.md](local-mode/appendix.md) | 附录：FAQ、数据完整性、数据示例 |

## 内容速查

| 主题 | 详细文档 |
|------|---------|
| SQLite 表结构 | [sqlite-schema.md](local-mode/sqlite-schema.md) |
| 向量搜索 | [vector-search.md](local-mode/vector-search.md) |
| 图查询 | [graph-query.md](local-mode/graph-query.md) |
| Local ↔ Server 切换 | [mode-switch.md](local-mode/mode-switch.md) |
| 性能基准 | [mode-switch.md](local-mode/mode-switch.md) |
| 数据示例 | [appendix.md](local-mode/appendix.md) |
