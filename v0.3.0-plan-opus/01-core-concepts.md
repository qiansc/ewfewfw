# Part 01: 核心概念与数据模型

> 详细执行计划 - 基于 `v0.3.0/concepts.md`

---

## 任务清单

| # | 功能 | [x] | 描述 |
|---|------|:---:|------|
| 1.1 | 双视角三构件模型 | [x] | Entity/Process/SoR + Business/Technical 双视角定义 |
| 1.2 | 三层知识结构 | [x] | Domain/Enterprise/Project 三层 + 流动规则 |
| 1.3 | 知识生命周期 | [x] | draft→approved→published→deprecated→archived 状态机 |
| 1.4 | Entity 构件 | [x] | Product/System/Container/Component 类型定义 |
| 1.5 | Process 构件 | [x] | Business/Technical Process + Flow 存储结构 |
| 1.6 | SoR 构件 | [x] | 9 种 SoR 类型 + 双视角 SoR 对应关系 |
| 1.7 | Entity-Process Mesh | [x] | 交叉产生 SoR 的机制与数据流 |
| 1.8 | 六种关系类型 | [x] | CONTAINS/DEPENDS_ON/REFERENCES/IMPLEMENTS/CORRESPONDS/DERIVES |
| 1.8a | 关系链路与追溯 | [x] | 代码→业务反向追溯链路 |
| 1.8b | 附属实体概述 | [x] | ADR/Contract 存储独立性与概念依赖性 |
| 1.9 | 附属实体 ADR | [x] | 架构决策记录结构与 ADR 触发条件 |
| 1.10 | 附属实体 Contract | [x] | spec/spec_uri 存储方式与契约类型 |
| 1.11 | Functional/Technical Spec | [x] | PRD/技术设计的 DSL 版本结构 |
| 1.12 | feat 实体 | [x] | Feature 分支隔离机制与元数据结构 |
| 1.13 | 术语表 | [x] | feat_id/proposal_id/source_project 区分与命名规则 |
| 1.13a | 完整示例 | [x] | 直播电商项目三层知识示例 (Domain/Enterprise/Project) |
| 1.14 | Feat 类型定义 | [x] | FeatStatus/Feat/FeatChange TypeScript 类型 |
| 1.15 | Checklist 类型定义 | [x] | ChecklistItem/Checklist TypeScript 类型 |
| 1.16 | Reference 类型定义 | [x] | ReferenceType/ResolvedReference TypeScript 类型 |
| 1.17 | JSON Schema 更新 | [x] | 更新 DSL Schema（不含存储层字段，由系统生成） |
| 1.18 | feat.schema.json | [x] | Feat 实体 JSON Schema |
| 1.19 | checklist.schema.json | [x] | Checklist JSON Schema |
| 1.20 | Schema 验证工具 | [x] | 运行时 Schema 验证函数 |
| 1.21 | 错误码格式定义 | [x] | C4A-{category}-{number} 格式规范 |
| 1.22 | 完整错误码映射表 | [x] | INPUT/DATA/SYS/BIZ/STORE/PERM/MIGRATE 类别 |
| 1.23 | C4AError 基类 | [x] | 错误基类和子类定义 |
| 1.24 | MCP 错误响应序列化 | [x] | McpErrorResponse 格式 |
| 1.25 | 哈希工具 | [x] | computeContentHash/normalizeForHash |
| 1.26 | ID 工具 | [x] | generateEntityId/generateProposalId/parseEntityId |
| 1.27 | 路径工具 | [x] | getEntityPath/parseEntityPath/suggestEntityPath |
| 1.28 | 日期工具 | [x] | now/parseDate/formatDate |
| 1.29 | YAML 工具 | [x] | parseYAML/stringifyYAML/validateYAMLSyntax |
| 1.30 | 配置管理 | [x] | C4AConfig 类型 + loadConfig/saveConfig/validateConfig |
| 1.31 | 日志系统 | [x] | Logger 接口 + 日志级别控制 + 输出格式化 |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 1.1 | 双视角三构件模型 | `concepts.md` | §1 双视角三构建块 | L5-38 | [x] | [x] |
| 1.2 | 三层知识结构 | `concepts.md` | §2 三层知识结构 | L41-95 | [x] | [x] |
| 1.3 | 知识生命周期 | `concepts.md` | §3 知识生命周期 | L97-149 | [x] | [x] |
| 1.4 | Entity 构件 | `concepts.md` | §4.1 Entity | L153-210 | [x] | [x] |
| 1.5 | Process 构件 | `concepts.md` | §4.2 Process | L212-289 | [x] | [x] |
| 1.6 | SoR 构件 | `concepts.md` | §4.3 SoR | L291-364 | [x] | [x] |
| 1.7 | Entity-Process Mesh | `concepts.md` | §5 Entity-Process Mesh | L366-441 | [x] | [x] |
| 1.8 | 六种关系类型 | `concepts.md` | §6 关系类型 | L443-461 | [x] | [x] |
| 1.8a | 关系链路与追溯 | `concepts.md` | §7 知识追溯链 | L463-505 | [x] | [x] |
| 1.8b | 附属实体概述 | `concepts.md` | §8 附属实体 | L507-525 | [x] | [x] |
| 1.9 | ADR 附属实体 | `concepts.md` | §8.2 ADR | L622-631 | [x] | [x] |
| 1.10 | Contract 附属实体 | `concepts.md` | §8.1 Contract | L526-621 | [x] | [x] |
| 1.11 | Spec 实体 | `concepts.md` | §8.3-8.5 Spec/feat | L632-728 | [x] | [x] |
| 1.12 | feat 实体 | `concepts.md` | §8.4 feat | L680-705 | [x] | [x] |
| 1.13 | 术语表 | `concepts.md` | 附录：术语表 | L854-884 | [x] | [x] |
| 1.13a | 完整示例 | `concepts.md` | §9 直播电商项目 | L731-852 | [x] | [x] |
| 1.14 | Feat 类型 | `concepts.md` | §8.4 feat | L680-705 | [x] | [x] |
| 1.14 | Feat 生命周期 | `architecture.md` | §7 feat 机制 | L965-1078 | [x] | [x] |
| 1.15 | Checklist 格式 | `skills/checklist-format.md` | 全文 | - | [x] | [x] |
| 1.15 | Checklist 存储 | `architecture.md` | §2.5 文件命名规则 - checklist | L472-495 | [x] | [x] |
| 1.16 | 关系类型 | `concepts.md` | §6 关系类型 | L443-461 | [x] | [x] |
| 1.16 | 跨层级引用 | `architecture.md` | §3.4.1 跨层级和跨项目引用 | L700-731 | [x] | [x] |
| 1.17-1.20 | Schema 校验 | `architecture.md` | §2.7 Schema 校验 | L543-615 | [x] | [x] |
| 1.21 | 错误码格式 | `permissions/error-codes.md` | §3.1 错误码格式 | L1-70 | [x] | [x] |
| 1.22 | 完整错误码表 | `permissions/error-codes.md` | §3.2 完整错误码映射表 | L72-122 | [x] | [x] |
| 1.23-1.24 | 错误响应格式 | `permissions/error-codes.md` | §3.3 错误响应格式 | L123-155 | [x] | [x] |
| 1.25-1.29 | ID/路径规范 | `architecture.md` | §2.4-2.5 | L354-495 | [x] | [x] |
| 1.25 | content_hash | `mcp/store-crud.md` | §3.1 save - 内部行为 | L105-111 | [x] | [x] |
| 1.30 | 全局配置 | `cli/user-cli.md` | §2.4 全局配置 | L1467-1500 | [x] | [x] |
| 1.30 | 项目配置 | `cli/user-cli.md` | §2.5 项目配置 | L1502-1596 | [x] | [x] |
| 1.31 | 错误处理最佳实践 | `permissions/error-codes.md` | §4.1 错误处理 | L181-189 | [x] | [x] |
| - | 输入验证 | `permissions/error-codes.md` | §5 输入验证与输出安全 | L209-425 | [x] | [x] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| TypeScript 类型 | `packages/core/src/types/base.ts` | 基础类型 + 生命周期状态机 | ✅ |
| TypeScript 类型 | `packages/core/src/types/entities.ts` | Entity/Process/SoR 存储类型定义 | ✅ |
| TypeScript 类型 | `packages/core/src/types/relations.ts` | 关系类型 + Reference 定义 | ✅ |
| TypeScript 类型 | `packages/core/src/types/feat.ts` | Feat/FeatStatus/FeatChange | ✅ |
| TypeScript 类型 | `packages/core/src/types/checklist.ts` | Checklist/ChecklistItem | ✅ |
| TypeScript 类型 | `packages/core/src/types/attached.ts` | ADR/Contract 附属实体 | ✅ |
| TypeScript 类型 | `packages/core/src/types/spec.ts` | Functional/Technical Spec | ✅ |
| TypeScript 类型 | `packages/core/src/types/errors.ts` | C4AError 错误类型 | ✅ |
| TypeScript 类型 | `packages/core/src/types/dsl.ts` | DSL 文件类型（Product/System/Container/Component/Process/SoR/ADR/Contract） | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-product.schema.json` | Product DSL Schema（业务视角实体） | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-system.schema.json` | System DSL Schema | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-container.schema.json` | Container DSL Schema | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-component.schema.json` | Component DSL Schema | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-process.schema.json` | Process DSL Schema（流程） | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-sor.schema.json` | SoR DSL Schema（需求项） | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-adr.schema.json` | ADR DSL Schema | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-contract.schema.json` | Contract DSL Schema | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-feat.schema.json` | Feat Schema | ✅ |
| JSON Schema | `packages/core/src/schemas/c4a-checklist.schema.json` | Checklist Schema | ✅ |
| 工具函数 | `packages/core/src/utils/hash.ts` | 哈希计算工具 | ✅ |
| 工具函数 | `packages/core/src/utils/id.ts` | ID 生成与解析 | ✅ |
| 工具函数 | `packages/core/src/utils/path.ts` | 路径计算工具 | ✅ |
| 工具函数 | `packages/core/src/utils/date.ts` | 日期工具 | ✅ |
| 工具函数 | `packages/core/src/utils/yaml.ts` | YAML 工具 | ✅ |
| 配置管理 | `packages/core/src/utils/config.ts` | 配置加载/保存 | ✅ |
| 日志系统 | `packages/core/src/utils/logger.ts` | 日志系统 | ✅ |
| Schema 验证 | `packages/core/src/utils/schema.ts` | JSON Schema 验证 | ✅ |
| Schema 验证 | `packages/core/src/validator/ajvInstance.ts` | AJV 单例 + Schema 加载 | ✅ |
| Schema 验证 | `packages/core/src/validator/index.ts` | DSL 验证业务封装 | ✅ |

---

## 依赖关系

- 无前置依赖，作为基础概念层
- 后续 Part 02-12 均依赖本 Part 的类型定义

---

## 验收标准

- [x] 所有 TypeScript 类型导出可用
- [x] 所有 JSON Schema 验证通过
- [x] 错误码覆盖所有场景
- [x] 工具函数有单元测试
- [x] 配置管理支持全局和项目配置
