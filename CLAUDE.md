# C4A - Context For AI

**知识驱动开发（Knowledge-Driven Development）平台**

C4A 为 AI Agent 提供结构化的上下文，实现从业务需求到代码实现的全链路知识贯通。

## 核心理念

传统开发中，需求文档、设计文档、代码实现之间存在断层，AI Agent 缺乏足够的上下文来理解业务意图。C4A 通过统一的知识模型，将业务知识、架构决策、技术实现串联起来。

## 知识模型

8 种实体类型，覆盖业务、架构、契约三个层面：

| 层面 | 实体 | 说明 |
|------|------|------|
| **业务** | Product | 产品定义、用户故事 |
| | Process | 业务流程 |
| | SoR | 权威数据源 |
| **架构** | System | 系统边界 |
| | Container | 服务、应用 |
| | Component | 模块、类 |
| | ADR | 架构决策记录 |
| **契约** | Contract | API 契约 |

## 工作模式

- **Local**：SQLite + 本地向量，个人开发
- **Server**：MongoDB + Neo4j + Milvus，团队协作
- **Remote**：云端托管

## Feat 分支

类似 Git 分支的知识隔离机制，支持并行开发和知识演进。

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

项目使用 Bun 运行时，但代码需保持 Node.js 兼容性：

```typescript
// ✅ 正确：使用标准 Node.js API
import { readFile } from 'node:fs/promises';

// ✅ 例外：SQLite 使用 bun:sqlite（Local 模式专用）
import { Database } from 'bun:sqlite';

// ✅ 例外：向量搜索使用 USearch (WASM)
import { Index } from 'usearch';

// ❌ 错误：使用其他 Bun 特有 API
const file = Bun.file('file.txt');  // 不要用
Bun.serve({ ... });                  // 不要用
```

### ESM 模块导入规则 (必须遵守)

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

### 关系数据完整性规则 (必须遵守)

更新实体时，**无论新关系列表是否为空，都必须先删除旧关系再写入新关系**：

```typescript
// ❌ 错误：只有 relations 非空时才删除，导致旧关系残留
const relations = parseRelations(data);
if (relations.length > 0) {
  await deleteRelations(entityId);
  await saveRelations(relations);
}

// ✅ 正确：始终删除旧关系，再写入新关系（即使为空）
await deleteRelations(entityId);
const relations = parseRelations(data);
if (relations.length > 0) {
  await saveRelations(relations);
}
```

**原因**：用户移除 `system_id`/`container_id` 或清空 `relationships` 时，旧关系必须被清理，否则会导致 MongoDB/Neo4j 残留脏数据，影响依赖/影响查询结果。

### SQLite NULL 值归一化规则 (必须遵守)

SQLite 表中用于 JOIN 的字段必须统一为空字符串 `''`，**禁止使用 NULL**：

```sql
-- ❌ 错误：NULL = NULL 在 SQL 中为 false，导致 JOIN 失败
SELECT * FROM entities e
JOIN metadata m ON e.proposal_id = m.proposal_id  -- 如果两边都是 NULL，不会匹配！

-- ✅ 正确：统一使用空字符串
UPDATE entities SET proposal_id = '' WHERE proposal_id IS NULL;
UPDATE metadata SET proposal_id = '' WHERE proposal_id IS NULL;
```

**适用字段**：`proposal_id`、`source_project`、`from_project`、`to_project` 等可能为空的字段。

### 路径安全规则 (必须遵守)

所有接受用户路径输入的 API 必须执行以下校验：

```python
# ✅ 正确的路径安全校验
def validate_safe_path(input_path: str, root: Path) -> Path:
    candidate = Path(input_path)

    # 1. 禁止绝对路径（防止越权访问）
    if candidate.is_absolute():
        raise HTTPException(400, "不允许绝对路径")

    # 2. 禁止父目录引用（防止路径穿越）
    if ".." in candidate.parts:
        raise HTTPException(400, "不允许父目录引用")

    # 3. 验证解析后路径在允许的根目录内
    resolved = (root / candidate).resolve()
    if root.resolve() not in resolved.parents and root.resolve() != resolved:
        raise HTTPException(400, "路径必须在项目根目录内")

    return resolved
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

架构知识的本地存储目录。

| 目录 | 用途 | 可修改性 |
|------|------|----------|
| `drafts/` | 草稿提案 | 自由修改 |
| `approved/` | 审核通过的提案 | 设计冻结 |
| `published/` | 已发布的权威版本 | 禁止修改 |
| `archive/` | 归档（被拒绝或已废弃） | 禁止修改 |

## 环境配置

```bash
cp .env.example .env    # 复制环境变量模板
```

所有环境变量在 `.env` 中统一管理，Docker Compose 通过 `env_file` 读取。

## 常用命令

```bash
./start.sh              # 交互式菜单 (推荐)

# 启动模式
./start.sh dev          # 开发模式: 本地 MCP + Docker 存储，改代码即时生效
./start.sh dev --force  # 开发模式: 强制重启所有 MCP 服务
./start.sh docker:rebuild  # Docker 模式: 强制 build 并重启全部容器（推荐）
./start.sh prod         # 生产模式: 全容器化 + 健康检查 + 自动重启
./start.sh restart      # 重启所有服务（存储 + MCP + ttyd）

# 服务管理
./start.sh status       # 查看 Docker 容器和本地进程状态
./start.sh stop         # 停止所有服务（Docker + 本地进程）
./start.sh logs [服务]  # 查看服务日志

# 调试模式（前台 stdio 运行，Ctrl+C 退出）
./start.sh debug:store  # 前台运行 mcp-store
./start.sh debug:extract # 前台运行 mcp-extract
./start.sh debug:query  # 前台运行 mcp-query

# 数据清理
./start.sh clean        # 清理所有数据（远程存储 + 本地知识文件）
./start.sh clean:storage # 仅清理远程存储（MongoDB/Neo4j/Milvus/Ollama）
./start.sh clean:local  # 仅清理本地知识文件（.context/ 子目录）

# 构建与测试
./start.sh build        # 构建项目
./start.sh install      # 安装依赖
./start.sh test         # 运行测试
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

> 详见 [ARCHITECTURE.md](ARCHITECTURE.md)

- **8 种实体类型**：System, Container, Component, ADR, Contract, Product, Process, SoR
- **知识点类型 (kind)**：`implementation`（实现）、`external`（外部）、`concept`（概念）
- **Feat 分支**：类似 Git 分支的知识隔离机制
- **MCP**：Model Context Protocol，Agent 工具调用协议

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

### 工作流 Skills

| Skill | 用途 |
|-------|------|
| `/c4a:feat` | Feature 管理（创建/修改/切换/流转） |
| `/c4a:specify` | 功能规格（Functional Spec） |
| `/c4a:plan` | 技术方案（Technical Spec + 契约 + 验收清单） |
| `/c4a:analyze` | 一致性检查 |
| `/c4a:implement` | 实现代码辅助 |

### 知识技能 Skills

| Skill | 用途 |
|-------|------|
| `/c4a:know:learn` | 快速录入知识 |
| `/c4a:know:search` | 搜索知识库 |

### CLI Commands

- `c4a init` - 初始化项目
- `c4a install` - 安装并配置工作模式
- `c4a sync` - 同步知识到数据库
- `c4a status` - 查看状态
- `c4a validate` - 验证 DSL 文件
