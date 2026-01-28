## 附录：常见问题

### Q1: sqlite-vec 扩展安装失败怎么办？

**A**: 系统会自动降级，按优先级尝试：向量搜索 → FTS5 全文搜索 → LIKE 模糊匹配。

**三级降级策略**：

| 级别 | 搜索方式 | 触发条件 | 性能 | 质量 |
|:----:|---------|---------|------|------|
| 1 | sqlite-vec 向量搜索 | 扩展可用 | ~50ms | 语义匹配，最佳 |
| 2 | FTS5 全文搜索 | sqlite-vec 不可用，FTS5 可用 | ~20ms | 关键词匹配，下降约 30% |
| 3 | LIKE 模糊匹配 | sqlite-vec 和 FTS5 均不可用 | ~500ms | 子串匹配，最差 |

**降级策略详情**：

| 维度 | 说明 |
|------|------|
| **检测时机** | MCP Server 初始化时依次检查 sqlite-vec 和 FTS5 可用性 |
| **用户提示** | 首次使用时显示警告，说明当前搜索模式 |
| **FTS5 不可用原因** | 某些 SQLite 编译禁用 FTS5（如精简版发行版） |
| **最终降级** | FTS5 也不可用时，降级到 LIKE 模糊匹配（性能较差） |

**对 Agent/Skill 的影响**：

| Skill | 影响程度 | 说明 |
|-------|---------|------|
| `/c4a:know:search` | **高** | 召回质量下降，可能遗漏相关知识 |
| `/c4a:specify` | **中** | 业务规则召回不完整，需用户补充 |
| `/c4a:plan` | **低** | 主要依赖图查询，语义搜索仅辅助 |

**初始化时的明确提示**：

```bash
$ c4a init

✅ 数据库初始化成功
⚠️ sqlite-vec 扩展不可用
   - 语义搜索已降级到全文搜索
   - 智能召回质量将下降约 30%
   - 建议安装: brew install sqlite-vec (macOS) / apt install sqlite-vec (Linux)

# 或（极端情况）
⚠️ sqlite-vec 和 FTS5 均不可用
   - 搜索已降级到 LIKE 模糊匹配（性能较差）
   - 建议使用标准 SQLite 发行版
```

**MCP 返回中的降级标识**：

```typescript
// c4a_query_search 降级模式返回（向量 → FTS5）
{
  success: true,
  degraded: true,
  degraded_reason: "VECTOR_SEARCH_UNAVAILABLE",
  degraded_message: "sqlite-vec 不可用，使用全文搜索替代，结果按关键词匹配而非语义相似度排序",
  search_mode: "fulltext",  // "vector" | "fulltext" | "like"
  items: [...]
}

// c4a_query_search 降级模式返回（向量 → FTS5 → LIKE）
{
  success: true,
  degraded: true,
  degraded_reason: "FULLTEXT_SEARCH_UNAVAILABLE",
  degraded_message: "sqlite-vec 和 FTS5 均不可用，使用 LIKE 模糊匹配替代，性能较差且仅支持子串匹配",
  search_mode: "like",
  items: [...]
}
```

**降级实现**：

```typescript
// MCP Server 初始化时检测
class LiteStore {
  private vectorSearchEnabled: boolean = false;
  private ftsEnabled: boolean = false;  // FTS5 需要探测，某些 SQLite 编译可能禁用

  async init() {
    // 1. 尝试加载 sqlite-vec 扩展
    try {
      this.db.loadExtension('vec0');
      this.vectorSearchEnabled = true;
    } catch (e) {
      console.warn('⚠️ 向量搜索不可用，尝试降级到 FTS5 全文搜索');
      this.vectorSearchEnabled = false;
    }

    // 2. 探测 FTS5 可用性（某些 SQLite 编译可能禁用）
    this.ftsEnabled = this.probeFTS5();
    if (!this.ftsEnabled) {
      console.warn('⚠️ FTS5 不可用，将降级到 LIKE 模糊匹配（性能较差）');
    } else {
      this.ensureFTSTable();
    }
  }

  // 探测 FTS5 是否可用
  private probeFTS5(): boolean {
    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(content)');
      this.db.exec('DROP TABLE IF EXISTS _fts5_probe');
      return true;
    } catch (e) {
      return false;
    }
  }

  async search(query: string, limit: number = 10) {
    if (this.vectorSearchEnabled) {
      return this.vectorSearch(query, limit);
    } else if (this.ftsEnabled) {
      return this.ftsSearch(query, limit);
    } else {
      return this.likeSearch(query, limit);  // 最终降级方案
    }
  }
}

// 降级到 FTS5 全文搜索（带 Merge View + BM25 排序 + 状态过滤）
function ftsSearch(query: string, currentProposalId: string | null, limit: number = 10) {
  return db.prepare(`
    WITH ranked AS (
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        bm25(fts) AS fts_rank,
        ROW_NUMBER() OVER (
          PARTITION BY e.source_project, e.id
          ORDER BY
            CASE
              WHEN e.proposal_id = ? THEN 1
              WHEN e.proposal_id = '' THEN 2  -- 主分支（空字符串哨兵值）
              ELSE 3
            END
        ) AS rn
      FROM entities e
      JOIN metadata m ON
        e.source_project = m.source_project AND
        e.id = m.entity_id AND
        e.proposal_id = m.proposal_id
      JOIN entities_fts fts ON
        e.id = fts.entity_id AND
        e.source_project = fts.source_project AND
        e.proposal_id = fts.proposal_id
      WHERE
        (e.proposal_id = ? OR e.proposal_id = '')
        AND m.status NOT IN ('archived', 'deprecated')  -- 过滤已归档/已废弃实体
        AND fts MATCH ?
    )
    SELECT id, source_project, proposal_id, type, data, fts_rank
    FROM ranked WHERE rn = 1
    ORDER BY fts_rank
    LIMIT ?
  `).all(currentProposalId, currentProposalId, query, limit);
}
```

### Q2: 如何判断是否应该切换到 Server 模式？

**A**: 出现以下情况时建议切换：
- 实体数超过 10,000
- 语义搜索响应时间 > 200ms
- 图遍历响应时间 > 100ms
- 多人协作需要实时同步

### Q3: 切换模式会丢失数据吗？

**A**: 不会。导出/导入流程保证数据完整性，包括：
- 所有实体和元数据
- 所有关系
- 向量索引（自动重建）

### Q4: Local 模式支持多项目吗？

**A**: 支持。所有项目共用一个 SQLite 文件，通过 `source_project` 字段区分。

### Q5: Local → Server 迁移时如何避免权限问题？

**A**: 在迁移前使用数据完整性检查工具：

```bash
# 1. 检查数据完整性
c4a local validate

# 2. 自动修复问题
c4a local repair

# 3. 备份时强制校验
c4a local backup  # 会自动检查并提示修复
```

详见 [A.9 节：数据完整性保证](#a9-数据完整性保证)。

---

## A.9 数据完整性保证

### A.9.1 问题背景

Local 模式跳过权限检查，且 `source_project` 在单项目 feat 中可省略（CLI/Agent 自动填充）。如果用户在 Local 模式下创建了大量数据，可能存在以下问题：

1. **`source_project` 字段缺失**：部分实体未正确填充 `source_project`
2. **`source_repo` 字段缺失**：缺少代码仓库归属信息
3. **字段格式不规范**：`source_project` 或 `source_repo` 格式不符合要求
4. **层级字段错误**：Domain/Enterprise 层级实体错误地包含 `source_project`

当用户将这些数据 restore 到 Server 模式时，严格的权限检查会被触发。如果数据中缺乏明确的 `source_project` 归属，或者归属项目在 Server 端不存在/无权限，会导致大规模导入失败。

### A.9.2 自动填充规则

**单项目环境**（推荐）：

```yaml
# .context/.c4a.yaml
project_id: my-project
repo_id: company/my-repo
```

在此环境下，CLI/Agent 会自动填充：
- `source_project` → `my-project`
- `source_repo` → `company/my-repo`

**多项目环境**：

如果 Local 模式管理多个项目的数据，必须在创建实体时显式指定 `source_project`：

```typescript
// 显式指定 source_project
await c4a_store_save({
  type: "container",
  data: {
    id: "auth-service",
    name: "认证服务"
  },
  source_project: "backend-api",  // 必须显式指定
  source_repo: "company/backend"
});
```

### A.9.3 数据完整性检查

#### A.9.3.1 `c4a local validate` 命令

检查所有实体的数据完整性，不修改任何数据。

**使用方式**：

```bash
# 检查所有实体
c4a local validate

# 仅检查特定状态
c4a local validate --status=published

# 输出 JSON 格式（用于 CI/CD）
c4a local validate --format=json
```

**输出示例**：

```
$ c4a local validate

  数据完整性校验

正在扫描实体...
  ✅ 已扫描 50 个实体

检查结果:

❌ 发现 3 个错误:

  auth-service (container):
    - [C4A-MIGRATE-001] 缺少 source_project 字段
      修复: 需要指定实体归属的项目
    - [C4A-MIGRATE-002] 缺少 source_repo 字段
      修复: 需要指定实体归属的代码仓库

  payment-service (container):
    - [C4A-MIGRATE-001] 缺少 source_project 字段
      修复: 需要指定实体归属的项目

  user-db (container):
    - [C4A-MIGRATE-003] source_project 格式不正确
      修复: 只能包含小写字母、数字和连字符

⚠️  发现 2 个警告:

  order-state-machine (process):
    - [C4A-MIGRATE-005] domain 层级实体不应有 source_project
      建议: 移除 source_project 字段

  mongodb (container):
    - [C4A-MIGRATE-008] external 实体缺少 external_url
      建议: 添加外部系统的 URL

=================================================
总计: 3 个错误, 2 个警告

⚠️  迁移到 Server 模式前必须修复所有错误
使用 "c4a local repair" 自动修复这些问题
```

#### A.9.3.2 `c4a local repair` 命令

自动修复数据完整性问题。

**使用方式**：

```bash
# 自动修复所有问题
c4a local repair

# 预览修复操作（不实际修改）
c4a local repair --dry-run

# 仅修复特定实体
c4a local repair --entity-ids=auth-service,payment-service
```

**输出示例**：

```
$ c4a local repair

  数据完整性修复

正在读取项目配置...
  ✅ 项目 ID: my-project
  ✅ 仓库 ID: company/my-repo

正在修复实体...

  auth-service (container):
    ✅ 补全 source_project: my-project
    ✅ 补全 source_repo: company/my-repo

  payment-service (container):
    ✅ 补全 source_project: my-project
    ✅ 补全 source_repo: company/my-repo

  user-db (container):
    ✅ 修复 source_project 格式: User_DB → user-db

  order-state-machine (process):
    ✅ 移除不应存在的 source_project 字段

  mongodb (container):
    ⏭️  跳过: external_url 缺失（需要手动补充）

=================================================
修复完成:
  - 成功: 4 个实体
  - 跳过: 1 个实体（需要手动处理）

⚠️  以下实体需要手动处理:
  - mongodb: 缺少 external_url，请手动添加外部系统的 URL
```

**修复规则**：

| 问题类型 | 自动修复策略 | 说明 |
|---------|------------|------|
| **缺少 source_project** | 使用项目配置的 `project_id` | 仅适用于 Project 层级实体 |
| **缺少 source_repo** | 使用项目配置的 `repo_id` | 仅适用于 Project 层级实体 |
| **source_project 格式错误** | 转换为小写，替换非法字符为 `-` | 例如：`User_DB` → `user-db` |
| **Domain/Enterprise 层级错误字段** | 删除 `source_project` 和 `source_repo` | 这些层级不应有项目归属 |
| **external 实体错误字段** | 删除 `source_project` | 外部系统不属于任何项目 |
| **缺少 external_url** | 跳过，提示手动处理 | 需要用户提供外部系统 URL |

### A.9.4 备份时强制校验

`c4a local backup` 命令在导出前会自动执行数据完整性检查，确保备份的数据可以顺利迁移到 Server 模式。

**交互流程**：

```
$ c4a local backup

  备份本地数据 (SQLite → 压缩包)

? 备份文件名: c4a-backup-20260124.tar.gz
? 是否包含草稿状态的实体?
  > 否 - 仅备份 published 状态 (推荐)
    是 - 备份所有状态

正在扫描实体...
  ✅ 已扫描 50 个实体

⚠️  数据完整性检查失败

发现 3 个实体缺少必要字段:
  - auth-service (container): 缺少 source_project
  - payment-service (container): 缺少 source_project
  - user-db (container): source_project 格式不正确

? 如何处理？
  > 自动补全缺失字段（使用当前项目配置）
    跳过这些实体，仅备份有效数据
    取消备份，手动修复后重试

─────────────────────────────────────────
选择: 自动补全缺失字段
─────────────────────────────────────────

正在修复...
  ✅ auth-service: 补全 source_project = my-project
  ✅ payment-service: 补全 source_project = my-project
  ✅ user-db: 修复 source_project 格式

正在备份...
  ✅ 导出 SQLite: 50 个实体
  ✅ 导出关系: 120 个关系
  ✅ 压缩数据...

✅ 备份完成
  文件: ./c4a-backup-20260124.tar.gz
  大小: 2.3 MB
  包含: 50 个实体, 120 个关系
  注意: 向量数据不导出，恢复时自动重建
```

**处理策略**：

| 选项 | 行为 | 适用场景 |
|------|------|---------|
| **自动补全** | 使用当前项目配置自动填充缺失字段 | 单项目环境（推荐） |
| **跳过无效实体** | 仅备份有效实体，跳过有问题的实体 | 多项目环境，部分数据不需要迁移 |
| **取消备份** | 中止操作，用户手动修复后重试 | 需要精确控制数据 |

### A.9.5 保存时的警告提示

虽然 Local 模式跳过权限检查，但在保存实体时会进行数据完整性检查并显示警告。

**示例**：

```typescript
// 保存时缺少 source_project
await c4a_store_save({
  type: "container",
  data: {
    id: "auth-service",
    name: "认证服务"
  }
  // 缺少 source_project
});

// 输出警告
⚠️  警告: 实体 auth-service 缺少 source_project，迁移到 Server 模式时可能失败
✅ 已自动填充 source_project: my-project (来自项目配置)
✅ 已自动填充 source_repo: company/my-repo (来自项目配置)
```

**警告级别**：

| 问题 | 级别 | 行为 |
|------|------|------|
| **缺少 source_project（有项目配置）** | INFO | 自动填充，显示提示 |
| **缺少 source_project（无项目配置）** | WARNING | 允许保存，显示警告 |
| **source_project 格式错误** | WARNING | 允许保存，显示警告 |
| **Domain/Enterprise 层级错误字段** | WARNING | 允许保存，显示警告 |

### A.9.6 最佳实践

#### A.9.6.1 单项目环境（推荐）

**配置项目信息**：

```yaml
# .context/.c4a.yaml
project_id: my-project
repo_id: company/my-repo
```

**创建实体时无需显式指定**：

```typescript
// CLI/Agent 会自动填充 source_project 和 source_repo
await c4a_store_save({
  type: "container",
  data: {
    id: "auth-service",
    name: "认证服务"
  }
  // source_project 和 source_repo 自动填充
});
```

#### A.9.6.2 多项目环境

**必须显式指定 source_project**：

```typescript
// 为 backend-api 项目创建实体
await c4a_store_save({
  type: "container",
  data: {
    id: "auth-service",
    name: "认证服务"
  },
  source_project: "backend-api",
  source_repo: "company/backend"
});

// 为 frontend-app 项目创建实体
await c4a_store_save({
  type: "component",
  data: {
    id: "login-form",
    name: "登录表单"
  },
  source_project: "frontend-app",
  source_repo: "company/frontend"
});
```

#### A.9.6.3 迁移前检查清单

在将 Local 模式数据迁移到 Server 模式前，执行以下步骤：

```bash
# 1. 检查数据完整性
c4a local validate

# 2. 如有问题，自动修复
c4a local repair

# 3. 再次验证
c4a local validate

# 4. 备份数据（会再次校验）
c4a local backup --output ./backup.tar.gz

# 5. 切换到 Server 模式
# 编辑 .context/.c4a.yaml，设置 mode: server

# 6. 恢复数据到 Server
c4a server restore ./backup.tar.gz --conflict-policy=merge
```

### A.9.7 错误码参考

| 错误码 | 说明 | 修复方式 |
|--------|------|---------|
| **C4A-MIGRATE-001** | 缺少 source_project 字段 | 使用 `c4a local repair` 自动补全 |
| **C4A-MIGRATE-002** | 缺少 source_repo 字段 | 使用 `c4a local repair` 自动补全 |
| **C4A-MIGRATE-003** | source_project 格式不正确 | 使用 `c4a local repair` 自动修复格式 |
| **C4A-MIGRATE-004** | source_repo 格式建议改进 | 手动修改为 `owner/repo` 格式 |
| **C4A-MIGRATE-005** | Domain/Enterprise 层级不应有 source_project | 使用 `c4a local repair` 自动移除 |
| **C4A-MIGRATE-006** | Domain/Enterprise 层级不应有 source_repo | 使用 `c4a local repair` 自动移除 |
| **C4A-MIGRATE-007** | external 实体不应有 source_project | 使用 `c4a local repair` 自动移除 |
| **C4A-MIGRATE-008** | external 实体缺少 external_url | 手动添加外部系统 URL |

---

## 附录：数据示例

> **注意**：以下示例展示的是**应用层语义**。在数据库存储时，`null` 值会转换为空字符串 `''`（哨兵值）。
> 详见 [sqlite-schema.md §2.1](./sqlite-schema.md#21-核心表) 的空字符串哨兵值约定。

### A.1 Domain 层 - 行业知识

```yaml
# entities 表
# 注意：数据库存储时 source_project='' 和 proposal_id=''
id: order-state-machine
source_project: ''           # 全局实体（数据库存储值）
proposal_id: ''              # 主分支（数据库存储值）
type: process
kind: concept
scope: domain
perspective: business
data:
  process_type: business
  name: 订单状态机
  description: 电商行业通用的订单状态流转

# metadata 表
entity_id: order-state-machine
source_project: ''           # 全局实体
source_repo: ''              # 无代码仓库归属
status: published
proposal_id: ''              # 主分支
created_at: "2026-01-20T10:00:00Z"
```

### A.2 Enterprise 层 - 企业知识

```yaml
# entities 表
id: refund-policy
source_project: ''           # 全局实体
proposal_id: ''              # 主分支
type: sor
kind: concept
scope: enterprise
perspective: business
data:
  entity_type: product
  sor_type: business_rule
  description: 支持 7 天无理由退款

# metadata 表
entity_id: refund-policy
source_project: ''           # 全局实体
source_repo: ''              # 无代码仓库归属
status: published
proposal_id: ''              # 主分支

# relations 表
from_project: ''             # 全局实体
from_id: refund-policy
to_project: ''               # 全局实体
to_id: order-state-machine
rel_type: REFERENCES
proposal_id: ''              # 主分支
```

### A.3 Project 层 - 业务视角 (Product)

```yaml
# entities 表
id: e-commerce-product
type: product
kind: concept
scope: project
perspective: business
data:
  name: 电商平台
  description: 在线购物平台

# metadata 表
entity_id: e-commerce-product
source_project: my-project
source_repo: company/my-repo
status: published

# relations 表（引用 Enterprise 层）
from_id: e-commerce-product
to_id: refund-policy
rel_type: REFERENCES
properties: '{"target_scope": "enterprise"}'
```

### A.4 Project 层 - 技术视角 (Container - implementation)

```yaml
# entities 表
id: mcp-data
type: container
kind: implementation
scope: project
perspective: technical
data:
  name: MCP Data Service
  technology: [{language: Python}]
  code_path: packages/mcp-data/

# metadata 表
entity_id: mcp-data
source_project: c4a-core
source_repo: company/bytedance-context
status: published
```

### A.5 Project 层 - 技术视角 (Container - external)

> **说明**：`external` 类型实体表示外部系统/服务，不属于任何项目，因此 `source_project` 和 `source_repo` 在应用层为 `null`，数据库存储为 `''`（空字符串哨兵值）。必须提供 `external_url` 指向外部系统的文档或入口。

```yaml
# entities 表
id: mongodb
type: container
kind: external
scope: project
perspective: technical
data:
  name: MongoDB
  technology: [{language: NoSQL Database}]
# metadata 表
entity_id: mongodb
source_project: ''         # external 实体不属于任何项目（数据库存储值，应用层为 null）
source_repo: ''            # external 实体无代码仓库归属（数据库存储值，应用层为 null）
external_url: https://mongodb.com
status: published
```

### A.6 关系示例

```yaml
# relations 表

# Product ↔ System 对应关系
- from_id: e-commerce-system
  to_id: e-commerce-product
  rel_type: CORRESPONDS

# Business SoR → Technical SoR 对应关系
- from_id: sor-t-a001
  to_id: sor-b-a001
  rel_type: CORRESPONDS

# Entity × Process → SoR 派生关系
- from_id: e-commerce-product
  to_id: sor-b-a001
  rel_type: DERIVES
  properties: '{"via_process": "prc-b-a001"}'
```
