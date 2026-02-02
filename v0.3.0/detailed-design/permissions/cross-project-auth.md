# 权限控制和错误处理

> **相关文档**：
> - 架构设计：[../architecture.md](../architecture.md)
> - Skills 设计：[skills-design.md](./skills-design.md)
> - MCP 工具单一真源：[./mcp-tools.md](./mcp-tools.md)

---

## 版本说明

> **本版本实现范围（Part 11 Lite）**：
>
> 本版本仅实现 HTTP Gateway 安全底线，完整权限系统**延后到 v0.4.0**：
>
> | 功能 | 本版本 | 说明 |
> |------|:------:|------|
> | Gateway 错误码 | ✅ | 在 errors.ts 中扩展 SYS-006~009 |
> | 安全工具 | ✅ | utils/security.ts（路径校验、DSL 转义） |
> | 权限系统 | ❌ | 全部延后到 v0.4.0 |
>
> **设计原则**：不创建新目录，复用现有 `types/` 和 `utils/` 结构。

---

## 1. 跨项目 feat 权限控制

### 1.1 权限检查的模式差异

C4A 支持三种运行模式，权限检查策略因模式而异：

| 模式 | 权限检查 | 用户上下文 | 用户表/权限表 | 说明 |
|------|---------|-----------|-------------|------|
| **Local** | ❌ 跳过 | 隐式单用户 | ❌ 无 | 本地开发环境，用户隐式拥有所有项目的 Admin 权限 |
| **Server** | ✅ 严格检查 | 多用户 | ✅ 有 | 团队协作环境，基于项目权限表检查 |
| **Remote** | ✅ 严格检查 | 多用户（API Token） | ✅ 有 | 远程服务，基于 API Token 和权限表检查 |

#### 1.1.1 Local 模式的权限处理

**设计原则**：
- Local 模式是单用户环境（个人开发者）
- **跳过鉴权**：不需要用户表、权限表、登录鉴权，所有权限检查自动通过
- **强制数据完整性**：创建实体时必须有 `source_project`，由 CLI/MCP 自动填充当前项目

> **关键设计**：Local 模式区分"鉴权"和"数据完整性"两个概念：
> - **鉴权（Authentication/Authorization）**：验证"你是谁"、"你有没有权限" → Local 模式跳过
> - **数据完整性（Data Integrity）**：验证"数据对不对"、"必填字段是否存在" → Local 模式强制检查

**实现逻辑**：

```typescript
async function saveEntity(params: SaveParams) {
  const mode = getRunMode(); // "local" | "server" | "remote"

  // 1. 数据完整性检查（所有模式都执行）
  let targetProject = params.source_project;

  if (!targetProject) {
    // 自动填充当前项目（从 .c4a.yaml 或 CLI 上下文获取）
    targetProject = getCurrentProject();

    if (!targetProject) {
      // 无法确定项目时报错，而非允许创建"无主实体"
      throw new DataIntegrityError({
        code: "C4A-INPUT-001",
        message: "缺少 source_project 字段",
        suggestion: "请在 .c4a.yaml 中配置 project_id，或显式指定 source_project"
      });
    }

    // 自动填充
    params.source_project = targetProject;
  }

  // 2. 权限检查（仅 Server/Remote 模式）
  if (mode !== "local") {
    const currentUser = getCurrentUser();
    const permissions = await loadProjectPermissions(targetProject);

    if (!permissions.writers.includes(currentUser) &&
        !permissions.admins.includes(currentUser)) {
      throw new PermissionError(
        `用户 ${currentUser} 无权限在项目 ${targetProject} 中创建实体`
      );
    }
  }

  // 3. 执行保存
  return await store.save(params);
}
```

**Local 模式的行为**：

| 检查类型 | Server/Remote 模式 | Local 模式 |
|---------|------------------|-----------|
| **鉴权检查** | ✅ 严格检查 | ❌ 跳过 |
| **数据完整性检查** | ✅ 严格检查 | ✅ 严格检查 |
| `source_project` 必填 | ✅ 是 | ✅ 是（自动填充） |
| `source_repo` 必填 | ✅ 是 | ✅ 是（自动填充） |

**自动填充机制**：

Local 模式下，CLI/MCP 工具会自动填充缺失的必填字段：

| 字段 | 自动填充来源 | 说明 |
|------|------------|------|
| `source_project` | `.c4a.yaml` 中的 `project_id` | 当前项目 ID |
| `source_repo` | Git remote URL 或 `.c4a.yaml` | 代码仓库地址 |
| `owner` | 无（Local 模式不需要） | 迁移时补全 |
| `created_by` | 无（Local 模式不需要） | 迁移时补全 |

**`source_repo` 获取失败时的处理**：

> **防呆设计**：如果在一个未关联 Git 远程仓库且未配置 `.c4a.yaml` 的纯本地目录下运行，应显式报错，阻止创建"来源不明"的实体。

```typescript
function getSourceRepo(): string {
  // 1. 优先从 .c4a.yaml 配置获取
  const config = loadC4AConfig();
  if (config?.source_repo) {
    return config.source_repo;
  }

  // 2. 尝试从 Git remote 获取
  try {
    const gitRemote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    if (gitRemote) {
      return gitRemote;
    }
  } catch {
    // Git 命令失败，继续检查
  }

  // 3. 无法确定 source_repo，显式报错
  throw new DataIntegrityError({
    code: "C4A-INPUT-001",
    message: "无法确定 source_repo：当前目录未关联 Git 远程仓库，且未配置 .c4a.yaml",
    details: {
      field: "source_repo",
      suggestion: "请执行以下操作之一：\n" +
        "1. 关联 Git 远程仓库：git remote add origin <repo-url>\n" +
        "2. 在 .c4a.yaml 中配置 source_repo 字段"
    }
  });
}
```

**设计理由**：
- Local 模式跳过鉴权，降低个人开发者的使用门槛
- 强制数据完整性，确保所有实体都有明确的项目归属
- 自动填充机制让用户无感知，同时保证数据质量
- 消除迁移时的 `C4A-MIGRATE-001` 错误（缺少 source_project）

#### 1.1.2 Server/Remote 模式的权限处理

Server 和 Remote 模式是多用户协作环境，需要严格的权限检查：

**用户上下文获取**：
- **Server 模式**：从 HTTP Session 或 JWT Token 获取当前用户
- **Remote 模式**：从 API Token 获取当前用户

**权限数据存储**（仅 Server/Remote 模式）：

> **存储选型**：权限数据存储在 MongoDB 中，与架构实体数据使用相同的存储层。

```typescript
// MongoDB 集合：project_permissions
interface ProjectPermission {
  _id: string;                    // MongoDB ObjectId
  project_id: string;             // 项目 ID
  user_id: string;                // 用户 ID
  role: "admin" | "writer" | "reader";
  granted_at: Date;
  granted_by?: string;
}

// 索引
// db.project_permissions.createIndex({ project_id: 1, user_id: 1 }, { unique: true })
// db.project_permissions.createIndex({ user_id: 1 })
// db.project_permissions.createIndex({ project_id: 1 })
```

#### 1.1.3 Local → Server 数据迁移时的权限校验

**问题场景**：用户在 Local 模式下创建了实体（无鉴权检查），迁移到 Server 模式时需要检查权限。

> **注意**：由于 Local 模式强制数据完整性（见 1.1.1 节），迁移时不会出现"缺少 source_project"的问题。迁移失败的主要原因是**权限不足**。

**迁移时的权限检查**：

| 操作 | 权限校验 | 失败处理 |
|------|---------|---------|
| `c4a local backup` | 无（Local 模式） | - |
| `c4a server restore` | **严格检查** | 部分实体导入失败 |
| `c4a sync` | **严格检查** | 部分实体推送失败 |

**Server 模式下的恢复操作**：

```typescript
async function restoreToServer(
  backupData: BackupData,
  currentUser: string,
  options: { transactionMode: 'atomic' | 'partial' } = { transactionMode: 'partial' }
) {
  const results = { success: [], failed: [], skipped: [] };

  if (options.transactionMode === 'atomic') {
    return await restoreAtomic(backupData, currentUser);
  }

  for (const entity of backupData.entities) {
    const targetProject = entity.metadata.source_project;

    // 检查用户是否有目标项目的写权限
    const hasPermission = await checkWritePermission(currentUser, targetProject);

    if (!hasPermission) {
      results.failed.push({
        entity_id: entity.id,
        reason: 'permission_denied',
        project: targetProject,
        message: `用户 ${currentUser} 无权限在项目 ${targetProject} 中创建实体`
      });
      continue;
    }

    // 导入实体
    try {
      await c4a_store_save(entity);
      results.success.push(entity.id);
    } catch (err) {
      results.failed.push({
        entity_id: entity.id,
        reason: 'import_error',
        message: err.message
      });
    }
  }

  return results;
}
```

**用户交互示例**：

```
$ c4a server restore backup.tar.gz

⚠️  权限校验失败

以下实体无法导入（权限不足）：
1. auth-service (project: backend-api)
   建议：联系项目管理员 @bob 授权

2. payment-db (project: infrastructure)
   建议：联系项目管理员 @charlie 授权

导入结果：
✅ 成功：15 个实体
❌ 失败：2 个实体（权限不足）

? 如何处理？
  > 联系项目管理员授权后重试
    跳过失败的实体，继续使用已导入的数据
    取消导入，回滚所有变更
```

**权限预检查**：

```bash
# 导入前检查权限
c4a server check-permissions --backup backup.tar.gz --user alice@example.com

# 输出：
# ✅ backend-api: 有写权限
# ❌ infrastructure: 无写权限（需要联系 @bob 授权）
# ✅ frontend-app: 有写权限
```

**配置选项**（`.c4a.yaml`）：

```yaml
migration:
  # 迁移时权限不足的处理策略
  permission_policy: "skip"  # skip | error | prompt

  # 是否在导入前进行权限预检查
  pre_check: true

  # 权限不足时是否自动通知项目管理员
  auto_notify_admins: false

  # 数据完整性检查策略
  data_integrity_check: "strict"  # strict | warn | skip
```

**设计要点**：
- **导出前强制校验**：在 `c4a local backup` 时强制检查数据完整性，避免导出无效数据
- **自动修复选项**：提供自动补全缺失字段的选项，简化迁移流程
- **严格校验**：Server 模式下必须重新执行权限检查和数据完整性检查
- **部分成功**：允许部分实体导入成功，不因个别问题回滚全部
- **清晰反馈**：明确告知用户哪些实体因何种原因无法导入
- **可恢复性**：用户修复问题后可以重新导入失败的实体

**权限元数据映射规范**：

> **关键设计**：Local 模式下创建的实体缺少权限元数据（`owner`、`created_by`），迁移到 Server 时必须补全这些字段。

| 字段 | Local 模式 | Server 模式 | 迁移映射规则 |
|------|-----------|------------|-------------|
| `owner` | 无（隐式单用户） | 必需 | 映射为执行迁移的用户 |
| `created_by` | 无 | 必需 | 映射为执行迁移的用户 |
| `created_at` | 有 | 有 | 保留原值 |
| `updated_by` | 无 | 必需 | 映射为执行迁移的用户 |
| `updated_at` | 有 | 有 | 保留原值 |

**迁移时的权限元数据补全**：

```typescript
async function migrateEntityToServer(
  entity: Entity,
  currentUser: string
): Promise<Entity> {
  // 补全权限元数据
  const migratedEntity = {
    ...entity,
    metadata: {
      ...entity.metadata,
      // 如果缺少 owner，使用执行迁移的用户
      owner: entity.metadata.owner || currentUser,
      // 如果缺少 created_by，使用执行迁移的用户
      created_by: entity.metadata.created_by || currentUser,
      // updated_by 始终更新为当前用户
      updated_by: currentUser,
      // 记录迁移来源
      migrated_from: 'local',
      migrated_at: new Date().toISOString(),
      migrated_by: currentUser
    }
  };

  return migratedEntity;
}
```

**迁移审计字段**：

为支持迁移追溯，所有从 Local 迁移的实体会添加以下审计字段：

```yaml
metadata:
  # 原有字段（补全后）
  owner: alice@example.com
  created_by: alice@example.com
  # 迁移审计字段
  migrated_from: local           # 来源模式
  migrated_at: "2026-01-24T10:00:00Z"
  migrated_by: alice@example.com # 执行迁移的用户
```

**相关工具**：

详细的数据完整性检查和修复工具请参考 [local-mode.md#9-数据完整性保证](./local-mode.md#9-数据完整性保证)。

### 1.2 权限模型

feat 不属于特定项目，但 feat 内的实体归属于 `source_project`。权限控制基于实体的归属项目。

| 操作 | 权限要求 | 检查时机 | 说明 |
|------|---------|---------|------|
| 创建 feat | 任意项目成员 | 创建时 | feat 不属于特定项目 |
| 在 feat 内创建实体 | 目标项目的写权限 | **创建时立即检查** | 避免用户创建大量实体后才发现无权限 |
| 修改 feat 内实体 | 实体所属项目的写权限 | 修改时 | 通过 `source_project` 判断 |
| 发布 feat | 所有涉及项目的批准权限 | 发布时 | 需要所有项目负责人批准 |

> **重要**：在创建实体时就检查目标项目的写权限，而非等到发布时才检查。这样可以避免用户在 feat 内创建了大量实体后才发现无权限发布。

### 1.3 权限变更的处理

权限可能在 feat 生命周期内发生变化，需要明确处理策略：

| 场景 | 处理策略 | 说明 |
|------|---------|------|
| 创建时无权限，后获得权限 | 用户可以重新尝试创建 | 系统不自动追溯历史权限 |
| 创建时有权限，发布前被撤销 | **发布时再次检查权限**，无权限则阻止发布 | 避免权限漏洞 |
| 发布后权限被撤销 | 不影响已发布实体，但无法再修改 | 已发布实体不可变 |

**发布时权限检查**：
- 重新验证所有涉及项目的批准权限
- 如权限不足，阻止发布并通知用户
- 用户需联系项目负责人恢复权限或从 feat 中移除相关实体

**示例**：
```
❌ feat-a001 发布失败

原因：权限不足

以下实体所属项目的权限已被撤销：
- auth-service (project: backend) - 需要写权限
- user-db (project: infrastructure) - 需要写权限

解决方案：
1. 联系项目负责人恢复权限
2. 或从 feat 中移除这些实体
```

**已知限制（v0.3.0）**：

> 当 feat 涉及多个强耦合项目（如 A 调用 B 的接口），且发布前某项目权限被撤销时，可能导致 feat 无法发布也无法拆分的"死锁"状态。
>
> **规避建议**：
> - 发布前确认所有涉及项目的权限状态
> - 跨项目 feat 尽量缩短生命周期，减少权限变更窗口
> - 如遇死锁，联系相关项目 admin 协调恢复权限
>
> **v0.4.0+ 规划**：考虑引入"权限快照"或"预锁定"机制，在 feat 创建时锁定权限状态。

### 1.4 权限检查时机

#### 1.4.1 创建实体时（立即检查写权限）

**`source_project` 参数说明**：

在调用 `c4a_store_save` 创建新实体时，必须明确指定实体的归属项目：

| 场景 | `source_project` 处理 | 说明 |
|------|---------------------|------|
| **单项目 feat** | 可省略，默认为当前项目 | CLI/Agent 自动填充当前项目 ID |
| **跨项目 feat** | **必须显式指定** | 明确新实体属于哪个项目 |
| **权限检查依据** | 基于 `source_project` 验证 | 检查用户是否有该项目的写权限 |

**示例 1：单项目 feat（可省略 `source_project`）**：

```typescript
// 在当前项目的 feat 内创建 Container
c4a_store_save({
  type: "container",
  data: {
    id: "auth-service",
    name: "认证服务"
  }
  // source_project 省略，CLI/Agent 自动填充当前项目 ID
})
```

**示例 2：跨项目 feat（必须显式指定 `source_project`）**：

```typescript
// 在跨项目 feat 中为后端项目创建 Container
c4a_store_save({
  type: "container",
  data: {
    id: "auth-service",
    name: "认证服务"
  },
  source_project: "backend-api"  // 显式指定归属项目
})

// 在同一 feat 中为前端项目创建 Component
c4a_store_save({
  type: "component",
  data: {
    id: "login-form",
    name: "登录表单"
  },
  source_project: "frontend-app"  // 显式指定归属项目
})
```

**内部检查流程**：

```typescript
async function checkCreatePermission(currentUser: string, params: SaveParams, featContext: FeatContext) {
  // 1. 确定目标项目（跨项目 Feat 防呆设计）
  let targetProject = params.source_project;

  if (!targetProject) {
    // 检查当前 Feat 是否为跨项目 Feat
    if (featContext && isCrossProjectFeat(featContext.feat_id)) {
      // 跨项目 Feat 必须显式指定 source_project，不自动回退
      throw new DataIntegrityError({
        code: "C4A-INPUT-001",
        message: "跨项目 Feat 中创建实体必须显式指定 source_project",
        details: {
          field: "source_project",
          feat_id: featContext.feat_id,
          suggestion: "请在 c4a_store_save 调用中显式指定 source_project 参数"
        }
      });
    }

    // 单项目 Feat 或无 Feat 上下文时，允许自动填充
    targetProject = getCurrentProject();
  }

  if (!targetProject) {
    throw new DataIntegrityError({
      code: "C4A-INPUT-001",
      message: "无法确定实体归属项目",
      details: {
        field: "source_project",
        suggestion: "请在 .c4a.yaml 中配置 project_id，或显式指定 source_project"
      }
    });
  }

  // 2. 检查写权限（仅 Server/Remote 模式）
  if (getRunMode() !== "local") {
    const permissions = await loadProjectPermissions(targetProject);

    if (!permissions.writers.includes(currentUser) &&
        !permissions.admins.includes(currentUser)) {
      throw new PermissionError(
        `用户 ${currentUser} 无权限在项目 ${targetProject} 中创建实体`
      );
    }
  }

  return targetProject;
}

// 判断 Feat 是否为跨项目 Feat
async function isCrossProjectFeat(featId: string): Promise<boolean> {
  const entities = await c4a_store_list({
    filter: { "metadata.proposal_id": featId },
    fields: ["metadata.source_project"]
  });

  const projects = new Set(
    entities.map(e => e.metadata.source_project).filter(Boolean)
  );

  return projects.size > 1;
}
```

> **防呆设计说明**：当检测到当前 Feat 是跨项目的（涉及多个 `source_project`），但用户/Agent 调用 `c4a_store_save` 时未传 `source_project`，不会默认回退到 `getCurrentProject()`，而是直接抛出错误要求明确指定。这能有效防止将实体误归属到错误的项目。

**错误示例（跨项目 feat 未指定 `source_project`）**：

```typescript
// ❌ 错误：跨项目 feat 中未指定 source_project
c4a_store_save({
  type: "container",
  data: {
    id: "payment-service",
    name: "支付服务"
  }
  // 缺少 source_project 参数，系统无法判断归属项目
})

// 错误响应
{
  "code": "C4A-INPUT-001",
  "message": "跨项目 Feat 中创建实体必须显式指定 source_project",
  "details": {
    "field": "source_project",
    "expected": "明确的项目 ID",
    "actual": "undefined",
    "suggestion": "在跨项目 feat 中创建实体时，必须显式指定 source_project 参数"
  }
}
```

#### 1.4.2 修改实体时

```typescript
// 检查：当前用户是否有实体所属项目的写权限
async function checkUpdatePermission(currentUser: string, entityId: string) {
  const entity = await c4a_store_read({ id: entityId });
  const sourceProject = entity.metadata.source_project;

  if (!sourceProject) {
    // 无 source_project 的实体（如 Domain/Enterprise 层）需要特殊权限
    throw new PermissionError(`实体 ${entityId} 无 source_project，无法修改`);
  }

  const permissions = await loadProjectPermissions(sourceProject);

  if (!permissions.writers.includes(currentUser) &&
      !permissions.admins.includes(currentUser)) {
    throw new PermissionError(`用户 ${currentUser} 无权限修改项目 ${sourceProject} 的实体`);
  }
}
```

#### 1.4.3 发布 feat 时

```typescript
// 检查：当前用户是否有所有涉及项目的批准权限
async function checkPublishPermission(currentUser: string, featId: string) {
  // 1. 获取 feat 内所有实体
  const entities = await c4a_store_read({
    filter: { "metadata.proposal_id": featId }
  });

  // 2. 收集涉及的项目
  const affectedProjects = new Set<string>();
  for (const entity of entities) {
    if (entity.metadata.source_project) {
      affectedProjects.add(entity.metadata.source_project);
    }
  }

  // 3. 检查每个项目的批准权限
  for (const project of affectedProjects) {
    const permissions = await loadProjectPermissions(project);

    if (!permissions.admins.includes(currentUser)) {
      throw new PermissionError(
        `用户 ${currentUser} 缺少项目 ${project} 的批准权限，无法发布 feat ${featId}`
      );
    }
  }
}
```

#### 1.4.4 跨项目 feat 发布权限检查

> **适用场景**：feat 涉及多个项目时，发布操作需要执行用户同时拥有所有涉及项目的 admin 权限。

**v0.3.0 简化设计**：

- 不支持异步多方审批工作流
- 发布时同步检查执行用户的权限
- 如果用户缺少任一项目的 admin 权限，发布失败

**权限检查逻辑**：

```typescript
async function checkCrossProjectPublishPermission(
  currentUser: string,
  featId: string
): Promise<void> {
  // 1. 获取 feat 涉及的所有项目
  const affectedProjects = await getAffectedProjects(featId);

  // 2. 检查用户是否拥有所有项目的 admin 权限
  const missingPermissions: string[] = [];

  for (const project of affectedProjects) {
    const permissions = await loadProjectPermissions(project);
    if (!permissions.admins.includes(currentUser)) {
      missingPermissions.push(project);
    }
  }

  // 3. 如有缺失权限，返回错误
  if (missingPermissions.length > 0) {
    throw new PermissionError({
      code: "C4A-BIZ-006",
      message: `跨项目 feat 发布需要所有涉及项目的 admin 权限`,
      details: {
        user: currentUser,
        affected_projects: Array.from(affectedProjects),
        missing_permissions: missingPermissions,
        suggestion: `请联系以下项目的 admin 协助发布：${missingPermissions.join(', ')}`
      }
    });
  }
}
```

**用户交互示例**：

```
$ c4a feat publish feat-a001

❌ 发布失败：权限不足

跨项目 feat 涉及以下项目：
  - backend-api
  - frontend-app
  - infrastructure

您缺少以下项目的 admin 权限：
  - frontend-app (admin: @charlie)
  - infrastructure (admin: @david)

解决方案：
1. 联系项目 admin 协助发布
2. 或将 feat 拆分为多个单项目 feat
```

> **v0.4.0+ 规划**：未来版本可能支持异步多方审批工作流，允许多个项目 admin 独立审批后自动发布。

### 1.5 权限配置

#### 1.5.1 配置文件格式

```yaml
# .context/.c4a.yaml
permissions:
  # 项目级权限
  projects:
    backend-api:
      admins: [alice, bob]
      writers: [charlie, david]
      readers: [eve]

    frontend-app:
      admins: [frank]
      writers: [grace]
      readers: [alice, bob]  # 跨项目只读
```

> **注意**：不支持 feat 级权限配置。feat 不属于特定项目，权限统一通过项目级权限控制。跨项目 feat 发布时需要所有涉及项目的 admins 批准。

#### 1.5.2 权限继承规则

| 规则 | 说明 |
|------|------|
| 项目级权限 | 所有权限基于项目配置 |
| 跨项目 feat | 发布时需要所有涉及项目的 admins 批准 |
| 只读权限 | readers 可查看但不可修改 |

### 1.6 权限检查流程图

```
创建实体
  ↓
检查当前用户是否有目标项目的写权限
  ↓ 有权限
保存实体（设置 source_project）
  ↓ 无权限
抛出 PermissionError

修改实体
  ↓
读取实体的 source_project
  ↓
检查当前用户是否有该项目的写权限
  ↓ 有权限
更新实体
  ↓ 无权限
抛出 PermissionError

发布 feat
  ↓
收集 feat 内所有实体的 source_project
  ↓
检查当前用户是否有所有项目的批准权限
  ↓ 有权限
执行发布流程
  ↓ 无权限
抛出 PermissionError（列出缺少权限的项目）
```

### 1.7 实现建议

#### 1.7.1 权限检查在 MCP 工具层实现

```typescript
// MCP 工具层统一权限检查
class PermissionChecker {
  async checkWrite(user: string, project: string): Promise<void> {
    const permissions = await this.loadPermissions(project);

    if (!permissions.writers.includes(user) &&
        !permissions.admins.includes(user)) {
      throw new PermissionError(`无写权限: ${user} @ ${project}`);
    }
  }

  async checkApprove(user: string, project: string): Promise<void> {
    const permissions = await this.loadPermissions(project);

    if (!permissions.admins.includes(user)) {
      throw new PermissionError(`无批准权限: ${user} @ ${project}`);
    }
  }
}

// 在 MCP 工具中使用
async function c4a_store_save(params: SaveParams) {
  const currentUser = getCurrentUser();
  const targetProject = params.data.source_project || getCurrentProject();

  // 权限检查
  await permissionChecker.checkWrite(currentUser, targetProject);

  // 执行保存
  return await store.save(params);
}
```

#### 1.7.2 支持集成外部权限系统

```typescript
interface PermissionProvider {
  checkPermission(user: string, resource: string, action: string): Promise<boolean>;
}

// LDAP 权限提供者
class LDAPPermissionProvider implements PermissionProvider {
  async checkPermission(user: string, resource: string, action: string): Promise<boolean> {
    // 调用 LDAP API 检查权限
    return await ldapClient.checkAccess(user, resource, action);
  }
}

// OAuth 权限提供者
class OAuthPermissionProvider implements PermissionProvider {
  async checkPermission(user: string, resource: string, action: string): Promise<boolean> {
    // 调用 OAuth API 检查权限
    return await oauthClient.checkScope(user, resource, action);
  }
}
```

#### 1.7.3 权限审计日志

```typescript
interface PermissionAuditLog {
  timestamp: string;
  user: string;
  action: string;
  resource: string;
  result: 'granted' | 'denied';
  reason?: string;
}

class PermissionAuditor {
  async log(entry: PermissionAuditLog) {
    await db.prepare(`
      INSERT INTO permission_audit_logs (timestamp, user, action, resource, result, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.timestamp,
      entry.user,
      entry.action,
      entry.resource,
      entry.result,
      entry.reason
    );
  }

  async query(filters: { user?: string; action?: string; startDate?: string }) {
    // 查询审计日志
  }
}
```

---

