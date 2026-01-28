## 未实现的 Skills（计划中）

以下 Skills 已在底层设计，但暂未实现，计划在后续版本中提供：

| Skill | 说明 | 计划版本 | 底层支持 | 备注 |
|-------|------|---------|---------|------|
| `/c4a:ops:rollback` | 紧急回滚机制 | v0.4.0 | data-operations.md 已设计 | 用于生产事故、安全漏洞等紧急情况的快速回滚 |

---

## 未实现的 CLI 命令（计划中）

| 命令 | 说明 | 计划版本 | 备注 |
|------|------|---------|------|
| `c4a feat prune` | 清理已发布的 Feat 本地目录 | v0.4.0 | 归档或删除 `.context/feat/` 下已发布的 Feat 目录 |

### `c4a feat prune` 设计说明

**背景**：Feat 发布后，`.context/feat/xxx` 目录完整保留作为历史记录。对于长期运行的大型项目，这可能导致本地文件数量膨胀。

**功能**：
- 清理已发布（`published`）或已归档（`archived`）的 Feat 本地目录
- 数据库中已有完整历史，本地目录可安全删除
- 支持按时间范围、状态筛选要清理的 Feat

**命令格式**：
```bash
# 清理所有已发布超过 30 天的 Feat 目录
c4a feat prune --status=published --older-than=30d

# 清理指定 Feat
c4a feat prune feat-a001-xxx

# 预览模式（不实际删除）
c4a feat prune --dry-run
```

---

**当前版本（v0.3.0）的替代方案**：

对于紧急回滚需求，用户可以通过以下方式手动执行：

```bash
# 1. 创建回滚 feat
c4a feat create --id feat-rollback-xxx --title "回滚 feat-xxx"

# 2. 在回滚 feat 中恢复旧版本
# （从历史记录获取原 feat 发布前的状态）

# 3. 发布回滚 feat
c4a feat publish feat-rollback-xxx
```

详细的回滚机制设计参见：[data-operations.md § 4.2 紧急回滚机制](./data-operations.md#42-紧急回滚机制)

