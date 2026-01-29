# Part 05: MCP Code 工具

> 详细执行计划 - 基于 `v0.3.0/detailed-design/mcp/code.md`

---

## 任务清单

| # | 功能 | [ ] | 描述 |
|---|------|:---:|------|
| 5.1 | c4a_code_extract 输入参数 | [x] | path/language/recursive/include/exclude 参数定义 + 文件数量软限制 |
| 5.2 | c4a_code_extract 返回结果 | [x] | files/interfaces/errors 返回结构 |
| 5.3 | ExtractedInterface 类型 | [x] | name/kind/file/line/exported/properties/methods |
| 5.4 | c4a_code_analyze 输入参数 | [x] | path/language/includeMetrics/includeDependencies/summary_only/limit/offset |
| 5.5 | c4a_code_analyze 返回结果 | [x] | files/summary/errors/pagination 返回结构 |
| 5.6 | CodeAnalysis 类型 | [x] | file/language/lines/linesOfCode/functions/classes/interfaces/imports/exports |
| 5.7 | c4a_code_ast 输入参数 | [x] | path/language/maxDepth/nodeTypes/startLine/endLine 参数定义 |
| 5.8 | c4a_code_ast 返回结果 | [x] | file/language/ast 返回结构 |
| 5.9 | ASTNode 类型 | [x] | type/name/children/location 递归结构 |
| 5.10 | c4a_code_contract 输入参数 | [x] | path/format/version/title/description/baseUrl 参数定义 |
| 5.11 | c4a_code_contract 返回结果 | [x] | format/version/content/endpoints/schemas 返回结构 |
| 5.12 | MCP Server 注册 | [x] | 4 个工具注册到 c4a-code-mcp Server |
| 5.13 | TypeScript 解析器 | [x] | 使用 typescript 编译器 API 解析 TS/JS |
| 5.14 | Go 解析器 | [ ] | 使用 tree-sitter-go 解析 Go（需验证 Bun 兼容性） |
| 5.15 | Python 解析器 | [ ] | 使用 tree-sitter-python 解析 Python（需验证 Bun 兼容性） |
| 5.16 | 语言自动检测 | [x] | 根据文件扩展名自动检测语言 |
| 5.17 | 单元测试 | [ ] | 各工具基本功能测试 |
| 5.18 | 接口一致性验证 | [ ] | 对照 mcp/code.md 验证现有实现的接口一致性 |
| 5.19 | Docker 模式文件访问 | [ ] | 配置 /workspace 卷挂载，限制可分析路径 |

---

## 设计文档映射

| # | 功能 | 文件 | 章节 | 行号 | 已读 | 已实现 |
|---|------|------|------|------|:----:|:------:|
| 5.1-5.3 | c4a_code_extract | `mcp/code.md` | §2.1 extract | L3-15 | [ ] | [x] |
| 5.4-5.6 | c4a_code_analyze | `mcp/code.md` | §2.2 analyze | L16-32 | [ ] | [x] |
| 5.7-5.9 | c4a_code_ast | `mcp/code.md` | §2.3 ast | L34-45 | [ ] | [x] |
| 5.10-5.11 | c4a_code_contract | `mcp/code.md` | §2.4 contract | L46-61 | [ ] | [x] |
| 5.12 | 工具分组 | `mcp/overview.md` | §1.1 工具分组 | L9-18 | [ ] | [x] |
| 5.12 | 核心工具 | `mcp/overview.md` | §1.2 核心工具 | L24-46 | [ ] | [x] |
| 5.12 | 辅助工具 | `mcp/overview.md` | §1.2 辅助工具 | L48-58 | [ ] | [x] |
| 5.18 | 接口一致性验证 | `mcp/code.md` | 全文 | - | [ ] | [ ] |
| 5.19 | Docker 文件访问 | `architecture.md` | §1.1 模式对比 | L38-74 | [ ] | [ ] |
| - | Code MCP 本地运行 | `architecture.md` | §1.1 模式对比 | L38-74 | [ ] | [x] |
| - | 知识生命周期 Extract | `architecture.md` | §1.3 知识生命周期 | L92-113 | [ ] | [x] |

---

## 实现产物

| 产物类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| MCP Server | `packages/mcp-code/src/server.ts` | MCP Server 工厂函数 | [x] |
| 入口文件 | `packages/mcp-code/src/index.ts` | 模块入口 | [x] |
| Schema 定义 | `packages/mcp-code/src/schemas/inputSchemas.ts` | Zod Schema 定义 | [x] |
| 工具实现 | `packages/mcp-code/src/tools/extract.ts` | c4a_code_extract 实现 | [x] |
| 工具实现 | `packages/mcp-code/src/tools/analyze.ts` | c4a_code_analyze 实现 | [x] |
| 工具实现 | `packages/mcp-code/src/tools/ast.ts` | c4a_code_ast 实现 | [x] |
| 工具实现 | `packages/mcp-code/src/tools/contract.ts` | c4a_code_contract 实现 | [x] |
| 工具导出 | `packages/mcp-code/src/tools/index.ts` | 工具统一导出 | [x] |
| 解析器 | `packages/mcp-code/src/parsers/codeParser.ts` | 代码解析器（TypeScript 编译器 API） | [x] |
| 解析器导出 | `packages/mcp-code/src/parsers/index.ts` | 解析器统一导出 | [x] |
| 类型定义 | `packages/mcp-code/src/types/index.ts` | 类型定义（包内自包含） | [x] |
| 单元测试 | `packages/mcp-code/src/__tests__/smoke.test.ts` | 冒烟测试 | [ ] |

> **说明**：mcp-code 包已有基础实现，需对照设计文档验证接口一致性。

---

## 依赖关系

- **无前置依赖，独立模块**
- 不依赖 `@c4a/storage`（不访问数据库）
- 不依赖 `@c4a/core`（类型定义在 mcp-code 包内自包含）
- 被 Part 10 Skills 依赖（/c4a:plan 调用 c4a_code_extract）

---

## 实现注意事项

### Native 模块兼容性

| 模块 | 用途 | Bun 兼容性 | 备选方案 |
|------|------|-----------|----------|
| typescript | TS/JS 解析 | ✅ 纯 JS | - |
| tree-sitter-go | Go 解析 | ⚠️ Native | 纯 JS 解析器或 WASM |
| tree-sitter-python | Python 解析 | ⚠️ Native | 纯 JS 解析器或 WASM |

**验证步骤**：实现前需验证 tree-sitter 在 Bun 下的兼容性，如不兼容需寻找替代方案。

### 大文件处理

- analyze 工具需要处理大型代码库
- 建议实现：文件数量限制 + 分页参数（limit/offset）
- 默认限制：单次最多分析 100 个文件
- extract 增加软限制：扫描超过 1000 文件时返回警告

### AST 局部解析

- ast 工具支持 `startLine/endLine` 参数用于局部解析
- 大文件（>10000 行）建议使用范围参数，避免内存压力

### Docker 模式文件访问

Code MCP 在 Docker 模式下的文件访问策略：

| 策略 | 说明 |
|------|------|
| **卷挂载（推荐）** | 宿主机代码挂载到 `/workspace`，path 参数限制为此目录 |
| 路径验证 | 拒绝 `/workspace` 外的路径，防止容器逃逸 |
| 默认 exclude | 自动排除 `node_modules/**`, `.git/**`, `dist/**` |

**配置示例**（docker-compose.yml）：
```yaml
mcp-code:
  volumes:
    - ${PROJECT_PATH:-./}:/workspace:ro
  environment:
    - C4A_CODE_ROOT=/workspace
```

---

## 验收标准

- [ ] 4 个 MCP 工具注册到 Server
- [ ] 输入参数与设计文档一致
- [ ] 返回结果与设计文档一致
- [ ] TypeScript/Go/Python 解析器可用
- [ ] 语言自动检测正确
- [ ] 单元测试通过
- [ ] `./start.sh debug:code` 可启动

---

## 最终验证（提交前必须执行）

**参考设计文档：**
- `v0.3.0/detailed-design/mcp/code.md` (全文)
- `v0.3.0/detailed-design/mcp/overview.md` §1.1-1.2
- `v0.3.0/architecture.md` §1.1, §1.3

**Review 流程：**
1. 运行 `bun run typecheck` 验证类型
2. 运行 `bun test` 验证测试
3. 打开 `v0.3.0/detailed-design/mcp/code.md` 逐行对照检查
4. 确认每个工具的输入参数和返回结果与设计文档完全一致
