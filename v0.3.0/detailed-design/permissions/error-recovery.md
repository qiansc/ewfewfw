## 2. 错误处理和恢复流程

> **版本说明**：
>
> `packages/core/src/types/errors.ts` 已包含完整的错误处理基础设施：
> - 7 类错误码（INPUT/DATA/SYS/BIZ/STORE/PERM/MIGRATE）
> - HTTP 状态码映射
> - 多语言消息
> - C4AError 基类和子类
> - `toMcpErrorResponse` / `errorToMcpResponse` 函数
>
> **本版本新增**：Gateway 错误码（SYS-006~009）
>
> **延后到 v0.4.0**：Skill 错误处理、归档检查、Server 数据修复、数据备份配置

### 2.1 错误分类

| 错误类型 | 说明 | 示例 | 恢复策略 |
|---------|------|------|---------|
| **用户输入错误** | 用户提供的信息不完整或错误 | 缺少必填字段 | 提示用户补充 |
| **数据一致性错误** | 数据不符合一致性规则 | 引用的实体不存在 | 提供修复建议 |
| **系统错误** | 数据库、网络等系统问题 | 数据库连接失败 | 重试或降级 |
| **业务逻辑错误** | 违反业务规则 | 状态流转非法 | 阻止操作，说明原因 |
| **权限错误** | 用户无权限执行操作 | 无写权限 | 提示权限不足 |

### 2.2 错误处理原则

1. **明确错误原因**：错误信息应清晰说明问题所在
2. **提供修复建议**：告诉用户如何解决问题
3. **保护数据完整性**：错误发生时回滚事务
4. **记录错误日志**：便于问题追溯和分析
5. **用户友好**：避免技术术语，使用自然语言

### 2.2.1 错误处理的分层职责

> **关键设计**：MCP 工具是无状态 API，不能发起交互式询问。交互逻辑由上层（CLI/Agent）负责。

| 层级 | 职责 | 能力 |
|------|------|------|
| **MCP 工具层** | 返回结构化错误响应 | 返回错误码、建议、可恢复操作列表 |
| **CLI 层** | 呈现交互式选项 | TTY 交互、用户输入、菜单选择 |
| **Agent 层** | 自主决策或询问用户 | 根据错误类型决定重试、跳过或询问 |

**MCP 错误响应格式**：

```typescript
interface McpErrorResponse {
  code: string;           // 错误码，如 "C4A-BIZ-001"
  message: string;        // 错误消息
  details?: object;       // 详细信息
  timestamp: string;      // 错误发生时间（ISO 8601）
  request_id?: string;    // 请求 ID（用于追踪）
  recoverable_actions?: RecoverableAction[];  // 可恢复操作（由上层决定如何呈现）
}

interface RecoverableAction {
  action: string;           // 操作标识，如 "retry", "force", "skip"
  label: string;            // 操作描述
  params?: object;          // 重试时需要的参数
}
```

**示例：MCP 工具返回可恢复错误**

```typescript
// MCP 工具返回（不包含交互逻辑）
{
  code: "C4A-BIZ-002",
  message: "feat 状态为 draft，无法开始实现",
  details: {
    suggestion: "先执行状态流转到 approved"
  },
  timestamp: "2026-01-22T10:30:00Z",
  recoverable_actions: [
    { action: "approve_first", label: "先批准方案再继续", params: { auto_approve: true } },
    { action: "cancel", label: "取消操作" }
  ]
}
```

**CLI 呈现交互**（基于 MCP 响应）：

```
❌ 无法开始实现

当前 feat 状态为 draft，需要先批准方案才能开始实现。

? 如何处理？
  > 先批准方案再继续
    取消操作
```

**Agent 自主决策**（基于 MCP 响应）：

```typescript
// Agent 收到错误后的处理逻辑
if (error.recoverable_actions?.some(a => a.action === "approve_first")) {
  // Agent 可以自主决定执行 approve_first，或询问用户
  if (autoApproveEnabled) {
    await executeAction("approve_first", error.recoverable_actions[0].params);
  } else {
    await askUser("是否先批准方案？", error.recoverable_actions);
  }
}
```

> **注意**：后续章节中的"用户交互示例"描述的是 **CLI/Agent 层的呈现方式**，而非 MCP 工具的返回格式。MCP 工具只返回结构化数据，不包含交互逻辑。

### 2.3 `/c4a:implement` 错误处理

#### 2.3.1 前置条件检查失败

**场景**：feat 状态为 draft，无法开始实现

**处理流程**：
```
1. Agent 检测到 feat 状态为 draft
2. 提示用户："方案尚未批准，请先执行 /c4a:feat --status=approved"
3. 询问用户：
   - 现在批准方案（自动执行 /c4a:feat --status=approved）
   - 稍后手动批准
   - 取消操作
4. 如用户选择"现在批准"，执行批准流程后继续
```

**用户交互示例**：
```
Agent:
❌ 无法开始实现

当前 feat 状态为 draft，需要先批准方案才能开始实现。

? 如何处理？
  > 现在批准方案（自动执行 /c4a:feat --status=approved）
    稍后手动批准
    取消操作
```

#### 2.3.2 实现清单生成失败

**场景**：Technical Spec 不完整，无法生成实现清单

**处理流程**：
```
1. Agent 尝试生成实现清单
2. 发现 Technical Spec 缺少关键信息（如 Container 未定义）
3. 提示用户："Technical Spec 不完整，无法生成实现清单"
4. 列出缺失的信息
5. 询问用户：
   - 补充 Technical Spec（引导用户回到 /c4a:plan）
   - 跳过缺失项，生成部分清单
   - 取消操作
```

**用户交互示例**：
```
Agent:
⚠️ Technical Spec 不完整

缺少以下信息：
1. Container 'auth-service' 未定义
2. Component 'jwt-validator' 缺少 container_id

? 如何处理？
  > 补充 Technical Spec（返回 /c4a:plan）
    跳过缺失项，生成部分清单
    取消操作
```

### 2.4 `/c4a:analyze` 错误处理

#### 2.4.1 一致性检查失败

**场景**：发现错误或警告

**处理流程**：
```
1. Agent 执行一致性检查
2. 发现 3 个错误、2 个警告
3. 展示详细信息（按级别分类）
4. 询问用户：
   - 修复错误后继续（Agent 提供修复建议）
   - 忽略警告继续（仅当无错误时）
   - 查看详细信息
   - 取消操作
5. 如用户选择"修复"，Agent 引导逐个修复
```

**用户交互示例（有错误）**：
```
Agent:
❌ 检查失败，发现 3 个错误：

1. [Technical Spec] Container 'auth-service' 未关联 System
   建议：设置 data.system_id = 'e-commerce-system'

2. [Contract] Component 'order-processor' 缺少 Contract
   建议：创建 OpenAPI 契约描述 /api/orders 接口

3. [Reference] entity_id 'payment-service' 不存在
   建议：检查拼写或创建该实体

? 如何处理？
  > 修复错误后继续
    查看详细信息
    取消操作
```

**用户交互示例（只有警告）**：
```
Agent:
⚠️ 检查通过，但有 2 个警告：

1. [Functional Spec] Product 缺少描述
   建议：补充 data.description 字段

2. [Contract] 缺少 AsyncAPI 契约（消息队列接口）
   建议：为 'notification-service' 创建 AsyncAPI 契约

? 如何处理？
  > 忽略警告，继续操作
    修复警告后继续
    查看详细信息
    取消操作
```

### 2.5 `/c4a:feat --status=published` 错误处理

#### 2.5.1 合并冲突

**场景**：主分支实体已被修改

**处理流程**：
```
1. Agent 检测到冲突
2. 展示冲突详情：
   - 主分支版本：1.5
   - feat 版本：2.0
   - 冲突字段：version, description
3. Agent 分析冲突，提供决策建议
4. 询问用户：
   - 保留主分支版本
   - 保留 feat 版本
   - 手动合并（Agent 辅助）
   - 取消发布
5. 用户确认后，继续合并剩余实体
```

**用户交互示例**：
```
Agent:
⚠️ 发现合并冲突

实体: payment-service
主分支版本: 1.5 (更新于 2026-01-20 by Bob)
feat 版本: 2.0 (更新于 2026-01-22 by Alice)

冲突字段:
- version: 1.5 vs 2.0
- description: "支付服务" vs "支付服务（支持微信、支付宝）"

Agent 建议：保留 feat 版本（包含更详细的描述）

? 如何处理？
  > 保留 feat 版本（推荐）
    保留主分支版本
    手动合并
    取消发布
```

#### 2.5.2 部分合并失败

**场景**：部分实体合并成功，部分失败

**处理流程**：
```
1. Agent 记录已合并的实体
2. 展示失败的实体和原因
3. 询问用户：
   - 修复失败项后继续
   - 回滚已合并的实体
   - 保持当前状态（部分合并）
4. 如用户选择"回滚"，恢复到发布前状态
```

**用户交互示例**：
```
Agent:
⚠️ 部分合并失败

已成功合并：5/8 个实体
- ✅ auth-service
- ✅ jwt-validator
- ✅ login-api
- ✅ user-model
- ✅ api-auth-login

合并失败：3/8 个实体
- ❌ payment-service (冲突: 主分支已删除)
- ❌ order-processor (引用错误: container_id 不存在)
- ❌ notification-service (权限不足: 无项目 'messaging' 的写权限)

? 如何处理？
  > 修复失败项后继续
    回滚已合并的实体
    保持当前状态（部分合并）
    取消发布
```

#### 2.5.3 一致性检查失败（发布前强制检查）

**场景**：发布前自动调用 `/c4a:analyze`，发现错误

**处理流程**：
```
1. Agent 在发布前自动调用 /c4a:analyze
2. 发现错误，阻止发布
3. 展示错误详情
4. 询问用户：
   - 修复错误后重新发布
   - 强制发布（跳过检查，需使用 --force）
   - 取消发布
```

> **注意**：发布前一致性检查默认**强制执行**，特殊场景（如紧急修复、已知问题暂缓修复）可通过 `--force` 跳过。

**用户交互示例**：
```
Agent:
❌ 发布前检查失败

发现 2 个错误，无法发布：

1. [Contract] Component 'order-processor' 缺少 Contract
   建议：创建 OpenAPI 契约描述 /api/orders 接口

2. [Reference] entity_id 'payment-service' 不存在
   建议：检查拼写或创建该实体

? 如何处理？
  > 修复错误后重新发布
    强制发布（/c4a:feat --status=published --force）
    取消发布
```

### 2.6 系统错误处理

#### 2.6.1 数据库连接失败

**处理流程**：
```
1. Agent 检测到数据库连接失败
2. 自动重试 3 次（间隔 1s, 2s, 4s）
3. 如仍失败，提示用户：
   - 检查数据库服务是否运行
   - 检查网络连接
   - 查看日志文件
4. 提供降级方案（如使用本地缓存）
```

**用户交互示例**：
```
Agent:
❌ 数据库连接失败

已尝试重连 3 次，仍无法连接到数据库。

可能原因：
1. 数据库服务未启动（运行 ./start.sh dev 启动服务）
2. 网络连接问题
3. 配置错误（检查 .env 文件）

? 如何处理？
  > 重试连接
    查看日志文件
    使用本地缓存（只读模式）
    取消操作
```

#### 2.6.2 MCP 工具调用失败

**处理流程**：
```
1. Agent 检测到工具调用失败
2. 记录错误日志
3. 提示用户：
   - 工具名称
   - 错误信息
   - 建议操作
4. 询问用户：
   - 重试
   - 跳过此步骤
   - 取消操作
```

**用户交互示例**：
```
Agent:
❌ MCP 工具调用失败

工具: c4a_store_save
错误: Connection timeout after 30s

可能原因：
1. storage-backend 服务未响应
2. 网络延迟过高
3. 数据量过大

? 如何处理？
  > 重试
    跳过此步骤
    取消操作
```

### 2.7 恢复机制

#### 2.7.1 操作日志

所有关键操作记录到日志：

```typescript
interface OperationLog {
  id: string;
  timestamp: string;
  user: string;
  operation: string;  // 'create_feat' | 'save_entity' | 'publish_feat' | ...
  params: any;
  result: 'success' | 'failed' | 'partial';
  error?: string;
}

// 记录操作
async function logOperation(log: OperationLog) {
  await db.prepare(`
    INSERT INTO operation_logs (id, timestamp, user, operation, params, result, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.id,
    log.timestamp,
    log.user,
    log.operation,
    JSON.stringify(log.params),
    log.result,
    log.error
  );
}
```

#### 2.7.2 回滚支持

支持回滚的操作：

| 操作 | 回滚方式 | 说明 |
|------|---------|------|
| feat 发布 | 回滚到 approved 状态 | 恢复实体的 proposal_id |
| 实体修改 | 恢复到上一版本 | 从历史记录恢复 |
| 状态流转 | 回退到前一状态 | 更新 metadata.status |

不支持回滚的操作：

| 操作 | 原因 | 替代方案 |
|------|------|---------|
| 实体删除 | 软删除 | 可恢复（设置 deleted=true） |
| 关系删除 | 记录历史 | 可恢复（从历史记录恢复） |

#### 2.7.3 归档检查

实体从 `deprecated` 流转到 `archived` 需满足以下条件：

1. **最小保留期**：deprecated 状态至少保持配置的天数（默认 30 天）
2. **无活跃引用**：没有 `published` 状态的实体引用此实体
3. **无 feat 引用**：没有 `draft` 或 `approved` 状态的 feat 引用此实体
4. **人工确认**：需要管理员或实体负责人确认归档

**归档配置**（`.c4a.yaml`）：

```yaml
archive:
  # 最小保留期（天），deprecated 状态需保持的最短时间
  min_retention_days: 30
  # 是否需要人工确认归档
  require_confirmation: true
```

**归档检查实现**：

```typescript
async function canArchive(entityId: string): Promise<{ canArchive: boolean; reason?: string }> {
  // 读取归档配置
  const config = await loadArchiveConfig();
  const minRetentionDays = config.min_retention_days ?? 30;

  // 1. 检查最小保留期
  const entity = await getEntity(entityId);
  const deprecatedDays = daysSince(entity.deprecated_at);
  if (deprecatedDays < minRetentionDays) {
    return {
      canArchive: false,
      reason: `需要保持 deprecated 状态至少 ${minRetentionDays} 天（当前 ${deprecatedDays} 天）`
    };
  }

  // 2. 检查是否有 published 实体引用
  const publishedRefs = await db.query(`
    SELECT r.source_id, r.source_proposal_id, e.id, e.type
    FROM relations r
    JOIN metadata m ON r.source_id = m.entity_id
      AND (r.source_proposal_id = m.proposal_id OR (r.source_proposal_id IS NULL AND m.proposal_id IS NULL))
    JOIN entities e ON m.entity_id = e.id
    WHERE r.target_id = ? AND m.status = 'published'
  `, [entityId]);

  if (publishedRefs.length > 0) {
    return {
      canArchive: false,
      reason: `被 ${publishedRefs.length} 个 published 实体引用`
    };
  }

  // 3. 检查是否有 feat 引用
  const featRefs = await db.query(`
    SELECT r.source_id, r.source_proposal_id, m.proposal_id
    FROM relations r
    JOIN metadata m ON r.source_id = m.entity_id
      AND (r.source_proposal_id = m.proposal_id OR (r.source_proposal_id IS NULL AND m.proposal_id IS NULL))
    WHERE r.target_id = ?
      AND m.proposal_id IS NOT NULL
      AND m.status IN ('draft', 'approved')
  `, [entityId]);

  if (featRefs.length > 0) {
    return {
      canArchive: false,
      reason: `被以下 feat 引用：${featRefs.map(r => r.proposal_id).join(', ')}`
    };
  }

  return { canArchive: true };
}
```

**回滚实现示例**：

```typescript
// 回滚 feat 发布
async function rollbackFeatPublish(featId: string) {
  const transaction = db.transaction(() => {
    // 1. 恢复 feat 状态
    db.prepare(`
      UPDATE metadata
      SET status = 'approved'
      WHERE entity_id = ?
    `).run(featId);

    // 2. 恢复所有关联实体的 proposal_id
    db.prepare(`
      UPDATE metadata
      SET proposal_id = ?, status = 'approved'
      WHERE proposal_id IS NULL
        AND entity_id IN (
          SELECT id FROM entities WHERE /* 查询条件 */
        )
    `).run(featId);

    // 3. 记录回滚操作
    logOperation({
      id: generateId(),
      timestamp: new Date().toISOString(),
      user: getCurrentUser(),
      operation: 'rollback_feat_publish',
      params: { feat_id: featId },
      result: 'success'
    });
  });

  transaction();
}
```

#### 2.7.3 数据一致性修复（Server 模式）

> **适用模式**：仅 Server 模式（Local 模式使用 SQLite 事务保证一致性，无需此工具）

Server 模式采用多存储架构（MongoDB + Neo4j + Milvus），可能出现索引不一致的情况。使用 `c4a_store_repair` 工具修复：

**使用场景**：

| 场景 | 说明 | 修复命令 |
|------|------|---------|
| Neo4j 写入失败 | 实体已保存到 MongoDB，但图关系未同步 | `c4a_store_repair --scope=neo4j` |
| Milvus 写入失败 | 实体已保存，但向量索引缺失 | `c4a_store_repair --scope=milvus` |
| 数据迁移后验证 | 从备份恢复后检查一致性 | `c4a_store_repair --dry-run` |
| 定期维护 | 后台任务定期扫描修复 | `c4a_store_repair --scope=all` |

**CLI 命令**：

```bash
# 检测不一致（不修复）
c4a server repair --dry-run

# 修复所有不一致
c4a server repair

# 仅修复 Neo4j 图索引
c4a server repair --scope=neo4j

# 仅修复 Milvus 向量索引
c4a server repair --scope=milvus

# 修复特定实体
c4a server repair --entity-ids=e-commerce-system,user-service
```

**返回示例**：

```json
{
  "success": true,
  "scanned": 150,
  "inconsistencies": [
    {
      "entity_id": "user-service",
      "issue": "Neo4j 节点缺失",
      "fixed": true
    },
    {
      "entity_id": "order-service",
      "issue": "Milvus 向量缺失",
      "fixed": true
    }
  ],
  "stats": {
    "neo4j_fixed": 1,
    "milvus_fixed": 1,
    "failed": 0
  }
}
```

> 详细的工具参数和返回格式请参考 [mcp-tools.md#3.10](./mcp-tools.md#310-c4a_store_repair修复数据一致性)

#### 2.7.4 数据备份

定期自动备份：

```typescript
// 自动备份配置
interface BackupConfig {
  enabled: boolean;
  interval: string;  // cron 表达式，如 "0 2 * * *" (每天凌晨 2 点)
  retention: number;  // 保留天数
  location: string;   // 备份目录
}

// 执行备份
async function performBackup(config: BackupConfig) {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const backupFile = `${config.location}/backup-${timestamp}.json`;

  // 导出数据
  await exportData(backupFile);

  // 清理过期备份
  await cleanupOldBackups(config.location, config.retention);
}
```

---
