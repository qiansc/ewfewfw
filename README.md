# C4A - Context For AI

AI 原生的架构知识管理平台，以 AI Agent 为一等公民，提供架构知识的生产与消费能力。

## 核心特性

- **知识抽象模型**：8 种实体类型覆盖架构、决策、业务三层
- **Feat 分支隔离**：类似 Git 分支，支持并行开发和知识演进
- **三种工作模式**：Local（单机）、Server（团队）、Remote（云端）
- **MCP 工具集成**：通过 MCP 协议为 AI Agent 提供知识读写能力

## 开发自举

本项目的开发基于 AI IDE 和 C4A 本身实现自我迭代，开发者只需要一切 talk with AI，与 C4A Agent 一起工作和迭代。

你可以自由与 C4A Agent 对话，让它帮你完成架构规划和代码实现；
或通过指令，使用 ADR 工作流（调研 → 草稿 → 评审 → 批准 → 实现 → 发布）进行迭代。

```
# Vibe Coding Start
我想做一些关于 xxx 的调研

# Skills
/c4a:feat      # Feature 生命周期管理
/c4a:specify   # 需求定义
/c4a:plan      # 技术设计
/c4a:implement # 代码实现
```

### 代码实现

C4A 现阶段聚焦于高质量知识生产和消费，在代码开发的场景下，实现的部分是开放选择的，你可以选择任意 Spec 工具、Plan Mode 进行接力工作：

```
# Vibe Coding
请你就 adr-001 提案进行规划

# Claude Code Feat DEV [推荐]
/feat-dev 阅读并实现 @.c4a/drafts/adr-001

# Spec Kit
/specify @.c4a/drafts/adr-001
```

只需要在任何你觉得代码就绪的时候执行归档即可：

```
我已完成 adr-002 的开发，请帮我完成知识发布

```

## 快速开始

在仓库根目录执行：

```bash
# 安装
./start.sh install

# 启动 (Local 模式)
./start.sh dev

# 启动 (Server 模式)
./start.sh docker
```

## 核心命令

- `c4a init` - 初始化项目
- `c4a sync` - 同步知识
- `c4a status` - 查看状态
- `c4a feat` - 管理 Feature

## Skills 使用

- `/c4a:feat` - Feature 管理
- `/c4a:specify` - 需求定义
- `/c4a:plan` - 技术设计
- `/c4a:implement` - 代码实现

## 开发环境

| 环境 | 说明 |
|------|------|
| **Claude Code + Opus 4.5** | 推荐 |
| **Cursor + Opus 4.5** |  |
| **OpenCode + GLM 4.5** | 免IDE安装和Token配置，dev 启动直接调起 |

## 开发指南

开发细节请参考 [CLAUDE.md](CLAUDE.md)。

## 已知问题

- **Server 模式一致性窗口**：MongoDB 写入后到 Neo4j/Milvus 同步完成前，查询可能返回过期数据（建议在关键查询前等待同步完成或使用重试策略）。
- **Checklist 并发行为**：多人同时编辑时采用 Last Write Wins 策略（建议通过流程约束避免并发编辑同一 Checklist）。
- **跨项目权限死锁**：发布前需确认所有涉及项目的权限状态（建议发布前执行权限自检或统一审批窗口）。

## License

MIT
