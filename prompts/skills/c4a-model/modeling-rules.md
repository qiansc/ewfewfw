# /c4a:model 建模规则

## 定位

内部可复用的建模能力，供其他 Skills（`/c4a:specify`、`/c4a:plan`、`/c4a:know:learn`）调用。

**职责**：将自然语言描述转换为标准的 C4A DSL 实体。

---

## 核心能力

1. **实体识别**：从描述中识别需要创建的实体类型
2. **层级判断**：确定实体所属的知识层级（Domain/Enterprise/Project）
3. **视角分类**：区分业务视角和技术视角实体
4. **关系推断**：自动推断实体间的关系
5. **引用解析**：处理跨项目、跨层级的引用
6. **ID 生成**：按命名规范生成实体 ID

---

## 实体类型识别

### C4 模型实体（技术视角）

| 实体类型 | 识别关键词 | 说明 |
|---------|-----------|------|
| `system` | 系统、平台、产品 | 最高层级的软件系统 |
| `container` | 服务、应用、数据库、消息队列 | 系统内的可部署单元 |
| `component` | 模块、组件、类、接口 | 容器内的代码单元 |

### 业务实体（业务视角）

| 实体类型 | 识别关键词 | 说明 |
|---------|-----------|------|
| `sor` | 记录系统、数据源、主数据 | System of Record |
| `actor` | 用户、角色、外部系统 | 交互参与者 |
| `usecase` | 用例、场景、流程 | 业务用例 |

### 决策与契约

| 实体类型 | 识别关键词 | 说明 |
|---------|-----------|------|
| `adr` | 决策、选型、迁移、重构 | 架构决策记录 |
| `contract` | API、接口、协议、契约 | 接口契约 |

---

## 知识层级判断

### 三层知识体系

```
┌─────────────────────────────────────────────┐
│  Domain Layer（领域层）                      │
│  - 跨企业的行业知识                          │
│  - 示例：电商领域、金融领域                   │
└─────────────────────────────────────────────┘
                    ▲
                    │ 引用
┌─────────────────────────────────────────────┐
│  Enterprise Layer（企业层）                  │
│  - 企业内跨项目共享的知识                    │
│  - 示例：企业级 SoR、共享服务                │
└─────────────────────────────────────────────┘
                    ▲
                    │ 引用
┌─────────────────────────────────────────────┐
│  Project Layer（项目层）                     │
│  - 项目特定的知识                            │
│  - 示例：项目架构、本地 ADR                  │
└─────────────────────────────────────────────┘
```

### 层级判断规则

| 条件 | 层级 | 说明 |
|------|------|------|
| 描述中提到"行业标准"、"通用模式" | Domain | 跨企业共享 |
| 描述中提到"企业级"、"跨项目"、"共享" | Enterprise | 企业内共享 |
| 描述中提到"本项目"、"当前系统" | Project | 项目特定 |
| 无明确指示 | **Project**（默认） | 安全默认值 |

---

## ID 命名规范

### 通用规则

- 使用 `kebab-case`（小写字母 + 连字符）
- 长度限制：3-64 字符
- 禁止特殊字符：仅允许 `[a-z0-9-]`

### 各类型 ID 格式

| 实体类型 | ID 格式 | 示例 |
|---------|--------|------|
| system | `{name}` | `c4a-platform` |
| container | `{name}` | `auth-service` |
| component | `{name}` | `jwt-validator` |
| sor | `sor-{domain}-{name}` | `sor-user-profile` |
| adr | `adr-{number}-{slug}` | `adr-001-use-jwt` |
| contract | `{type}-{name}` | `api-auth-login` |
| feat | `feat-{code}-{slug}` | `feat-a001-user-login` |

### ADR 编号规则

- 格式：`adr-{NNN}-{slug}`
- 编号自动递增，从 001 开始
- slug 从标题生成，最多 5 个单词

---

## 关系推断规则

### 关系类型

| 关系 | 含义 | 推断条件 |
|------|------|---------|
| `CONTAINS` | 包含 | 父子层级（System→Container→Component） |
| `DEPENDS_ON` | 依赖 | 描述中提到"调用"、"使用"、"依赖" |
| `IMPLEMENTS` | 实现 | Component 实现 Contract |
| `REFERENCES` | 引用 | 跨层级/跨项目引用 |
| `SUPERSEDES` | 替代 | ADR 替代旧决策 |

### 自动推断示例

```yaml
# 输入描述："auth-service 调用 user-service 获取用户信息"
# 推断关系：
- from: auth-service
  to: user-service
  type: DEPENDS_ON
  description: "调用获取用户信息"
```

---

## DSL 输出格式

### System

```yaml
c4a: "1.0"
type: system
id: {system-id}
name: {显示名称}
description: {描述}
external: false  # true 表示外部系统
tags:
  - {tag1}
```

### Container

```yaml
c4a: "1.0"
type: container
id: {container-id}
name: {显示名称}
description: {描述}
system: {parent-system-id}
technology: {技术栈}
external: false
tags:
  - {tag1}
```

### Component

```yaml
c4a: "1.0"
type: component
id: {component-id}
name: {显示名称}
description: {描述}
container: {parent-container-id}
technology: {技术栈}
tags:
  - {tag1}
```

### SoR (System of Record)

```yaml
c4a: "1.0"
type: sor
id: sor-{domain}-{name}
name: {显示名称}
description: {描述}
domain: {业务领域}
owner: {负责团队}
attributes:
  - name: {属性名}
    type: {数据类型}
    description: {属性描述}
    required: true
```

### ADR

```yaml
c4a: "1.0"
type: adr
id: adr-{NNN}-{slug}
title: {决策标题}
status: proposed  # proposed / accepted / deprecated / superseded
context: |
  {决策背景}
decision: |
  {决策内容}
consequences:
  positive:
    - {正面影响}
  negative:
    - {负面影响}
alternatives:
  - title: {备选方案}
    pros:
      - {优点}
    cons:
      - {缺点}
related_entities:
  - {相关实体ID}
supersedes: {被替代的ADR ID，可选}
```

### Contract

```yaml
c4a: "1.0"
type: contract
id: {contract-id}
name: {契约名称}
description: {描述}
format: openapi  # openapi / asyncapi / proto
version: "1.0.0"
spec_path: {规格文件路径}
provider: {提供方容器ID}
consumers:
  - {消费方容器ID}
```

---

## 建模流程

### 步骤 1：实体识别

从用户描述中提取实体：

```
输入："我们需要一个认证服务来处理用户登录，使用 JWT 进行令牌管理"

识别结果：
- Container: auth-service（认证服务）
- Component: jwt-manager（JWT 令牌管理）
- Contract: api-auth-login（登录接口）
```

### 步骤 2：层级判断

确定每个实体的知识层级：

```
- auth-service → Project（项目特定服务）
- jwt-manager → Project（项目特定组件）
- api-auth-login → Project（项目特定契约）
```

### 步骤 3：关系推断

推断实体间关系：

```
- auth-service CONTAINS jwt-manager
- jwt-manager IMPLEMENTS api-auth-login
```

### 步骤 4：ID 生成

按命名规范生成 ID：

```
- auth-service（已符合规范）
- jwt-manager（已符合规范）
- api-auth-login（已符合规范）
```

### 步骤 5：DSL 生成

输出标准 DSL 格式（见上方格式定义）。

---

## 错误处理

| 失败类型 | 处理策略 |
|---------|---------|
| 实体识别失败 | 询问用户澄清实体类型 |
| 层级判断模糊 | 默认使用 Project 层，提示用户确认 |
| ID 冲突 | 提示用户修改 ID 或使用自动生成的 ID |
| 关系推断失败 | 跳过关系创建，记录警告 |
| 必填字段缺失 | 询问用户补充信息 |

---

## 验证规则

### 必填字段检查

| 实体类型 | 必填字段 |
|---------|---------|
| system | id, name |
| container | id, name, system |
| component | id, name, container |
| sor | id, name, domain |
| adr | id, title, status, context, decision |
| contract | id, name, format, provider |

### ID 唯一性检查

- 同类型实体 ID 必须唯一
- 检查范围：当前 Feat 分支 + 主分支

### 引用完整性检查

- 所有引用的实体必须存在
- 跨层级引用需要显式声明

---

## 使用示例

### 示例 1：从需求描述建模

**输入**：
```
用户登录功能：用户输入用户名和密码，系统验证后返回 JWT 令牌。
需要支持多因素认证（MFA）。
```

**输出**：
```yaml
# Container: auth-service
c4a: "1.0"
type: container
id: auth-service
name: 认证服务
description: 处理用户认证，支持密码验证和多因素认证
system: c4a-platform
technology: Node.js
tags:
  - authentication
  - security

---
# Component: password-validator
c4a: "1.0"
type: component
id: password-validator
name: 密码验证器
description: 验证用户密码
container: auth-service
technology: bcrypt

---
# Component: mfa-handler
c4a: "1.0"
type: component
id: mfa-handler
name: MFA 处理器
description: 处理多因素认证流程
container: auth-service
technology: TOTP

---
# Component: jwt-issuer
c4a: "1.0"
type: component
id: jwt-issuer
name: JWT 签发器
description: 签发和验证 JWT 令牌
container: auth-service
technology: jsonwebtoken
```

### 示例 2：从技术决策建模

**输入**：
```
决定使用 Redis 作为会话存储，替代原来的内存存储方案。
原因是需要支持多实例部署。
```

**输出**：
```yaml
c4a: "1.0"
type: adr
id: adr-002-redis-session-store
title: 使用 Redis 作为会话存储
status: proposed
context: |
  当前系统使用内存存储会话数据，无法支持多实例部署。
  需要一个分布式会话存储方案。
decision: |
  使用 Redis 作为会话存储，替代内存存储。
consequences:
  positive:
    - 支持多实例部署
    - 会话数据持久化
    - 高性能读写
  negative:
    - 增加运维复杂度
    - 需要额外的 Redis 实例
alternatives:
  - title: 继续使用内存存储 + 粘性会话
    pros:
      - 无需额外组件
    cons:
      - 扩展性差
      - 实例故障导致会话丢失
  - title: 使用数据库存储会话
    pros:
      - 复用现有数据库
    cons:
      - 性能较差
related_entities:
  - auth-service
  - session-manager
```

---

## 与其他 Skills 的集成

### /c4a:specify 调用

在功能规格阶段，调用建模规则生成业务实体：
- Actor、UseCase、SoR

### /c4a:plan 调用

在技术方案阶段，调用建模规则生成技术实体：
- System、Container、Component、Contract、ADR

### /c4a:know:learn 调用

在知识录入阶段，根据内容类型调用相应建模规则。
