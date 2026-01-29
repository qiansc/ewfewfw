# 知识采集类：`c4a_extract_*`（c4a-extract-mcp）

## 2.1 `c4a_extract_interfaces`（从代码中提取接口/类型/类）

- **输入**
  - `path: string`：文件或目录
  - `language?: "typescript" | "go" | "python"`：语言提示（可选）
  - `recursive?: boolean = false`：递归处理目录（可选）
  - `include?: string[]`：包含 glob（可选）
  - `exclude?: string[]`：排除 glob（可选）
- **返回（JSON）**
  - `files: number`
  - `interfaces: ExtractedInterface[]`
  - `errors: { file: string; error: string }[]`

## 2.2 `c4a_extract_analyze`（分析代码结构与依赖）

- **输入**
  - `path: string`
  - `language?: "typescript" | "go" | "python"`
  - `includeMetrics?: boolean = true`
  - `includeDependencies?: boolean = true`
  - `summary_only?: boolean = false`：仅返回统计摘要，不返回文件详情（大型项目推荐）
  - `limit?: number = 100`：返回文件详情数量上限
  - `offset?: number = 0`：分页偏移量
- **返回（JSON）**
  - `files?: CodeAnalysis[]`：文件详情（`summary_only=true` 时不返回）
  - `summary: { totalFiles; totalLines; totalLinesOfCode; totalFunctions; totalClasses; totalInterfaces; languages; dependencies }`
  - `errors: { file: string; error: string }[]`
  - `pagination?: { total: number; offset: number; limit: number; has_more: boolean }`

> **大型项目建议**：对于 Monorepo（数千文件），建议先用 `summary_only=true` 获取统计，再按需分页获取文件详情。

## 2.3 `c4a_extract_ast`（获取 AST）

- **输入**
  - `path: string`
  - `language?: "typescript" | "go" | "python"`
  - `maxDepth?: number = 10`
  - `nodeTypes?: string[]`
- **返回（JSON）**
  - `file: string`
  - `language: string`
  - `ast: ASTNode`

## 2.4 `c4a_extract_contract`（生成契约：OpenAPI/AsyncAPI/Proto）

- **输入**
  - `path: string`
  - `format?: "openapi" | "asyncapi" | "proto" = "openapi"`
  - `version?: string = "3.0.0"`
  - `title?: string`
  - `description?: string`
  - `baseUrl?: string`
- **返回（JSON）**
  - `format: string`
  - `version: string`
  - `content: string`：契约文本（JSON/YAML/Proto，取决于 format）
  - `endpoints: { path: string; method: string; operationId?: string; summary?: string }[]`
  - `schemas: string[]`

## 2.5 Tree-sitter WASM 配置（Go/Python 解析）

- **内置 WASM 文件**
  - `packages/mcp-extract/wasm/tree-sitter.wasm`（core）
  - `packages/mcp-extract/wasm/tree-sitter-go.wasm`
  - `packages/mcp-extract/wasm/tree-sitter-python.wasm`
- **环境变量覆盖**
  - `C4A_TREE_SITTER_GO_WASM` / `C4A_TREE_SITTER_PYTHON_WASM`：指定单语言 wasm 绝对路径
  - `C4A_TREE_SITTER_WASM_DIR`：指定 wasm 目录（自动拼接文件名）
- **查找顺序**：语言专用 env → `C4A_TREE_SITTER_WASM_DIR` → 包内 `wasm/` → 已安装包内候选目录
- **降级策略**：当 WASM 不可用时，Go/Python 解析降级为正则解析，并在结果 `warnings` 中提示
