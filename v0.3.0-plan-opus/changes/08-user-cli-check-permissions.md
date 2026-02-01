# Part 08 User CLI - check-permissions 占位说明

> **创建日期**: 2026-01-31
> **状态**: 已完成（2026-02-01，Part 13 实现）
> **影响范围**: `c4a server check-permissions`（已实现）+ 新增 server 运维命令

---

## 背景

设计文档 `v0.3.0/detailed-design/cli/user-cli.md` §2.4 明确要求提供：

```
c4a server check-permissions --backup <file> --user <email> --format=json
```

该命令需要从备份文件解析实体，并进行跨项目权限预检查。

## 当前实现状态

- `c4a server check-permissions` 已实现（Part 13）：解析备份文件并进行跨项目权限预检查，支持 `--backup` / `--user` / `--format=json`。
- 新增 server 运维命令：
  - `c4a server check-consistency`（POST `/utils/check-consistency`）
  - `c4a server rebuild-neo4j`（POST `/utils/repair` scope=neo4j）
  - `c4a server rebuild-milvus`（POST `/utils/repair` scope=milvus）
- `sync-pending` 命令移除：后端 `/utils/repair` 为全量重建，无法按 `sync_status` 过滤，避免语义不一致与高成本操作。

## 验证记录

- 手动验证 server 命令（`check-consistency` / `rebuild-neo4j` / `rebuild-milvus`，含 `--user`/`--format=json`）。
- `bun run typecheck` 与 `bun run --filter @c4a/cli test` 全部通过。

## 依赖与后续建议

- 如需从全局配置读取默认用户 ID，可在 v0.4.0 扩展 GlobalConfig 支持 `user_id`。
