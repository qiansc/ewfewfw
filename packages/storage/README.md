# @c4a/storage

C4A Storage 层实现，包含 Local/Server Adapter、SQLiteStore 与 Data Ops 业务逻辑。

## Data Ops 模块

Data Ops 提供以下子模块：

- feat：生命周期、合并、冲突检测
- reference：引用解析与校验
- sync：同步/导出/冲突检测
- transaction：feat 事务、回滚、补偿
- workflow：Workflow 状态与恢复

## Server 模式

Server 模式通过 storage-backend（Python）访问 MongoDB/Neo4j/Milvus。配置文件位于 `.context/.c4a.yaml`：

```yaml
mode: server
server:
  url: http://localhost:8055
```

使用 `getAdapter` 获取适配器：

```ts
import { getAdapter } from "@c4a/storage";

const adapter = await getAdapter();
await adapter.save({
  type: "system",
  id: "demo-system",
  source_project: "demo",
  data: { id: "demo-system", name: "Demo System", source_project: "demo" },
});
```

### Docker 部署

```bash
docker-compose -f docker/docker-compose.server.yml up -d
curl http://localhost:8055/health
```

Docker 部署下 MCP 容器通过 `C4A_STORAGE_BACKEND_URL` 直连后端；如需调整后端地址，请修改环境变量。
若后端运行在容器中且宿主机无法直接访问容器文件路径，Server→Local 迁移会通过
`/utils/download` 下载备份文件；该接口默认仅允许 `/tmp` 或 `/var/tmp` 路径。

## Server 模式降级行为

当 Neo4j 或 Milvus 服务不可用时，查询操作会优雅降级：

| 服务 | 影响的操作 | 降级行为 |
|------|-----------|---------|
| Milvus | search | 回退到 LIKE 搜索 + `degraded: true` |
| Neo4j | queryDeps, queryImpact | 返回空结果 + `degraded: true` |

## 同步状态追踪

实体保存时会记录 Neo4j/Milvus 同步状态：

- `synced`: 同步成功
- `pending`: 同步失败，待重试

使用 `/utils/check-consistency` 检查一致性状态。
使用 `/utils/repair` 修复不一致的数据。

## 使用示例

### Data Ops 直接调用

```ts
import {
  SQLiteStore,
  InMemoryGraph,
  GraphQueryCache,
  createDataOpsContext,
  featLifecycle,
  parseReference,
  sync,
} from '@c4a/storage';

const store = SQLiteStore.getInstance({ dbPath: './c4a.db' });
const ctx = createDataOpsContext({
  store,
  graph: new InMemoryGraph(),
  cache: new GraphQueryCache(),
  config: {
    dbPath: './c4a.db',
    defaultProject: 'alpha',
    enableVectorSearch: false,
    repoId: null,
    feat: {
      concurrent_warning: true,
      auto_notify: false,
    },
  },
});

await featLifecycle(ctx, {
  action: 'create',
  feat_id: 'feat-1',
  metadata: {
    title: 'feat-1',
    description: 'demo',
    created_by: 'user',
  },
});

const ref = parseReference('project:alpha/sys-1');
await sync(ctx, {
  direction: 'db-to-file',
  path: process.cwd(),
  mode: 'incremental',
  format: 'yaml',
});
```
