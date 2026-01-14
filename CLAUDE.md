# C4A - Context For AI

> ## 第一性原理
>
> **代码是知识的有损投影。**
>
> 代码是给机器执行的指令，只包含执行所需的信息。理解一个系统所需的知识——设计意图、架构边界、依赖关系、历史演进——并不在代码里。
>
> **C4A 的任务：将隐性知识显性化，使其可被机器消费。**

---

架构知识管理平台，为 AI Agent 提供项目知识的生产与消费能力。

## 项目结构

```
c4a/
├── packages/                  # 所有模块
│   ├── cli/                   # 交互式 CLI (TypeScript + Ink)
│   ├── config-generator/      # 配置生成器 (TypeScript)
│   ├── core/                  # 共享核心库 (TypeScript)
│   ├── mcp-code/              # 代码分析提取 (TypeScript)
│   ├── mcp-data/              # 统一数据服务 (Python)
│   └── mcp-dsl/               # DSL 解析验证 (TypeScript)
├── prompts/                   # Agent Prompts
├── docker/                    # Docker 配置
├── docs/                      # 项目文档
├── .c4a/                      # 架构知识本地存储
└── start.sh                   # CLI 入口 (查看所有命令: ./start.sh)
```

## 开发约定

### Bun 兼容性规则 (必须遵守)

为确保代码可在 Node.js 和 Bun 之间切换：

```typescript
// ✅ 正确：使用标准 Node.js API
import { readFile } from 'node:fs/promises';
const content = await readFile('file.txt', 'utf-8');

// ❌ 错误：使用 Bun 特有 API
const file = Bun.file('file.txt');
const content = await file.text();
```

**规则：**
- 不使用 Bun 特有 API（如 `Bun.file()`, `Bun.serve()`, `Bun.spawn()`）
- 使用标准 Node.js API（`node:fs`, `node:path`, `node:child_process` 等）
- 如果遇到 native addon 兼容问题，优先找纯 JS 替代品

### 代码风格

**TypeScript:**
- 模块系统: ESM (`"type": "module"`)
- 文件命名: `camelCase.ts`，类: `PascalCase`，函数/变量: `camelCase`，常量: `UPPER_SNAKE_CASE`

**Python:**
- 格式化: Ruff (行长度 100)，类型检查: MyPy (strict)
- 文件: `snake_case.py`，类: `PascalCase`，函数/变量: `snake_case`，常量: `UPPER_SNAKE_CASE`

### DSL 文件
- 扩展名：`.c4a.yaml`
- 遵循 C4 模型层级：System → Container → Component

### 临时文件
- 调试阶段生成的临时测试文件必须写到 `.tmp/` 目录
- `.tmp/` 目录已在 `.gitignore` 中忽略

## .c4a/ 目录结构

架构知识的本地存储，数据库（MongoDB + Neo4j + Milvus）是权威源。

| 目录 | 用途 | 可修改性 |
|------|------|----------|
| `drafts/` | 草稿提案，按提案组织 | 自由修改 |
| `approved/` | 审核通过的提案 | 设计冻结 |
| `published/` | 已发布的权威版本 | 禁止修改 |
| `archive/` | 归档（被拒绝或已废弃） | 禁止修改 |

### 提案工作流

```
drafts/adr-xxx/  ──审核通过──►  approved/adr-xxx/  ──发布──►  published/xxx/
                                     │                           │
                                审核不通过                    有新版本
                                     ▼                           ▼
                              archive/adr-xxx/            archive/xxx-v1/
```

### 提案目录结构示例

```
drafts/adr-002-introduce-mq/
├── adr-002.c4a.yaml              # ADR 本身
├── containers/
│   ├── c4a-mq.c4a.yaml           # 新增容器
│   └── c4a-data-mcp.c4a.yaml     # 修改的容器
└── README.md                     # 提案说明（可选）
```

## 环境配置

```bash
cp .env.example .env    # 复制环境变量模板
```

所有环境变量在 `.env` 中统一管理，Docker Compose 通过 `env_file` 读取。

## 常用命令

```bash
./start.sh              # 交互式菜单 (推荐)
./start.sh dev          # 开发模式: 启动存储 + mcp-data + ttyd，提供 Web 终端访问
./start.sh docker       # Docker 模式: 全部服务容器化，暴露 HTTP 端口
./start.sh prod         # 生产模式: 启用健康检查和自动重启
./start.sh debug:dsl    # 调试 mcp-dsl (前台运行)
./start.sh debug:code   # 调试 mcp-code (前台运行)
./start.sh debug:data   # 调试 mcp-data (前台运行)
./start.sh status       # 查看服务状态
./start.sh stop         # 停止所有服务
./start.sh logs         # 查看服务日志
./start.sh install      # 安装依赖
./start.sh test         # 运行测试
./start.sh clean        # 清理所有数据 (危险!)
```

## 启动模式

| 模式 | 命令 | 适用场景 |
|------|------|----------|
| **dev** | `./start.sh dev` | 本地开发，改代码即时生效 |
| **docker** | `./start.sh docker` | 团队共享、演示、CI/CD |
| **prod** | `./start.sh prod` | 正式环境部署 |

- **dev 模式**: 存储服务 Docker 运行，mcp-data 本地运行，ttyd 提供 Web 终端（局域网可访问 OpenCode）
- **docker 模式**: 所有服务 Docker 运行，MCP 暴露 HTTP 端口供远程调用
- **prod 模式**: 基于 docker 模式，增加健康检查和自动重启

## 服务端口

| 端口 | 服务 |
|------|------|
| 27017 | MongoDB |
| 7474 | Neo4j Browser |
| 7687 | Neo4j Bolt |
| 19530 | Milvus |
| 7681 | ttyd (Web 终端，仅 dev 模式) |
| 8050 | mcp-data (数据服务) |
| 8051 | mcp-dsl (DSL 解析，仅 docker/prod 模式) |
| 8052 | mcp-code (代码分析，仅 docker/prod 模式) |

## 核心概念

- **C4A DSL**: 架构描述语言，描述 System/Container/Component 及其关系
- **ADR**: 架构决策记录，记录技术决策及其上下文
- **契约**: API/消息契约 (OpenAPI, AsyncAPI, Proto)
- **MCP**: Model Context Protocol，Agent 工具调用协议
- **external**: DSL 中标记外部系统/容器/组件的属性

## AI 助手行为规则

### 语言规则
- 所有对话必须使用中文（除非用户明确要求英语）
- 代码、命令可以用英文，但解释说明必须用中文

### Git Commit 规则
- Commit message 必须使用英文
- 不要在 commit message 末尾添加 Co-Authored-By 或任何作者署名信息

## 文档规范

### 文档原则
1. **真实性**: 只记录已实现的功能
2. **直接修改**: 不打补丁，直接更新
3. **无营销语言**: 不用"高性能"、"灵活"等模糊词汇
4. **链接有效**: 所有内部链接必须可用

## 详细文档

- [ARCHITECTURE.md](ARCHITECTURE.md) - 工程架构详情
- [CONTRIBUTING.md](CONTRIBUTING.md) - 文档编写规范
