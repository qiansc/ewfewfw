# 存储 CRUD 操作：`c4a_store_*`


### 3.1 `c4a_store_save`（保存/更新实体）

- **输入（建议）**
  - `type: "system" | "container" | "component" | "adr" | "contract" | "product" | "process" | "sor"`：实体类型
  - `data?: object`：实体内容（业务数据对象，与 `content` 二选一）
  - `content?: string`：实体内容（YAML/JSON 字符串，与 `data` 二选一，用于 Remote 模式的文件流传输）
  - `format?: "yaml" | "json"`：`content` 的格式（当使用 `content` 时必填，默认 `"yaml"`）
  - `id?: string`：指定 ID（不传则可由系统生成）
  - `source_project?: string`：实体归属项目（用于权限校验）
    - 单项目 feat：可省略，CLI/Agent 自动填充当前项目 ID
    - 跨项目 feat：**必须显式指定**，明确实体属于哪个项目
    - 权限检查：基于此字段验证用户是否有目标项目的写权限
    - 存储位置：保存到 `metadata.source_project` 字段
  - `proposal_id?: string | null`：feat/提案隔离（主分支为 null）
    - **格式约束**：`^feat-[a-z0-9]+(-[a-z0-9]+)*$`（小写字母、数字、连字符，必须以 `feat-` 开头）
    - 有效示例：`feat-a001`、`feat-a001-user-login`、`feat-b002-add-oauth`
    - 无效示例：`feat_a001`（下划线）、`Feat-A001`（大写）、`a001`（缺少前缀）
  - `enforce_adr?: boolean = false`：是否强制 ADR 检查（保存 system/container/component 且 status=published 时生效）
  - `skip_adr_check?: boolean = false`：跳过 ADR 检查（需要特殊权限，用于系统级操作）
  - `ignore_concurrent_warning?: boolean = false`：忽略并发修改警告（用户已确认继续修改）
  - `force_save?: boolean = false`：强制保存（跳过所有警告，需要特殊权限）
- **返回（JSON，建议）**
  - `success: boolean`
  - `id: string`
  - `status: "draft" | "approved" | "published" | "deprecated" | "archived"`
  - `adr_check?: { required: boolean; passed: boolean; missing_adr?: boolean; message?: string }`：ADR 检查结果（仅当触发检查时返回）
  - `warnings?: Warning[]`：警告信息列表（不阻止保存，但需要用户注意）

**输入格式说明**：

`data` 和 `content` 参数二选一，用于不同场景：

| 参数 | 类型 | 适用场景 | 示例 |
|------|------|---------|------|
| `data` | `object` | Agent 程序调用、Local 模式 | `{ id: "auth-service", name: "认证服务", ... }` |
| `content` + `format` | `string` | CLI Remote 模式、文件流传输 | `"id: auth-service\nname: 认证服务\n..."` + `"yaml"` |

**验证规则**：
- 必须提供 `data` 或 `content` 其中之一
- 同时提供两者时返回错误
- 使用 `content` 时必须同时指定 `format`
- `content` 内容会被解析为对应格式的对象后进行 Schema 验证

**ADR 检查逻辑**：

当满足以下条件时触发 ADR 检查：
1. 实体类型为 `system`、`container` 或 `component`
2. 实体状态为 `published`
3. `skip_adr_check=false`

检查规则：
- 如果 `enforce_adr=true` 或项目配置 `adr_policy.enforce=true`：
  - 检查是否存在关联的 ADR（通过 `REFERENCES` 关系）
  - 如果没有 ADR：
    - `adr_policy.on_missing=error`：返回错误，阻止保存
    - `adr_policy.on_missing=warning`：返回警告，允许保存
    - `adr_policy.on_missing=ignore`：不检查
- 如果 `enforce_adr=false` 且项目未配置 ADR 策略：不检查

**Warning 类型定义**：

```typescript
interface Warning {
  code: "CONCURRENT_MODIFICATION" | "MISSING_ADR" | "DEPRECATED_DEPENDENCY" | string;
  message: string;
  severity: "info" | "warning" | "error";  // error 级别的警告可被 ignore_concurrent_warning 忽略
  details?: {
    concurrent_feats?: {
      feat_id: string;
      status: string;
      updated_by: string;
      updated_at: string;
      changes_summary?: string;
    }[];
    missing_adr?: boolean;
    [key: string]: any;
  };
}
```

**返回示例**：

```json
// 成功保存，但缺少 ADR（warning 模式）
{
  "success": true,
  "id": "user-service",
  "status": "published",
  "adr_check": {
    "required": true,
    "passed": false,
    "missing_adr": true,
    "message": "警告：此 container 缺少关联的 ADR，建议补充架构决策记录"
  }
}
```

**内部行为（副作用）**：

保存实体时，系统会自动执行以下操作：

| 行为 | 说明 | 详细文档 |
|------|------|---------|
| **引用自动解析** | 解析 `references` 字段中的简单 ID 为完整引用格式，创建 `REFERENCES` 关系 | [cross-reference.md#1.10](../data-ops/cross-reference.md#110-保存时的自动解析) |
| **悬空引用处理** | 引用的实体不存在时创建悬空引用（`resolved: false`），目标实体创建后自动解析 | [cross-reference.md#1.11](../data-ops/cross-reference.md#111-悬空引用处理) |
| **content_hash 计算** | 自动计算并存储内容哈希（SHA-256），用于同步时的冲突检测 | [sync-export.md#2.3](../data-ops/sync-export.md#23-冲突检测算法) |

> **注意**：这些副作用对调用者透明，但会影响数据库中的关系数据。Agent 无需手动处理引用解析。

**返回示例（续）**：

```json

// 成功保存，但有并发修改警告
{
  "success": true,
  "id": "auth-service",
  "status": "draft",
  "warnings": [
    {
      "code": "CONCURRENT_MODIFICATION",
      "message": "实体 auth-service 正在被其他 feat 修改",
      "severity": "warning",
      "details": {
        "concurrent_feats": [
          {
            "feat_id": "feat-a001",
            "status": "approved",
            "updated_by": "user-a@example.com",
            "updated_at": "2026-01-22T13:00:00Z",
            "changes_summary": "升级到 v2.0, 新增 OAuth 支持"
          }
        ]
      }
    }
  ]
}

// 保存失败，缺少 ADR（error 模式）
{
  "success": false,
  "error": {
    "code": "C4A-STORE-ADR-001",
    "message": "发布 system/container/component 需要关联 ADR",
    "details": {
      "entity_id": "user-service",
      "entity_type": "container",
      "missing_adr": true,
      "suggestion": "请先创建 ADR 记录架构决策，然后通过 REFERENCES 关系关联"
    }
  }
}
```

### 3.2 `c4a_store_read`（读取实体/列表）

- **输入（建议）**
  - `id?: string`
  - `format?: "object" | "yaml" | "json"`：返回格式（默认 `"object"`）
    - `"object"`：返回业务对象（用于程序处理）
    - `"yaml"` / `"json"`：返回格式化字符串（用于 Remote 模式的文件流传输）
  - `proposal_id?: string | string[] | null`：Feat 隔离查询
    - `null`：仅查询主分支实体（默认）
    - `"feat-xxx"`：查询合并视图（主分支 + Feat，Feat 版本优先）
    - `["feat-xxx", "feat-yyy"]`：查询多 Feat 合并视图
  - `filter?: object`
  - `limit?: number`
  - `include_relations?: boolean`
  - `filter_relations?: object`：关系过滤条件（仅当 `include_relations=true` 时有效）
- **返回（JSON，建议）**
  - 当 `format="object"`（默认）：单实体或实体列表（按 `id`/`filter` 决定）
  - 当 `format="yaml"` 或 `"json"`：
    ```typescript
    {
      id: string;
      type: string;
      status: string;
      content: string;  // YAML 或 JSON 格式的字符串
      format: "yaml" | "json";
    }
    ```

**format 参数说明**：

| format 值 | 返回内容 | 适用场景 |
|-----------|---------|---------|
| `"object"`（默认） | 业务对象 | Agent 程序处理、Local 模式 |
| `"yaml"` | YAML 字符串 | Remote 模式同步、导出到文件 |
| `"json"` | JSON 字符串 | Remote 模式同步、API 集成 |

**查询行为（Copy-on-Write 机制）**：

| proposal_id 参数 | 查询行为 | 返回结果 |
|-----------------|---------|---------|
| `null`（默认） | 仅查询主分支 | 主分支实体（proposal_id=NULL） |
| `"feat-xxx"` | 合并视图 | 主分支 + Feat，Feat 版本覆盖主分支同名实体 |
| `["feat-xxx", "feat-yyy"]` | 多 Feat 合并视图 | 主分支 + 多个 Feat，后面的 Feat 优先 |

**查询示例**：

```typescript
// 查询主分支实体（默认）
c4a_store_read({ id: "auth-service" })
// 返回：主分支的 auth-service（如果存在）

// 查询 feat-a001 的合并视图
c4a_store_read({ id: "auth-service", proposal_id: "feat-a001" })
// 返回：
// - 如果 feat-a001 修改了 auth-service → 返回 feat 版本
// - 如果 feat-a001 未修改 auth-service → 返回主分支版本
// - 如果主分支和 feat 都没有 → 返回 null

// 查询 feat-a001 的所有实体（合并视图）
c4a_store_read({ proposal_id: "feat-a001" })
// 返回：主分支所有实体 + feat-a001 的实体（feat 版本覆盖主分支）

// 查询多个 feat 的合并视图
c4a_store_read({ proposal_id: ["feat-a001", "feat-a002"] })
// 返回：主分支 + feat-a001 + feat-a002（后面的优先）
```

**SQL 实现示例**（合并视图）：

```sql
-- 查询 feat-a001 的合并视图
WITH all_entities AS (
  SELECT * FROM entities
  WHERE proposal_id IS NULL OR proposal_id = 'feat-a001'
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY id
      ORDER BY CASE WHEN proposal_id = 'feat-a001' THEN 0 ELSE 1 END
    ) AS rn
  FROM all_entities
)
SELECT * FROM ranked WHERE rn = 1;
```

### 3.3 `c4a_store_list`（列出实体概要）

- **输入（建议）**
  - `filter?: object`：通用过滤条件
  - `type?: "system" | "container" | "component" | "adr" | "product" | "process" | "sor" | "contract" | "all"`：类型筛选
  - `project_id?: string`：按项目 ID 筛选（可选）
  - `proposal_id?: string | null`：按提案 ID 筛选（`null` 仅主分支，`string` 为指定提案，不传则返回全部）
  - `status?: "draft" | "approved" | "published" | "deprecated" | "archived"`：按状态筛选（可选）
  - `updated_after?: string`：按更新时间筛选（ISO 8601 格式）
  - `limit?: number = 100`：返回结果数量上限
  - `offset?: number = 0`：分页偏移量
  - `group_by?: "type" | "status"`：分组统计（可选）
  - `count_only?: boolean = false`：仅返回数量统计，不返回实体列表（大型项目推荐）
- **返回（JSON，建议）**
  - 当 `count_only=true` 时：
    ```typescript
    { total: number; by_type?: Record<string, number>; by_status?: Record<string, number> }
    ```
  - 当 `group_by` 未指定时：
    ```typescript
    {
      items: {
        id: string;
        type: string;
        status: string;
        updated_at: string;
        content_hash: string;
        source_project?: string;
        proposal_id?: string;
      }[];
      pagination: { total: number; offset: number; limit: number; has_more: boolean };
    }
    ```
  - 当 `group_by` 指定时：`groups: { [key: string]: { count: number; items?: [...] } }`

> **设计说明**：`content_hash` 和 `updated_at` 为必需字段，CLI 可通过单次 `list` 调用获取足够信息进行冲突检测，避免 N+1 查询问题（Remote 模式下尤为重要）。只有真正需要下载内容时才调用 `c4a_store_read`。

> **proposal_id 筛选行为**：
> - `proposal_id: null`：仅返回主分支实体
> - `proposal_id: "feat-xxx"`：返回指定提案分支的实体（包含 CoW 副本）
> - 不传 `proposal_id`：返回所有实体（主分支 + 所有 feat 分支）

### 3.4 `c4a_store_delete`（删除实体）

- **输入（建议）**
  - `id: string`：实体 ID（必需）
  - `proposal_id?: string | null`：feat/提案隔离（默认 null 表示主分支）
  - `force?: boolean = false`：强制删除（跳过关联检查，需要特殊权限）
- **返回（JSON，建议）**
  - `success: boolean`
  - `id: string`
  - `deleted_relations?: number`：级联删除的关系数量

**删除规则**：

| 场景 | 行为 | 说明 |
|------|------|------|
| 删除主分支实体 | 检查是否有 feat 在修改 | 有则返回警告，用户确认后删除 |
| 删除 feat 中的实体（feat 新建） | 物理删除 feat 副本 | 不影响主分支 |
| **删除 feat 中的实体（主分支已存在）** | **转换为软删除** | **自动设置 `status: "archived"`，不物理删除** |
| 实体被其他实体引用 | 返回错误 | 除非 `force=true` |
| 删除 System | 级联检查 Container | 有关联 Container 时返回错误 |
| 删除 Container | 级联检查 Component | 有关联 Component 时返回错误 |

> **重要：删除 vs 废弃的语义区分**
>
> | 操作 | 含义 | 使用场景 | 实现方式 |
> |------|------|---------|---------|
> | **撤销修改**（Revert） | 撤销 feat 中对实体的修改 | feat 内新建的实体不再需要 | `c4a_store_delete` 物理删除 feat 副本 |
> | **业务废弃**（Deprecate） | 废弃主分支已存在的实体 | 服务下线、功能移除 | 状态流转 `published → deprecated → archived` |
>
> 详见 [cross-project-transaction.md#6.5](../data-ops/cross-project-transaction.md#65-feat-发布的事务处理)

**返回示例**：

```json
// 成功删除
{
  "success": true,
  "id": "legacy-service",
  "deleted_relations": 3
}

// 删除失败：有关联实体
{
  "success": false,
  "error": {
    "code": "C4A-STORE-REF-001",
    "message": "无法删除：实体被其他实体引用",
    "details": {
      "entity_id": "user-service",
      "referenced_by": [
        { "id": "api-gateway", "type": "container", "relation": "DEPENDS_ON" },
        { "id": "adr-001", "type": "adr", "relation": "REFERENCES" }
      ],
      "suggestion": "请先删除或修改引用此实体的其他实体，或使用 force=true 强制删除"
    }
  }
}

// 删除失败：有 feat 在修改
{
  "success": false,
  "error": {
    "code": "C4A-STORE-FEAT-001",
    "message": "无法删除：实体正在被 feat 修改",
    "details": {
      "entity_id": "auth-service",
      "concurrent_feats": [
        { "feat_id": "feat-a001", "status": "draft", "updated_by": "alice@example.com" }
      ],
      "suggestion": "请先等待相关 feat 发布或废弃"
    }
  }
}
```

