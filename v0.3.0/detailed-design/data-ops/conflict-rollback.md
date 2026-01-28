## 3. feat 冲突解决

### 3.1 合并策略

**分层自动化**：

```
自动合并（脚本执行）:
├─ 新增实体（主分支不存在）
├─ 无冲突修改（主分支未变更）
├─ 撤销修改（feat 内新建的实体被删除，物理删除 feat 副本）
└─ 业务废弃（主分支实体被标记废弃，自动设置 status: archived）

模型决策（返回冲突）:
├─ 内容冲突（双方都修改了同一字段）
├─ 删除冲突（一方删除，一方修改）
├─ 类型冲突（type/kind 变更）
└─ 语义冲突（关系变更导致的逻辑冲突）
```

> **删除语义说明**：详见 [store-crud.md 3.4 节](./store-crud.md#34-删除语义)
> - **撤销修改**：feat 内新建的实体不再需要，物理删除 feat 副本，不影响主分支
> - **业务废弃**：主分支已存在的实体需要下线，通过状态流转 `published → deprecated → archived` 实现软删除

**冲突决策树**：

```
冲突类型判断
  │
  ├─ 字段级冲突（同一字段双方都修改）
  │   ├─ 非关键字段（description, tags 等）
  │   │   └─ 自动合并：last-write-wins（按 updated_at）
  │   └─ 关键字段（name, type, kind, status 等）
  │       └─ 模型分析语义 → 用户确认
  │
  ├─ 类型变更（type/kind 变更）
  │   └─ 模型分析业务意图 → 用户确认
  │
  ├─ 删除冲突（一方删除，一方修改）
  │   ├─ 主分支删除 + feat 修改
  │   │   └─ 模型分析依赖关系 → 建议恢复实体 → 用户确认
  │   └─ feat 删除 + 主分支修改
  │       └─ 模型分析影响范围 → 建议保留实体 → 用户确认
  │
  └─ 关系冲突（依赖关系变更）
      ├─ 新增依赖
      │   └─ 自动合并：添加新关系
      ├─ 删除依赖
      │   └─ 模型分析影响范围 → 用户确认
      └─ 循环依赖
          └─ 阻止合并 → 用户必须手动解决
```

**边界判断**：
- 能通过字段对比判断的 → 自动合并
- 需要理解业务语义的 → 模型决策

### 3.2 三阶段决策流程

```
阶段 1: 冲突检测
  ↓ 返回冲突列表

阶段 2: 模型分析
  ↓ 模型分析冲突详情（main_branch vs feat_branch）
  ↓ 生成决策建议（保留哪个/合并/拆分）
  ↓ 用户确认决策

阶段 3: 执行决策
  ↓ 保存解决后的实体
  ↓ 继续合并剩余实体
```

### 3.3 冲突类型详解

| 冲突类型 | 说明 | 示例 | 决策建议 |
|---------|------|------|---------|
| **内容冲突** | 双方修改同一字段 | 主分支改 name，feat 也改 name | 模型分析语义，建议保留哪个 |
| **删除冲突** | 一方删除，一方修改 | 主分支删除实体，feat 修改实体 | 通常保留修改，恢复实体 |
| **类型冲突** | type/kind 变更 | 主分支改 kind=external，feat 改 kind=implementation | 需要理解业务意图 |
| **语义冲突** | 关系变更导致逻辑冲突 | 主分支删除依赖，feat 新增依赖 | 分析依赖图，建议调整 |

### 3.4 MCP 工具接口

冲突检测和解决通过 `c4a_store_feat_merge` 工具实现（详见 [store-feat-lifecycle.md#3.7](../mcp/store-feat-lifecycle.md#37-c4a_store_feat_mergefeat-合并与冲突解决)）：

| 操作 | 工具调用 | 说明 |
|------|---------|------|
| **冲突检测** | `c4a_store_feat_merge({ feat_id, strategy: "auto" })` | 返回 `conflicts` 数组，包含冲突详情和建议 |
| **手动解决** | `c4a_store_feat_merge({ feat_id, strategy: "manual", conflict_resolution: [...] })` | 根据 `conflict_resolution` 参数选择保留版本 |
| **强制发布** | `c4a_store_feat_lifecycle({ action: "transition", to_status: "published", force_publish: true })` | 跳过冲突检测强制发布（不推荐） |

**冲突解决策略**：

| resolution | 行为 | 适用场景 |
|------------|------|---------|
| `keep_main` | 保留主分支版本，丢弃 feat 版本 | feat 的修改不再需要 |
| `keep_feat` | 保留 feat 版本，覆盖主分支 | feat 的修改是正确的 |

> **设计说明**：不提供独立的 `c4a_store_detect_conflicts` 工具，冲突检测集成在 `c4a_store_feat_merge` 中。这样设计是因为：
> 1. 冲突检测和合并是紧密耦合的操作，分开会增加 Agent 调用复杂度
> 2. `strategy: "auto"` 已经实现了"检测冲突 + 自动合并无冲突实体"的功能
> 3. 返回的 `conflicts` 数组包含足够的信息供 Agent/用户决策

### 3.5 回退机制

- 合并失败 → feat 保持 `approved` 状态
- 部分合并成功 → 记录已合并实体，支持继续/回滚
- 用户可以取消合并，feat 回到 `approved`

---

## 4. 回滚机制

C4A 不支持直接回滚，而是通过创建"回滚 feat"来实现：

### 4.1 回滚流程

```
发布后发现问题:
  1. 创建新 feat（回滚 feat）

  2. 在回滚 feat 内恢复旧版本
     ↓ 从历史记录获取原 feat 发布前的状态
     ↓ 创建实体（恢复旧版本）

  3. 发布回滚 feat
     ↓ 正常走 draft → approved → published 流程
```

### 4.2 紧急回滚机制

> **v0.3.0 状态**：紧急回滚机制已在数据层设计，但对应的 CLI 命令（`c4a rollback`）和 Skill（`/c4a:ops:rollback`）计划在 v0.4.0 实现。
> 当前版本用户需要通过创建"回滚 feat"手动执行回滚操作（见 [4.1 回滚流程](#41-回滚流程)）。

**适用场景**：生产事故、安全漏洞等紧急情况

**操作流程**（v0.4.0 计划）：
```bash
c4a rollback <feat-id> --emergency --reason="生产事故：支付服务宕机"
```

**机制**：
- 需要管理员权限（通过项目配置的 `admin_users` 列表验证）
- 直接恢复到 feat 发布前的状态（绕过审批流程）
- 自动创建"紧急回滚记录"（不走 feat 流程）
- 记录完整审计日志（操作人、时间、原因、回滚范围）
- 事后需补充正式的回滚 feat 作为文档

> **事务一致性**：紧急回滚的底层实现复用 `publishFeat` 的 MongoDB 事务机制。回滚本质上是"发布一个包含旧版本数据的特殊 Feat"，复用同一套 ACID 逻辑可确保数据一致性并减少维护成本。

**限制**：
- 仅限管理员使用
- 需提供回滚原因（强制，不少于 10 字）
- 24 小时内需补充正式 feat 文档（系统自动提醒）
- 紧急回滚次数有限制（每月不超过 3 次，超过需审批）

**示例**：
```
$ c4a rollback feat-a005-payment-refactor --emergency --reason="生产事故：支付服务宕机"

⚠️  紧急回滚模式

feat: feat-a005-payment-refactor
发布时间: 2026-01-22 14:30:00
涉及实体: 5 个 (payment-service, order-service, ...)

? 确认回滚？此操作将立即生效，无法撤销。
  > 是，立即回滚
    否，取消

─────────────────────────────────────────
选择: 是，立即回滚
─────────────────────────────────────────

正在回滚...
  ⏪ 恢复: payment-service (v2 → v1)
  ⏪ 恢复: order-service (v3 → v2)
  ⏪ 更新图谱关系...
  ⏪ 更新向量索引...

✓ 紧急回滚完成

审计记录:
  操作人: admin@example.com
  时间: 2026-01-22 15:00:00
  原因: 生产事故：支付服务宕机
  回滚范围: 5 个实体

⚠️  提醒: 请在 24 小时内补充正式的回滚 feat 文档
```

### 4.3 历史记录存储

**Local 模式（SQLite）**：

```sql
CREATE TABLE feat_history (
    feat_id TEXT NOT NULL,
    published_at DATETIME NOT NULL,
    entities_snapshot JSON NOT NULL,
    PRIMARY KEY (feat_id, published_at)
);
```

**Server 模式（MongoDB）**：

```javascript
// feat_history 集合
{
  _id: ObjectId,
  feat_id: "feat-a005-payment-refactor",
  published_at: ISODate("2026-01-22T14:30:00Z"),
  entities_snapshot: [
    { id: "payment-service", type: "container", version: 2, data: {...} },
    { id: "order-service", type: "container", version: 3, data: {...} }
  ],
  published_by: "user@example.com"
}

// 索引
db.feat_history.createIndex({ feat_id: 1, published_at: -1 })
```

> **存储策略**：历史快照仅保留最近 N 个版本（默认 10），超出后自动清理最旧版本。

### 4.4 部分回滚

支持只回滚部分实体，其他实体保持不变。

### 4.5 设计理由

- 保持审计追踪（所有变更都有记录）
- 避免数据丢失（不直接删除）
- 支持部分回滚（只回滚部分实体）

---

