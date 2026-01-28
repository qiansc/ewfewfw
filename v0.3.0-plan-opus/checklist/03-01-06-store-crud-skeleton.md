# Part 03 验收清单: Store CRUD 工具骨架实现

**任务范围:** 3.1 - 3.6
**设计文档:** `v0.3.0/detailed-design/mcp/overview.md`, `v0.3.0/detailed-design/mcp/store-crud.md`
**验收时间:** 2026-01-26 17:30

---

## 1. 设计文档逐节对照

### §1.1 工具分组 (overview.md L1-18)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| Store 工具前缀 `c4a_store_*` | L14 | `storeSchemas.ts` | L1-300 | [x] |
| 工具分组定义 | L12-17 | `server.ts` | L354-474 | [x] |

**本节验收结果:** [x] 通过

---

### §1.2 可见性分层 (overview.md L20-79)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| 核心工具：c4a_store_save | L32 | `server.ts` | L356-384 | [x] |
| 核心工具：c4a_store_read | L33 | `server.ts` | L386-414 | [x] |
| 核心工具：c4a_store_list | L34 | `server.ts` | L416-444 | [x] |
| 核心工具：c4a_store_delete | L35 | `server.ts` | L446-474 | [x] |

**本节验收结果:** [x] 通过

---

### §1.3-1.5 规范详情 (overview.md L82-179)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| proposal_id 格式验证 | L85-92 | `storeSchemas.ts` | L33-39 | [x] |
| source_project 参数 | L94-101 | `storeSchemas.ts` | L56 | [x] |
| 错误响应格式 ErrorResponse | L108-133 | `storeSchemas.ts` | L234-243 | [x] |
| RecoverableAction 定义 | L128-132 | `storeSchemas.ts` | L228-232 | [x] |

**本节验收结果:** [x] 通过

---

### §3.1 c4a_store_save (store-crud.md L1-156)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| 输入参数 type | L6 | `storeSchemas.ts` | L43 | [x] |
| 输入参数 data/content 二选一 | L7-9 | `storeSchemas.ts` | L44-46, L66-76 | [x] |
| 输入参数 format | L9 | `storeSchemas.ts` | L47 | [x] |
| 输入参数 id | L10 | `storeSchemas.ts` | L48 | [x] |
| 输入参数 source_project | L11-16 | `storeSchemas.ts` | L49 | [x] |
| 输入参数 proposal_id | L17-19 | `storeSchemas.ts` | L50 | [x] |
| 输入参数 enforce_adr | L20 | `storeSchemas.ts` | L51 | [x] |
| 输入参数 skip_adr_check | L21 | `storeSchemas.ts` | L52 | [x] |
| 输入参数 ignore_concurrent_warning | L22 | `storeSchemas.ts` | L53 | [x] |
| 输入参数 force_save | L23 | `storeSchemas.ts` | L54 | [x] |
| 返回结果 success | L25 | `storeSchemas.ts` | L99 | [x] |
| 返回结果 id | L26 | `storeSchemas.ts` | L100 | [x] |
| 返回结果 status | L27 | `storeSchemas.ts` | L101 | [x] |
| 返回结果 adr_check | L28 | `storeSchemas.ts` | L102 | [x] |
| 返回结果 warnings | L29 | `storeSchemas.ts` | L103 | [x] |
| Warning 类型定义 | L64-81 | `storeSchemas.ts` | L82-87 | [x] |
| AdrCheckResult 类型定义 | L28 | `storeSchemas.ts` | L92-97 | [x] |
| 工具处理函数 storeSaveHandler | - | `save.ts` | L1-26 | [x] |
| 工具注册到 server | - | `server.ts` | L356-384 | [x] |

**本节验收结果:** [x] 通过

---

### §3.2 c4a_store_read (store-crud.md L158-243)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| 输入参数 id | L160 | `storeSchemas.ts` | L110 | [x] |
| 输入参数 format | L161-163 | `storeSchemas.ts` | L111 | [x] |
| 输入参数 proposal_id | L164-167 | `storeSchemas.ts` | L112-115 | [x] |
| 输入参数 filter | L168 | `storeSchemas.ts` | L116 | [x] |
| 输入参数 limit | L169 | `storeSchemas.ts` | L117 | [x] |
| 输入参数 include_relations | L170 | `storeSchemas.ts` | L118 | [x] |
| 输入参数 filter_relations | L171 | `storeSchemas.ts` | L119 | [x] |
| 返回结果 (format=object) | L173-174 | `storeSchemas.ts` | L125-128 | [x] |
| 返回结果 (format=yaml/json) | L175-183 | `storeSchemas.ts` | L133-139 | [x] |
| 工具处理函数 storeReadHandler | - | `read.ts` | L1-24 | [x] |
| 工具注册到 server | - | `server.ts` | L386-414 | [x] |

**本节验收结果:** [x] 通过

---

### §3.3 c4a_store_list (store-crud.md L244-285)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| 输入参数 filter | L246 | `storeSchemas.ts` | L146 | [x] |
| 输入参数 type | L247 | `storeSchemas.ts` | L147 | [x] |
| 输入参数 project_id | L248 | `storeSchemas.ts` | L148 | [x] |
| 输入参数 proposal_id | L249 | `storeSchemas.ts` | L149-152 | [x] |
| 输入参数 status | L250 | `storeSchemas.ts` | L153 | [x] |
| 输入参数 updated_after | L251 | `storeSchemas.ts` | L154 | [x] |
| 输入参数 limit | L252 | `storeSchemas.ts` | L155 | [x] |
| 输入参数 offset | L253 | `storeSchemas.ts` | L156 | [x] |
| 输入参数 group_by | L254 | `storeSchemas.ts` | L157 | [x] |
| 输入参数 count_only | L255 | `storeSchemas.ts` | L158 | [x] |
| EntitySummary 类型定义 | L262-272 | `storeSchemas.ts` | L164-171 | [x] |
| Pagination 类型定义 | L273 | `storeSchemas.ts` | L176-181 | [x] |
| 返回结果 (count_only=false) | L256-275 | `storeSchemas.ts` | L186-189 | [x] |
| 返回结果 (count_only=true) | L257-260 | `storeSchemas.ts` | L194-198 | [x] |
| 返回结果 (group_by 指定) | L276 | `storeSchemas.ts` | L203-209 | [x] |
| 工具处理函数 storeListHandler | - | `list.ts` | L1-26 | [x] |
| 工具注册到 server | - | `server.ts` | L416-444 | [x] |

**本节验收结果:** [x] 通过

---

### §3.4 c4a_store_delete (store-crud.md L286-361)

| 设计项 | 行号 | 实现文件 | 实现行号 | 状态 |
|--------|------|----------|----------|:----:|
| 输入参数 id | L288 | `storeSchemas.ts` | L216 | [x] |
| 输入参数 proposal_id | L289 | `storeSchemas.ts` | L217 | [x] |
| 输入参数 force | L290 | `storeSchemas.ts` | L218 | [x] |
| 返回结果 success | L292 | `storeSchemas.ts` | L224 | [x] |
| 返回结果 id | L293 | `storeSchemas.ts` | L225 | [x] |
| 返回结果 deleted_relations | L294 | `storeSchemas.ts` | L226 | [x] |
| 工具处理函数 storeDeleteHandler | - | `delete.ts` | L1-24 | [x] |
| 工具注册到 server | - | `server.ts` | L446-474 | [x] |

**本节验收结果:** [x] 通过

---

## 2. 自动化验证

```bash
# 执行以下命令并记录结果
cd packages/mcp-dsl
bun run lint
```

| 验证项 | 命令 | 结果 | 状态 |
|--------|------|------|:----:|
| 类型检查 | `bun run lint` | 通过，无错误 | [x] |

---

## 3. 完整性检查

- [x] 设计文档中定义的所有类型都已实现
- [x] 设计文档中定义的所有字段都已实现
- [x] 设计文档中定义的所有工具都已实现
- [x] 所有新增 Schema 已在 storeSchemas.ts 中定义
- [x] 所有新增工具已在 server.ts 中注册
- [x] 所有工具处理函数已创建（骨架实现）
- [x] 无遗漏、无多余实现

---

## 4. 实现产物清单

| 文件类型 | 文件路径 | 说明 | 状态 |
|---------|---------|------|:----:|
| Schema 定义 | `packages/mcp-dsl/src/schemas/storeSchemas.ts` | Store 工具的输入输出类型定义 | [x] |
| 工具实现 | `packages/mcp-dsl/src/tools/store/save.ts` | c4a_store_save 骨架实现 | [x] |
| 工具实现 | `packages/mcp-dsl/src/tools/store/read.ts` | c4a_store_read 骨架实现 | [x] |
| 工具实现 | `packages/mcp-dsl/src/tools/store/list.ts` | c4a_store_list 骨架实现 | [x] |
| 工具实现 | `packages/mcp-dsl/src/tools/store/delete.ts` | c4a_store_delete 骨架实现 | [x] |
| 工具导出 | `packages/mcp-dsl/src/tools/store/index.ts` | Store 工具统一导出 | [x] |
| 服务注册 | `packages/mcp-dsl/src/server.ts` | 在 MCP Server 中注册 Store 工具 | [x] |

---

## 5. 验收结论

- **验收人:** AI Agent (Claude Opus 4.5)
- **验收时间:** 2026-01-26 17:30
- **结果:** [x] 通过
- **完成度:** 骨架实现完成，类型定义完整，工具注册正确
- **遗留问题:**
  - 工具处理函数为骨架实现，需要后续补充具体业务逻辑
  - 需要实现与 Python 服务层（mcp-data）的交互
  - 需要实现 ADR 检查、并发修改检查、引用解析等副作用逻辑
- **下一步:**
  - 继续实现 3.7-3.10（Store Sync 工具）
  - 或者先实现 Store CRUD 工具的具体业务逻辑

---

## 6. 设计文档对照总结

本次实现严格遵循设计文档：
- `v0.3.0/detailed-design/mcp/overview.md` §1.1-1.5
- `v0.3.0/detailed-design/mcp/store-crud.md` §3.1-3.4

所有设计文档中定义的：
- ✅ 工具名称与设计文档一致
- ✅ 输入参数完整且类型正确
- ✅ 返回格式符合规范
- ✅ 错误响应结构符合标准
- ✅ proposal_id 格式验证正确
- ✅ 工具可见性分层正确

**验收通过，可以继续下一阶段任务。**
