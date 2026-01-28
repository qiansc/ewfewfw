# 存储工具类操作


### 3.11 `c4a_store_read_history`（查询实体变更历史）

- **输入（建议）**
  - `entity_id?: string`：查询指定实体的历史
  - `feat_id?: string`：查询指定 Feat 的变更记录
  - `limit?: number = 100`：返回记录数量上限
  - `order?: "asc" | "desc" = "desc"`：按时间排序
- **返回（JSON，建议）**
  - `items: { feat_id, action, changed_fields, changed_by, changed_at }[]`

**查询示例**：

```typescript
// 查询 auth-service 的完整变更历史
c4a_store_read_history({ entity_id: "auth-service" })

// 返回：
[
  {
    feat_id: "feat-a001-user-login",
    action: "create",
    changed_by: "alice@example.com",
    changed_at: "2026-01-22T10:00:00Z"
  },
  {
    feat_id: "feat-a002-add-oauth",
    action: "update",
    changed_fields: ["data.auth_methods"],
    changed_by: "bob@example.com",
    changed_at: "2026-01-25T14:30:00Z"
  }
]

// 查询 feat-a002 修改了哪些实体
c4a_store_read_history({ feat_id: "feat-a002-add-oauth" })

// 返回：
[
  { entity_id: "auth-service", action: "update" },
  { entity_id: "oauth-component", action: "create" }
]
```

---

### 3.12 已移除的工具

以下工具已移至 CLI 内部实现，不再作为独立 MCP 工具暴露：

| 原工具 | CLI 替代方式 | 移除理由 |
|--------|-------------|---------|
| `c4a_store_generate_template` | `c4a template <type>` | 静态资源，CLI 读取本地模板文件即可 |
| `c4a_store_get_schema` | `c4a schema <type>` 或内部读取 | 静态资源，CLI 读取本地 Schema 文件即可 |

> **设计理由**：
> - Agent 的 prompt 中已包含 DSL 规范，不需要运行时查询模板或 Schema
> - DSL 验证逻辑在 `c4a_store_save` 内部自动执行
> - 用户需要查看模板/Schema 时，通过 CLI 命令获取

---

### 3.13 `c4a_store_backup`（备份数据）

- **输入（建议）**
  - `output: string`：备份文件路径（如 `./backup.tar.gz`）
  - `status_filter?: "published" | "approved" | "all" = "published"`：按实体状态筛选备份范围
  - `format?: "tar.gz" | "json" = "tar.gz"`：备份格式
  - `include_metadata?: boolean = true`：是否包含元数据
- **返回（JSON，建议）**
  - `success: boolean`
  - `file: string`：备份文件路径
  - `size: number`：文件大小（字节）
  - `format_version: string`：备份格式版本（如 "1.0"）
  - `stats: { entities: number; relations: number; vectors: number }`

**备份格式规范**：

备份文件（解压后的 JSON）包含以下字段：

```json
{
  "version": "0.3.0",
  "format_version": "1.0",
  "exported_at": "2026-01-22T15:30:45Z",
  "exported_by": "user@example.com",
  "source": {
    "mode": "local",
    "project_id": "my-project",
    "repo_id": "company/my-repo"
  },
  "entities": [
    {
      "id": "e-commerce-system",
      "type": "system",
      "status": "published",
      "data": { ... },
      "metadata": { ... },
      "content_hash": "sha256:abc123..."
    }
  ],
  "relations": [ ... ],
  "checksums": {
    "entities": "sha256:def456...",
    "relations": "sha256:ghi789..."
  }
}
```

### 3.14 `c4a_store_restore`（恢复数据）

- **输入（建议）**
  - `input: string`：备份文件路径
  - `conflict_policy?: "skip" | "override" | "merge" | "error" = "skip"`：冲突处理策略
  - `validate_checksums?: boolean = true`：是否验证校验和
- **返回（JSON，建议）**
  - `success: boolean`
  - `format_version: string`：备份格式版本
  - `compatible: boolean`：是否兼容当前版本
  - `stats: { entities: number; relations: number; vectors: number }`
  - `conflicts?: { entity_id: string; reason: string; resolution: string }[]`

**冲突处理策略**：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| `skip` | 跳过冲突实体，保留目标数据库的版本 | 默认，安全 |
| `override` | 覆盖目标数据库的版本 | 强制恢复 |
| `merge` | 智能合并（保留较新的版本，比较 `updated_at`） | 数据迁移 |
| `error` | 遇到冲突立即报错并回滚 | 严格模式 |

**版本兼容性检查**：

```typescript
function checkCompatibility(backupVersion: string, currentVersion: string): boolean {
  const [backupMajor, backupMinor] = backupVersion.split('.').map(Number);
  const [currentMajor, currentMinor] = currentVersion.split('.').map(Number);

  // 主版本号必须相同
  if (backupMajor !== currentMajor) {
    return false;
  }

  // 次版本号向后兼容（新版本可以恢复旧版本的备份）
  if (backupMinor > currentMinor) {
    return false;
  }

  return true;
}
```

### 3.15 `c4a_store_repair`（修复数据一致性）

> **适用模式**：仅 Server 模式（Local 模式使用 SQLite 事务保证一致性，无需此工具）

- **输入（建议）**
  - `scope?: "all" | "neo4j" | "milvus" = "all"`：修复范围
  - `dry_run?: boolean = false`：仅检测不修复
  - `entity_ids?: string[]`：指定实体 ID（可选，不指定则扫描全部）
- **返回（JSON，建议）**
  - `success: boolean`
  - `scanned: number`：扫描的实体数量
  - `inconsistencies: { entity_id: string; issue: string; fixed: boolean }[]`：不一致问题列表
  - `stats: { neo4j_fixed: number; milvus_fixed: number; failed: number }`

**修复逻辑**：

1. **Neo4j 修复**：
   - 扫描 MongoDB 中的实体和关系
   - 检测 Neo4j 中缺失的节点或关系
   - 重建缺失的图结构

2. **Milvus 修复**：
   - 扫描 MongoDB 中的实体
   - 检测 Milvus 中缺失的向量
   - 重新生成并插入缺失的向量

3. **使用场景**：
   - Neo4j/Milvus 写入失败后的补偿
   - 数据迁移后的一致性验证
   - 定期维护任务

**示例**：

```typescript
// 检测不一致（不修复）
c4a_store_repair({
  dry_run: true
})

// 修复所有不一致
c4a_store_repair({
  scope: "all"
})

// 仅修复特定实体的向量索引
c4a_store_repair({
  scope: "milvus",
  entity_ids: ["e-commerce-system", "user-service"]
})
```

---

### 3.16 `c4a_store_validate`（架构一致性检查）

> **设计目的**：在服务端执行架构一致性检查，避免 Agent 拉取大量实体到 Context 中自行分析。支持 `/c4a:analyze` Skill 和发布前检查。

**输入（概念签名）**：

```typescript
c4a_store_validate({
  // 检查范围
  proposal_id?: string;         // 指定 feat 分支（不传则检查主分支）

  // 检查项（可选，默认全部检查）
  checks?: Array<
    | "functional_spec"         // Functional Spec 完整性
    | "technical_spec"          // Technical Spec 完整性
    | "contracts"               // 契约完备度
    | "references"              // DSL 引用正确性
    | "adr_completeness"        // ADR 完备度（架构变更检测）
    | "checklist"               // 实现清单进度
  >;

  // 检查选项
  options?: {
    check_depth?: number;       // 依赖检查深度（默认 2）
    include_suggestions?: boolean;  // 是否返回修复建议（默认 true）
  };
})
```

**返回（概念示例）**：

```typescript
{
  success: true,
  proposal_id: "feat-a001-user-login",

  // 检查结果汇总
  summary: {
    passed: 4,
    warnings: 2,
    errors: 1,
    status: "failed"  // "passed" | "warnings" | "failed"
  },

  // 各项检查详情
  checks: {
    functional_spec: {
      status: "passed",
      message: "Functional Spec 完整"
    },
    technical_spec: {
      status: "error",
      message: "Technical Spec 完整性检查失败",
      errors: [
        {
          code: "MISSING_SYSTEM_REF",
          entity_id: "auth-service",
          message: "Container 'auth-service' 未关联 System",
          suggestion: "设置 data.system_id = 'e-commerce-system'"
        }
      ]
    },
    contracts: {
      status: "warning",
      message: "契约完备度检查有警告",
      warnings: [
        {
          code: "MISSING_CONTRACT",
          entity_id: "user-service",
          message: "HTTP API 缺少 OpenAPI 契约",
          suggestion: "使用 c4a_code_contract 生成契约"
        }
      ]
    },
    references: {
      status: "passed",
      message: "DSL 引用正确",
      dangling_count: 0
    },
    adr_completeness: {
      status: "warning",
      message: "检测到架构变更，但未找到关联的 ADR",
      changes_detected: [
        { type: "container_tech_change", entity_id: "db-service", detail: "MySQL → PostgreSQL" }
      ],
      suggestion: "创建 ADR 记录架构变更的背景和决策"
    },
    checklist: {
      status: "passed",
      progress: { completed: 8, total: 10, percentage: 80 },
      blocked: []
    }
  },

  // 修复建议（按优先级排序）
  suggestions: [
    "1. 修复 auth-service 的 System 关联",
    "2. 为 user-service 补充 OpenAPI 契约",
    "3. 创建 ADR 记录数据库迁移决策"
  ]
}
```

**检查项说明**：

| 检查项 | 检查内容 | 服务端实现 |
|--------|---------|-----------|
| `functional_spec` | Product、Business Process、Business SoR 完整性 | 查询 feat 内实体，验证必需字段 |
| `technical_spec` | System/Container/Component 定义、Technical SoR 关联 | 图谱遍历验证层级关系 |
| `contracts` | 对外接口有契约、契约关联 Component | 查询 IMPLEMENTS 关系 |
| `references` | 实体引用存在、无悬空引用 | 查询 resolved=false 的关系 |
| `adr_completeness` | 架构变更有 ADR、ADR 字段完整 | 对比 feat 与主分支的 Diff |
| `checklist` | 任务进度、阻塞状态 | 读取 checklist 统计 |

**性能优化**：

服务端采用**按依赖范围检查**策略，避免全量扫描：

```typescript
// 服务端实现伪代码
async function validate(proposal_id: string, checks: string[]) {
  // 1. 仅查询 feat 内的实体（增量）
  const featEntities = await db.find({ proposal_id });

  // 2. 按依赖范围确定检查范围
  const checkScope = await determineCheckScope(featEntities);

  // 3. 批量执行检查（并行）
  const results = await Promise.all(
    checks.map(check => runCheck(check, checkScope))
  );

  return aggregateResults(results);
}
```

| 项目规模 | 全量检查 | 按依赖检查 | 性能提升 |
|---------|---------|-----------|---------|
| 100 实体 | ~200ms | ~50ms | 4x |
| 1000 实体 | ~2s | ~200ms | 10x |
| 5000 实体 | ~10s | ~500ms | 20x |

**使用示例**：

```typescript
// 完整检查（/c4a:analyze 调用）
c4a_store_validate({
  proposal_id: "feat-a001-user-login"
})

// 仅检查契约和引用（快速检查）
c4a_store_validate({
  proposal_id: "feat-a001-user-login",
  checks: ["contracts", "references"]
})

// 发布前检查（/c4a:feat --status=published 调用）
c4a_store_validate({
  proposal_id: "feat-a001-user-login",
  options: { include_suggestions: true }
})
```

---

