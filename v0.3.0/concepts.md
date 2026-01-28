# C4A 核心概念

> 知识驱动开发的核心概念定义

## 1. 双视角三构建块

C4A 采用"**双视角三构建块**"模型来组织知识：

### 1.1 三个构建块

| 构建块 | 说明 | 核心问题 |
|-------|------|---------|
| **Entity** | 承载知识的主体 | "是什么？" |
| **Process** | 业务或技术流程 | "怎么运作？" |
| **SoR** | Statement of Requirements，需求项 | "要满足什么？" |

### 1.2 两个视角

| 视角 | 关注点 | 核心问题 | Entity 表现形式 |
|-----|-------|---------|--------------|
| **业务视角** | 业务价值、用户需求 | "做什么业务？" | Product（业务产品） |
| **技术视角** | 技术实现、系统架构 | "如何实现？" | System/Container/Component |

### 1.3 双视角的并行结构

```
业务视角（Business Perspective）         技术视角（Technical Perspective）
─────────────────────────────          ─────────────────────────────
Entity: Product                   ←→   Entity: System/Container/Component
Process: Business Process         ←→   Process: Technical Process
SoR: Business SoR                 ←→   SoR: Technical SoR
```

**关键理解**：
- 两个视角**完全并行**，结构对称
- Product 和 System 是**同一事物的两个视角**，通过 `CORRESPONDS` 关系 1:1 对应
- Business SoR 和 Technical SoR 通过 `CORRESPONDS` 关系连接

---

## 2. 三层知识结构

### 2.1 层级概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      三层知识结构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Domain Knowledge (行业知识)                                    │
│    视角: 纯业务视角                                             │
│    构建块: Entity(Product) + Process + SoR                     │
│     ↓ 实例化 + 定制化                                          │
│                                                                 │
│  Enterprise Knowledge (企业知识)                                │
│    视角: 纯业务视角                                             │
│    构建块: Entity(Product) + Process + SoR                     │
│     ↓ 引用 Product，Project 层创建对应 System                   │
│                                                                 │
│  Project Knowledge (项目知识)                                   │
│    视角: 业务视角 + 技术视角（完整双视角）                        │
│    构建块: Entity(Product/System) + Process + SoR              │
│    特点: Product 引用 Enterprise，System 与 Product 1:1 对应     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 三层对比

| 维度 | Domain | Enterprise | Project |
|-----|--------|-----------|---------|
| **视角** | 纯业务 | 纯业务 | 业务 + 技术（双视角） |
| **Entity 形式** | Product | Product | Product + System/Container/Component |
| **管理者** | 行业专家 | 技术委员会 | 研发团队 |
| **变更频率** | 低（年度级） | 中（季度级） | 高（日度级） |
| **是否有代码** | ❌ 无 | ❌ 无 | ✅ 有 |

### 2.3 知识流动

```
Domain Knowledge (行业)
    ↓ 实例化 + 定制化
Enterprise Knowledge (企业)
    ↓ 引用 + 细化（通过提案-批准-发布流程）
Project Knowledge (项目)
    ↓ 反馈
Enterprise Knowledge (企业)
```

**关键机制**：
1. **引用而非复制**：Project 通过 `REFERENCES` 关系引用 Enterprise 的 Product
2. **System 在 Project 层创建**：与 Product 1:1 对应，然后细化为 Container/Component
3. **提案流程**：通过 Draft → Approved → Published → Deprecated → Archived 流程管理变更

---

## 3. 知识生命周期

所有知识遵循统一的生命周期：

```
draft ──批准──► approved ──发布──► published ──废弃──► deprecated ──归档──► archived
  │                                    │                              │
│                                    └───────────快速归档───────────►│（仅 feat）
  └──────────────拒绝──────────────────►                               │
                                                                      ▼
                                                                  archived
```

| 状态 | 说明 | 可操作 | 流转条件 |
|------|------|--------|---------|
| **draft** | 正在编辑 | 修改、删除、提交审批 | - |
| **approved** | 已批准，准备实施 | 开始实施、发布 | - |
| **published** | 已发布，成为权威知识 | 查看、引用、创建新版本 | - |
| **deprecated** | 已废弃，不推荐使用 | 归档 | 满足归档条件后可归档 |
| **archived** | 已归档，不再使用 | 查看（只读） | - |

**强制规则**：
- 状态流转必须按顺序进行，不可跳过（除以下例外）
- `draft → published` 是非法操作，必须先经过 `approved`
- 只有 `approved` 状态的实体才能发布
- `published` 状态的实体不可直接修改，需创建新版本（新 draft）
- `published → archived` 仅适用于 feat（普通实体不支持快速归档）
- 状态流转需记录操作人和时间（记录在 entity_history，可用 `c4a_store_read_history` 查询）

> **Local 模式说明**：Local 模式下，状态流转记录通过 entity_history 追踪，不在 DSL 文件中存储额外的 history 字段。这是为了：
> 1. 保持 DSL 文件简洁（Schema 设置 `additionalProperties: false`）
> 2. 统一通过变更历史查询（`c4a_store_read_history`）
> 3. 避免数据冗余

**deprecated → archived 的条件**：

实体从 `deprecated` 流转到 `archived` 需满足以下**所有条件**：

1. **最小保留期**：deprecated 状态至少保持 30 天（可配置）
2. **无活跃引用**：没有 `published` 状态的实体引用此实体
3. **无 feat 引用**：没有 `draft` 或 `approved` 状态的 feat 引用此实体
4. **人工确认**：需要管理员或实体负责人确认归档

> **实现说明**：
> - **Server 模式**：完整实现上述条件校验（含 SQL 查询）
> - **Local 模式**：当前版本仅校验状态流转规则（如 draft→approved→published 顺序），不校验归档条件（最小保留期、引用检查等），由用户自行判断是否满足归档条件
> - **MCP 工具**：普通实体通过 `c4a_store_save` 更新 status 字段；Feat 通过 `c4a_store_feat_lifecycle` (action: "transition") 执行状态流转

**状态值规范**：数据库中使用小写：`draft`, `approved`, `published`, `deprecated`, `archived`

> **详细设计**：归档检查的完整实现（含 SQL 查询）请参考 [detailed-design/permissions-and-errors.md](./detailed-design/permissions-and-errors.md)

---

## 4. 三个构建块详解

### 4.1 Entity（实体）

**定义**：承载知识的主体，在不同视角下有不同的表现形式。

#### 4.1.1 Entity 在双视角下的表现

| 视角 | Entity 表现 | 说明 | 示例 |
|-----|------------|------|------|
| **业务视角** | Product | 业务产品分类 | 电商平台、直播带货 |
| **技术视角** | System/Container/Component | 技术实现的层级结构 | 直播系统、视频服务、编码组件 |

#### 4.1.2 Product 与 System 的关系

Product（业务视角）和 System（技术视角）是**同一事物的两个视角**：

- **1:1 对应**：通过 `CORRESPONDS` 关系建立对应
- **不同层级定义**：Product 在 Enterprise 层定义，Project 层引用 Enterprise 的 Product + 创建对应的 System
- **独立管理**：各自有独立的生命周期和属性

```yaml
# Enterprise Knowledge - 业务视角（定义 Product）
- id: live-commerce-product
  type: product
  scope: enterprise
  name: 品牌直播带货

# Project Knowledge - 业务视角（引用 Enterprise Product）
- id: live-commerce-product
  type: product
  scope: project
  reference_from: enterprise

# Project Knowledge - 技术视角（创建 System，与 Product 1:1 对应）
- id: live-commerce-system
  type: software-system  # DSL 使用 software-system，内部映射为 system
  scope: project
  corresponds_to: live-commerce-product  # 1:1 对应
```

#### 4.1.3 技术视角的 Entity 层级（C4 模型）

技术视角下的 Entity 采用 C4 模型的层级结构：

| C4 层级 | 说明 | 与代码的关联 |
|--------|------|-------------|
| System | 软件系统，与 Product 1:1 对应 | - |
| Container | 容器/服务，System 的组成部分 | `code_path` 关联代码目录 |
| Component | 组件/模块，Container 的组成部分 | `code_path` 关联代码文件 |

#### 4.1.4 Entity 在各层的表现

| 层级 | 业务视角 (Product) | 技术视角 (System/Container/Component) |
|-----|-------------------|---------------------------------------|
| Domain | ✅ 行业产品分类 | ❌ 无 |
| Enterprise | ✅ 企业产品分类 | ❌ 无 |
| Project | ✅ 引用 Enterprise | ✅ 创建 System（与 Product 1:1），细化为 Container/Component |

---

### 4.2 Process（流程）

**定义**：产品生命周期中的逻辑工作单元，描述"怎么运作"

#### 4.2.1 双视角下的 Process

| 视角 | 类型 | 含义 | 示例 |
|-----|-----|------|------|
| **业务视角** | Business Process | 业务活动流程 | 订单履约流程、退款流程 |
| **技术视角** | Technical Process | 技术活动流程 | 服务部署流程、数据同步流程 |

#### 4.2.2 Process 在各层的表现

| 层级 | Business Process | Technical Process |
|-----|-----------------|-------------------|
| Domain | ✅ 行业通用流程 | ❌ 无 |
| Enterprise | ✅ 企业定制流程 | ❌ 无 |
| Project | ✅ 引用或细化 | ✅ 项目新增 |

#### 4.2.3 Process 的层级结构

Process 可以分层，形成流程树：

```
用户认证流程 (prc-b-a001)
├── 密码验证 (prc-b-a002)
├── 多因素认证 (prc-b-a003)
└── 生成会话 (prc-b-a004)
```

#### 4.2.4 Flow（流程图）

**重要**：Flow 不是独立的实体类型，而是 Process 的可视化表达。

Flow 是 Process 的可视化表达，用于直观展示流程的执行逻辑：

| Flow 类型 | 说明 | 适用 Process 类型 |
|----------|------|------------------|
| Sequence Diagram | 时序图，展示参与者之间的交互顺序 | Business/Technical |
| Activity Diagram | 活动图，展示流程的步骤和分支 | Business/Technical |
| State Machine | 状态机，展示状态转换逻辑 | Business/Technical |

**存储方式**：

Flow 不作为独立实体存储，而是作为 Process 的附属信息：

| 方式 | 说明 | 示例 |
|------|------|------|
| **data 字段** | 在 Process 的 data 中存储 Flow 信息 | `data.flow.type`, `data.flow.diagram_uri` |
| **assets 目录** | 将流程图文件存储在 assets 目录 | `./assets/order-fulfillment-flow.png` |

**示例**：

```yaml
# Business Process 的 Flow
- id: prc-b-a001
  type: process
  process_type: business
  name: 订单履约流程
  data:
    description: 从下单到发货的完整流程
    flow:
      type: activity_diagram
      diagram_uri: ./assets/order-fulfillment-flow.png

# Technical Process 的 Flow
- id: prc-t-a001
  type: process
  process_type: technical
  name: 服务部署流程
  data:
    description: 微服务的自动化部署流程
    flow:
      type: sequence_diagram
      diagram_uri: ./assets/deployment-sequence.png
```

---

### 4.3 SoR（需求项）

**定义**：Statement of Requirements，描述"要满足什么"

#### 4.3.1 双视角下的 SoR

| 视角 | entity_type | 关联实体 | 关联流程 | 示例 |
|-----|------------|---------|---------|------|
| **业务视角** | product | Product | Business Process | "支持 7 天无理由退款" |
| **技术视角** | system/container/component | System/Container/Component | Technical Process | "响应时间 < 500ms" |

#### 4.3.2 SoR 的 9 种类型

| 类型 | 说明 | 子类型 |
|-----|------|--------|
| Business Rule | 业务规则 | Policy, Validation, Business Scenario |
| Business Data | 业务数据 | - |
| Non-functional | 非功能属性 | Performance, Security, Usability, Scalability, Reliability |
| Report | 报表 | - |
| Communication | 沟通 | Inbound, Outbound |
| Utility | 工具 | - |
| User Interface | 用户界面 | - |
| Message | 消息 | - |
| KPI | 关键绩效指标 | - |

#### 4.3.3 SoR 在各层的表现

| 层级 | Business SoR | Technical SoR |
|-----|-------------|---------------|
| Domain | ✅ 行业通用需求 | ❌ 无 |
| Enterprise | ✅ 企业特有需求 | ❌ 无 |
| Project | ✅ 引用或细化 | ✅ 项目新增 |

#### 4.3.4 Business SoR 与 Technical SoR 的关系

```yaml
# Business SoR（业务视角）
- id: sor-b-a001
  entity_type: product
  entity_id: live-commerce-product
  sor_type: non_functional
  description: 直播间需要支持万人同时在线观看

# Technical SoR（技术视角）
- id: sor-t-a001
  entity_type: container
  entity_id: live-streaming-service
  sor_type: non_functional
  description: 服务需要支持水平扩展，QPS 10000+
  corresponds_to: sor-b-a001  # 数据字段，冗余存储对应关系

# 关系（图数据库存储）
- from: sor-t-a001
  to: sor-b-a001
  rel_type: CORRESPONDS
```

> **字段与关系双轨存储**：`corresponds_to` 字段是 `CORRESPONDS` 关系的冗余存储。
> - **字段**：便于单表查询，无需 JOIN 图数据库
> - **关系**：支持图遍历和复杂关系查询
> - **维护方式**：当前版本由 `relations` 表维护关系（DSL 不包含 `data.relationships`），字段仅作为便捷查询的冗余存储
>
> **示例**：SoR 字段与关系表
> ```yaml
> schema: c4a/v1
> type: sor
> sor:
>   id: sor-t-a001
>   corresponds_to: sor-b-a001    # DSL 字段，便于单表查询
> # 关系由 relations 表维护，不在 DSL 中定义
> # relations 表记录: (sor-t-a001) -[CORRESPONDS]-> (sor-b-a001)
> ```

---

## 5. Entity-Process Mesh

### 5.1 Mesh 的本质

Entity-Process Mesh 是 C4A 的核心关系机制。实体（Entity）与流程（Process）的交叉点产生 SoR（需求项）。

```
Entity × Process → SoR
```

### 5.2 双视角的 Mesh

| Mesh 类型 | Entity | Process | 产出 |
|----------|--------|---------|------|
| Product-Process Mesh | Product | Business Process | Business SoR |
| Implementation-Process Mesh | System/Container/Component | Technical Process | Technical SoR |

### 5.3 各层的 Mesh 结构

#### Domain/Enterprise Knowledge（纯业务视角）

```
         Business Process 1   Business Process 2   Business Process 3
Product 1        SoR               SoR                  SoR
Product 2        SoR               SoR                  SoR
Product 3        SoR               SoR                  SoR
```

#### Project Knowledge（完整双视角）

**业务视角**：
```
         Business Process 1   Business Process 2
Product 1        SoR               SoR
Product 2        SoR               SoR
```

**技术视角**：
```
                Technical Process 1   Technical Process 2
System 1              SoR                 SoR
Container 1           SoR                 SoR
Component 1           SoR                 SoR
```

**视角间关系**：
```
Business SoR ←─(CORRESPONDS)─→ Technical SoR
```

### 5.4 Mesh 示例

```yaml
# 业务视角：Product × Business Process → Business SoR
- id: sor-b-a001
  entity_type: product
  entity_id: live-commerce-product       # Product
  process_id: prc-b-a001                 # Business Process: 直播销售流程
  sor_type: business_rule
  description: 品牌直播需要提前48小时预约直播间

# 技术视角：Entity(Container) × Technical Process → Technical SoR
- id: sor-t-a001
  entity_type: container
  entity_id: live-streaming-service      # Container
  process_id: prc-t-a001                 # Technical Process: 服务部署流程
  sor_type: non_functional
  description: 服务需要支持水平扩展，QPS 10000+

# 关系：Business SoR → Technical SoR
- from: sor-t-a001
  to: sor-b-a001
  rel_type: CORRESPONDS
```

---

## 6. 关系类型

C4A 定义了 6 种核心关系类型：

| 关系类型 | 语义 | 存储方向 | 示例 |
|---------|------|---------|------|
| **CONTAINS** | 层级包含 | 父→子 | System→Container→Component |
| **DEPENDS_ON** | 依赖关系 | 依赖方→被依赖方 | Container A→Container B |
| **REFERENCES** | 引用关系 | 引用方→被引用方 | Project Product→Enterprise Product |
| **IMPLEMENTS** | 实现关系 | 实现方→被实现方 | Component→Contract, Contract→SoR |
| **CORRESPONDS** | 对应关系（双视角映射，语义双向） | Technical→Business | System→Product, Technical SoR→Business SoR |
| **DERIVES** | 派生/产出 | 产出方→被产出方 | Entity×Process→SoR |

**关系方向说明**：
- 所有关系在图数据库中都有明确的存储方向（from→to）
- `CORRESPONDS` 关系虽然语义上是双向对应，但存储时约定从 Technical 指向 Business
- 查询时可以双向遍历（通过 `direction: 'both'` 参数）

---

## 7. 知识追溯链

完整的知识追溯链（双向追溯）：

```
业务视角                                    技术视角
────────                                    ────────
Product (业务产品)          ←─CORRESPONDS── System (技术系统)
    │                                           │
    │ DERIVES                                   │ CONTAINS
    ↓                                           ↓
Business SoR (业务需求)     ←─CORRESPONDS── Technical SoR (技术需求)
                                                │
                                                │ IMPLEMENTS
                                                ↓
                                           Contract (接口规格)
                                                │
                                                │ IMPLEMENTS
                                                ↓
                                           Component (组件)
                                                │
                                                │ code_path
                                                ↓
                                           Code (代码文件)
```

**存储方向说明**：
- 图中 `←─CORRESPONDS──` 表示存储方向是从右到左（Technical→Business）
- 箭头 `↓` 表示其他关系的存储方向
- 查询时可以双向遍历所有关系

**从代码反向追溯到业务**：
1. Code → Component (code_path)
2. Component → Contract (IMPLEMENTS)
3. Contract → Technical SoR (IMPLEMENTS)
4. Technical SoR → Business SoR (CORRESPONDS)
5. Business SoR → Product × Process (DERIVES)

**关系链路说明**：
- **Contract 实现 SoR**：Contract 是 SoR 的技术设计表达（设计转化）
- **Component 实现 Contract**：Component 是 Contract 的代码实现（代码实现）

---

## 8. 附属实体

附属实体不是三构建块（Entity/Process/SoR），但作为独立的实体类型存储在数据库中。

**概念定位说明**：

| 维度 | 说明 |
|------|------|
| **存储层面** | ADR 和 Contract 是独立的实体，有自己的 ID、type、data，可以独立保存和查询 |
| **概念层面** | ADR 和 Contract 是附属实体，必须关联到核心实体（System/Container/Component）才有意义 |
| **API 层面** | 在 MCP 工具接口中，`type: "adr" \| "contract"` 与其他实体类型并列处理 |

**设计理由**：
- **存储独立性**：ADR 和 Contract 可独立创建、修改、删除（状态流转随 feat，见 architecture.md §2.6）
- **概念依赖性**：ADR 记录架构决策，Contract 描述接口规格，都需要关联到具体的技术实体才有意义
- **关系建议**：虽然不强制检查，但强烈建议通过 `REFERENCES` 或 `IMPLEMENTS` 关系关联到核心实体

> **API 层面的处理**：在 MCP 工具接口（如 `c4a_store_save`）中，Contract 和 ADR 作为独立的 `type` 值处理，与其他实体类型并列。但从概念上，它们仍是附属实体，建议（不强制）关联到核心实体。详见 [mcp-tools.md#3.1](./detailed-design/mcp-tools.md#31-c4a_store_save保存更新实体)

### 8.1 Contract（接口规格）

Contract 是 **SoR 的技术设计表达**，描述接口的具体规格：

| 维度 | SoR | Contract |
|------|-----|----------|
| **层级** | 需求层面 | 设计层面 |
| **描述** | "要满足什么" | "接口长什么样" |
| **产生顺序** | 先 | 后（基于 SoR 设计） |

**Contract 类型**：
- OpenAPI (REST API 规格)
- AsyncAPI (消息/事件规格)
- Proto (gRPC 规格)
- GraphQL (GraphQL Schema 规格)

**Contract 存储方式**：

| 字段 | 说明 | 适用场景 |
|------|------|---------|
| `spec` | 内联存储规格内容 | 小型契约，便于版本管理 |
| `spec_uri` | 外部引用（URI 作为唯一标识） | 大型契约，避免 DSL 文件过大 |

> **重要说明**：`spec_uri` 是 **URI 唯一标识**，不是文件路径同步机制。
>
> - **设计意图**：URI 本身就是资源的唯一标识符（如 `https://api.example.com/specs/order-service.json` 或 `./contracts/order-service.openapi.yaml`）
> - **数据库存储**：仅存储 URI 字符串，不存储文件内容
> - **解析责任**：由外部工具（如 API 网关、文档生成器）根据 URI 解析和获取规格内容
> - **同步范围**：`spec_uri` 指向的文件**不在 C4A 同步范围内**，类似于 `external_url` 字段
> - **版本管理**：如果需要版本管理，应使用 `spec` 内联存储，或在 URI 中包含版本信息（如 `./contracts/order-service.v1.openapi.yaml`）
>
> **使用建议**：
> - 小型契约（< 500 行）：使用 `spec` 内联存储，便于版本管理和同步
> - 大型契约（> 500 行）：使用 `spec_uri` 引用，由专门的契约管理系统（如 Swagger Hub、API Portal）管理
> - 团队共享契约：使用远程 URL（如 `https://contracts.company.com/order-service.json`），确保所有成员访问同一版本

**Contract 字段说明**：

| 字段 | 说明 | 示例 |
|------|------|------|
| `implements_sor` | 记录此 Contract 实现了哪些 SoR（数据字段） | `[sor-t-a001, sor-t-a002]` |

**关系链路**：
```
SoR (需求项)
  ↓ 设计转化 (IMPLEMENTS 关系)
Contract (接口规格)
  ↓ 代码实现 (IMPLEMENTS 关系)
Component (代码)
```

**示例 1：内联存储（spec）**：
```yaml
schema: c4a/v1
type: contract
contract:
  id: api-order-service
  name: 订单服务 API
  contract_type: openapi
  status: draft
  implements_sor: [sor-t-a001, sor-t-a002]
spec:
  openapi: "3.0.0"
  info:
    title: Order Service API
    version: "1.0.0"
  paths:
    /orders:
      post:
        summary: 创建订单
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  user_id:
                    type: string
                  items:
                    type: array
        responses:
            '200':
              description: 订单创建成功
```

**示例 2：外部引用（spec_uri）**：
```yaml
schema: c4a/v1
type: contract
contract:
  id: api-order-service
  name: 订单服务 API
  contract_type: openapi
  status: draft
  implements_sor: [sor-t-a001, sor-t-a002]
spec_uri: ./contracts/order-service.openapi.yaml
```

### 8.2 ADR（架构决策记录）

ADR (Architecture Decision Record) 记录架构决策的背景、选项和结论。

**特点**：
- 只在 Project Knowledge 层存在
- 记录"为什么这样设计"
- 永久保留，形成架构决策历史
- 可以被后续 ADR 替代（supersede）

### 8.3 Functional Spec / Technical Spec

Functional Spec 和 Technical Spec 是 **PRD / 技术设计的 DSL 版本**：

| 概念 | 等价于 | 组成 |
|------|--------|------|
| **Functional Spec** | PRD 的 DSL 版本 | Product + Business Process + Business SoR |
| **Technical Spec** | 技术设计的 DSL 版本 | System/Container/Component + Technical Process + Technical SoR + Contract |

**绑定维度与查询方式**：

| 查询维度 | 说明 | 示例 |
|---------|------|------|
| **按 feat 取** | 获取某个 feat 下的所有实体 | `proposal_id = "feat-001"` |
| **按 Product 取** | 获取某产品的 Functional Spec | `corresponds_to = "product-xxx"` 或 `entity_id = "product-xxx"` |
| **按 System 取** | 获取某系统的 Technical Spec | `system_id = "xxx"` 或 `container.system_id = "xxx"` |
| **按 scope 取** | 获取某层级的所有 Spec | `scope = "project"` |

**查询示例**：

```typescript
// 按 feat 获取 Technical Spec（使用 c4a_store_list 进行条件查询）
c4a_store_list({
  filter: { proposal_id: "feat-001" },
  type: "all"  // 或指定具体类型
})

// 按 System 获取完整 Technical Spec
c4a_store_list({
  filter: { "data.system_id": "e-commerce-system" },
  type: "all"  // 返回 system, container, component, process, sor, contract
})

// 按 Product 获取 Functional Spec
c4a_store_list({
  filter: { "data.entity_id": "e-commerce-product" },
  type: "all"  // 返回 product, process, sor
})

// 按 ID 获取单个实体（使用 c4a_store_read）
c4a_store_read({
  id: "e-commerce-system",
  format: "yaml"  // 可选：返回 DSL 格式
})
```

> **说明**：`c4a_store_read` 用于按 ID 获取单个实体，`c4a_store_list` 用于条件查询返回实体列表。

### 8.4 feat（需求迭代）

feat 是 Feature 的缩写，用于管理需求迭代中的实体变更。

**命名规范**：`feat-{序号}-{简短描述}`，如 `feat-a001-user-login`

**feat 与 Spec 的关系**：
- 一个 feat 包含一组相关的实体变更
- feat 发布后，实体合并到主分支
- 通过 `proposal_id` 字段关联 feat 和实体

**典型流程**：
```
feat-a001-user-login (需求迭代)
    ├── Functional Spec
    │   ├── Business SoR: 用户可以使用邮箱登录
    │   └── Business SoR: 支持记住登录状态
    └── Technical Spec
        ├── Container: auth-service
        ├── Component: jwt-validator
        ├── Technical SoR: 登录接口响应 < 500ms
        └── Contract: api-auth (OpenAPI)
    ↓
feat 发布 → 实体合并到主分支
```

### 8.5 MRD/PRD 与 Spec 的映射

| 文档类型 | 对应的 Spec | 层级 |
|---------|------------|------|
| **MRD** | Enterprise 层的 Functional Spec | Domain/Enterprise |
| **PRD** | Project 层的 Functional Spec | Project (业务视角) |
| **技术设计** | Project 层的 Technical Spec | Project (技术视角) |

**工作流程**：
```
MRD (市场需求)
    ↓ 提炼
Enterprise Functional Spec (Product + Business Process + Business SoR)
    ↓ 细化
PRD (产品需求)
    ↓ 转化为
Project Functional Spec (Product 引用 + 细化的 Business SoR)
    ↓ 设计
Technical Spec (System + Technical SoR + Contract)
    ↓ 实现
Code (代码)
```

---

## 9. 完整示例：直播电商项目
> 注：以下示例使用简化列表格式展示实体关系，实际 DSL 文件使用嵌套结构（见 §4 各实体定义）
### 9.1 Domain Knowledge

```yaml
# 行业产品分类
- id: live-streaming-commerce
  type: product
  scope: domain
  name: Live Streaming Commerce
  description: 直播带货行业

# 行业流程
- id: prc-b-a001
  type: process
  process_type: business
  scope: domain
  name: 直播销售流程

# 行业 SoR
- id: sor-b-a001
  type: sor
  entity_type: product
  entity_id: live-streaming-commerce
  process_id: prc-b-a001
  sor_type: business_rule
  scope: domain
  description: 直播间商品需要实时同步库存
```

### 9.2 Enterprise Knowledge

```yaml
# 企业产品（基于 Domain 定制）
- id: brand-live-commerce
  type: product
  scope: enterprise
  name: 品牌直播带货
  based_on: live-streaming-commerce
  description: 品牌商家的直播带货产品

# 企业流程
- id: prc-b-a002
  type: process
  process_type: business
  scope: enterprise
  name: 品牌直播销售流程
  based_on: prc-b-a001

# 企业 SoR
- id: sor-b-a002
  type: sor
  entity_type: product
  entity_id: brand-live-commerce
  process_id: prc-b-a002
  sor_type: business_rule
  scope: enterprise
  based_on: sor-b-a001
  description: 品牌直播需要提前48小时预约直播间
```

### 9.3 Project Knowledge

```yaml
# 业务视角 - 引用 Enterprise Product
- id: brand-live-commerce
  type: product
  scope: project
  reference_from: enterprise

# 技术视角 - 创建 System（与 Product 1:1 对应）
- id: live-commerce-system
  type: software-system  # DSL 使用 software-system，内部映射为 system
  scope: project
  corresponds_to: brand-live-commerce

# Container
- id: live-streaming-service
  type: container
  scope: project
  system_id: live-commerce-system
  code_path: src/services/live/

# Component
- id: inventory-sync-component
  type: component
  scope: project
  container_id: live-streaming-service
  code_path: src/services/live/components/InventorySync.ts
  implements_contracts: [api-inventory-sync]  # 实现哪些 Contract

# 技术流程
- id: prc-t-a001
  type: process
  process_type: technical
  scope: project
  name: 服务部署流程

# 技术 SoR
- id: sor-t-a001
  type: sor
  entity_type: container
  entity_id: live-streaming-service
  process_id: prc-t-a001
  sor_type: non_functional
  scope: project
  description: 服务需要支持水平扩展，QPS 10000+

# SoR 关系
- from: sor-t-a001
  to: sor-b-a001
  rel_type: CORRESPONDS

# Contract
- id: api-inventory-sync
  type: contract
  contract_type: openapi

  implements_sor: [sor-t-a001]  # 实现哪些 SoR
```

---

## 附录：术语表

为避免文档中术语混淆，本节明确定义常用术语的含义：

| 术语 | 含义 | 使用场景 |
|------|------|---------|
| **feat_id** | Feat 本身的唯一标识符 | MCP 工具参数名，如 `c4a_store_feat_create({ feat_id: "feat-a001" })` |
| **proposal_id** | 实体版本归属标识，用于 Copy-on-Write 机制 | 数据库字段名，标识实体属于哪个 feat 分支 |
| **source_project** | 实体归属的项目 ID | 数据库字段名，用于多项目权限控制 |
| **source_repo** | 实体归属的代码仓库 URL | 数据库字段名，用于代码关联 |

**`feat_id` 与 `proposal_id` 的关系**：

- 在大多数场景下，`feat_id` 和 `proposal_id` 的值相同（如 `"feat-a001-user-login"`）
- 语义不同：
  - `feat_id` 是 API 参数名，表示"操作哪个 feat"
  - `proposal_id` 是数据库字段名，表示"实体属于哪个 feat 分支"
- 主分支实体的 `proposal_id` 为 `NULL`，feat 内实体的 `proposal_id` 等于其 `feat_id`

```typescript
// 示例：创建 feat 并在其中创建实体
c4a_store_feat_create({ feat_id: "feat-a001" })  // feat_id 作为参数

c4a_store_save({
  type: "container",
  data: { id: "auth-service", name: "认证服务" }
})
// 数据库中：proposal_id = "feat-a001"（自动填充当前 feat 上下文）
```

---

## 附录：修正记录

> 本节记录相对于原 `concepts.md` 的修正内容。

### 修正 1：Contract 类型枚举增加 GraphQL

**位置**：§8.1 Contract 类型

**修正**：
```
**Contract 类型**：
- OpenAPI (REST API 规格)
- AsyncAPI (消息/事件规格)
- Proto (gRPC 规格)
- GraphQL (GraphQL Schema 规格)  ← 新增
```

### 修正 2：SoR corresponds_to 字段说明

**位置**：§4.3.4 Business SoR 与 Technical SoR 的关系

**补充**：
```yaml
# Technical SoR（技术视角）
- id: sor-t-a001
  corresponds_to: sor-b-a001  # 数据字段，冗余存储对应关系
```

> **字段与关系双轨存储**：`corresponds_to` 字段是 `CORRESPONDS` 关系的冗余存储。
> - **字段**：便于单表查询，无需 JOIN 图数据库
> - **关系**：支持图遍历和复杂关系查询
> - **维护方式**：当前版本由 `relations` 表维护关系（DSL 不包含 `data.relationships`）

### 修正 3：Local 模式状态流转记录说明

**位置**：§3 知识生命周期 - 强制规则

**补充**：
> **Local 模式说明**：Local 模式下，状态流转记录通过 entity_history 追踪，不在 DSL 文件中存储额外的 history 字段。这是为了：
> 1. 保持 DSL 文件简洁（Schema 设置 `additionalProperties: false`）
> 2. 统一通过变更历史查询（`c4a_store_read_history`）
> 3. 避免数据冗余

### 修正 4：归档条件校验实现说明

**位置**：§3 知识生命周期 - deprecated → archived 的条件

**补充**：
> **实现说明**：
> - **Server 模式**：完整实现上述条件校验（含 SQL 查询）
> - **Local 模式**：当前版本仅校验状态流转规则，不校验归档条件，由用户自行判断
> - **MCP 工具**：普通实体通过 `c4a_store_save` 更新 status 字段；Feat 通过 `c4a_store_feat_lifecycle` (action: "transition") 执行状态流转

### 修正 5：Contract 状态字段统一

**实现决策**：Contract 的状态字段统一使用 `status`（而非 `contract_status`）。

| 层 | 字段名 | 类型 |
|---|--------|------|
| DSL 类型 | `status` | `ContractStatus` |
| JSON Schema | `status` | enum |
| 运行时类型 | `status` | `ContractStatus` |

**ContractStatus 定义**：
```typescript
type ContractStatus = 'draft' | 'approved' | 'implemented' | 'published' | 'deprecated';
```

**说明**：Contract 有独立的生命周期，`implemented` 状态表示 Contract 已被 Component 实现，是 Contract 特有的状态。

### 修正 6：ADR 状态字段统一

**实现决策**：ADR 的状态字段统一使用 `status`（而非 `adr_status`），与 Contract 保持一致。

| 层 | 字段名 | 类型 |
|---|--------|------|
| DSL 类型 | `status` | `ADRStatus` |
| JSON Schema | `status` | enum |
| 运行时类型 | `status` | `ADRStatus` |

**ADRStatus 定义**：
```typescript
type ADRStatus = 'draft' | 'approved' | 'published' | 'deprecated' | 'archived' | 'superseded';
```

**说明**：ADR 有独立的生命周期，`superseded` 状态表示 ADR 已被后续 ADR 替代，是 ADR 特有的状态。

### 修正 7：附属实体状态映射说明

**背景**：`BaseEntityMetadata.status` 是 `LifecycleStatus`（5 种状态），但附属实体有独立的状态：
- Contract 有 `implemented` 状态
- ADR 有 `superseded` 状态

**实现决策**：采用两层状态映射：

| 实体 | 特殊状态 | 顶层 status 映射 | data.status |
|------|---------|-----------------|-------------|
| Contract | `implemented` | → `approved` | 保留 `implemented` |
| ADR | `superseded` | → `deprecated` | 保留 `superseded` |

**说明**：
- **顶层 status**：用于通用查询/过滤，符合 `LifecycleStatus` 类型约束
- **data.status**：保留完整语义，用于业务逻辑判断

### 修正 8：System type 映射说明

**背景**：DSL 文件中的 `type` 字段与内部类型有映射关系。

**映射规则**：
| DSL 文件 (type) | 内部类型 (SchemaType) | 说明 |
|----------------|----------------------|------|
| `software-system` | `system` | 符合 C4 模型命名 |
| `container` | `container` | 无映射 |
| `component` | `component` | 无映射 |

**说明**：
- **DSL 文件**：使用 `type: software-system`（符合 C4 模型规范）
- **内部类型**：使用 `system`（简化内部使用）
- **validator**：自动将 `software-system` 映射为 `system`
- **概念文档**：示例中使用 `type: software-system` 以反映实际 DSL 写法
