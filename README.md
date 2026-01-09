# C4A - Context For AI

基于知识抽象模型扩展的架构知识管理平台，为 AI Agent 和企业开发团队提供架构知识的生产与消费能力。

## 开发自举

本项目的开发基于 AI IDE 和 C4A 本身实现自我迭代，开发者只需要一切 talk with AI，与 C4A Agent 一起工作和迭代。

你可以自由与 C4A Agent 对话，让它帮你完成架构规划和代码实现；
或通过指令，使用 ADR 工作流（调研 → 草稿 → 评审 → 批准 → 实现 → 发布）进行迭代。

```
# Vibe Coding Start
我想做一些关于 xxx 的调研

# Skills
/c4a:research # 自由调研
/c4a:draft    # 结合调研抽象 ADR 提案
/c4a:review   # 自由对话，通过影响分析、澄清、决策、范围检查等手段逐步使方案完成达成发布状态
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

```bash
git clone https://github.com/context4ai/c4a
cd c4a

# 一键启动，自动安装依赖，包括 Bun 1.3+, Python 3.11+, Docker 及 镜像
# dev、prod 运行；server、mcp、数据库管理；日志和测试管理交互菜单
./start.sh
```

## 开发环境

| 环境 | 说明 |
|------|------|
| **Claude Code + Opus 4.5** | 推荐 |
| **Cursor + Opus 4.5** |  |
| **OpenCode + GLM 4.5** | 免IDE安装和Token配置，dev 启动直接调起 |

## 开发指南

开发细节请参考 [CLAUDE.md](CLAUDE.md)。

## License

MIT
