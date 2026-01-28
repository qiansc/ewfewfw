## 建模阶段

当需要将需求转换为 DSL 实体时，遵循以下建模规则：

1. 实体识别：从描述中识别需要创建的实体类型（Product、Process、SoR）
2. 层级判断：确定实体所属的知识层级（Domain/Enterprise/Project）
3. 视角分类：区分业务视角和技术视角实体
4. 关系推断：自动推断实体间的关系
5. 生成标准 DSL 并保存到当前 feat 目录

详细建模规则见 `prompts/skills/c4a-model/modeling-rules.md`
```

**工作机制**：
- `/c4a:model` 的建模规则通过提示词内联到父 Skill 中
- Agent 在执行父 Skill 时，根据内联的规则自动执行建模逻辑
- 不需要显式的工具调用或子流程切换

### 平台转换

`prompts/` 目录是平台无关的模板：

```
prompts/ (模板)
    ↓ 转换器
Claude Code 格式 (.claude/skills/)
Cursor 格式 (.cursor/prompts/)
OpenCode 格式 (.opencode/skills/)
```

转换器负责：
1. 读取 `prompts/` 目录结构
2. 转换为目标平台格式
3. 生成平台特定的配置文件

---

## ADR 与架构变更的关联逻辑

### 设计目标

确保所有架构变更都有明确的决策记录，防止"只有变更没有决策背景"的情况。

### 架构变更的定义

以下情况被视为架构变更，需要关联 ADR：

| 变更类型 | 说明 | 示例 |
|---------|------|------|
| **新增 System** | 引入新的软件系统 | 新增支付系统 |
| **修改 System** | 修改系统的核心属性 | 修改系统边界、职责 |
| **删除 System** | 废弃整个系统 | 下线旧系统 |
| **新增 Container** | 引入新的服务/容器 | 新增消息队列服务 |
| **修改 Container** | 修改容器的核心属性 | 修改技术栈、部署方式 |
| **删除 Container** | 废弃服务/容器 | 下线旧服务 |
| **新增 DEPENDS_ON** | 新增依赖关系（System/Container 级别） | order-service 依赖 payment-service |
| **修改 DEPENDS_ON** | 修改依赖关系 | 改变依赖方向或类型 |
| **技术栈变更** | 修改 Container 的技术栈 | MySQL → PostgreSQL, Express → Fastify |

**不视为架构变更的情况**：
- Component 级别的新增/修改/删除（属于实现细节）
- SoR 的新增/修改（属于需求变更）
- Contract 的新增/修改（属于接口设计）

### 检测时机

ADR 关联检查在以下时机触发：

| 时机 | Skill | 行为 | 阻塞性 |
|------|-------|------|--------|
| **方案设计阶段** | `/c4a:plan` | 检测架构变更，如无 ADR，强制提示用户创建 | 提示但不阻塞，用户可选择稍后补充 |
| **实现过程中** | `/c4a:analyze` | 检测架构变更，如无 ADR，返回警告 | 警告，不阻塞 |
| **发布前** | `/c4a:feat --status=published` | 调用 `/c4a:analyze`，如有架构变更但无 ADR，返回警告 | 警告，可通过 `--force` 跳过 |

> **说明**：「强制提示」指必须展示提示信息并要求用户明确选择（创建 ADR / 稍后补充 / 跳过），但不阻塞流程。发布时的警告可通过 `--force` 参数跳过。

### 性能优化：按依赖范围检查

**问题**：如果项目实体数量巨大（数千个），每次检查都进行全量图谱的 Diff 计算会导致显著延迟。

**优化策略**：按依赖范围检查，而非全量检查。

#### 核心思路

**只检查受影响的子图**，而非全量图谱。

#### 1. 确定检查范围

根据当前变更的实体，通过依赖关系确定需要检查的范围：

```typescript
interface CheckScope {
  entity_id: string;           // 当前变更的实体
  affected_entities: string[]; // 受影响的实体（通过依赖关系）
  check_depth: number;         // 检查深度（默认 2 层）
}

function determineCheckScope(entity: Entity): CheckScope {
  // 1. 当前实体
  const entity_id = entity.id;

  // 2. 查询依赖关系（仅 2 层）
  const affected = await c4a_query_deps({
    id: entity_id,
    direction: 'both',  // 上游和下游
    depth: 2            // 仅 2 层，避免全量遍历
  });

  return {
    entity_id,
    affected_entities: affected.map(e => e.id),
    check_depth: 2
  };
}
```

#### 2. 分层检查策略

根据实体类型和变更类型，采用不同的检查策略：

| 实体类型 | 变更类型 | 检查范围 | 检查深度 |
|---------|---------|---------|---------|
| **System** | 新增/修改/删除 | 全局（必须） | 1 层（仅直接依赖） |
| **Container** | 新增 | 所属 System + 直接依赖 | 2 层 |
| **Container** | 技术栈变更 | 所属 System + 直接依赖 | 2 层 |
| **Container** | 新增依赖 | 依赖链 | 2 层 |
| **Component** | 任何变更 | 不检查（实现细节） | 0 |

#### 3. 延迟检查机制

**保存时轻量检查**：

```typescript
// c4a_store_save 时仅做轻量检查
async function onSave(entity: Entity) {
  // 1. 快速判断是否可能需要 ADR
  const needsCheck = quickCheck(entity);

  if (needsCheck) {
    // 2. 标记"需要检查"，不立即执行
    await markForReview(entity, 'adr_check_pending');
  }

  // 3. 保存实体（不阻塞）
  await saveEntity(entity);
}

function quickCheck(entity: Entity): boolean {
  // 仅检查实体类型和基本属性
  if (entity.type === 'system') return true;
  if (entity.type === 'container') return true;
  if (entity.type === 'component') return false;

  return false;
}
```

**/c4a:analyze 时完整检查**：

```typescript
// /c4a:analyze 时执行完整的按依赖检查
async function analyze(proposal_id: string) {
  // 1. 查询所有标记为"需要检查"的实体
  const pendingEntities = await c4a_store_read({
    filter: {
      proposal_id,
      metadata: { adr_check_pending: true }
    }
  });

  // 2. 按依赖范围检查
  const results = [];
  for (const entity of pendingEntities) {
    const scope = determineCheckScope(entity);
    const result = await checkArchitectureChangeInScope(entity, scope);
    results.push(result);
  }

  // 3. 汇总结果
  return aggregateResults(results);
}
```

#### 4. 性能对比

| 方案 | 查询实体数 | 对比次数 | 时间复杂度 | 响应时间 |
|------|-----------|---------|-----------|---------|
| **全量检查** | 1000+ | 1000+ | O(n) | 500ms - 2s |
| **按依赖检查** | 10-50 | 10-50 | O(d) | 50ms - 200ms |

**性能提升：5-10 倍**

### 检测逻辑

> **重要设计原则**：架构变更检测必须由 MCP 工具（`c4a_store_validate`）在服务端执行，返回结构化的变更报告。Agent 只负责调用工具并根据返回结果提示用户，**不应自行进行 DSL Diff 分析**。
>
> **理由**：
> - LLM 进行大规模 DSL 对比可能产生幻觉或遗漏
> - 服务端工具可保证检测逻辑的确定性和一致性
> - 减少 Context 占用，提升响应速度

#### 1. 在 `/c4a:plan` 中的检测

```
1. 读取当前 feat 的 Technical Spec
2. 确定检查范围（按依赖关系）：
   - 对于 System 变更：查询直接依赖（1 层）
   - 对于 Container 变更：查询所属 System + 依赖链（2 层）
3. 检测变更（仅在范围内）：
   - 新增的 System/Container
   - 修改的 System/Container（对比 data 字段）
   - 删除的 System/Container（标记为 deprecated）
   - 新增/修改的 DEPENDS_ON 关系
   - 技术栈变更（对比 Container 的 tech_stack 字段）
4. 如检测到架构变更：
   - 检查当前 feat 是否已有 ADR（通过 proposal_id 关联）
   - 如无 ADR：
     * 强制提示："检测到架构变更，建议补充 ADR 说明原因"
     * 提供 ADR 模板
     * 引导用户填写背景、选项、决策、后果
   - 如有 ADR：
     * 检查 ADR 是否完整
     * 提示用户确认 ADR 是否覆盖所有变更
```

#### 2. 在 `/c4a:analyze` 中的检测

```
1. 读取当前 feat 的 Technical Spec
2. 查询所有标记为"需要检查"的实体
3. 按依赖范围检测变更（同上）
4. 如检测到架构变更：
   - 检查当前 feat 是否有关联的 ADR
   - 如无 ADR：
     * 返回 ⚠️ 警告："检测到架构变更，建议补充 ADR 说明原因"
     * 列出具体的变更项
     * 提供修复建议
   - 如有 ADR：
     * 检查 ADR 是否完整（包含背景、选项、决策、后果）
     * 如不完整，返回 ⚠️ 警告
```

### ADR 模板

当检测到架构变更但无 ADR 时，提供以下模板：

```yaml
id: adr-{序号}
type: adr
scope: project
proposal_id: {feat-id}  # 关联到当前 feat
title: {架构变更标题}
status: draft
date: {当前日期}

context:
  background: |
    {背景描述：为什么需要这个变更？}

  problem: |
    {问题描述：当前架构存在什么问题？}

options:
  - id: option-1
    title: {选项 1 标题}
    description: |
      {选项 1 描述}
    pros:
      - {优点 1}
      - {优点 2}
    cons:
      - {缺点 1}
      - {缺点 2}

  - id: option-2
    title: {选项 2 标题}
    description: |
      {选项 2 描述}
    pros:
      - {优点 1}
    cons:
      - {缺点 1}

decision:
  chosen_option: option-1
  rationale: |
    {决策理由：为什么选择这个选项？}

consequences:
  positive:
    - {正面影响 1}
    - {正面影响 2}
  negative:
    - {负面影响 1}
  risks:
    - {风险 1}
  mitigation:
    - {缓解措施 1}

affected_entities:
  - {受影响的 System/Container ID}

supersedes: []  # 如果替代了之前的 ADR，填写 ADR ID
superseded_by: null  # 如果被后续 ADR 替代，填写 ADR ID
```

### 用户交互示例

#### 示例 1：在 `/c4a:plan` 中检测到架构变更

```
用户: "/c4a:plan"

Agent:
📋 正在设计技术方案...

🔍 架构变更检测：
检测到以下架构变更：
1. 新增 Container: payment-service
2. 新增 DEPENDS_ON 关系: order-service → payment-service

⚠️ 未找到关联的 ADR

架构变更需要记录决策背景。是否创建 ADR？
1. 是，创建 ADR（推荐）
2. 否，稍后补充
3. 跳过（不推荐）

用户: 1

Agent:
📝 创建 ADR 草稿...

请描述架构变更的背景：
- 为什么需要引入 payment-service？
- 当前架构存在什么问题？

用户: 当前支付逻辑耦合在 order-service 中，导致代码复杂度高，难以维护。需要拆分为独立的支付服务。

Agent:
✅ 已创建 ADR 草稿：adr-002-introduce-payment-service

请继续填写：
1. 考虑了哪些技术选型？
2. 为什么选择当前方案？
3. 有哪些风险和缓解措施？

...
```

#### 示例 2：在 `/c4a:analyze` 中检测到缺少 ADR

```
用户: "/c4a:analyze"

Agent:
🔍 一致性检查中...

✅ Functional Spec 完整
✅ Technical Spec 完整
✅ 契约完备
✅ DSL 引用正确
⚠️ ADR 完备度：检测到架构变更，但未找到关联的 ADR
   - 修改 Container 技术栈: database-service (MySQL → PostgreSQL)
   建议：创建 ADR 记录数据库迁移的背景、选项和决策
📊 实现进度：5/10 (50%)

⚠️ 检查通过，但有 1 个警告

? 如何处理？
  > 忽略警告，继续
    创建 ADR
    查看详细信息
```

### 实现要点

1. **变更对比算法**：
   - 使用 `c4a_query_deps` 查询当前架构
   - 对比 feat 中的 Technical Spec 与现有架构
   - 识别新增、修改、删除的实体和关系

2. **ADR 关联**：
   - 通过 `proposal_id` 字段关联 ADR 和 feat
   - 一个 feat 可以有多个 ADR（如果涉及多个独立的架构决策）

3. **警告级别**：
   - `/c4a:plan` 阶段：强制提示（阻塞流程，要求用户确认）
   - `/c4a:analyze` 阶段：警告（不阻塞，但建议修复）
   - `/c4a:feat --status=published` 阶段：警告（不阻塞，但记录到报告）

4. **ADR 完整性检查**：
   - 必需字段：context.background, context.problem, options, decision, consequences
   - 至少 2 个选项（体现决策过程）
   - decision.chosen_option 必须引用 options 中存在的选项 ID
   - decision.rationale 不能为空
   - 每个 option 必须包含 pros 和 cons（至少各 1 项）

### 设计价值

1. **强制决策记录**：确保架构变更有明确的决策背景
2. **提高可追溯性**：从代码 → Component → Container → ADR，完整追溯决策链
3. **知识沉淀**：ADR 成为团队的架构决策历史
4. **降低风险**：通过记录选项和后果，避免重复犯错

---

