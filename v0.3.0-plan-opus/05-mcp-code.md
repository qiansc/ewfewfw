# Part 05: MCP Code 工具

> 详细执行计划 - 基于 `v0.3.0/detailed-design/mcp/code.md`

---

## 任务清单

| # | 功能 | [ ] | 描述 |
|---|------|:---:|------|
| 5.1 | c4a_extract_interfaces 输入参数 | [x] | path/language/recursive/include/exclude 参数定义 + 文件数量软限制 |
| 5.2 | c4a_extract_interfaces 返回结果 | [x] | files/interfaces/errors 返回结构 |
| 5.3 | ExtractedInterface 类型 | [x] | name/kind/file/line/exported/properties/methods |
| 5.4 | c4a_extract_analyze 输入参数 | [x] | path/language/includeMetrics/includeDependencies/summary_only/limit/offset |
| 5.5 | c4a_extract_analyze 返回结果 | [x] | files/summary/errors/pagination 返回结构 |
| 5.6 | CodeAnalysis 类型 | [x] | file/language/lines/linesOfCode/functions/classes/interfaces/imports/exports |
| 5.7 | c4a_extract_ast 输入参数 | [x] | path/language/maxDepth/nodeTypes 参数定义 |
| 5.8 | c4a_extract_ast 返回结果 | [x] | file/language/ast 返回结构 |
| 5.9 | ASTNode 类型 | [x] | type/name/children/location 递归结构 |
| 5.10 | c4a_extract_contract 输入参数 | [x] | path/format/version/title/description/baseUrl 参数定义 |
| 5.11 | c4a_extract_contract 返回结果 | [x] | format/version/content/endpoints/schemas 返回结构 |
| 5.12 | MCP Server 注册 | [x] | 4 个工具注册到 c4a-extract-mcp Server |
| 5.13 | TypeScript 解析器 | [x] | 使用 typescript 编译器 API 解析 TS/JS |
| 5.14 | Go 解析器 | [x] | 使用 tree-sitter-go 解析 Go（需验证 Bun 兼容性） |
| 5.15 | Python 解析器 | [x] | 使用 tree-sitter-python 解析 Python（需验证 Bun 兼容性） |
| 5.16 | 语言自动检测 | [x] | 根据文件扩展名自动检测语言 |
| 5.17 | 单元测试 | [x] | 各工具基本功能测试 |
| 5.18 | 接口一致性验证 | [x] | 对照 mcp/code.md 验证现有实现的接口一致性 |
| 5.19 | Docker 模式文件访问 | [x] | 配置 /workspace 卷挂载，限制可分析路径 |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 5.1-5.3 | c4a_extract_interfaces | `mcp/code.md` | §2.1 extract | L3-15 | [x] | [x] |
| 5.4-5.6 | c4a_extract_analyze | `mcp/code.md` | §2.2 analyze | L16-32 | [x] | [x] |
| 5.7-5.9 | c4a_extract_ast | `mcp/code.md` | §2.3 ast | L34-45 | [x] | [x] |
| 5.10-5.11 | c4a_extract_contract | `mcp/code.md` | §2.4 contract | L46-60 | [x] | [x] |
| - | Tree-sitter WASM 配置 | `mcp/code.md` | §2.5 wasm | L62-72 | [x] | [x] |
| 5.12 | 工具分组 | `mcp/overview.md` | §1.1 工具分组 | L9-18 | [x] | [x] |
| 5.12 | 核心工具 | `mcp/overview.md` | §1.2 核心工具 | L24-46 | [x] | [x] |
| 5.12 | 辅助工具 | `mcp/overview.md` | §1.2 辅助工具 | L48-58 | [x] | [x] |
| 5.18 | 接口一致性验证 | `mcp/code.md` | 全文 | - | [x] | [x] |
| 5.19 | Docker 文件访问 | `architecture.md` | §1.1 模式对比 | L40-76 | [x] | [x] |
| - | Extract MCP 本地运行 | `architecture.md` | §1.1 模式对比 | L40-76 | [x] | [x] |
| - | 知识生命周期 Extract | `architecture.md` | §1.3 知识生命周期 | L96-115 | [x] | [x] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| MCP Server | `packages/mcp-extract/src/server.ts` | MCP Server 工厂函数（待重命名 mcp-extract） | [x] |
| 入口文件 | `packages/mcp-extract/src/index.ts` | 模块入口（待重命名 mcp-extract） | [x] |
| Schema 定义 | `packages/mcp-extract/src/schemas/inputSchemas.ts` | Zod Schema 定义（待重命名 mcp-extract） | [x] |
| 工具实现 | `packages/mcp-extract/src/tools/extract.ts` | c4a_extract_interfaces 实现 | [x] |
| 工具实现 | `packages/mcp-extract/src/tools/analyze.ts` | c4a_extract_analyze 实现 | [x] |
| 工具实现 | `packages/mcp-extract/src/tools/ast.ts` | c4a_extract_ast 实现 | [x] |
| 工具实现 | `packages/mcp-extract/src/tools/contract.ts` | c4a_extract_contract 实现 | [x] |
| 工具导出 | `packages/mcp-extract/src/tools/index.ts` | 工具统一导出（待重命名 mcp-extract） | [x] |
| 解析器 | `packages/mcp-extract/src/parsers/codeParser.ts` | 解析入口 + 语言路由（待重命名 mcp-extract） | [x] |
| 解析器 | `packages/mcp-extract/src/parsers/typescriptParser.ts` | TypeScript 解析（compiler API）（待重命名 mcp-extract） | [x] |
| 解析器 | `packages/mcp-extract/src/parsers/goParser.ts` | Go 解析（待重命名 mcp-extract） | [x] |
| 解析器 | `packages/mcp-extract/src/parsers/pythonParser.ts` | Python 解析（待重命名 mcp-extract） | [x] |
| 解析器 | `packages/mcp-extract/src/parsers/astBuilder.ts` | 简化 AST 生成（待重命名 mcp-extract） | [x] |
| 解析器 | `packages/mcp-extract/src/parsers/metrics.ts` | 代码指标统计（待重命名 mcp-extract） | [x] |
| 解析器 | `packages/mcp-extract/src/parsers/treeSitter.ts` | Tree-sitter 加载与缓存（待重命名 mcp-extract） | [x] |
| 解析器导出 | `packages/mcp-extract/src/parsers/index.ts` | 解析器统一导出（待重命名 mcp-extract） | [x] |
| 类型定义 | `packages/mcp-extract/src/types/index.ts` | 类型定义（包内自包含）（待重命名 mcp-extract） | [x] |
| 单元测试 | `packages/mcp-extract/src/__tests__/smoke.test.ts` | 冒烟测试（待重命名 mcp-extract） | [x] |

> **说明**：mcp-code 包已有基础实现，需对照设计文档验证接口一致性。Part 03.5 将重命名为 mcp-extract。

---

## 依赖关系

- **无前置依赖，独立模块**
- 不依赖 `@c4a/storage`（不访问数据库）
- 不依赖 `@c4a/core`（类型定义在 mcp-code 包内自包含，待重命名 mcp-extract）
- 被 Part 10 Skills 依赖（/c4a:plan 调用 c4a_extract_analyze）

---

## 实现注意事项

### Native 模块兼容性

| 模块 | 用途 | Bun 兼容性 | 备选方案 |
|------|------|-----------|----------|
| typescript | TS/JS 解析 | ✅ 纯 JS | - |
| web-tree-sitter | Tree-sitter Core (WASM) | ✅ 纯 JS/WASM | - |
| tree-sitter-go.wasm | Go 解析 | ✅ WASM | 正则解析（降级） |
| tree-sitter-python.wasm | Python 解析 | ✅ WASM | 正则解析（降级） |

**验证步骤**：实现前需验证 tree-sitter 在 Bun 下的兼容性，如不兼容需寻找替代方案。

### Tree-sitter WASM 配置

- 默认内置（`packages/mcp-extract/wasm/`）：
  - `tree-sitter.wasm`（core）
  - `tree-sitter-go.wasm`
  - `tree-sitter-python.wasm`
- 环境变量覆盖：
  - `C4A_TREE_SITTER_GO_WASM` / `C4A_TREE_SITTER_PYTHON_WASM`：指定单个语言 wasm 的绝对路径
  - `C4A_TREE_SITTER_WASM_DIR`：统一指定 wasm 目录（自动拼接文件名）
- 查找顺序：语言专用 env → `C4A_TREE_SITTER_WASM_DIR` → 包内 `wasm/` → 已安装包内候选目录
- Go/Python 解析在 WASM 不可用时会降级到正则解析，并在结果 `warnings` 中提示

### 大文件处理

- analyze 工具需要处理大型代码库
- 建议实现：文件数量限制 + 分页参数（limit/offset）
- 默认限制：单次最多分析 100 个文件
- extract 增加软限制：扫描超过 1000 文件时返回警告

### AST 深度控制

- ast 工具支持 `maxDepth` / `nodeTypes` 参数用于裁剪返回结构
- 大文件（>10000 行）建议降低 maxDepth，避免内存压力

### Docker 模式文件访问

Code MCP 在 Docker 模式下的文件访问策略：

| 策略 | 说明 |
|------|------|
| **卷挂载（推荐）** | 宿主机代码挂载到 `/workspace`，path 参数限制为此目录 |
| 路径验证 | 拒绝 `/workspace` 外的路径，防止容器逃逸 |
| 默认 exclude | 自动排除 `node_modules/**`, `.git/**`, `dist/**` |

**配置示例**（仅路径限制；如需容器化也必须保持 stdio 本地运行）：
```yaml
# 仅示例卷挂载与路径限制（不建议以 HTTP 服务暴露）
volumes:
  - ${PROJECT_PATH:-./}:/workspace:ro
environment:
  - C4A_EXTRACT_ROOT=/workspace
```

---

## 验收标准

- [x] 4 个 MCP 工具注册到 Server
- [x] 输入参数与设计文档一致
- [x] 返回结果与设计文档一致
- [x] TypeScript/Go/Python 解析器可用
- [x] 语言自动检测正确
- [x] 单元测试通过
- [x] `./start.sh debug:code` 可启动

---

## 最终验证（提交前必须执行）

**参考设计文档：**
- `v0.3.0/detailed-design/mcp/code.md` (全文)
- `v0.3.0/detailed-design/mcp/overview.md` §1.1-1.2
- `v0.3.0/architecture.md` §1.1, §1.3

**Review 流程：**
1. 运行 `bun run lint` 验证类型（tsc --noEmit）
2. 运行 `bun test` 验证测试
3. 打开 `v0.3.0/detailed-design/mcp/code.md` 逐行对照检查
4. 确认每个工具的输入参数和返回结果与设计文档完全一致
