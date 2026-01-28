# Skills 体系设计

## Skills 总览

共 **7 个 Skills**（5 个工作流 + 2 个知识技能）：

### 工作流 Skills（5个）

| Skill | 触发方式 | 说明 |
|-------|---------|------|
| `/c4a:feat` | 自然语言 / 命令 | Feature 管理（创建/修改/切换/流转） |
| `/c4a:specify` | 自然语言 / 命令 | 功能规格（Functional Spec） |
| `/c4a:plan` | 自然语言 / 命令 | 技术方案（Technical Spec + 契约 + 验收清单） |
| `/c4a:analyze` | 自然语言 / 命令 | 一致性检查（Spec 完整性、契约完备度、实现进度） |
| `/c4a:implement` | 自然语言 / 命令 | 实现代码（生成实现清单、辅助实现，需 approved 状态） |

### 知识技能 Skills（2个）

| Skill | 触发方式 | 说明 |
|-------|---------|------|
| `/c4a:know:learn` | 自然语言 / 命令 | 快速录入知识（编排 feat → specify → plan → publish） |
| `/c4a:know:search` | 自然语言 / 命令 | 搜索知识库（语义搜索） |

### 内部 Skill（1个）

| Skill | 说明 | 调用方 |
|-------|------|--------|
| `/c4a:model` | 建模能力（将自然语言转换为 DSL 实体） | `/c4a:specify`、`/c4a:plan`、`/c4a:know:learn` |

---

## 内部 Skill：`/c4a:model`

**定位**：内部可复用的建模能力，不对外宣传，供其他 Skills 调用。

**职责**：将自然语言描述转换为标准的 C4A DSL 实体（System/Container/Component/SoR/ADR 等）。

**调用机制**：提示词引导（非显式工具调用）

`/c4a:model` 不是显式的工具调用，而是通过提示词引导 Agent 在适当时机执行建模逻辑。

| 集成方式 | 说明 | 适用场景 |
|---------|------|---------|
| **提示词内联（推荐）** | 父 Skill 的提示词中直接包含 `/c4a:model` 的完整建模规则 | 所有需要建模的场景 |

**提示词内联示例**：

```markdown
# /c4a:specify 提示词片段

## 建模规则（来自 /c4a:model）

当需要将需求转换为 DSL 实体时，遵循以下规则：

1. 实体识别：从描述中识别需要创建的实体类型
2. 层级判断：确定实体所属的知识层级
3. ...（完整规则内联）
```

**工作原理**：
- Agent 读取 `prompts/skills/c4a-model/` 目录下的建模规则和示例
- 在父 Skill 执行过程中，根据提示词引导自动执行建模逻辑
- 生成符合规范的 DSL 实体

**调用失败处理**：

| 失败类型 | 处理策略 |
|---------|---------|
| 实体识别失败 | 询问用户澄清实体类型 |
| 层级判断模糊 | 默认使用 Project 层，提示用户确认 |
| ID 冲突 | 提示用户修改 ID 或使用自动生成的 ID |
| 关系推断失败 | 跳过关系创建，记录警告 |

**输入**：
- 自然语言描述（需求、技术方案、架构决策等）
- 当前上下文（已有实体、项目配置等）

**输出**：
- 标准化的 DSL 实体（YAML 格式）
- 实体间关系（CONTAINS、DEPENDS_ON、IMPLEMENTS 等）

**核心能力**：
1. **实体识别**：从描述中识别需要创建的实体类型
2. **层级判断**：确定实体所属的知识层级（Domain/Enterprise/Project）
3. **视角分类**：区分业务视角和技术视角实体
4. **关系推断**：自动推断实体间的关系
5. **引用解析**：处理跨项目、跨层级的引用
6. **ID 生成**：按命名规范生成实体 ID

**建模规则位置（建议拆分）**：`prompts/skills/c4a-model/modeling-rules.md`

---

## 设计亮点

1. **统一入口**：所有工作从 `/c4a:feat` 开始（或 `/c4a:know:learn` 快捷入口）
2. **自动路由**：Agent 根据描述自动判断流程
3. **灵活流程**：支持需求开发、架构变更、纯知识三种场景
4. **质量保证**：`/c4a:analyze` 独立检查，`/c4a:feat --status=published` 强制调用
5. **知识技能**：`/c4a:know:*` 提供知识管理专用能力

---

## 工作流程变更（v0.3.0）

**核心变更**：
- 新增 `/c4a:analyze` Skill，专门负责一致性检查
- `/c4a:implement` 移除一致性检查，专注于实现辅助
- `/c4a:feat --status=published` 发布前强制调用 `/c4a:analyze`
- 实现清单存储在数据库，本地文件为只读渲染视图（详见 [checklist-format.md](./checklist-format.md)）

**完整流程**：
```
/c4a:feat (创建，状态: draft)
    ↓
/c4a:specify (功能规格)
    ↓
/c4a:plan (技术方案 + 验收清单)
    ↓
/c4a:analyze (可选，用户随时调用检查)
    ↓
/c4a:feat --status=approved (批准方案，状态: draft → approved)
    ↓
/c4a:implement (实现代码，更新实现清单，需 approved 状态)
    ↓
/c4a:analyze (可选，实现过程中随时检查)
    ↓
/c4a:feat --status=published (发布，状态: approved → published，内部调用 /c4a:analyze)
    ↓
c4a sync (同步到知识库)
```
