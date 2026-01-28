# CLI 架构设计 v0.3.0

> 用户 CLI 与开发 CLI 的职责划分、目录结构与实现方案
>
> MCP 工具名称、参数与返回结构以 [./mcp-tools.md](./mcp-tools.md) 为准（避免本文档与其他文档出现工具名漂移）。

---

## 1. 概述

C4A 有两类 CLI 工具，面向不同用户群体：

| CLI | 包名 | 目标用户 | 安装方式 | 存储模式 |
|-----|------|---------|---------|---------|
| **用户 CLI** | `@c4a/cli` | 最终用户 | `npm install -g @c4a/cli` | Local/Server/Remote 可选 |
| **开发 CLI** | `@c4a/cli-dev` | C4A 开发者 | 项目内使用 | Server (Docker) |

### 1.1 核心区别

**用户 CLI**：
- 支持 Local 模式（SQLite）、Server 模式（Docker）和 Remote 模式（远程服务）
- 通过 `c4a install local/server` 选择模式，或选择 remote 跳过安装
- 内嵌 MCP 工具（Local 模式）或连接远程服务（Server/Remote 模式）

**开发 CLI**：
- 仅 Server 模式
- 用于开发和调试 MCP 服务
- 具备编译发布用户 CLI 的能力

---

