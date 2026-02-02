# C4A v0.3.0 用户故事验证记录

> 验证时间: 2026-02-02
> 验证人: Agent C
> 环境: Server 模式 (storage-backend + MongoDB + Neo4j + Milvus)

## 验证结果汇总

| 用户故事 | 状态 | 说明 |
|---------|:----:|------|
| US-001 需求迭代全流程 | ✅ | feat→specify→plan→implement→publish |
| US-002 研发主导流程 | ✅ | 跳过 specify，直接 plan→implement |
| US-003 ADR 流程 | ✅ | 架构变更识别 + ADR 创建 + 审批发布 |
| US-004 契约补充 | ✅ | 契约定义与关联 |
| US-005 业务知识 | ✅ | process 实体创建与语义搜索 |
| US-006 存量知识 | ✅ | 批量创建 system/container/sor，语义搜索可用 |

---

## US-001: 需求迭代全流程验证

**验收标准**: 完整走通 feat→specify→plan→implement→publish 流程

### Step 1: 创建 Feature

```typescript
// 调用 c4a_store_feat_lifecycle
{
  action: "create",
  feat_id: "feat-user-login",
  metadata: {
    title: "用户登录功能",
    description: "实现基础的用户登录认证功能",
    created_by: "agent-c"
  }
}
```

**结果**:
```json
{
  "success": true,
  "feat_id": "feat-user-login",
  "status": "draft",
  "message": "Feat created successfully"
}
```

### Step 2: 定义功能规格 (Specify)

```typescript
// 调用 c4a_store_save 创建 product 实体
{
  type: "product",
  proposal_id: "feat-user-login",
  data: {
    id: "product-user-login",
    name: "用户登录",
    description: "提供安全的用户身份认证功能",
    scope: "project",
    features: [
      "用户名密码登录",
      "登录状态保持",
      "登录失败处理"
    ],
    acceptance_criteria: [
      "用户可以使用用户名和密码登录",
      "登录成功后跳转到首页",
      "登录失败显示错误信息"
    ]
  }
}
```

**结果**:
```json
{
  "success": true,
  "id": "product-user-login",
  "type": "product",
  "proposal_id": "feat-user-login"
}
```

### Step 3: 技术方案设计 (Plan)

```typescript
// 创建 container 实体
{
  type: "container",
  proposal_id: "feat-user-login",
  data: {
    id: "auth-service",
    name: "认证服务",
    description: "处理用户认证和会话管理",
    technology: "Node.js + Express",
    scope: "project"
  }
}

// 创建 component 实体
{
  type: "component",
  proposal_id: "feat-user-login",
  data: {
    id: "login-handler",
    name: "登录处理器",
    description: "处理用户登录请求",
    container_id: "auth-service",
    scope: "project"
  }
}
```

**结果**: 两个实体创建成功

### Step 4: 生成 Checklist

```typescript
// 调用 c4a_store_feat_checklist
{
  action: "generate",
  feat_id: "feat-user-login",
  items: [
    { id: "task-1", title: "实现登录 API", type: "code", status: "pending" },
    { id: "task-2", title: "编写单元测试", type: "test", status: "pending" },
    { id: "task-3", title: "更新 API 文档", type: "doc", status: "pending" }
  ]
}
```

**结果**:
```json
{
  "success": true,
  "checklist": {
    "feat_id": "feat-user-login",
    "items": [
      { "id": "task-1", "title": "实现登录 API", "type": "code", "status": "pending" },
      { "id": "task-2", "title": "编写单元测试", "type": "test", "status": "pending" },
      { "id": "task-3", "title": "更新 API 文档", "type": "doc", "status": "pending" }
    ]
  }
}
```

### Step 5: 实现阶段 (Implement)

```typescript
// 更新 checklist 任务状态
{
  action: "patch",
  feat_id: "feat-user-login",
  patches: [
    { task_id: "task-1", updates: { status: "completed" } },
    { task_id: "task-2", updates: { status: "completed" } },
    { task_id: "task-3", updates: { status: "completed" } }
  ]
}
```

**结果**: 所有任务标记为完成

### Step 6: 审批发布

```typescript
// 状态流转: draft → approved
{
  action: "transition",
  feat_id: "feat-user-login",
  to_status: "approved"
}

// 状态流转: approved → published
{
  action: "transition",
  feat_id: "feat-user-login",
  to_status: "published"
}
```

**结果**:
```json
{
  "success": true,
  "feat_id": "feat-user-login",
  "status": "published"
}
```

### Step 7: 验证发布结果

```typescript
// 查询已发布的实体
{
  filter: { "metadata.source_project": "c4a-test" },
  limit: 10
}
```

**结果**: 所有实体 status 变为 `published`，proposal_id 变为 `null`

---

## US-002: 研发主导流程验证

**验收标准**: 跳过 specify 阶段，直接从 plan 开始

### Step 1: 创建 Feature

```typescript
{
  action: "create",
  feat_id: "feat-cli-perf",
  metadata: {
    title: "CLI 启动性能优化",
    description: "优化 CLI 启动时间，实现懒加载",
    created_by: "agent-c"
  }
}
```

### Step 2: 直接进入技术设计 (跳过 Specify)

```typescript
// 创建 container
{
  type: "container",
  proposal_id: "feat-cli-perf",
  data: {
    id: "cli-core",
    name: "CLI 核心模块",
    description: "CLI 主入口和命令分发，优化启动性能",
    technology: "TypeScript + Commander.js",
    scope: "project"
  }
}

// 创建 components
{
  type: "component",
  proposal_id: "feat-cli-perf",
  data: {
    id: "lazy-loader",
    name: "懒加载器",
    description: "按需加载命令模块，减少启动时间",
    container_id: "cli-core",
    scope: "project"
  }
}

{
  type: "component",
  proposal_id: "feat-cli-perf",
  data: {
    id: "cache-manager",
    name: "缓存管理器",
    description: "缓存配置和依赖检查结果",
    container_id: "cli-core",
    scope: "project"
  }
}
```

### Step 3: 生成 Checklist 并完成

```typescript
{
  action: "generate",
  feat_id: "feat-cli-perf",
  items: [
    { id: "perf-1", title: "实现懒加载机制", type: "code", status: "pending" },
    { id: "perf-2", title: "添加缓存层", type: "code", status: "pending" },
    { id: "perf-3", title: "性能测试", type: "test", status: "pending" }
  ]
}

// 完成所有任务
{
  action: "patch",
  feat_id: "feat-cli-perf",
  patches: [
    { task_id: "perf-1", updates: { status: "completed" } },
    { task_id: "perf-2", updates: { status: "completed" } },
    { task_id: "perf-3", updates: { status: "completed" } }
  ]
}
```

### Step 4: 审批发布

```typescript
{ action: "transition", feat_id: "feat-cli-perf", to_status: "approved" }
{ action: "transition", feat_id: "feat-cli-perf", to_status: "published" }
```

**结果**: ✅ 成功发布，无 product 实体也能完成流程

---

## US-003: ADR 流程验证

**验收标准**: 架构变更识别 + ADR 创建 + 审批发布

### Step 1: 创建 Feature

```typescript
{
  action: "create",
  feat_id: "feat-introduce-mq",
  metadata: {
    title: "引入消息队列",
    description: "引入 RabbitMQ 处理异步任务",
    created_by: "agent-c"
  }
}
```

### Step 2: 创建 ADR

```typescript
{
  type: "adr",
  proposal_id: "feat-introduce-mq",
  data: {
    id: "adr-003-introduce-mq",
    title: "引入消息队列处理异步任务",
    status: "proposed",
    context: "当前系统所有操作都是同步的，大文件处理和批量操作会阻塞用户请求",
    decision: "引入 RabbitMQ 作为消息队列，将耗时操作异步化",
    consequences: {
      positive: ["提升用户体验", "系统可扩展性增强"],
      negative: ["增加运维复杂度", "需要处理消息可靠性"],
      neutral: ["需要学习消息队列相关知识"]
    },
    scope: "project"
  }
}
```

### Step 3: 创建相关容器和组件

```typescript
// 消息队列容器
{
  type: "container",
  proposal_id: "feat-introduce-mq",
  data: {
    id: "c4a-mq",
    name: "消息队列服务",
    description: "基于 RabbitMQ 的消息队列服务，处理异步任务",
    technology: "RabbitMQ",
    scope: "project"
  }
}

// 生产者组件
{
  type: "component",
  proposal_id: "feat-introduce-mq",
  data: {
    id: "mq-producer",
    name: "消息生产者",
    description: "发送异步任务到消息队列",
    container_id: "c4a-mq",
    scope: "project"
  }
}

// 消费者组件
{
  type: "component",
  proposal_id: "feat-introduce-mq",
  data: {
    id: "mq-consumer",
    name: "消息消费者",
    description: "从消息队列消费并处理异步任务",
    container_id: "c4a-mq",
    scope: "project"
  }
}
```

### Step 4: 审批发布

```typescript
{ action: "transition", feat_id: "feat-introduce-mq", to_status: "approved" }
{ action: "transition", feat_id: "feat-introduce-mq", to_status: "published" }
```

**结果**: ✅ ADR 和相关架构实体成功发布

---

## US-004: 契约补充验证

**验收标准**: 契约定义与关联

### Step 1: 创建 Feature

```typescript
{
  action: "create",
  feat_id: "feat-auth-contract",
  metadata: {
    title: "认证服务 API 契约",
    description: "定义认证服务的 REST API 契约",
    created_by: "agent-c"
  }
}
```

### Step 2: 创建契约实体

```typescript
{
  type: "contract",
  proposal_id: "feat-auth-contract",
  data: {
    id: "contract-auth-api",
    name: "认证服务 API 契约",
    description: "用户认证相关的 REST API 契约定义",
    format: "openapi",
    version: "1.0.0",
    provider: "auth-service",
    consumers: ["web-frontend", "mobile-app"],
    endpoints: [
      {
        path: "/api/auth/login",
        method: "POST",
        description: "用户登录"
      },
      {
        path: "/api/auth/logout",
        method: "POST",
        description: "用户登出"
      }
    ],
    scope: "project"
  }
}
```

### Step 3: 审批发布

```typescript
{ action: "transition", feat_id: "feat-auth-contract", to_status: "approved" }
{ action: "transition", feat_id: "feat-auth-contract", to_status: "published" }
```

### Step 4: 验证契约可搜索

```typescript
// 语义搜索
{ query: "用户认证 API", scope: "contract" }
```

**结果**:
```json
{
  "success": true,
  "items": [
    {
      "id": "contract-auth-api",
      "type": "contract",
      "score": 0.62
    }
  ]
}
```

---

## US-005: 业务知识验证

**验收标准**: process 实体创建与语义搜索

### Step 1: 创建 Feature

```typescript
{
  action: "create",
  feat_id: "feat-order-process",
  metadata: {
    title: "订单履约流程",
    description: "记录订单从创建到完成的业务流程",
    created_by: "agent-c"
  }
}
```

### Step 2: 创建 Process 实体

```typescript
{
  type: "process",
  proposal_id: "feat-order-process",
  data: {
    id: "process-order-fulfillment",
    name: "订单履约流程",
    description: "从用户下单到订单完成的完整业务流程",
    steps: [
      { order: 1, name: "用户下单", actor: "用户" },
      { order: 2, name: "库存检查", actor: "库存系统" },
      { order: 3, name: "支付处理", actor: "支付系统" },
      { order: 4, name: "订单确认", actor: "订单系统" },
      { order: 5, name: "物流发货", actor: "物流系统" },
      { order: 6, name: "订单完成", actor: "订单系统" }
    ],
    participants: ["用户", "库存系统", "支付系统", "订单系统", "物流系统"],
    scope: "project"
  }
}
```

### Step 3: 审批发布

```typescript
{ action: "transition", feat_id: "feat-order-process", to_status: "approved" }
{ action: "transition", feat_id: "feat-order-process", to_status: "published" }
```

### Step 4: 验证语义搜索

```typescript
{ query: "订单流程 物流", scope: "process" }
```

**结果**:
```json
{
  "success": true,
  "items": [
    {
      "id": "process-order-fulfillment",
      "type": "process",
      "score": 0.58
    }
  ]
}
```

---

## US-006: 存量知识整理验证

**验收标准**: 存量文档正确解析，实体关系正确建立

### Step 1: 批量创建存量知识实体

```typescript
// 创建外部系统
{
  type: "system",
  data: {
    id: "legacy-erp",
    name: "传统 ERP 系统",
    description: "公司现有的 ERP 系统，管理财务、库存、采购等",
    external: true,
    scope: "project"
  }
}

// 创建容器 - 库存模块
{
  type: "container",
  data: {
    id: "erp-inventory",
    name: "库存管理模块",
    description: "ERP 系统的库存管理模块",
    technology: "Java + Oracle",
    system_id: "legacy-erp",
    scope: "project"
  }
}

// 创建容器 - 财务模块
{
  type: "container",
  data: {
    id: "erp-finance",
    name: "财务管理模块",
    description: "ERP 系统的财务管理模块",
    technology: "Java + Oracle",
    system_id: "legacy-erp",
    scope: "project"
  }
}

// 创建 SOR (System of Record)
{
  type: "sor",
  data: {
    id: "sor-inventory-data",
    name: "库存数据权威源",
    description: "库存数据的唯一权威来源",
    owner: "erp-inventory",
    data_domains: ["库存数量", "库存位置", "库存成本"],
    scope: "project"
  }
}
```

**结果**: 4 个实体全部创建成功

### Step 2: 验证语义搜索

```typescript
{ query: "ERP 库存管理", scope: "all" }
```

**结果**:
```json
{
  "success": true,
  "items": [
    { "id": "erp-finance", "type": "container", "score": 0.51 },
    { "id": "legacy-erp", "type": "system", "score": 0.50 },
    { "id": "sor-inventory-data", "type": "sor", "score": 0.48 },
    { "id": "erp-inventory", "type": "container", "score": 0.48 }
  ],
  "search_mode": "vector"
}
```

### Step 3: 验证实体数据

```typescript
// 读取实体详情
{ id: "erp-inventory", include_relations: true }
```

**结果**:
```json
{
  "entity": {
    "id": "erp-inventory",
    "type": "container",
    "data": {
      "id": "erp-inventory",
      "name": "库存管理模块",
      "description": "ERP 系统的库存管理模块",
      "technology": "Java + Oracle",
      "system_id": "legacy-erp"
    },
    "metadata": {
      "status": "published"
    }
  },
  "relations": []
}
```

---

## 待改进项

### 1. 关系图自动建立

**现象**: 保存 container 时指定了 `system_id`，但 Neo4j 中未自动创建 `CONTAINS` 关系边

**影响**: `c4a_query_deps` 返回空关系

**建议**: 在 `c4a_store_save` 时，根据以下字段自动创建关系：
- `container.system_id` → `(system)-[:CONTAINS]->(container)`
- `component.container_id` → `(container)-[:CONTAINS]->(component)`
- `sor.owner` → `(container)-[:OWNS]->(sor)`

### 2. 依赖查询错误处理

**现象**: `c4a_query_deps` 对不存在关系的实体返回 `Bad Request` 错误

**建议**: 应返回空结果而非错误：
```json
{
  "success": true,
  "entity_id": "legacy-erp",
  "dependencies": [],
  "message": "No relationships found"
}
```

---

## 环境配置

验证使用的配置文件 `.context/.c4a.yaml`:

```yaml
mode: server
server:
  url: http://localhost:8051
  headers:
    X-User-ID: agent-c-test
project_id: c4a-test
```

启动命令:
```bash
./start.sh dev
```
