# @c4a/storage

C4A Storage 层实现，包含 Local/Server Adapter、SQLiteStore 与 Data Ops 业务逻辑。

## Data Ops 模块

Data Ops 提供以下子模块：

- feat：生命周期、合并、冲突检测
- reference：引用解析与校验
- sync：同步/导出/冲突检测
- transaction：feat 事务、回滚、补偿
- workflow：Workflow 状态与恢复

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
