# C4A 产品需求文档

> 基于 KDD（Knowledge Driven Development）理念的架构知识管理平台

## 1. 产品概述

### 1.1 产品定位

C4A 是一个**知识驱动的软件开发平台**，基于 KDD（Knowledge Driven Development）框架，帮助团队将软件开发过程中的各类知识（从行业规范到代码实现）结构化、可追溯、可复用。

### 1.2 核心价值

| 价值 | 说明 |
|------|------|
| **知识显性化** | 将隐藏在文档、代码、人脑中的知识显性化为结构化数据 |
| **全链路追溯** | 从代码追溯到需求，从需求追溯到业务目标 |
| **知识复用** | 原子化的知识可跨项目、跨团队复用 |
| **AI 友好** | 结构化知识可被 AI Agent 高效消费 |

### 1.3 目标用户

| 角色 | 痛点 | C4A 解决方案 |
|------|------|-------------|
| **产品经理** | 需求文档散落各处，难以追溯 | 统一的知识图谱，需求可追溯 |
| **架构师** | 架构决策缺乏记录，新人难以理解 | ADR + 架构知识沉淀 |
| **开发工程师** | 不清楚为什么这样设计，改动影响不明 | 依赖分析、影响分析 |
| **技术管理者** | 团队知识流失，重复造轮子 | 知识沉淀、跨项目复用 |

---

## 2. 知识模型

> 详细的概念定义请参考 [concepts.md](./concepts.md)

C4A 采用"**双视角三构建块**"模型来组织知识，将知识分为三个层级（Domain/Enterprise/Project），并通过统一的生命周期管理知识变更。

---

## 3. 核心功能

> **相关文档**：
> - 用户交互流程：[user-stories.md](./user-stories.md)
> - Skills 封装设计：[detailed-design/skills-design.md](./detailed-design/skills-design.md)
> - MCP 工具单一真源：[mcp-tools.md](./detailed-design/mcp-tools.md)

### 3.1 功能全景

| 功能模块 | 说明 | 优先级 | 架构实现 |
|---------|------|--------|---------|
| **业务管理** | MRD 管理，行业动向跟踪，业务决策记录 | P0 | Skills: `/c4a:feat`, `/c4a:specify` |
| **知识管理** | 新增、编辑、查询各层级知识 | P0 | MCP: 见 [mcp-tools.md](./detailed-design/mcp-tools.md) |
| **需求管理** | Feature → Functional Spec → Technical Spec | P0 | Skills: `/c4a:feat`, `/c4a:specify`, `/c4a:plan` |
| **架构变更** | 产品驱动和技术驱动的架构变更流程 | P0 | Skills: `/c4a:feat` (ADR), `/c4a:analyze` |
| **代码实现** | 代码实现辅助、自动关联架构知识 | P0 | Skills: `/c4a:implement` |
| **依赖分析** | 知识图谱查询、影响分析 | P1 | MCP: 见 [mcp-tools.md](./detailed-design/mcp-tools.md) |
| **代码关联** | 代码提取、契约生成 | P1 | MCP: 见 [mcp-tools.md](./detailed-design/mcp-tools.md) |
| **可视化** | 架构图、依赖图生成 | P2 | MCP: 见 [mcp-tools.md](./detailed-design/mcp-tools.md) |

#### 功能模块与架构实现的对应关系

C4A 的功能模块通过两层实现：

**第一层：Skills（工作流封装）**
- Skills 封装完整的用户交互流程，隐藏 MCP 工具的复杂性
- 用户通过自然语言或命令触发 Skills，无需了解底层工具
- 详见 [skills-design.md](./detailed-design/skills-design.md)

**第二层：MCP 工具（原子操作）**
- MCP 工具提供原子化的数据操作能力
- Skills 内部编排多个 MCP 工具完成复杂流程
- 详见 [architecture.md](./architecture.md) 第 1.3 节

**映射说明**：

| 功能模块 | Skills 层 | MCP 工具层 | 说明 |
|---------|----------|-----------|------|
| **业务管理** | `/c4a:feat`, `/c4a:specify` | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | 通过 feat 流程管理 MRD/PRD，生成 Product/Process DSL |
| **知识管理** | `/c4a:know:learn`, `/c4a:know:search` | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | 快速录入和搜索知识 |
| **需求管理** | `/c4a:feat` → `/c4a:specify` → `/c4a:plan` | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | 完整的需求到实现流程 |
| **架构变更** | `/c4a:feat` (ADR), `/c4a:analyze` | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | ADR 记录决策，analyze 检查影响 |
| **代码实现** | `/c4a:implement` | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | 代码实现辅助，自动关联架构知识 |
| **依赖分析** | 无（直接调用 MCP） | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | 依赖查询、影响分析 |
| **代码关联** | 无（直接调用 MCP） | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | Agent 直接调用 MCP 工具 |
| **可视化** | 无（直接调用 MCP） | 见 [mcp-tools.md](./detailed-design/mcp-tools.md) | Agent 直接调用 MCP 工具 |

**设计原则**：
- **复杂流程 → Skills 封装**：如需求管理、架构变更等多步骤流程
- **原子操作 → 直接调用 MCP**：如依赖查询、代码提取等单一操作
- **用户无感知**：用户只需通过自然语言描述需求，Agent 自动选择合适的 Skills 或 MCP 工具

### 3.2 知识管理

**功能描述**：管理不同层级的知识，支持提案、批准、发布流程。

**用户故事**：
- 作为业务负责人，我要能提交 MRD，记录行业动向和业务决策
- 作为产品经理，我要能提交 PRD 提案，经批准后发布为产品知识
- 作为架构师，我要能记录行业合规要求，作为架构决策的依据
- 作为开发，我要能查询某个功能相关的所有知识（从 MRD 到代码）

**核心能力**：
1. 支持三层知识结构（Domain/Enterprise/Project）
2. 知识间通过引用机制关联（避免复制）
3. 知识变更需走提案流程
4. 支持全文搜索和语义搜索

### 3.3 需求管理

**功能描述**：从 Feature 到实现的完整链路管理。

**用户故事**：
- 作为产品经理，我要能提交 Feature 需求，并协助研发澄清为 Functional Spec
- 作为研发，我要能基于 Functional Spec 设计 Technical Spec
- 作为团队，我们要能看到某个 Feature 的完整实施状态

**完整流程**：
1. 提交 Feature 提案
2. 澄清为 Functional Spec（产品 + 研发）
3. 设计 Technical Spec（研发）
4. 批准两个 Spec，进入实施
5. 实施完成后，发布相关知识

### 3.4 架构变更管理

**功能描述**：管理架构变更的两种典型场景。

**场景 1：产品驱动的架构变更**
- Feature 提案 → Functional Spec → Technical Spec
- 判断是否涉及架构变更
- 如涉及，创建 ADR 记录架构决策
- 更新架构元素，继续实施

**场景 2：技术驱动的架构升级**
- 技术升级需求（性能优化、技术债务、安全加固）
- 创建 Technical Spec
- 反向生成对应的 Feature 和 Functional Spec（技术变更也要体现用户价值）
- 创建 ADR 记录决策
- 实施并验证

**用户故事**：
- 作为产品经理，我要能看到技术升级对应的用户价值
- 作为架构师，我要能在设计时判断是否需要架构变更
- 作为开发，我要能理解某个架构决策的历史背景和理由
- 作为技术负责人，我要能发起技术债务治理

### 3.5 依赖分析

**功能描述**：查询知识图谱，分析变更影响。

**用户故事**：
- 作为开发，我要能查询某个组件的上下游依赖
- 作为架构师，我要能分析某个变更的影响范围
- 作为技术负责人，我要能识别系统的关键依赖路径

### 3.6 代码关联

**功能描述**：从代码提取知识，生成接口契约。

**用户故事**：
- 作为开发，我要能从代码自动提取接口定义
- 作为架构师，我要能看到代码与架构知识的关联
- 作为新人，我要能从架构知识快速定位到代码位置

---

## 4. 产品边界

### 4.1 做什么

- 知识的结构化存储和管理
- 知识间的关联和追溯
- 知识的生命周期管理
- 从文档/代码提取知识
- 知识图谱查询和可视化

### 4.2 不做什么

- **不是项目管理工具**（不管理任务、排期、人员）
- **不是代码托管平台**（不替代 Git）
- **不是文档协作工具**（不替代 Notion/Confluence）
- **不是 CI/CD 平台**（不负责构建部署）

### 4.3 与其他工具的关系

| 工具类型 | 关系 | 集成方式 |
|---------|------|---------|
| **Git** | 互补 | 读取代码，提取知识 |
| **Jira/Linear** | 互补 | 可导入 Issue 作为 Feature |
| **Notion/Confluence** | 互补 | 可导入文档作为知识 |
| **IDE** | 互补 | 通过 MCP 协议集成 |

---

## 5. 成功指标

### 5.1 核心指标

| 指标 | 目标 | 说明 |
|------|------|------|
| **知识覆盖率** | 80% | 项目中 80% 的代码有对应的知识记录 |
| **知识复用率** | 30% | 30% 的知识被多个项目引用 |
| **追溯完整性** | 90% | 90% 的代码可追溯到需求 |
| **知识时效性** | 95% | 95% 的知识在 30 天内更新 |

### 5.2 用户体验指标

| 指标 | 目标 |
|------|------|
| 新人上手时间 | < 1 天 |
| 知识查询响应时间 | < 500ms |
| 知识提交成功率 | > 95% |

---

## 6. 附录

### 6.1 术语表

> 详细的概念定义请参考 [concepts.md](./concepts.md)

| 术语 | 说明 |
|------|------|
| **KDD** | Knowledge Driven Development，知识驱动开发 |
| **MRD** | Market Requirements Document，市场需求文档 |
| **PRD** | Product Requirements Document，产品需求文档 |
| **Functional Spec** | 功能规格，描述"做什么" |
| **Technical Spec** | 技术规格，描述"怎么做" |

### 6.2 参考资料

- [核心概念定义](./concepts.md) - 双视角三构建块、三层知识结构详解
- [用户故事](./user-stories.md) - 实际使用场景和交互流程
- [架构设计](./architecture.md) - 技术实现细节
- [C4 Model](https://c4model.com/)
