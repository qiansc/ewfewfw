# C4A User CLI

用户侧命令行入口，提供项目初始化、模式安装、同步、状态查看等能力。

## 运行方式

### 开发环境

```bash
# 直接运行入口文件（推荐，支持交互式菜单）
bun packages/cli/src/index.tsx

# 带参数执行命令
bun packages/cli/src/index.tsx status
bun packages/cli/src/index.tsx help
```

> **注意**: `bun run --filter @c4a/cli dev` 通过 workspace runner 启动子进程，
> stdin 不再是 TTY，导致交互式菜单无法使用。
> 如需测试交互式菜单，请直接运行入口文件。

### 打包后使用

```bash
# 交互式菜单（需要 TTY 终端）
c4a

# 直接执行命令
c4a status
c4a help
```

## 运行模式

CLI 有两种运行模式：

| 模式 | 触发条件 | 说明 |
|------|----------|------|
| 交互式菜单 | 无参数 + TTY 终端 | 使用 ↑/↓/Enter 选择，支持首次引导 |
| 命令行模式 | 有参数 | 直接执行命令，适用于脚本/CI |

非 TTY 环境下无参数运行会打印帮助信息并退出。

## 命令速览

```
c4a                              启动交互式菜单
c4a help                         显示帮助信息
c4a init                         初始化项目配置
c4a install <local|server|remote> 安装存储模式
c4a sync                         同步到知识库
c4a status                       查看状态
c4a validate [path]              验证 DSL 文件
c4a feat render <feat-id>        渲染 Checklist
c4a template <type>              生成模板
c4a schema <type|all>            输出 Schema
c4a server <subcommand>          服务模式命令
c4a local <subcommand>           本地模式命令
```

## 示例

初始化项目：

```bash
c4a init
```

安装本地模式：

```bash
c4a install local
```

同步数据：

```bash
c4a sync
```

渲染 Checklist：

```bash
c4a feat render feat-login
```

生成模板：

```bash
c4a template system
```

输出 Schema：

```bash
c4a schema all
```

## 子命令

`c4a server`（Server 模式安装后可用）：

```
status | restart | stop | logs | backup | restore | clean | check-permissions
```

`c4a local`（Local 模式安装后可用）：

```
status | validate | repair | backup | restore | clean | vacuum
```

## 首次运行引导

首次运行时（未安装任何存储模式），交互式菜单会显示引导界面：

```
检测到尚未安装存储模式，请选择:

> local  - 本地模式 (SQLite，无需 Docker)
  server - 服务模式 (MongoDB + Neo4j + Milvus)
  remote - 远程模式 (连接远程服务)
  skip   - 稍后决定
```

也可以通过命令行直接安装：

```bash
c4a install local
```

## 测试

```bash
# 运行单元测试
bun run --filter @c4a/cli test

# 测试命令行模式
bun packages/cli/src/index.tsx help
bun packages/cli/src/index.tsx status

# 测试交互式菜单（需要真实 TTY）
bun packages/cli/src/index.tsx

# 测试首次引导（使用临时 HOME）
C4A_HOME=/tmp/c4a-test bun packages/cli/src/index.tsx
```
