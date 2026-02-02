# 同步操作：`c4a_store_sync` / `c4a_store_plan_sync`


### 3.5 `c4a_store_sync`（文件系统 ↔ 数据库）

> **重要说明**：此工具仅适用于 **Local 模式**（MCP 工具嵌入 CLI，可访问本地文件系统）。
>
> **Server/Remote 模式**：MCP 服务运行在独立进程（Docker 容器或远程服务器），无法访问用户本地 `.context/` 目录。这些模式下使用 `c4a_store_plan_sync` 实现同步（见 3.5.1 节）。

- **输入（定义）**
  - `direction: "import" | "export"`
  - `status_filter?: "published" | "approved" | "all" = "published"`：按实体状态筛选
  - `path?: string = ".context"`（⚠️ 需路径安全校验）
  - `format?: "yaml" | "json" = "yaml"`（仅 export 时使用）
  - `mode?: "incremental" | "full" = "incremental"`
  - `conflict_policy?: "warn" | "skip" | "override" | "prompt" = "skip"`（仅 export 时使用）
- **返回（JSON，定义）**
  - `success: boolean`
  - `stats: { scanned; created; updated; skipped; conflicted; failed }`
  - `details?: object[]`

**适用模式**：
- ✅ Local 模式：MCP 工具可直接访问本地文件系统
- ❌ Server 模式：MCP 服务在 Docker 容器中，无法访问用户本地文件
- ❌ Remote 模式：MCP 服务在远程服务器，无法访问用户本地文件

> **安全要求：路径遍历防护**
>
> `path` 参数必须进行安全校验，防止恶意 Agent 访问项目外文件：
> - 禁止父目录引用（`..`）
> - 禁止绝对路径
> - 解析后的路径必须在项目根目录内
> - 符号链接解析后仍需在项目内
>
> 详见 [error-codes.md](../permissions/error-codes.md#55-路径安全校验path-traversal-防护)

### 3.5.1 `c4a_store_plan_sync`（Server/Remote 模式同步计划）

> **设计目的**：将同步的核心逻辑（Diff 计算、冲突检测、删除识别）下沉到 Server 端，CLI 只负责收集本地文件摘要和执行操作指令，避免 CLI 端实现复杂的三方对比逻辑。支持两种模式：计划模式（返回操作列表）和执行模式（Server 端事务性批量执行）。

**适用模式**：
- ❌ Local 模式：使用 `c4a_store_sync` 即可
- ✅ Server 模式：MCP 服务在 Docker 容器中
- ✅ Remote 模式：MCP 服务在远程服务器

**输入（概念签名）**：

```typescript
c4a_store_plan_sync({
  // 本地文件摘要列表
  local_manifest: {
    files: Array<{
      path: string;           // 相对路径，如 "technical/containers/auth-service.yaml"
      entity_id: string;      // 实体 ID
      type: string;           // 实体类型
      content_hash: string;   // 内容哈希（SHA-256）
      updated_at: string;     // 本地文件修改时间（ISO 8601）
      proposal_id?: string;   // feat 分支标识（主分支为 undefined）
      content?: string;       // 文件内容（execute=true 时必须提供）
    }>;
  };

  // 上次同步快照（首次同步时为 null）
  snapshot?: {
    synced_at: string;
    entities: Record<string, {
      content_hash: string;
      proposal_id?: string;
    }>;
  } | null;

  // 同步选项
  options?: {
    proposal_id?: string;     // 指定同步的 feat 分支（不传则同步主分支）
    status_filter?: "published" | "approved" | "all";
    conflict_policy?: "warn" | "skip" | "override" | "prompt";
  };

  // 执行模式（默认 false）
  execute?: boolean;          // true: Server 端直接执行上传，保证事务原子性
                              // false: 仅返回计划，CLI 自行执行（默认）

  // ⚠️ execute=true 时的限制（见下方说明）
  // - max_upload_files: 100（Server 端强制限制）
  // - 超过限制返回错误，提示使用 execute=false 或 CLI 分批同步
})
```

**返回（概念示例）**：

**execute=false（默认，计划模式）**：

```typescript
{
  success: true,
  executed: false,  // 标识未执行，仅返回计划

  // 操作指令列表（CLI 按顺序执行）
  actions: [
    {
      op: "upload",
      entity_id: "auth-service",
      path: "technical/containers/auth-service.yaml",
      reason: "本地新增"
    },
    {
      op: "download",
      entity_id: "payment-service",
      path: "technical/containers/payment-service.yaml",
      content: "schema: c4a/v1\ntype: container\n...",  // 直接返回内容，避免二次请求
      reason: "远程新增"
    },
    {
      op: "conflict",
      entity_id: "order-service",
      path: "technical/containers/order-service.yaml",
      conflict_type: "both_modified",  // both_modified | local_deleted | remote_deleted
      local_hash: "abc123",
      remote_hash: "def456",
      remote_content: "...",  // 远程内容，供用户对比
      reason: "双方都修改了"
    },
    {
      op: "delete_local",
      entity_id: "old-service",
      path: "technical/containers/old-service.yaml",
      reason: "远程已删除"
    }
  ],

  // 更新后的快照（CLI 应保存到 .sync-state.json）
  new_snapshot: {
    synced_at: "2026-01-24T10:00:00Z",
    entities: { ... }
  },

  // 统计信息
  stats: {
    to_upload: 1,
    to_download: 1,
    conflicts: 1,
    to_delete: 1
  }
}
```

**execute=true（执行模式，事务性批量操作）**：

```typescript
{
  success: true,
  executed: true,  // 标识已执行

  // 执行结果（上传操作已在 Server 端事务中完成）
  results: {
    uploaded: ["auth-service", "user-service"],  // 已上传的实体 ID
    failed: []  // 失败的实体（事务回滚时为空）
  },

  // 仍需 CLI 处理的操作（下载、冲突、删除需要本地文件系统操作）
  actions: [
    { op: "download", entity_id: "payment-service", path: "...", content: "..." },
    { op: "conflict", entity_id: "order-service", ... },
    { op: "delete_local", entity_id: "old-service", path: "..." }
  ],

  new_snapshot: { ... },
  stats: { uploaded: 2, to_download: 1, conflicts: 1, to_delete: 1 }
}
```

> **事务保证**：当 `execute=true` 时，所有上传操作在 Server 端的单个数据库事务中完成。如果任一实体保存失败，整个事务回滚，返回 `success: false`。

**操作类型说明**：

| op | 含义 | execute=false 时 CLI 动作 | execute=true 时 |
|----|------|--------------------------|-----------------|
| `upload` | 本地新增或修改 | 读取本地文件，调用 `c4a_store_save` | Server 已执行，无需处理 |
| `download` | 远程新增或修改 | 将 `content` 写入本地文件 | 同左（需本地文件系统） |
| `conflict` | 冲突，需用户决策 | 展示冲突详情，等待用户选择 | 同左 |
| `delete_local` | 远程已删除 | 删除本地文件（需用户确认） | 同左 |
| `delete_remote` | 本地已删除 | 调用 `c4a_store_delete` | Server 已执行，无需处理 |
| `skip` | 无需操作 | 无 | 无 |

#### CLI 本地文件写入保护（Double Check）

> **背景**：从 `c4a_store_plan_sync` 获取操作计划到 CLI 执行写入之间存在时间窗口。如果用户在此期间修改了本地文件，直接执行 `download` 或 `delete_local` 会导致用户修改丢失。

**强制要求**：CLI 在执行任何本地文件写入/删除操作前，必须进行二次 Hash 校验（Double Check）。

```typescript
interface WriteAction {
  op: "download" | "delete_local";
  path: string;
  expected_hash?: string;  // 计划生成时的本地文件 Hash
  content?: string;        // download 时的远程内容
}

async function executeWriteAction(action: WriteAction): Promise<WriteResult> {
  const filePath = resolve(projectRoot, action.path);

  // 1. Double Check：重新计算本地文件 Hash
  let currentHash: string | null = null;
  try {
    const content = await readFile(filePath, 'utf-8');
    currentHash = computeHash(content);
  } catch {
    currentHash = null;  // 文件不存在
  }

  // 2. 比对 Hash，检测时间窗口内的修改
  if (action.expected_hash !== currentHash) {
    // 本地文件在计划生成后被修改，转为冲突处理
    return {
      success: false,
      error: "LOCAL_FILE_CHANGED",
      message: `文件 ${action.path} 在同步计划生成后被修改`,
      suggestion: "请重新执行同步以获取最新计划",
      local_hash: currentHash,
      expected_hash: action.expected_hash
    };
  }

  // 3. Hash 一致，安全执行写入/删除
  if (action.op === "download") {
    await writeFile(filePath, action.content!, 'utf-8');
  } else if (action.op === "delete_local") {
    await unlink(filePath);
  }

  return { success: true };
}
```

**保护范围**：

| 操作 | 保护机制 | 冲突处理 |
|------|---------|---------|
| `download`（覆盖已有文件） | Hash 比对 | 转为 `conflict`，提示用户 |
| `download`（新建文件） | 检查文件是否存在 | 如果文件已存在，转为 `conflict` |
| `delete_local` | Hash 比对 | 转为 `conflict`，提示用户 |

**用户提示示例**：

```
⚠️ 检测到本地文件变更

文件 technical/containers/auth-service.yaml 在同步计划生成后被修改。

选项：
1. 保留本地版本（跳过下载）
2. 使用远程版本（覆盖本地）
3. 查看差异
4. 重新同步（推荐）
```

> **设计原则**：与 checklist.md 的指纹保护机制一致，任何可能覆盖用户修改的操作都必须进行二次确认。

**三方对比逻辑（Server 端实现）**：

| 本地 | 远程 | 快照 | 判定 | 返回 op |
|:----:|:----:|:----:|------|---------|
| ✅ | ❌ | ❌ | 本地新增 | `upload` |
| ✅ | ❌ | ✅ | 远程已删除 | `conflict` (remote_deleted) |
| ❌ | ✅ | ❌ | 远程新增 | `download` |
| ❌ | ✅ | ✅ | 本地已删除 | `conflict` (local_deleted) |
| ✅ | ✅ | - | 比较哈希 | `upload`/`download`/`conflict`/`skip` |
| ❌ | ❌ | ✅ | 双方都删除 | `skip`（仅清理快照） |

**设计优势**：

1. **单一真源**：同步逻辑只在 Server 端实现一次（Python），避免 CLI (TypeScript) 和 Server (Python) 双重维护
2. **瘦客户端**：CLI 只负责收集摘要、执行指令、保存快照，不做业务决策
3. **易于升级**：同步策略变更只需更新 Server，无需强制用户升级 CLI
4. **减少网络往返**：`download` 操作直接返回内容，避免二次调用 `c4a_store_read`
5. **事务原子性**：`execute=true` 模式下，所有上传在单个事务中完成，避免网络中断导致的数据不一致

#### `execute=true` 的限制（Remote 模式风险防护）

> **背景**：在 Remote 模式下，Agent（如 Cursor/Claude）可能直接连接远程 Data MCP，绕过 CLI。如果 Agent 直接调用 `c4a_store_plan_sync` 且 `execute=true`，它无法使用 CLI 内部的分批 HTTP API，导致大批量同步时请求超时或被拒。

**Server 端强制限制**：

| 限制项 | 阈值 | 超限行为 |
|--------|------|----------|
| `max_upload_files` | 100 | 返回错误，提示使用 `execute=false` 或 CLI |
| `max_payload_size` | 5MB | 返回错误，提示分批处理 |

**错误响应示例**：

```json
{
  "success": false,
  "error": {
    "code": "C4A-STORE-010",
    "message": "批量同步超过限制（100 文件或 5MB）",
    "details": {
      "upload_count": 150,
      "payload_size": "8.2MB",
      "limit_files": 100,
      "limit_size": "5MB"
    },
    "suggestion": "请使用 CLI `c4a sync` 命令进行大批量同步，或使用 execute=false 模式后逐个调用 c4a_store_save",
    "agent_hint": "DO NOT retry this MCP call. Instead, inform the user to run `c4a sync` in terminal for batch operations exceeding 100 files."
  }
}
```

> **Agent 行为指南**：当收到 `C4A-STORE-010` 错误时，Agent 应：
> 1. **不要重试**：重试会再次触发相同错误
> 2. **不要尝试拆分调用**：Agent 无法访问 CLI 的分批 HTTP API
> 3. **引导用户**：输出提示信息，建议用户在终端运行 `c4a sync`
>
> 示例 Agent 响应：
> ```
> ⚠️ 同步文件数（150）超过 MCP 工具限制（100）。
> 请在终端运行以下命令完成大批量同步：
> $ c4a sync
> ```

**Server 端处理逻辑**：

```python
def plan_sync(request: PlanSyncRequest) -> PlanSyncResponse:
    if request.execute:
        upload_count = len([f for f in request.local_manifest.files if f.content])
        payload_size = sum(len(f.content or '') for f in request.local_manifest.files)

        # 硬限制：超过阈值直接拒绝
        if upload_count > 100 or payload_size > 5 * 1024 * 1024:
            return error_response("C4A-STORE-010", "批量同步超过限制")

        # 中等批量（50-100）：Server 内部流式写入优化
        if upload_count > 50:
            return streaming_sync(request)

        # 小批量：直接处理
        return direct_sync(request)

    # execute=false：仅返回计划，无限制
    return compute_sync_plan(request)
```

**调用者指南**：

| 调用者 | 推荐方式 | 说明 |
|--------|---------|------|
| **CLI** | 自动选择 | < 100 文件用 MCP，≥ 100 文件用内部 HTTP 分批 API |
| **Agent（通过 CLI）** | `c4a_store_sync` | CLI 自动处理分批，Agent 无感知 |
| **Agent（直连 Remote）** | `execute=false` + 逐个 `save` | 避免触发限制，适合日常增量同步 |
| **Agent（直连 Remote，大批量）** | 提示用户使用 CLI | 返回错误时引导用户 |

---

### 3.5.2 大批量同步的性能优化

#### 问题分析

当 `execute=true` 时，CLI 需要在请求中提供所有变更文件的内容（`content` 字段），存在以下架构隐患：

| 问题 | 描述 | 影响 |
|------|------|------|
| **Payload 膨胀** | 1000+ 个 DSL 文件可能产生数十 MB 的请求体 | 触发网关超时、Payload 大小限制（Nginx 默认 1MB） |
| **原子性代价** | 追求"全部成功或全部失败"牺牲了传输可靠性 | 大请求在弱网环境下失败率高 |
| **无断点续传** | 传输中断后必须从头开始 | 用户体验差，浪费已传输的数据 |
| **内存压力** | Server 端需要一次性解析和处理所有内容 | 可能导致 OOM 或响应延迟 |

**典型场景**：
- 项目初始化：首次同步整个架构知识库
- 大规模重构：批量修改数百个组件定义
- 团队协作：合并多个 feat 分支的变更

#### 改进方案：CLI 封装分批逻辑

**设计原则**：分批同步是**基础设施细节**，不应暴露给 Agent。Agent 只需调用一个 MCP 工具，CLI 内部处理复杂性。

```
┌─────────────────────────────────────────────────────────────┐
│                    职责划分                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Agent (MCP)          CLI                    Server         │
│  ─────────────        ───                    ──────         │
│                                                             │
│  c4a_store_sync  ──►  内部分批逻辑  ──►  HTTP API           │
│  (单个工具)           (封装复杂性)       (会话管理)          │
│                                                             │
│  只关心：             负责：              提供：             │
│  - 同步成功/失败      - 分批切割          - 暂存区           │
│  - 冲突列表          - 断点续传          - 事务提交          │
│  - 统计信息          - 进度展示          - 会话过期          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**方案对比**：

| 方面 | 原 `execute=true` | CLI 分批模式 |
|------|-------------------|-------------|
| 单次请求大小 | 可能数十 MB | 每批 < 1MB |
| 断点续传 | ❌ 不支持 | ✅ 支持 |
| 并行上传 | ❌ 不支持 | ✅ 支持 |
| 弱网可靠性 | 差 | 好 |
| 进度可见性 | 无 | CLI 展示进度条 |
| 原子性 | ✅ 保持 | ✅ 保持（commit 阶段） |
| Agent 复杂度 | 低 | **低（不变）** |

#### Server 内部 HTTP API（非 MCP）

以下 API 供 CLI 内部调用，**不暴露为 MCP 工具**：

##### `POST /sync/session`（创建会话）

```json
// Request
{
  "local_manifest": {
    "files": [{ "entity_id": "...", "content_hash": "...", "path": "..." }]
  },
  "snapshot": { ... },
  "options": { "batch_size": 50, "session_ttl": 1800 }
}

// Response
{
  "session_id": "uuid",
  "expires_at": "2026-01-25T12:00:00Z",
  "plan": {
    "to_upload": [{ "entity_id": "...", "path": "...", "reason": "本地新增" }],
    "to_download": [{ "entity_id": "...", "content": "...", "reason": "远程新增" }],
    "conflicts": [...]
  }
}
```

##### `POST /sync/session/{id}/upload`（分批上传）

```json
// Request
{ "files": [{ "entity_id": "...", "content": "..." }] }

// Response
{ "uploaded": 50, "total_uploaded": 150, "pending": 850, "progress": 15 }
```

##### `POST /sync/session/{id}/commit`（提交事务）

```json
// Response
{
  "success": true,
  "committed": ["entity-1", "entity-2"],
  "new_snapshot": { ... }
}
```

#### 实现建议

##### Server 端

**会话存储**：

```python
# 方案 A：Redis（推荐，支持 TTL 自动过期）
session_key = f"sync_session:{session_id}"
redis.hset(session_key, mapping={
    "status": "pending",
    "plan": json.dumps(plan),
    "uploaded_entities": "[]",
    "created_at": datetime.utcnow().isoformat()
})
redis.expire(session_key, ttl=1800)

# 方案 B：MongoDB 临时集合（无 Redis 依赖）
db.sync_sessions.create_index("expires_at", expireAfterSeconds=0)
db.sync_sessions.insert_one({
    "_id": session_id,
    "status": "pending",
    "expires_at": datetime.utcnow() + timedelta(seconds=1800),
    ...
})
```

**暂存区设计**：

```python
# 上传的文件暂存到 MongoDB 临时集合
db.sync_staging.insert_one({
    "session_id": session_id,
    "entity_id": entity_id,
    "content": content,
    "uploaded_at": datetime.utcnow()
})

# commit 时批量移动到正式集合（单事务）
with client.start_session() as session:
    with session.start_transaction():
        for doc in db.sync_staging.find({"session_id": session_id}):
            db.entities.replace_one(
                {"_id": doc["entity_id"]},
                parse_dsl(doc["content"]),
                upsert=True,
                session=session
            )
        db.sync_staging.delete_many({"session_id": session_id}, session=session)
```

**会话过期处理**：

| 场景 | 处理策略 | 说明 |
|------|---------|------|
| 会话过期（TTL 到期） | 自动清理暂存区数据 | Redis TTL 或 MongoDB TTL 索引自动删除 |
| 用户主动取消 | 调用 `DELETE /sync/session/{id}` | 立即清理暂存区 |
| 网络中断后恢复 | 检查会话状态，过期则重新开始 | CLI 保存本地状态支持断点续传 |

> **数据安全保证**：
> - 暂存区数据**不会**写入正式集合，直到 `commit` 成功
> - 会话过期后，暂存区数据自动清理，**不会**残留脏数据
> - 用户可随时重新发起同步，无需手动清理

##### CLI 端

**分批上传逻辑**：

```typescript
async function batchSync(files: LocalFile[], batchSize = 50) {
  // 1. 创建会话（HTTP 调用，非 MCP）
  const { session_id, plan } = await httpPost('/sync/session', {
    local_manifest: { files: files.map(f => ({ ...f, content: undefined })) }
  });

  // 2. 分批上传
  const toUpload = plan.to_upload;
  for (let i = 0; i < toUpload.length; i += batchSize) {
    const batch = toUpload.slice(i, i + batchSize);
    const filesWithContent = batch.map(item => ({
      entity_id: item.entity_id,
      content: readFileSync(item.path, 'utf-8')
    }));

    const result = await httpPost(`/sync/session/${session_id}/upload`, {
      files: filesWithContent
    });

    renderProgressBar(result.progress);  // CLI 展示进度条
  }

  // 3. 提交
  return await httpPost(`/sync/session/${session_id}/commit`, {});
}
```

**断点续传支持**：

```typescript
// CLI 本地保存会话状态到 .sync-session.json
interface SyncSessionState {
  session_id: string;
  uploaded_entities: string[];
  last_updated: string;
}

// 恢复中断的同步
async function resumeSync(state: SyncSessionState) {
  const status = await httpGet(`/sync/session/${state.session_id}/status`);

  if (status.status === 'expired') {
    console.log('会话已过期，重新开始同步...');
    return startNewSync();
  }

  // 继续上传剩余文件
  const remaining = plan.to_upload.filter(
    f => !state.uploaded_entities.includes(f.entity_id)
  );
  // ...
}
```

#### 自动模式选择

CLI 根据文件数量自动选择同步模式，对 Agent 透明：

```typescript
// CLI 内部逻辑
async function sync(options: SyncOptions) {
  const files = collectLocalFiles();

  if (files.length <= BATCH_THRESHOLD) {
    // 小批量：直接调用 MCP
    return await mcpCall('c4a_store_plan_sync', { ...options, execute: true });
  } else {
    // 大批量：使用内部 HTTP API 分批上传
    return await batchSync(files, options);
  }
}
```

**阈值建议**：
- `BATCH_THRESHOLD = 100`：超过 100 个文件时自动切换到分批模式
- 单批上传 50 个文件，每个文件平均 2KB，单次请求约 100KB

#### Agent 视角

Agent 始终只调用 `c4a_store_sync` 或 `c4a_store_plan_sync`，无需感知分批细节：

| 场景 | Agent 调用 | CLI 内部行为 |
|------|-----------|-------------|
| 日常同步（< 100 文件） | `c4a_store_sync` | 直接 MCP 调用 |
| 项目初始化（1000+ 文件） | `c4a_store_sync` | 自动分批 + 进度展示 |
| 弱网环境 | `c4a_store_sync` | 自动重试 + 断点续传 |
