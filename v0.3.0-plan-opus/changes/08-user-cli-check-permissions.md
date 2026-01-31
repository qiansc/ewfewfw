# Part 08 User CLI - check-permissions 占位说明

> **创建日期**: 2026-01-31
> **状态**: 设计已定义，当前占位
> **影响范围**: `c4a server check-permissions`

---

## 背景

设计文档 `v0.3.0/detailed-design/cli/user-cli.md` §2.4 明确要求提供：

```
c4a server check-permissions --backup <file> --user <email> --format=json
```

该命令需要从备份文件解析实体，并进行跨项目权限预检查。

## 当前实现状态

由于 **Server API/权限校验能力尚未实现**（`ServerAdapter` 仍为占位），CLI 端暂时无法完成真实权限分析。

因此：
- `c4a server check-permissions` 保持 **占位提示** 并返回错误码
- 不执行备份解析和权限判断

## 依赖与后续建议

需要在 Part 13 Server Mode 中补齐以下能力后再实现：

1. **ServerAdapter** 完整实现（含权限校验/权限查询接口）
2. **备份格式与解析逻辑** 对齐（JSON/tar.gz）
3. **权限策略与用户身份获取** 的统一接口

完成上述依赖后，补齐 CLI 的 `check-permissions` 行为。
