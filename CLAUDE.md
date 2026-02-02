# C4A - Context For AI

---

AI 原生的架构知识管理平台。以 AI Agent 为一等公民，提供架构知识的生产与消费能力。

**核心理念**：
- **知识抽象模型**：8 种实体类型（System, Container, Component, ADR, Contract, Product, Process, SoR）
- **Feat 分支隔离**：类似 Git 分支，支持并行开发和知识演进
- **三种工作模式**：Local（单机 SQLite）、Server（团队协作）、Remote（云端托管）

## 项目结构

```
c4a/
├── packages/                  # 所有模块
│   ├── cli/                   # 交互式 CLI (TypeScript + Ink)
│   ├── config-generator/      # 配置生成器 (TypeScript)
│   ├── core/                  # 共享核心库 (TypeScript)
│   ├── storage/               # 存储适配层 (TypeScript)
│   ├── mcp-extract/           # 知识采集 MCP (c4a_extract_*)
│   ├── mcp-store/             # 知识存储 MCP (c4a_store_*)
│   └── mcp-query/             # 知识查询 MCP (c4a_query_*)
├── prompts/                   # Agent Prompts
├── docker/                    # Docker 配置
├── docs/                      # 项目文档
├── .context/                  # 架构知识本地存储
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

### ESM 模块导入规则 (必须遵守)

使用 CommonJS 模块（如 `ajv`）时，注意导入语法：

```typescript
// ❌ 错误：namespace import 在 ESM 中无法正确获取 default export
import * as Ajv from 'ajv';
new Ajv();  // Error: not constructable

// ✅ 正确：使用 default import
import Ajv from 'ajv';
new Ajv();  // OK

// 如果只需要类型，使用 type import
import type { ValidateFunction } from 'ajv';
```

### SQLite 访问规则 (必须遵守)

Local 模式使用 Bun 内置的 `bun:sqlite` 模块访问 SQLite：

```typescript
// ✅ 正确：使用 bun:sqlite
import { Database } from 'bun:sqlite';
const db = new Database('c4a.db');

// 向量搜索使用 USearch (WASM)
import { Index } from 'usearch';
const index = new Index({ metric: 'cos', dimensions: 384 });
```

### Zod Schema 与 MCP SDK 规则 (必须遵守)

使用 Zod 定义 MCP 工具参数时，**不要对需要 `.shape` 的 schema 使用 `.refine()`**：

```typescript
// ❌ 错误：.refine() 返回 ZodEffects，没有 .shape 属性
// 会导致 TypeScript 编译时内存溢出 (OOM)
export const MyInputSchema = z.object({
  data: z.string(),
  content: z.string().optional(),
}).refine((d) => d.data || d.content, { message: "..." });

server.tool("my_tool", ..., MyInputSchema.shape, ...);  // ❌ .shape 不存在！

// ✅ 正确：拆分为基础 schema 和带验证的 schema
export const MyInputSchema = z.object({  // 纯 ZodObject，用于 .shape
  data: z.string(),
  content: z.string().optional(),
});

export const MyInputSchemaWithRefine = MyInputSchema.refine(  // 用于运行时验证
  (d) => d.data || d.content,
  { message: "..." }
);

server.tool("my_tool", ..., MyInputSchema.shape, ...);  // ✅ 正常工作
```

**原因**：Zod 的 `.refine()` / `.superRefine()` / `.transform()` 返回 `ZodEffects` 类型而非 `ZodObject`，TypeScript 尝试推断深度嵌套的泛型类型时会消耗大量内存导致 OOM。

### MCP 错误响应规范 (必须遵守)

MCP 工具执行失败时，返回 `content[].text` 内的错误结构必须遵循：

```typescript
interface ErrorResponse {
  code: string;           // 错误码，如 "C4A-DATA-001"
  message: string;        // 错误消息（用户友好）
  details?: {             // 详细信息（可选）
    field?: string;       // 出错字段
    expected?: string;    // 期望值
    actual?: string;      // 实际值
    suggestion?: string;  // 修复建议
  };
  timestamp: string;      // 错误发生时间（ISO 8601）
  request_id?: string;    // 请求 ID（用于追踪）
  recoverable_actions?: RecoverableAction[];
}

interface RecoverableAction {
  action: string;         // 操作标识，如 "retry", "force", "skip"
  label: string;          // 操作描述
  params?: object;        // 重试时需要的参数
}
```

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

## .context/ 目录结构

架构知识的本地存储，数据库是权威源（Local 模式使用 SQLite，Server 模式使用 MongoDB + Neo4j + Milvus）。

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
│   └── c4a-store-mcp.c4a.yaml    # 修改的容器
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
./start.sh dev          # 开发模式: 启动存储 + MCP 服务，提供 Web 终端访问
./start.sh docker       # Docker 模式: 全部服务容器化，暴露 HTTP 端口
./start.sh prod         # 生产模式: 启用健康检查和自动重启
./start.sh debug:extract # 调试 mcp-extract (前台运行)
./start.sh debug:store  # 调试 mcp-store (前台运行)
./start.sh debug:query  # 调试 mcp-query (前台运行)
./start.sh status       # 查看服务状态
./start.sh stop         # 停止所有服务
./start.sh logs         # 查看服务日志
./start.sh install      # 安装依赖
./start.sh test         # 运行测试
./start.sh clean        # 清理所有数据 (危险!)
```

## 命令执行规则（必须遵守）

- **项目使用 Bun**：一律使用 `bun run`/`bunx` 执行脚本与工具。
- **禁止使用 pnpm/npm/yarn** 执行 `tsc`、`test`、`build` 等命令。
- 类型检查/测试/构建应参考 `package.json` 中的 `scripts`（如 `bun run test`、`bun run build`）。
- **单包测试**：不要用 `bun run test --filter <name>`（会把过滤器传给所有包导致无匹配报错）；请使用 `bun run --filter @c4a/<package> test`，或在根 `package.json` 中添加对应的 `test:<package>` 脚本。

### Python 服务测试（storage-backend）

```bash
cd packages/storage-backend
python3 -m venv .venv && . .venv/bin/activate
python -m pip install -e ".[dev]"
python -m pytest
```

## 启动模式

| 模式 | 命令 | 适用场景 |
|------|------|----------|
| **dev** | `./start.sh dev` | 本地开发，改代码即时生效 |
| **docker** | `./start.sh docker` | 团队共享、演示、CI/CD |
| **prod** | `./start.sh prod` | 正式环境部署 |

- **dev 模式**: 存储服务 Docker 运行，MCP 服务本地运行，ttyd 提供 Web 终端（局域网可访问）
- **docker 模式**: 所有服务 Docker 运行，MCP 暴露 HTTP 端口供远程调用
- **prod 模式**: 基于 docker 模式，增加健康检查和自动重启

## 服务端口

| 端口 | 服务 |
|------|------|
| 27017 | MongoDB (Server 模式) |
| 7474 | Neo4j Browser (Server 模式) |
| 7687 | Neo4j Bolt (Server 模式) |
| 19530 | Milvus (Server 模式) |
| 7681 | ttyd (Web 终端，仅 dev 模式) |
| 8051 | mcp-store (知识存储) |
| 8052 | mcp-extract (知识采集，仅 docker/prod 模式) |
| 8053 | mcp-visual (可视化服务) |
| 8054 | mcp-query (知识查询) |

## 核心概念

- **知识抽象模型**: 8 种实体类型
  - **架构层**：System（系统）、Container（容器）、Component（组件）
  - **决策层**：ADR（架构决策记录）、Contract（API/消息契约）
  - **业务层**：Product（产品）、Process（流程）、SoR（记录系统）
- **Feat 分支**: 类似 Git 分支的知识隔离机制，支持并行开发
- **Checklist**: Feat 内的任务追踪，支持 DSL/代码/测试/文档等任务类型
- **MCP**: Model Context Protocol，Agent 工具调用协议
- **external**: DSL 中标记外部系统/容器/组件的属性

## AI 助手行为规则

### 语言规则
- 所有对话必须使用中文（除非用户明确要求英语）
- 代码、命令可以用英文，但解释说明必须用中文

### Git Commit 规则
- Commit message 必须使用英文
- 不要在 commit message 末尾添加 Co-Authored-By 或任何作者署名信息

### 代码规模规则 (必须遵守)

**单个模块文件不得超过 800 行。** 当文件接近或超过此限制时：
**计划文档不受此限制**

1. **立即暂停代码实现**
2. **向用户报告当前文件行数**
3. **提出分拆建议**，包括：
   - 建议拆分的模块/文件结构
   - 每个拆分后文件的职责说明
   - 拆分的具体步骤
4. **等待用户确认后再继续**

```
⚠️ 文件 xxx.ts 已达到 XXX 行，超过 800 行限制。
建议拆分方案：
- xxx-core.ts: 核心逻辑 (~300 行)
- xxx-utils.ts: 工具函数 (~200 行)
- xxx-types.ts: 类型定义 (~100 行)

是否按此方案进行拆分？
```

**原因**：过大的文件难以维护、测试和理解，也会增加 AI 助手的上下文负担。

### 文件操作规范

**创建/写入文件**：

- ✅ **优先使用** `Write` 工具 - 适用于所有文件大小
  ```typescript
  // Write 工具是 Claude Code 推荐的标准方法
  // 支持中小型文件（< 1000 行）
  // 类型安全，简单直接
  ```
- ✅ **大文件策略** - 当文件超过 1000 行时：
  - **方案 A**：分段创建多个小文件，最后合并
  - **方案 B**：使用 Write 工具创建主体，Edit 工具补充细节
  - **方案 C**：创建文件骨架，让用户补充内容
- ❌ **禁止使用** `Bash` 的 `cat`/`echo`/`printf` 创建文件
  - 原因：违反项目规范，难以维护，不利于类型检查
  - 例外：仅在 Write 工具确实无法工作时作为紧急备用

**文件操作最佳实践**：

1. **读取优先**：编辑现有文件前必须先用 `Read` 工具读取
2. **精确编辑**：使用 `Edit` 工具进行精确字符串替换
3. **路径规范**：始终使用绝对路径，避免相对路径
4. **编码安全**：确保文件使用 UTF-8 编码
5. **验证结果**：文件操作后使用 `Read` 或 `Bash ls` 验证

## 文档规范

### 文档原则
1. **真实性**: 只记录已实现的功能
2. **直接修改**: 不打补丁，直接更新
3. **无营销语言**: 不用"高性能"、"灵活"等模糊词汇
4. **链接有效**: 所有内部链接必须可用
5. **避免冗余版本号**: 不要在展示类文档、示例、DSL 文件中写 C4A 版本信息（如 `version: v0.1`）。版本号仅在需要严格版本控制的地方使用（如 JSON Schema、发布文档）

## 详细文档

- [ARCHITECTURE.md](ARCHITECTURE.md) - 工程架构详情
- [CONTRIBUTING.md](CONTRIBUTING.md) - 文档编写规范

## Skills 使用指南

C4A 提供以下 Skills 来完成架构知识管理任务：

### 核心 Skills

| Skill | 用途 | 触发示例 |
|-------|------|----------|
| `/c4a:feat` | Feature 生命周期管理 | "开发功能"、"创建 ADR"、"批准方案"、"发布" |
| `/c4a:specify` | 功能规格定义 | "定义需求"、"写功能规格" |
| `/c4a:plan` | 技术方案设计 | "设计方案"、"技术设计" |
| `/c4a:implement` | 代码实现辅助 | "开始实现"、"写代码" |
| `/c4a:analyze` | 一致性检查 | "检查一致性"、"验证方案" |

### 知识管理 Skills

| Skill | 用途 | 触发示例 |
|-------|------|----------|
| `/c4a:know:learn` | 快速录入知识 | "整理规范"、"记录知识" |
| `/c4a:know:search` | 搜索知识库 | "搜索 xxx"、"查找 xxx" |

### 典型工作流

**需求开发**：
```
/c4a:feat "用户登录功能"
→ /c4a:specify
→ /c4a:plan
→ /c4a:feat --status=approved
→ /c4a:implement
→ /c4a:feat --status=published
```

**快速录入知识**：
```
/c4a:know:learn ./docs/redis-guide.md
→ 自动完成全流程
```

### CLI Commands

- `c4a sync` - 同步到知识库
- `c4a status` - 查看状态
- `./start.sh` - 查看所有可用命令
