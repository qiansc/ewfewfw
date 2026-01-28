# Part 02: 三模式架构

> 详细执行计划 - 基于 `v0.3.0/architecture.md`

---

## 任务清单

| # | 功能 | [ ] | 描述 |
|---|------|:---:|------|
| 2.0 | 文档结构 | [x] | 相关文档链接与导航 |
| 2.1 | 三模式对比 | [x] | Local/Server/Remote 特性对比表 |
| 2.2 | Code MCP 本地运行 | [x] | c4a_code_* 必须 stdio 本地运行约束 |
| 2.3 | 存储层可插拔 | [x] | 同一套 MCP 工具接口适配多存储 |
| 2.4 | 知识生命周期阶段 | [x] | Extract→Model→Store→Query 四阶段 |
| 2.5 | 架构图 | [x] | 用户层/MCP 工具层/存储适配层 |
| 2.6 | Skills/Commands 分层 | [x] | MCP 工具设计原则 |
| 2.7 | 存储位置 | [x] | 数据库缓存目录 + .context/ |
| 2.8 | 工作目录结构 | [x] | business/technical/feat 目录规范 |
| 2.9 | 项目配置 | [x] | .c4a.yaml 格式规范 |
| 2.10 | ID 命名规范 | [x] | 唯一性约束 + 命名格式规则 |
| 2.11 | 文件命名规则 | [x] | DSL 文件路径规则 |
| 2.12 | checklist 处理 | [x] | DB-only + 本地只读视图 |
| 2.12a | ADR 定位 | [x] | ADR 作为普通实体的设计 |
| 2.13 | Schema 校验 | [x] | JSON Schema + 离线支持 |
| 2.14 | 子 .context 规则 | [x] | 多项目支持 + 配置继承 |
| 2.15 | 实体类型定义 | [x] | type 字段枚举值 |
| 2.16 | 知识层级 scope | [x] | domain/enterprise/project |
| 2.17 | 知识点类型 kind | [x] | implementation/external/concept |
| 2.18 | 跨层级引用 | [x] | 引用格式规范 + 解析优先级 |
| 2.18a | 状态生命周期 | [x] | draft→approved→published→deprecated→archived |
| 2.18b | 表结构设计 | [x] | configs/entities/metadata/relations/vectors |
| 2.18c | 示例数据 | [x] | 典型 Container 实体示例 |
| 2.18d | data 字段结构 | [x] | 各实体类型的 data 字段定义 |
| 2.18e | Local 模式技术栈 | [x] | SQLite + sqlite-vec + transformers |
| 2.18f | 数据流设计 | [x] | 写入流程 + 同步与备份 |
| 2.18g | CLI 架构 | [x] | 用户 CLI + 开发 CLI 设计 |
| 2.19 | feat 机制 | [x] | CoW + 变更管控 + 工作流程 |
| 2.20 | 合并策略 | [x] | 自动合并 + 人工介入规则 |
| 2.20a | MCP 工具与 feat | [x] | feat 工具接口定义 |
| 2.20b | 冲突解决与回滚 | [x] | 回滚 feat 机制 |
| 2.21 | 跨项目 feat | [x] | 中心化数据库架构支持 |
| 2.21a | 查询策略 | [x] | 主分支/feat/合并视图查询 |
| 2.22 | 清理 legacy 配置路径 | [x] | 仅保留 .context/.c4a.yaml |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 2.0 | 文档结构 | `architecture.md` | 文档头部 | L1-15 | [x] | [x] |
| 2.1-2.2 | 模式对比 | `architecture.md` | §1.1 模式对比 | L16-72 | [x] | [x] |
| 2.3 | 存储层可插拔 | `architecture.md` | §1.2 存储层可插拔 | L73-91 | [x] | [x] |
| 2.4 | 知识生命周期阶段 | `architecture.md` | §1.3 知识生命周期 | L92-111 | [x] | [x] |
| 2.5 | 架构图 | `architecture.md` | §1.4 架构图 | L112-178 | [x] | [x] |
| 2.6 | Skills/Commands | `architecture.md` | §1.5 Skills/Commands | L179-231 | [x] | [x] |
| 2.7 | 存储位置 | `architecture.md` | §2.1 存储位置 | L234-250 | [x] | [x] |
| 2.8 | 工作目录结构 | `architecture.md` | §2.2 工作目录结构 | L251-333 | [x] | [x] |
| 2.9 | 项目配置 | `architecture.md` | §2.3 项目配置 | L334-353 | [x] | [x] |
| 2.10 | ID 命名规范 | `architecture.md` | §2.4 ID 命名规范 | L354-434 | [x] | [x] |
| 2.11 | 文件命名规则 | `architecture.md` | §2.5 文件命名规则 | L435-495 | [x] | [x] |
| 2.12 | checklist 处理 | `architecture.md` | §2.5 checklist 处理 | L472-495 | [x] | [x] |
| 2.12a | ADR 定位 | `architecture.md` | §2.6 ADR 的定位 | L496-542 | [x] | [x] |
| 2.13 | Schema 校验 | `architecture.md` | §2.7 Schema 校验 | L543-615 | [x] | [x] |
| 2.14 | 子 .context 规则 | `architecture.md` | §2.8 子 .context | L616-628 | [x] | [x] |
| 2.15-2.17 | 数据模型 | `architecture.md` | §3 数据模型 | L629-684 | [x] | [x] |
| 2.18 | 跨层级引用 | `architecture.md` | §3.4.1 跨层级引用 | L700-731 | [x] | [x] |
| 2.18a | 状态生命周期 | `architecture.md` | §3.5 状态生命周期 | L732-750 | [x] | [x] |
| 2.18b | 表结构设计 | `architecture.md` | §3.6 表结构 | L751-762 | [x] | [x] |
| 2.18c | 示例数据 | `architecture.md` | §3.7 示例数据 | L763-795 | [x] | [x] |
| 2.18d | data 字段结构 | `architecture.md` | §3.8 data 字段结构 | L796-819 | [x] | [x] |
| 2.18e | Local 模式技术栈 | `architecture.md` | §4 Local 模式技术栈 | L820-832 | [x] | [x] |
| 2.18f | 数据流设计 | `architecture.md` | §5 数据流 | L833-873 | [x] | [x] |
| 2.18g | CLI 架构 | `architecture.md` | §6 CLI 架构 | L874-964 | [x] | [x] |
| 2.19 | feat 机制 | `architecture.md` | §7 feat 机制 | L965-1078 | [x] | [x] |
| 2.20 | 合并策略 | `architecture.md` | §7.5 合并策略 | L1083-1091 | [x] | [x] |
| 2.20a | MCP 工具与 feat | `architecture.md` | §7.4 MCP 工具与 feat | L1079-1082 | [x] | [x] |
| 2.20b | 冲突解决与回滚 | `architecture.md` | §7.6 冲突解决与回滚 | L1092-1097 | [x] | [x] |
| 2.21 | 跨项目 feat | `architecture.md` | §7.7 跨项目 feat | L1098-1107 | [x] | [x] |
| 2.21a | 查询策略 | `architecture.md` | §7.8 查询策略 | L1108-1122 | [x] | [x] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| 配置解析 | `packages/core/src/utils/config.ts` | .c4a.yaml 解析（mode: local/server/remote） | ✅ |
| 目录结构 | `packages/core/src/utils/path.ts` | .context/ + business/technical/feat 路径计算 | ✅ |
| ID 生成 | `packages/core/src/utils/id.ts` | ID 生成与验证 | ✅ |
| Schema 验证 | `packages/core/src/utils/schema.ts` | JSON Schema 验证（复用 validator 模块） | ✅ |
| 验证器 | `packages/core/src/validator/index.ts` | DSL 验证器（validateDSL, validateDSLAuto） | ✅ |
| 单元测试 | `packages/core/src/utils/__tests__/path.test.ts` | 路径计算测试（30 cases） | ✅ |
| 单元测试 | `packages/core/src/utils/__tests__/config.test.ts` | 配置解析测试（8 cases） | ✅ |

---

## 设计决策

### 类型系统分层

| 层级 | 文件 | 用途 | 包含类型 |
|------|------|------|---------|
| DSL 层 | `types/dsl.ts` | YAML 文件格式，与 JSON Schema 一致 | SystemDSL, ContainerDSL, ComponentDSL, ADRDSL, ContractDSL |
| 存储层 | `types/base.ts` + `types/entities.ts` | 数据库存储格式 | BaseEntityMetadata, StoredEntityMetadata, Product, Process, SoR |

**关键决策**：
- DSL 类型是"输入格式"，存储类型是"内部表示"
- 数据流：DSL 文件 → 解析 → 存储类型 → 数据库
- JSON Schema **不需要**存储层字段（`proposal_id`, `content_hash`, `source_project`），这些由系统自动生成
- `types/dsl.ts` 保留用于 MCP 工具解析 `.c4a.yaml` 文件

### 目录结构变更

| 旧设计 | 新设计 |
|--------|--------|
| `.c4a/` | `.context/` |
| `drafts/`, `approved/`, `published/`, `archive/` | `business/`, `technical/`, `feat/` |
| `cwd/c4a.config.yaml` | `.context/.c4a.yaml` |

---

## 依赖关系

- 依赖 Part 01 的类型定义
- 被 Part 03-12 依赖

---

## 最终验证（提交前必须执行）

**参考设计文档：**
- `v0.3.0/architecture.md` (全文)

**Review 流程：**
1. 运行 `git diff --name-only` 查看所有未提交变更
2. 打开 `v0.3.0/architecture.md` 逐行对照检查
3. 确认设计文档中定义的每个章节的内容都实现，代码与设计完全一致

