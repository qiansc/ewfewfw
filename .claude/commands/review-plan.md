# /review-plan - PRD 与 Plan 一致性审查

审查 PRD 与 Plan 文档的一致性，识别阻塞性问题。

## 审查模式

根据输入参数自动选择审查模式：

| 模式 | 输入 | 审查内容 |
|------|------|----------|
| **双文档审查** | PRD + Plan | PRD 与 Plan 的一致性，行级覆盖检查 |
| **单文档审查** | 仅 PRD 或仅 Plan | 文档内部一致性 |
| **代码关联审查** | Plan + 代码地图 | Plan 任务与代码的关联正确性 |

---

## 审查原则

**PRD 和 Plan 是不同抽象层级的文档**：

| 文档 | 抽象层级 | 目的 | 权威性 |
|------|---------|------|--------|
| PRD | What（做什么） | 定义契约、行为、边界 | **契约权威** |
| Plan | How（怎么做） | 拆解任务、分配工作、识别风险 | 执行指引 |

**核心理念**：Plan 是 PRD 的执行路径，不是 PRD 的复制品。实现时以 PRD 为准。

---

## 模式一：双文档审查（PRD + Plan）

当同时提供 PRD 和 Plan 时，执行**行级覆盖检查**。

### 行级覆盖检查流程

1. **提取 PRD 关键契约**（按行号标记）
   - 数据模型定义（interface、type、schema）
   - API 契约（输入/输出/错误码）
   - 行为规则（业务逻辑、约束条件）
   - 迁移要求（字段变更、数据转换）

2. **构建覆盖矩阵**
   ```
   | PRD 行号 | 契约类型 | 契约摘要 | Plan 任务 | 覆盖状态 |
   |----------|---------|---------|----------|---------|
   | L125-130 | 数据模型 | Entity.versions 字段 | Task 2.1 | ✅ 覆盖 |
   | L200-210 | API 契约 | addVersion 输入 Schema | Task 3.2 | ✅ 覆盖 |
   | L300-305 | 行为规则 | 0.0.0 保护机制 | - | ❌ 遗漏 |
   ```

3. **报告未覆盖项**
   - 只报告**关键契约**未被 Plan 任务覆盖的情况
   - 不报告细节描述、示例代码、注释等

### 审查范围

#### ✅ 必须报告（阻塞性问题）

仅报告以下类型的问题：

1. **逻辑矛盾**
   - PRD 说 A，Plan 说 非A
   - 示例：PRD 说"删除字段"，Plan 说"重命名字段"
   - 示例：PRD 说"同步写入"，Plan 说"异步写入"

2. **关键任务遗漏**（行级检查）
   - PRD 定义了功能/契约（标注行号），Plan 完全没有对应任务
   - 必须列出具体的 PRD 行号范围
   - 示例：PRD 定义了 `c4a_store_publish_version` 工具，Plan 没有任何相关任务

3. **依赖错误**
   - 任务依赖关系有环
   - 前置任务缺失导致无法执行
   - 示例：Task 3 依赖 Task 5，但 Task 5 依赖 Task 3

4. **破坏性歧义**
   - 某处描述可能导致实现时产生完全相反的行为
   - 必须说明具体的歧义场景和可能的错误实现

#### ⚠️ 可选报告（非阻塞）

以下问题可以报告，但标记为"建议"而非"阻塞"：

- 表述模糊但不影响正确实现
- 缺少某些细节但可从 PRD 推断

#### ❌ 不要报告

以下问题**禁止报告**，因为它们是正常的抽象层级差异：

1. **Plan 伪代码与 PRD Schema 的字段级差异**
   - Plan 中的伪代码是示意，不是最终代码
   - 实现时以 PRD 定义的 Schema 为准

2. **Plan 未覆盖 PRD 的所有细节**
   - Plan 只需覆盖关键路径和风险点
   - 细节在实现时参考 PRD

3. **返回值结构的细微差异**
   - Plan 伪代码返回 `{ a, b }`，PRD 定义 `{ a, b, c }`
   - 这不是矛盾，实现时以 PRD 为准

4. **代码风格、命名一致性**
   - Plan 写 `entityUuid`，PRD 写 `entity_uuid`
   - 这是风格问题，不是逻辑问题

5. **伪代码的实现细节**
   - 错误处理是否完整
   - 边界条件是否覆盖
   - 这些在实现时处理

6. **文档格式问题**
   - 行号引用
   - 章节编号
   - 标点符号

---

## 模式二：单文档审查

当只提供单一文件时，执行**文档内部一致性检查**。

### PRD 内部审查

检查以下问题：

1. **接口定义与示例代码矛盾**
   - 示例：接口返回 `Promise<void>`，但示例代码使用了返回值
   - 示例：Schema 定义了字段 A，但示例代码未返回

2. **错误码定义不完整**
   - 前文描述了某错误场景，但错误码清单未列出

3. **行为规则自相矛盾**
   - 不同章节对同一行为的描述冲突

4. **引用缺失**
   - 引用了未定义的类型、接口、错误码

### Plan 内部审查

检查以下问题：

1. **任务依赖错误**
   - 依赖关系有环
   - 依赖了不存在的任务

2. **任务描述矛盾**
   - 不同任务对同一操作的描述冲突

3. **验收标准不可验证**
   - 验收标准过于模糊，无法判断是否完成

---

## 模式三：代码关联审查（Plan + 代码地图）

当提供 Plan 和代码地图时，检查 Plan 任务与代码的关联正确性。

**注意**：如果未提供代码地图，跳过此模式的所有检查，不要猜测代码结构。

### 代码地图格式

代码地图可以是以下格式之一：

```yaml
# 格式 1: 文件列表
files:
  - path: src/storage/adapter.ts
    exports: [IStorageAdapter, LocalAdapter]
  - path: src/mcp/tools/version.ts
    exports: [addVersion, removeVersion, publishVersion]

# 格式 2: 模块结构
modules:
  storage:
    adapter: src/storage/adapter.ts
    local: src/storage/local.ts
  mcp:
    version-tools: src/mcp/tools/version.ts
```

### 关联检查内容

1. **文件路径有效性**
   - Plan 引用的文件路径是否存在于代码地图中
   - 报告：`Task 3.2 引用 src/storage/adapter.ts:L100，但代码地图中无此文件`

2. **模块归属正确性**
   - Plan 任务修改的模块是否与代码地图的模块划分一致
   - 报告：`Task 3.2 将 addVersion 放在 storage 模块，但代码地图显示应在 mcp/tools`

3. **依赖方向正确性**
   - Plan 描述的模块依赖是否与代码地图的实际依赖一致
   - 报告：`Task 3.2 描述 mcp 依赖 storage，但代码地图显示反向依赖`

---

## 审查流程

1. **理解文档定位**
   - PRD 是契约，定义"做什么"和"边界在哪"
   - Plan 是路径，定义"怎么做"和"分几步"

2. **识别关键契约**
   - 从 PRD 提取：数据模型、API 契约、行为规则、错误处理
   - 这些是必须在 Plan 中有对应任务的内容

3. **检查任务覆盖**
   - 每个 PRD 契约是否有对应的 Plan 任务
   - 不要求一一对应，但关键功能必须覆盖

4. **检查逻辑一致性**
   - 只检查"是否矛盾"，不检查"是否完整"
   - Plan 可以比 PRD 简略，但不能与 PRD 冲突

5. **输出结论**
   - 有阻塞性问题：列出问题和修复建议
   - 无阻塞性问题：确认可以开始实现

---

## 输出格式

### 双文档审查输出

```markdown
## 审查结果：PRD + Plan 一致性

### 覆盖矩阵

| PRD 行号 | 契约类型 | 契约摘要 | Plan 任务 | 状态 |
|----------|---------|---------|----------|------|
| L125-130 | 数据模型 | Entity.versions | Task 2.1 | ✅ |
| L200-210 | API 契约 | addVersion Schema | Task 3.2 | ✅ |
| L300-305 | 行为规则 | 0.0.0 保护 | - | ❌ |

### 阻塞性问题（N 个）

#### 问题 1: [标题]

**PRD 位置**：L300-305
**PRD 描述**：
> [引用原文]

**Plan 状态**：未覆盖 / 矛盾

**建议修复**：[具体建议]
```

### 单文档审查输出

```markdown
## 审查结果：[PRD/Plan] 内部一致性

### 发现问题（N 个）

#### 问题 1: [标题]

**位置**：L100-110 vs L200-205
**矛盾描述**：
> L100: [引用]
> L200: [引用]

**建议修复**：[具体建议]
```

### 代码关联审查输出

```markdown
## 审查结果：Plan 与代码关联

### 关联检查

| Plan 任务 | 引用文件 | 代码地图状态 | 问题 |
|----------|---------|-------------|------|
| Task 3.2 | src/storage/adapter.ts | ✅ 存在 | - |
| Task 3.5 | src/mcp/unknown.ts | ❌ 不存在 | 文件路径无效 |

### 问题详情

[如有问题，详细说明]
```

### 未发现阻塞性问题时

```markdown
## 审查结果：无阻塞性问题

PRD 与 Plan 在关键逻辑上保持一致，可以开始实现。

### 实现注意事项

- 契约细节（Schema、错误码、返回结构）以 PRD 为准
- Plan 中的伪代码仅供参考，不是最终实现
- [其他需要注意的点]
```

---

## 示例

### 示例 1：这是阻塞性问题

**PRD**：`requirement_id` 字段直接删除，不做重命名

**Plan**：Task 2.6 步骤 2 - 字段重命名：`requirement_id` → `requirement_id`

**判定**：✅ 阻塞性问题（逻辑矛盾）

**原因**：PRD 明确说"删除"，Plan 说"重命名"，这是完全相反的操作。

### 示例 2：这不是阻塞性问题

**PRD**：
```typescript
interface PublishVersionOutput {
  success: boolean;
  root_id: string;
  version: string;
  affected_entities: number;
  latest_transferred: boolean;
  warnings?: string[];
}
```

**Plan**：
```typescript
return { affected_entities: entities.length, latest_transferred: transfer_latest };
```

**判定**：❌ 不是阻塞性问题

**原因**：Plan 的伪代码是示意，省略了部分字段。实现时以 PRD 的完整 Schema 为准。这是正常的抽象层级差异。

### 示例 3：这不是阻塞性问题

**PRD**：定义了 `c4a_store_add_version` 的完整 Schema 和实现逻辑

**Plan**：Task 3.7 只写了"调用 `IStorageAdapter.addVersion()`，使用合并策略"

**判定**：❌ 不是阻塞性问题

**原因**：Plan 概括了实现要点，细节在 PRD 中。这是 Plan 应有的抽象程度。

### 示例 4：PRD 内部一致性问题

**PRD L430**：
```typescript
addVersion(uuid: string, version: string): Promise<void>;
```

**PRD L570**：
```typescript
const updated = await adapter.addVersion(entity.uuid, version);
return { versions: updated.versions };  // 使用了返回值
```

**判定**：✅ 阻塞性问题（PRD 内部矛盾）

**原因**：接口定义返回 `void`，但示例代码依赖返回值。

---

## 使用方式

```bash
# 双文档审查（行级覆盖检查）
/review-plan <prd_path> <plan_path>

# 单文档审查（内部一致性）
/review-plan <prd_path>
/review-plan <plan_path>

# 代码关联审查
/review-plan <plan_path> --code-map <code_map_path>

# 完整审查（三种模式）
/review-plan <prd_path> <plan_path> --code-map <code_map_path>
```

或在对话中：

```
请审查以下文档：
- PRD: .tmp/0.3.1/prd.md
- Plan: .tmp/0.3.1/plan.md
- 代码地图: .tmp/0.3.1/code-map.yaml（可选）
```
