# ADR-003 组件-代码映射

本文档记录 ADR-003 涉及的三个 MCP Server 的组件与代码文件的对应关系。

## 📊 映射概览

| Container | 组件数 | 代码文件数 | 主要语言 |
|-----------|--------|-----------|---------|
| c4a-dsl-mcp | 6 | 17 | TypeScript |
| c4a-code-mcp | 5 | 11 | TypeScript |
| c4a-data-mcp | 5 | ~10 | Python |

---

## 1. c4a-dsl-mcp 组件映射

### dsl-parser
- **职责**: DSL 解析
- **代码**: `packages/mcp-dsl/src/tools/parse.ts`
- **依赖**: `@c4a/core.parseDSL`

### dsl-validator
- **职责**: DSL 验证
- **代码**: `packages/mcp-dsl/src/tools/validate.ts`
- **依赖**: `@c4a/core.validateDSL`

### dsl-generator
- **职责**: DSL 生成
- **代码**: `packages/mcp-dsl/src/tools/generate.ts`
- **依赖**: `template-manager`

### template-manager
- **职责**: 模板管理
- **代码**: `packages/mcp-dsl/src/templates/index.ts`
- **函数**: `getTemplate`, `renderTemplate`

### schema-provider
- **职责**: Schema 提供
- **代码**: `packages/mcp-dsl/src/tools/schema.ts`
- **数据**: `packages/core/src/schemas/*.json`

### local-storage
- **职责**: 本地存储管理
- **代码目录**: `packages/mcp-dsl/src/tools/storage/`
- **文件列表**:
  - `init.ts` → `initHandler`
  - `list.ts` → `listHandler`
  - `read.ts` → `readHandler`
  - `write.ts` → `writeHandler`
  - `transition.ts` → `transitionHandler`

---

## 2. c4a-code-mcp 组件映射

### code-parser
- **职责**: 代码解析核心
- **代码**: `packages/mcp-code/src/parsers/codeParser.ts`
- **行数**: ~950 行
- **支持语言**: TypeScript, Go, Python
- **函数**: `parseFile`, `detectLanguage`, `extractAST`

### code-analyzer
- **职责**: 代码结构分析
- **代码**: `packages/mcp-code/src/tools/analyze.ts`
- **依赖**: `code-parser`, `fast-glob`
- **函数**: `analyze`

### interface-extractor
- **职责**: 接口提取
- **代码**: `packages/mcp-code/src/tools/extract.ts`
- **依赖**: `code-parser`, `fast-glob`
- **函数**: `extract`

### contract-generator
- **职责**: API 契约生成
- **代码**: `packages/mcp-code/src/tools/contract.ts`
- **行数**: ~470 行
- **支持格式**: OpenAPI 3.0, AsyncAPI, Proto

### ast-provider
- **职责**: AST 提供
- **代码**: `packages/mcp-code/src/tools/ast.ts`
- **函数**: `getAST`

---

## 3. c4a-data-mcp 组件映射

### data-service
- **职责**: 数据服务核心
- **代码**: `packages/mcp-data/c4a_data_mcp/services/data_service.py`
- **协调**: mongodb-client, neo4j-client, milvus-client

### mongodb-client
- **职责**: 文档存储
- **代码**: `packages/mcp-data/c4a_data_mcp/clients/mongodb_client.py`
- **驱动**: motor (async)

### neo4j-client
- **职责**: 图关系存储
- **代码**: `packages/mcp-data/c4a_data_mcp/clients/neo4j_client.py`
- **驱动**: neo4j-driver

### milvus-client
- **职责**: 向量存储
- **代码**: `packages/mcp-data/c4a_data_mcp/clients/milvus_client.py`
- **驱动**: pymilvus

### embedder
- **职责**: 文本向量化
- **代码**: 
  - `packages/mcp-data/c4a_data_mcp/clients/embedder.py`
  - `packages/mcp-data/c4a_data_mcp/clients/embedding_service.py`

---

## 📈 代码指标摘要

### c4a-dsl-mcp
```
总文件数: 17
总代码行: 1,443
函数数: 29
接口数: 7
主要依赖: @c4a/core, yaml, zod
```

### c4a-code-mcp
```
总文件数: 11
总代码行: 2,049
函数数: 47
接口数: 19
主要依赖: fast-glob, zod
```

---

## 🔗 组件依赖图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          c4a-dsl-mcp                                │
│  ┌─────────────┐   ┌──────────────┐   ┌────────────────┐           │
│  │ dsl-parser  │──▶│ dsl-validator│   │ schema-provider│           │
│  └─────────────┘   └──────────────┘   └────────────────┘           │
│         │                  │                   │                    │
│         ▼                  ▼                   ▼                    │
│  ┌─────────────────────────────────────────────────────┐           │
│  │                    @c4a/core                         │           │
│  └─────────────────────────────────────────────────────┘           │
│  ┌───────────────┐   ┌──────────────────────┐                      │
│  │ dsl-generator │──▶│  template-manager    │                      │
│  └───────────────┘   └──────────────────────┘                      │
│  ┌──────────────────────────────────────────┐                      │
│  │            local-storage                  │──▶ dsl-validator    │
│  └──────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          c4a-code-mcp                               │
│  ┌─────────────┐                                                   │
│  │ code-parser │◀──┬──────────────────────────────────────────┐    │
│  └─────────────┘   │                                          │    │
│         ▲          │                                          │    │
│         │    ┌─────┴────────┐  ┌──────────────────┐  ┌───────┴──┐ │
│         └────│code-analyzer │  │interface-extractor│  │ast-provider│
│              └──────────────┘  └──────────────────┘  └──────────┘ │
│                    │                                               │
│              ┌─────┴───────────┐                                   │
│              │contract-generator│                                   │
│              └─────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          c4a-data-mcp                               │
│                    ┌─────────────────┐                              │
│                    │   data-service   │                              │
│                    └────────┬────────┘                              │
│           ┌─────────────────┼─────────────────┐                     │
│           ▼                 ▼                 ▼                     │
│  ┌────────────────┐ ┌─────────────┐ ┌─────────────────┐            │
│  │ mongodb-client │ │neo4j-client │ │  milvus-client  │            │
│  └────────────────┘ └─────────────┘ └────────┬────────┘            │
│                                              │                      │
│                                     ┌────────▼────────┐            │
│                                     │    embedder     │            │
│                                     └─────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📝 维护说明

1. **更新时机**: 当组件职责或代码位置变更时，需同步更新此映射
2. **自动化**: 可通过 `c4a_code_analyze` 工具重新生成代码指标
3. **验证**: 定期检查组件定义与代码实现的一致性

