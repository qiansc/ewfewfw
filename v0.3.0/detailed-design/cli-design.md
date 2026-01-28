# CLI 架构设计 v0.3.0

> 用户 CLI 与开发 CLI 的职责划分、目录结构与实现方案
>
> MCP 工具名称、参数与返回结构以 [./mcp-tools.md](./mcp-tools.md) 为准。

## 文档结构

详细设计文档已按功能模块拆分到 `cli/` 目录：

| 文件 | 内容 |
|------|------|
| [cli/overview.md](cli/overview.md) | 概述、CLI 分类 |
| [cli/user-cli.md](cli/user-cli.md) | 用户 CLI 设计 |
| [cli/dev-cli.md](cli/dev-cli.md) | 开发 CLI 设计 |
| [cli/mcp-mapping.md](cli/mcp-mapping.md) | CLI 命令与 MCP 工具映射 |
| [cli/commands-vs-skills.md](cli/commands-vs-skills.md) | CLI 命令 vs Skills、MCP 工具来源 |
| [cli/structure-migration.md](cli/structure-migration.md) | 目录结构、迁移计划、总结 |

## CLI 分类

| CLI | 包名 | 目标用户 | 安装方式 |
|-----|------|---------|---------|
| **用户 CLI** | `@c4a/cli` | 最终用户 | `npm install -g @c4a/cli` |
| **开发 CLI** | `@c4a/cli-dev` | C4A 开发者 | 项目内 `bun run` |

## 命令速查

### 用户 CLI 命令

| 命令 | 用途 | 详细文档 |
|------|------|---------|
| `c4a init` | 初始化项目 | [user-cli.md](cli/user-cli.md) |
| `c4a install` | 安装模式（local/server） | [user-cli.md](cli/user-cli.md) |
| `c4a sync` | 同步知识库 | [user-cli.md](cli/user-cli.md) |
| `c4a status` | 查看状态 | [user-cli.md](cli/user-cli.md) |
| `c4a validate` | 验证 DSL 文件 | [user-cli.md](cli/user-cli.md) |
| `c4a server` | 服务管理（仅 Server 模式） | [user-cli.md](cli/user-cli.md) |
| `c4a local` | 本地管理（仅 Local 模式） | [user-cli.md](cli/user-cli.md) |
| `c4a feat render` | 渲染 Checklist 到本地 | [user-cli.md](cli/user-cli.md) |
| `c4a template` | 生成 DSL 模板 | [user-cli.md](cli/user-cli.md) |
| `c4a schema` | 查看 JSON Schema | [user-cli.md](cli/user-cli.md) |
| `c4a server backup` | 备份数据（Server 模式） | [user-cli.md](cli/user-cli.md) |
| `c4a server restore` | 恢复数据（Server 模式） | [user-cli.md](cli/user-cli.md) |
| `c4a server check-permissions` | 检查备份文件权限兼容性 | [user-cli.md](cli/user-cli.md) |
| `c4a local backup` | 备份数据（Local 模式） | [user-cli.md](cli/user-cli.md) |
| `c4a local restore` | 恢复数据（Local 模式） | [user-cli.md](cli/user-cli.md) |
| `c4a local validate` | 检查数据完整性 | [user-cli.md](cli/user-cli.md) |
| `c4a local repair` | 修复数据完整性问题 | [user-cli.md](cli/user-cli.md) |
| `c4a help` | 帮助信息 | [user-cli.md](cli/user-cli.md) |

### 开发 CLI 命令

| 命令 | 用途 | 详细文档 |
|------|------|---------|
| `./start.sh` | 交互式菜单 | [dev-cli.md](cli/dev-cli.md) |
| `./start.sh dev` | 启动开发环境 | [dev-cli.md](cli/dev-cli.md) |
| `./start.sh test` | 运行测试 | [dev-cli.md](cli/dev-cli.md) |
| `./start.sh build` | 构建项目 | [dev-cli.md](cli/dev-cli.md) |
