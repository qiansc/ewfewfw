# C4A v0.3.0 待办事项

本文档记录 v0.3.0 识别但暂不实现的架构改进项，计划在后续版本处理。

---

## v0.4.0 规划

### A. Server 模式三库一致性窗口

**问题**：MongoDB 写入成功后到 Neo4j/Milvus 同步完成前，查询可能返回过期数据。

**决策**：v0.4.0 实现 `data_freshness` 字段

**方案**：
```typescript
// 查询返回增加 data_freshness 字段
{
  success: true,
  items: [...],
  metadata: {
    data_freshness: {
      mongodb_at: "2026-01-26T10:00:00Z",
      neo4j_synced_at: "2026-01-26T09:59:55Z",
      milvus_synced_at: "2026-01-26T09:59:50Z",
      is_stale: true,
      stale_reason: "neo4j_lag"
    }
  }
}
```

**影响范围**：
- `c4a_store_read` 返回值
- `c4a_store_list` 返回值
- `c4a_store_query_graph` 返回值
- `c4a_store_search` 返回值

---

### B. 跨项目引用的读取权限边界

**问题**：跨项目引用的读取权限模型不清晰。

**决策**：v0.3.0 暂不设限，所有引用都可读取

**v0.3.0 行为**：
- 用户可以读取任何被引用实体的完整信息
- 不区分公开/私有实体
- 图查询可以遍历到任何项目的实体

**v0.4.0+ 考虑**：
- 如有需求，引入 `visibility: public | internal | private` 标记
- 或引入 `reference_visible_to` 项目白名单配置

---

### C. Checklist 多人协作冲突处理

**问题**：多人同时编辑 checklist 时，后写入者会静默覆盖先写入者的修改（Last Write Wins）。

**决策**：v0.3.0 暂不处理，文档说明当前行为

**v0.3.0 行为**：
- `patch` 操作是原子的，但不检测并发冲突
- 最后执行的 patch 生效
- 建议团队内部协调，避免同时编辑同一任务

**v0.4.0+ 考虑**：
- 实现乐观锁（`expected_version` 参数）
- 冲突时返回错误，提示用户刷新后重试

**乐观锁方案示例**：
```typescript
c4a_store_feat_checklist({
  action: "patch",
  feat_id: "feat-a001",
  patches: [...],
  expected_version: "1.5"  // 从上次 get 获取
})

// 冲突返回
{
  success: false,
  error: "version_conflict",
  current_version: "1.6",
  conflicting_tasks: ["task-1"],
  message: "Checklist 已被其他用户修改，请刷新后重试"
}
```

---

### D. 跨项目 Feat 权限死锁

**问题**：当 feat 涉及多个项目，且发布前某项目权限被撤销时，可能导致 feat 无法发布也无法拆分的"死锁"状态。

**决策**：v0.3.0 暂不处理，完善文档规避建议

**v0.3.0 规避建议**（已在 cross-project-auth.md 说明）：
- 发布前确认所有涉及项目的权限状态
- 跨项目 feat 尽量缩短生命周期，减少权限变更窗口
- 如遇死锁，联系相关项目 admin 协调恢复权限

**v0.4.0+ 考虑**：

1. **Feat 废弃操作**（优先）
```typescript
c4a_store_feat_lifecycle({
  action: "abandon",
  feat_id: "feat-a001",
  reason: "权限变更导致无法发布"
})
// 不需要任何项目的写权限，只需 feat 创建者或系统 admin
```

2. **超时自动归档**
```yaml
feat:
  max_lifetime_days: 90
  warning_at_days: 60
```

3. **权限快照**（v0.5.0+）
- 创建跨项目 feat 时锁定权限状态
- 发布时使用快照权限，而非实时权限

---

## 优先级排序

| 事项 | 优先级 | 目标版本 | 复杂度 |
|------|--------|----------|--------|
| A. 三库一致性窗口 | 中 | v0.4.0 | 低 |
| D. 权限死锁 - abandon 操作 | 高 | v0.4.0 | 中 |
| D. 权限死锁 - 超时归档 | 中 | v0.4.0 | 低 |
| C. Checklist 乐观锁 | 低 | v0.4.0 | 中 |
| B. 引用可见性配置 | 低 | v0.5.0+ | 中 |
| D. 权限快照 | 低 | v0.5.0+ | 高 |

---

## 更新记录

- 2026-01-26: 初始创建，从 FIXES.md 架构设计建议迁移
