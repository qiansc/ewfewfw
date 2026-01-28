## 4. CLI 命令与 MCP 工具映射

### 4.1 映射表

| CLI 命令 | Local 模式 | Server 模式 | Remote 模式 | 说明 |
|---------|-----------|------------|------------|------|
| **c4a init** | 无 MCP 调用 | 无 MCP 调用 | 无 MCP 调用 | 纯文件系统操作，创建 `.context/` 目录和配置文件 |
| **c4a sync** | `c4a_store_sync` | `c4a_store_plan_sync` | `c4a_store_plan_sync` | Local: MCP 工具批量同步；Server/Remote: Server 端计划同步 + 事务执行 |
| **c4a status** | `c4a_store_list`, `c4a_store_read` | `c4a_store_list`, `c4a_store_read` | `c4a_store_list`, `c4a_store_read` | 查询项目配置和数据库状态 |
| **c4a server backup** | N/A | `c4a_store_backup(status_filter="published")` | N/A | 备份全量数据为压缩包 |
| **c4a server restore** | N/A | `c4a_store_restore(input="./backup.tar.gz")` | N/A | 从压缩包恢复全量数据 |
| **c4a local backup** | `c4a_store_backup(status_filter="published")` | N/A | N/A | 备份全量数据为压缩包 |
| **c4a local restore** | `c4a_store_restore(input="./backup.tar.gz")` | N/A | N/A | 从压缩包恢复全量数据 |
| **c4a install** | 无 MCP 调用 | 无 MCP 调用 | 无 MCP 调用 | 系统级操作，安装 Docker 或初始化 SQLite |
| **c4a server status** | N/A | 无 MCP 调用 | N/A | Docker 容器状态查询 |
| **c4a local status** | 无 MCP 调用 | N/A | N/A | SQLite 数据库文件状态查询 |
| **c4a validate** | 无 MCP 调用 | 无 MCP 调用 | 无 MCP 调用 | 离线验证，CLI 内部实现（不连接数据库） |
| **c4a local validate** | `c4a_store_validate` | N/A | N/A | 在线验证数据库数据完整性 |
| **c4a feat render** | `c4a_store_feat_checklist` | `c4a_store_feat_checklist` | `c4a_store_feat_checklist` | 获取 Checklist 数据并渲染为本地文件 |
| **c4a template** | 无 MCP 调用 | 无 MCP 调用 | 无 MCP 调用 | CLI 内部实现，生成 DSL 模板 |
| **c4a schema** | 无 MCP 调用 | 无 MCP 调用 | 无 MCP 调用 | CLI 内部实现，输出 JSON Schema |

### 4.2 sync 命令详细映射

**`c4a sync`（智能双向同步）**：

> **说明**：`c4a sync` 命令提供智能双向同步能力，底层实现根据模式不同而不同。

**同步忽略规则**：

以下文件/目录不参与同步，即使用户手动修改也不会被上传：

| 文件/目录 | 忽略原因 |
|----------|---------|
| `checklist.md` | 只读视图，数据库是唯一数据源 |
| `feat.yaml` | Feat 元数据通过专用 MCP 工具管理 |
| `.sync-state.json` | 同步状态快照，仅本地使用 |
| `.c4a.yaml` | 项目配置文件，不同步到数据库 |

#### 4.2.1 Local 模式实现

Local 模式下，MCP 工具嵌入 CLI，可直接访问本地文件系统，使用 `c4a_store_sync` 工具：

```typescript
// 1. 检测变更方向
const fileChanges = await detectFileChanges('.context/');
const dbChanges = await c4a_store_list({
  updated_after: lastSyncTime
});

// 2. 根据变更情况选择同步策略
if (fileChanges.length > 0 && dbChanges.length === 0) {
  // 仅文件有变更 → 自动导入
  console.log('检测到本地文件变更，正在导入到数据库...');
  await c4a_store_sync({ direction: "import" });
} else if (fileChanges.length === 0 && dbChanges.length > 0) {
  // 仅数据库有变更 → 自动导出
  console.log('检测到数据库变更，正在导出到本地文件...');
  await c4a_store_sync({ direction: "export" });
} else if (fileChanges.length > 0 && dbChanges.length > 0) {
  // 双向变更 → 提示用户选择或执行双向同步
  console.log('检测到双向变更：');
  console.log(`  📁 本地: ${fileChanges.length} 个文件变更`);
  console.log(`  ☁️  数据库: ${dbChanges.length} 个实体变更`);

  const choice = await promptUser([
    '先导入本地变更，再导出数据库变更（推荐）',
    '仅导入本地变更',
    '仅导出数据库变更',
    '取消同步'
  ]);

  if (choice === 0) {
    // 双向同步：先导入再导出
    await c4a_store_sync({ direction: "import" });
    await c4a_store_sync({ direction: "export" });
  } else if (choice === 1) {
    await c4a_store_sync({ direction: "import" });
  } else if (choice === 2) {
    await c4a_store_sync({ direction: "export" });
  }
}
```

#### 4.2.2 Server/Remote 模式实现

Server/Remote 模式下，MCP 服务运行在独立进程（Docker 容器或远程服务器），无法访问用户本地 `.context/` 目录。CLI 调用 `c4a_store_plan_sync` 工具，由 Server 端计算同步计划，CLI 只负责执行。

> **架构原则**：同步的核心逻辑（Diff 计算、冲突检测、删除识别）下沉到 Server 端，CLI 只负责收集本地文件摘要和执行操作指令，避免 CLI 端实现复杂的三方对比逻辑。

> **重要**：Checklist 不参与同步，数据库是唯一数据源。Agent 通过 `c4a_store_feat_checklist` 直接操作数据库，CLI 通过 `c4a feat render` 将数据库内容渲染为本地 `checklist.md` 只读视图。

**同步状态快照**：

快照存储在 `.context/.sync-state.json`，由 Server 端返回，CLI 负责保存：

```typescript
interface SyncState {
  version: "1.0";
  synced_at: string;           // 上次同步时间（ISO 8601）
  project_id: string;
  entities: {
    [entityId: string]: {
      content_hash: string;    // 内容哈希
      proposal_id?: string;    // 所属提案 ID（feat 分支内的实体）
    };
  };
}
```

**CLI 端职责（瘦客户端）**：

```typescript
// 1. 收集本地文件摘要（包含内容，用于 execute=true 模式）
async function collectLocalManifestWithContent(contextDir: string): Promise<LocalManifest> {
  const files = [];

  for await (const entry of walkDir(contextDir)) {
    // 处理 DSL 实体文件：优先 .c4a.yaml，兼容 .yaml
    // 注：.c4a.yaml 是规范扩展名，.yaml 保留向后兼容
    const isC4aYaml = entry.name.endsWith('.c4a.yaml');
    const isYaml = entry.name.endsWith('.yaml');
    if (!isC4aYaml && !isYaml) continue;

    // 跳过 checklist.md（只读视图，不参与同步）
    // 注意：虽然上面已过滤 .yaml，这里显式注释说明 checklist.md 的处理策略
    // 实际上 checklist.md 会被 .yaml 过滤器自动排除

    const content = await readFile(entry.path, 'utf-8');
    const parsed = parseYaml(content);

    // 跳过 feat.yaml（不通过 c4a_store_save 同步）
    if (parsed.type === 'feat') continue;

    // 提取实体 ID：优先从内容获取，否则从文件名推断
    const entityIdFromName = entry.name
      .replace('.c4a.yaml', '')
      .replace('.yaml', '');

    files.push({
      path: relative(contextDir, entry.path),
      entity_id: parsed.id || entityIdFromName,
      type: parsed.type,
      content_hash: computeHash(content),
      updated_at: entry.mtime.toISOString(),
      proposal_id: extractProposalId(entry.path),
      content: content  // 包含文件内容，用于 execute=true 模式
    });
  }

  return { files };
}
```

**同步主流程（使用 c4a_store_plan_sync）**：

```typescript
async function syncServerRemote(projectConfig: ProjectConfig): Promise<void> {
  // 1. 收集本地文件摘要（包含内容，用于 execute 模式）
  const localManifest = await collectLocalManifestWithContent('.context/');

  // 2. 读取上次同步快照
  const snapshot = await readSyncState('.context/.sync-state.json');

  // 3. 调用 Server 端计算并执行同步（execute=true 保证事务原子性）
  const syncResult = await c4a_store_plan_sync({
    local_manifest: localManifest,
    snapshot: snapshot,
    options: {
      proposal_id: projectConfig.current_feat,
      status_filter: "all"
    },
    execute: true  // Server 端事务性批量执行上传
  });

  if (!syncResult.success) {
    console.error(`❌ 同步失败: ${syncResult.error}`);
    return;
  }

  // 4. 显示执行结果
  console.log(`\n同步结果:`);
  if (syncResult.results?.uploaded?.length > 0) {
    console.log(`  ⬆️  已上传: ${syncResult.results.uploaded.length} 个`);
  }
  console.log(`  ⬇️  待下载: ${syncResult.stats.to_download} 个`);
  if (syncResult.stats.conflicts > 0) {
    console.log(`  ⚠️  冲突: ${syncResult.stats.conflicts} 个`);
  }

  // 5. 处理剩余操作（下载、冲突、删除需要本地文件系统）
  await executeRemainingActions(syncResult.actions, projectConfig);

  // 6. 保存新的同步快照
  await writeSyncState('.context/.sync-state.json', syncResult.new_snapshot);

  console.log(`\n✅ 同步完成`);
}
```

**处理剩余操作（execute=true 模式下，上传已由 Server 完成）**：

```typescript
async function executeRemainingActions(
  actions: SyncAction[],
  projectConfig: ProjectConfig
): Promise<void> {
  // execute=true 时，actions 中不包含 upload 操作（已由 Server 执行）
  const downloads = actions.filter(a => a.op === 'download');
  const conflicts = actions.filter(a => a.op === 'conflict');
  const deletes = actions.filter(a => a.op === 'delete_local');

  // 1. 处理下载（Server 已返回内容，直接写入本地）
  for (const action of downloads) {
    console.log(`⬇️  下载: ${action.path} (${action.reason})`);
    const filePath = join('.context', action.path);
    await ensureDir(dirname(filePath));
    await writeFile(filePath, action.content);
  }

  // 2. 处理冲突（需要用户决策）
  for (const conflict of conflicts) {
    await handleConflict(conflict, projectConfig);
  }

  // 3. 处理删除（需要用户确认）
  for (const action of deletes) {
    await handleDelete(action, projectConfig);
  }
}
```

**冲突处理**：

```typescript
async function handleConflict(
  conflict: ConflictAction,
  projectConfig: ProjectConfig
): Promise<void> {
  console.log(`\n⚠️  冲突: ${conflict.path}`);
  console.log(`   类型: ${conflict.conflict_type}`);
  console.log(`   原因: ${conflict.reason}`);

  if (conflict.conflict_type === 'both_modified') {
    // 双方都修改了
    const choice = await promptUser([
      '使用本地版本（覆盖远程）',
      '使用远程版本（覆盖本地）',
      '跳过（保持现状）'
    ]);

    if (choice === 0) {
      // 上传本地版本
      const content = await readFile(join('.context', conflict.path), 'utf-8');
      await c4a_store_save({
        type: conflict.type,
        content: content,
        format: 'yaml',
        id: conflict.entity_id,
        source_project: projectConfig.project_id,
        proposal_id: conflict.proposal_id
      });
    } else if (choice === 1) {
      // 使用远程版本
      await writeFile(join('.context', conflict.path), conflict.remote_content);
    }
  } else if (conflict.conflict_type === 'remote_deleted') {
    // 远程已删除
    const choice = await promptUser([
      '删除本地文件（与远程保持一致）',
      '重新上传到远程（恢复实体）',
      '跳过（保持现状）'
    ]);

    if (choice === 0) {
      await deleteFile(join('.context', conflict.path));
    } else if (choice === 1) {
      const content = await readFile(join('.context', conflict.path), 'utf-8');
      await c4a_store_save({
        type: conflict.type,
        content: content,
        format: 'yaml',
        id: conflict.entity_id,
        source_project: projectConfig.project_id,
        proposal_id: conflict.proposal_id
      });
    }
  } else if (conflict.conflict_type === 'local_deleted') {
    // 本地已删除
    const choice = await promptUser([
      '删除远程实体（与本地保持一致）',
      '重新下载到本地（恢复文件）',
      '跳过（保持现状）'
    ]);

    if (choice === 0) {
      await c4a_store_delete({ id: conflict.entity_id });
    } else if (choice === 1) {
      await writeFile(join('.context', conflict.path), conflict.remote_content);
    }
  }
}
```

**三方对比决策表**（Server 端实现）：

| 本地 | 远程 | 快照 | 判定 | 操作 |
|:----:|:----:|:----:|------|------|
| ✅ | ❌ | ❌ | 本地新增 | 上传到远程 |
| ✅ | ❌ | ✅ | 远程已删除 | **冲突**：询问用户 |
| ❌ | ✅ | ❌ | 远程新增 | 下载到本地 |
| ❌ | ✅ | ✅ | 本地已删除 | **冲突**：询问用户 |
| ✅ | ✅ | - | 双方都有 | 比较哈希/时间戳 |
| ❌ | ❌ | ✅ | 双方都删除 | 清理快照 |

**首次同步行为**：

当 `.sync-state.json` 不存在时（首次同步）：
- 所有快照判定视为"不存在"
- 本地有、远程无 → 上传（本地新增）
- 本地无、远程有 → 下载（远程新增）
- 双方都有 → 比较哈希/时间戳

**交互示例**：

```
$ c4a sync

  同步架构知识 (双向)

检测变更...
  📁 本地: 3 个新增, 2 个修改, 1 个删除
  ☁️  服务端: 1 个新增, 1 个修改, 1 个删除

同步操作:
  ⬆️  上传: 3 个文件
  ⬇️  下载: 2 个文件

⚠️  检测到删除冲突:

  container/legacy-service.yaml:
    - 远程已删除此实体
    - 本地文件仍然存在

? 如何处理？
  > 删除本地文件（与远程保持一致）
    重新上传到远程（恢复实体）
    跳过（保持现状）

  component/old-handler.yaml:
    - 本地已删除此文件
    - 远程实体仍然存在

? 如何处理？
  > 删除远程实体（与本地保持一致）
    重新下载到本地（恢复文件）
    跳过（保持现状）

正在同步...
  ⬆️  上传: system/my-system.yaml
  ⬇️  下载: container/new-service.yaml
  🗑️  删除本地: container/legacy-service.yaml
  🗑️  删除远程: old-handler

✅ 同步完成
  - 上传: 3 个
  - 下载: 2 个
  - 本地删除: 1 个
  - 远程删除: 1 个
```

**Checklist 渲染说明**：

> **关键设计**：Checklist **不参与同步**，数据库是唯一数据源。CLI 通过 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 `checklist.md` 只读视图。

```typescript
/**
 * 渲染 checklist 到本地文件
 *
 * 从数据库获取 checklist 数据，渲染为 Markdown 格式的只读视图。
 *
 * @param featId - Feat ID
 */
async function renderChecklist(featId: string): Promise<void> {
  // 1. 从数据库获取 checklist
  const result = await c4a_store_feat_checklist({
    action: "get",
    feat_id: featId
  });

  if (!result.success || !result.checklist) {
    console.log(`ℹ️  feat ${featId} 暂无 checklist`);
    return;
  }

  // 2. 渲染为 Markdown 格式
  const markdown = renderChecklistToMarkdown(result.checklist);

  // 3. 写入本地文件（只读视图）
  const localPath = `.context/feat/${featId}/checklist.md`;
  await writeFile(localPath, markdown);
  console.log(`📄 渲染: ${localPath}`);
}

/**
 * 将 checklist 数据渲染为 Markdown 格式
 */
function renderChecklistToMarkdown(checklist: Checklist): string {
  const lines = [`# Checklist: ${checklist.feat_id}`, ''];

  for (const phase of checklist.phases) {
    lines.push(`## ${phase.name}`);
    lines.push('');
    for (const task of phase.tasks) {
      const status = task.status === 'done' ? '[x]' : '[ ]';
      lines.push(`- ${status} ${task.title}`);
      if (task.assignee) {
        lines.push(`  - 负责人: ${task.assignee}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('> 此文件由 `c4a feat render` 自动生成，请勿手动编辑。');
  lines.push('> 修改 checklist 请使用 Agent 或 `c4a_store_feat_checklist` 接口。');

  return lines.join('\n');
}
```

**与普通实体同步的区别**：

| 维度 | 普通实体 | Checklist |
|------|---------|-----------|
| **数据源** | 数据库 + 文件系统双写 | 数据库（唯一数据源） |
| **本地文件** | `.yaml`（参与同步） | `.md`（只读视图） |
| **修改方式** | 编辑本地文件 + `c4a sync` | Agent 调用 `c4a_store_feat_checklist` |
| **同步方向** | 双向 | 单向（数据库 → 本地） |

**性能对比**：

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 1000 个实体，无变更 | 1001 次 HTTP 请求 | 1 次 HTTP 请求 |
| 1000 个实体，10 个冲突选择远程 | 1001 次 HTTP 请求 | 11 次 HTTP 请求 |
| 1000 个实体，50 个远程新增 | 1001 次 HTTP 请求 | 51 次 HTTP 请求 |

**关键差异**：

| 维度 | Local 模式 | Server/Remote 模式 |
|------|-----------|-------------------|
| **MCP 工具** | `c4a_store_sync` | `c4a_store_plan_sync`（execute=true） |
| **同步逻辑位置** | MCP 工具内部 | Server 端（`c4a_store_plan_sync`） |
| **CLI 职责** | 调用 MCP 工具 | 收集摘要+内容，处理下载/冲突/删除 |
| **上传执行** | MCP 工具内部 | Server 端事务性批量执行 |
| **冲突检测** | MCP 工具内部处理 | Server 端处理，返回冲突列表 |
| **事务保证** | SQLite 单库事务 | MongoDB 事务（execute=true） |

**关键点**：
- 用户接口完全一致：`c4a sync` 命令在所有模式下行为一致
- **同步逻辑单一真源**：Server 端统一实现三方对比逻辑，避免 CLI/Server 双重维护
- **瘦客户端原则**：CLI 只负责收集摘要、执行指令、保存快照，不做业务决策
- **易于升级**：同步策略变更只需更新 Server，无需强制用户升级 CLI
- **事务原子性**：`execute=true` 模式下，所有上传在单个事务中完成，避免网络中断导致数据不一致

### 4.3 冲突检测算法

使用**时间戳 + 内容哈希**的组合策略，避免误判：

**1. 计算内容哈希（跨平台规范化）**：

> **关键设计**：为避免跨平台 Hash 不一致导致误判冲突，必须在计算 Hash 前对内容进行规范化处理。

```typescript
import crypto from 'crypto';
import yaml from 'js-yaml';

/**
 * 计算内容 Hash（跨平台一致性保证）
 *
 * 规范化步骤：
 * 1. 统一换行符为 LF (\n)
 * 2. 移除文件末尾多余换行符（保留一个）
 * 3. 对 YAML 内容进行确定性序列化（字段排序）
 *
 * @param content - 文件原始内容
 * @param format - 文件格式（yaml 或 json）
 * @returns SHA256 哈希值（十六进制）
 */
function calculateHash(content: string, format: 'yaml' | 'json' = 'yaml'): string {
  let normalized: string;

  if (format === 'yaml') {
    // YAML 文件：解析后重新序列化（确保字段顺序一致）
    try {
      const parsed = yaml.load(content);
      // 使用确定性序列化：字段按字母顺序排序
      normalized = yaml.dump(parsed, {
        sortKeys: true,        // 字段排序
        lineWidth: -1,         // 不自动换行
        noRefs: true,          // 不使用引用
        quotingType: '"',      // 统一使用双引号
      });
    } catch (error) {
      // 解析失败时回退到文本规范化
      normalized = normalizeText(content);
    }
  } else {
    // JSON 文件：使用 Canonical JSON
    try {
      const parsed = JSON.parse(content);
      normalized = JSON.stringify(parsed, Object.keys(parsed).sort());
    } catch (error) {
      normalized = normalizeText(content);
    }
  }

  // 统一换行符为 LF
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 移除文件末尾多余换行符（保留一个）
  normalized = normalized.replace(/\n+$/, '\n');

  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

/**
 * 文本规范化（用于解析失败时的回退）
 */
function normalizeText(content: string): string {
  return content
    .replace(/\r\n/g, '\n')    // CRLF → LF
    .replace(/\r/g, '\n')      // CR → LF
    .replace(/\n+$/, '\n')     // 移除末尾多余换行符
    .trim() + '\n';            // 确保末尾有且仅有一个换行符
}
```

**规范化策略说明**：

| 问题 | 规范化方案 | 理由 |
|------|-----------|------|
| **换行符不一致** | 统一转换为 LF (`\n`) | Git 默认行为，跨平台标准 |
| **YAML 字段顺序** | 解析后按字母顺序重新序列化 | 确保相同内容产生相同 Hash |
| **文件末尾换行符** | 保留一个 LF | 符合 POSIX 标准 |
| **空白字符** | 通过重新序列化消除 | 避免手动编辑引入的差异 |

**性能优化**：
- 仅在需要时解析 YAML（冲突检测阶段）
- 解析失败时回退到简单文本规范化
- Hash 计算结果可缓存（基于文件 mtime）

**2. 冲突检测逻辑（使用 list 返回的摘要信息）**：

> **性能说明**：此函数使用 `c4a_store_list` 返回的 `content_hash` 和 `updated_at`，无需调用 `c4a_store_read`，避免 N+1 查询问题。

```typescript
// 基于摘要信息的冲突检测（无需额外 HTTP 请求）
function detectConflictFromSummary(
  localHash: string,
  localMtime: Date,
  remoteHash: string,      // 来自 c4a_store_list 返回
  remoteUpdatedAt: Date    // 来自 c4a_store_list 返回
): ConflictResult {
  // 情况 1：内容相同 → 无冲突，跳过
  if (localHash === remoteHash) {
    return { hasConflict: false, action: 'skip' };
  }

  // 情况 2：内容不同，检查修改时间
  const lastSyncTime = getLastSyncTime();  // 从本地缓存读取

  const localModified = localMtime > lastSyncTime;
  const remoteModified = remoteUpdatedAt > lastSyncTime;

  if (localModified && !remoteModified) {
    // 仅本地修改 → 上传
    return { hasConflict: false, action: 'upload' };
  } else if (!localModified && remoteModified) {
    // 仅远程修改 → 下载
    return { hasConflict: false, action: 'download' };
  } else if (localModified && remoteModified) {
    // 双方都修改 → 冲突，需用户选择
    return {
      hasConflict: true,
      localHash,
      remoteHash,
      localMtime,
      remoteUpdatedAt,
      lastSyncTime
    };
  }

  // 都未修改但内容不同（异常情况，可能是时钟偏差）
  // 保守策略：按远程较新处理
  return { hasConflict: false, action: 'download' };
}

interface ConflictResult {
  hasConflict: boolean;
  action?: 'skip' | 'upload' | 'download';
  localHash?: string;
  remoteHash?: string;
  localMtime?: Date;
  remoteUpdatedAt?: Date;
  lastSyncTime?: Date;
}
```

**3. 冲突提示示例**：

```
⚠️  检测到冲突文件: container/api-gateway.yaml

本地修改时间: 2026-01-22 15:30:45
远程修改时间: 2026-01-22 15:28:30
上次同步时间: 2026-01-22 14:00:00

? 如何处理？
  > 使用本地版本（覆盖远程）
    使用远程版本（覆盖本地文件）
    查看差异（diff）
    跳过此文件
```

**关键改进**：
- **内容哈希**：避免误判（文件改回原样不会冲突）
- **上次同步时间**：精确判断双向修改
- **避免 N+1**：使用 `c4a_store_list` 返回的摘要信息进行检测
- **diff 功能**：帮助用户决策



### 4.4 status 命令详细映射

**`c4a status`**：

```typescript
// 1. 读取项目配置
const projectConfig = await readFile('.context/.c4a.yaml');

// 2. 查询数据库统计
const stats = await c4a_store_list({
  project_id: projectConfig.project_id,
  group_by: "type"
});

// 3. 显示状态
console.log(`
项目配置:
  项目 ID: ${projectConfig.project_id}
  仓库 ID: ${projectConfig.repo_id}
  使用模式: ${projectConfig.mode}

数据库统计:
  System: ${stats.system} 个
  Container: ${stats.container} 个
  Component: ${stats.component} 个
  ADR: ${stats.adr} 个
`);
```

### 4.5 MCP 工具参数说明

**`c4a_store_sync` 参数**：

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `direction` | `"import" \| "export"` | 同步方向 | 必需 |
| `status_filter` | `"published" \| "approved" \| "all"` | 按实体状态筛选同步范围 | `"published"` |
| `path` | `string` | 文件系统路径 | `".context"` |
| `format` | `"yaml" \| "json"` | 导出格式（仅 export） | `"yaml"` |
| `mode` | `"incremental" \| "full"` | 同步模式 | `"incremental"` |
| `conflict_policy` | `"warn" \| "skip" \| "override" \| "prompt"` | 冲突处理策略（仅 export） | `"skip"` |

**`c4a_store_list` 参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `project_id` | `string` | 项目 ID（可选） |
| `status` | `"draft" \| "approved" \| "published"` | 状态筛选（可选） |
| `type` | `"system" \| "container" \| "component" \| "adr"` | 类型筛选（可选） |
| `group_by` | `"type" \| "status"` | 分组统计（可选） |
| `updated_after` | `string` | 更新时间筛选（ISO 8601） |

### 4.6 Remote 模式的 MCP 调用

Remote 模式下，CLI 通过 HTTP API 调用远程 MCP 服务。

**同步实现**：Remote 模式使用与 Server 模式相同的 `c4a_store_plan_sync` 工具，详见 [4.2.2 节](#422-serverremote-模式实现)。

**关键设计**：
- Remote 模式复用 Server 模式的同步逻辑
- 使用 `c4a_store_plan_sync` 工具（支持 `execute=true` 事务性批量执行）
- 避免 N+1 性能问题和事务一致性问题

**HTTP 调用示例**：

```typescript
// Remote 模式通过 HTTP 调用 c4a_store_plan_sync
async function syncRemote() {
  const config = await readProjectConfig();
  const remoteUrl = config.remote.url;

  // 1. 收集本地文件摘要（包含内容）
  const manifest = await collectLocalManifestWithContent('.context');

  // 2. 读取上次同步快照
  const snapshot = await readSyncState('.context/.sync-state.json');

  // 3. 调用远程 MCP 的 c4a_store_plan_sync（execute=true 模式）
  const response = await fetch(`${remoteUrl}/mcp/c4a_store_plan_sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
      // v0.3.0 暂不支持认证，允许匿名访问
    },
    body: JSON.stringify({
      local_manifest: manifest,
      snapshot: snapshot,
      execute: true,  // Server 端事务性批量执行
      options: {
        proposal_id: null,  // 主分支
        status_filter: "all"
      }
    })
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(`同步失败: ${result.error}`);
  }

  // 4. 处理下载操作
  for (const action of result.actions.filter(a => a.op === 'download')) {
    await writeFile(join('.context', action.path), action.content);
  }

  // 5. 处理删除操作
  for (const action of result.actions.filter(a => a.op === 'delete_local')) {
    await deleteFile(join('.context', action.path));
  }

  // 6. 保存新快照
  await writeSyncState('.context/.sync-state.json', result.new_snapshot);

  console.log(`✅ 同步完成: 上传 ${result.stats.uploaded} 个，下载 ${result.stats.downloaded} 个`);
}
```

**与 Server 模式的区别**：
- Server 模式：MCP 通过 stdio 调用
- Remote 模式：MCP 通过 HTTP API 调用
- 底层逻辑完全相同，都使用 `c4a_store_plan_sync`

---

