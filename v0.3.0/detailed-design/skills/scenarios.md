## 三种场景的完整流程

### 场景 1：需求开发

```
用户: "我想开发一个用户登录功能"
  ↓
/c4a:feat
  → 创建 feat-a001-user-login
  → 生成 PRD 草稿
  ↓
/c4a:specify
  → 定义功能规格（Functional Spec）
  ↓
/c4a:plan
  → 设计技术方案（Technical Spec + 契约 + 验收清单）
  ↓
/c4a:feat --status=approved
  → 批准方案（draft → approved）
  ↓
/c4a:implement
  → 生成实现清单 + 代码实现
  ↓
/c4a:feat --status=published
  → 一致性检查（内部调用 /c4a:analyze）+ 状态流转（approved → published）
  ↓
c4a sync
  → 同步到知识库
```

---

### 场景 2：架构变更

```
用户: "我想把数据库从 MySQL 迁移到 PostgreSQL"
  ↓
/c4a:feat
  → 创建 feat-a002-migrate-to-postgresql (ADR)
  → 生成 ADR 草稿
  → 分析影响面
  ↓
/c4a:plan
  → 制定迁移方案（Technical Spec + 验收清单）
  ↓
/c4a:feat --status=approved
  → 批准方案（draft → approved）
  ↓
/c4a:implement
  → 生成实现清单 + 执行迁移
  ↓
/c4a:feat --status=published
  → 一致性检查 + 状态流转（approved → published）
  ↓
c4a sync
  → 同步到知识库
```

---

### 场景 3：纯知识

```
用户: "我想整理 Redis 的使用规范"
  ↓
/c4a:feat
  → 创建 feat-a003-redis-standards
  → 生成知识文档草稿
  ↓
/c4a:specify
  → 定义知识范围和结构（Functional Spec）
  ↓
/c4a:plan
  → 生成技术规格和 DSL（Technical Spec + 验收清单）
  ↓
/c4a:feat --status=approved
  → 批准方案（draft → approved）
  → 纯知识场景跳过 implement
  ↓
/c4a:feat --status=published
  → 一致性检查 + 状态流转（approved → published）
  ↓
c4a sync
  → 同步到知识库
```

---

