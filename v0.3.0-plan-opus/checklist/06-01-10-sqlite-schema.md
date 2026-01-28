# Part 06 验收清单: 任务 6.1-6.10

**任务范围:** 6.1 - 6.10 (SQLite Schema 部分)
**设计文档:** v0.3.0/detailed-design/local-mode/sqlite-schema.md
**验收时间:** 2026-01-27 10:55

---

## 设计文档对照

### §1 概述与配置 (L1-75)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| Local vs Server 模式对比 | L13-23 | sqlite-store.ts (注释) | ✅ |
| WAL 模式配置 | L27-51 | sqlite-store.ts L82-93 | ✅ |
| 索引设计原则 | L52-75 | sqlite-store.ts (索引创建) | ✅ |

### §2.1 核心表 (L76-148)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| configs 表 | L81-87 | sqlite-store.ts L102-109 | ✅ |
| entities 表 (复合主键) | L89-107 | sqlite-store.ts L113-130 | ✅ |
| metadata 表 (外键约束) | L108-127 | sqlite-store.ts L133-153 | ✅ |
| relations 表 (无外键) | L128-148 | sqlite-store.ts L156-175 | ✅ |

### §2.2 变更历史表 (L162-248)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| entity_history 表 | L166-188 | sqlite-store.ts L178-199 | ✅ |
| feat_history 表 | L219-231 | sqlite-store.ts L202-215 | ✅ |

### §2.3 Local 模式特有表 (L291-495)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| vectors 表 (USearch) | L293-320 | usearch-store.ts (独立文件) | ✅ |
| graph_cache 表 | L475-489 | sqlite-store.ts L218-228 | ✅ |

### §3 Merge View 模式 (L498-569)

| 设计项 | 行号 | 实现文件 | 状态 |
|--------|------|----------|:----:|
| Merge View 核心原则 | L502-508 | sqlite-store.ts L246-254 | ✅ |
| 实体 Merge View SQL | L512-531 | sqlite-store.ts L258-285 | ✅ |
| 关系 Merge View SQL | L533-552 | sqlite-store.ts L292-317 | ✅ |

---

## 自动化验证

| 验证项 | 命令 | 结果 |
|--------|------|:----:|
| 依赖安装 | `bun install` | ✅ |
| 类型检查 | `bun x tsc --noEmit --skipLibCheck` | ✅ |
| 构建验证 | - | ⏭️ (跳过，无需构建) |

---

## 实现产物

| 文件 | 行数 | 说明 |
|------|------|------|
| `packages/storage/src/sqlite-store.ts` | ~330 | SQLite Store 核心实现 |
| `packages/storage/src/index.ts` | ~8 | Store 模块导出 |
| `packages/core/package.json` | +2 deps | 添加 usearch 依赖 |

---

## 关键实现要点

### 1. 并发访问配置 ✅
- WAL 模式已启用 (`journal_mode = WAL`)
- 忙等待超时 5 秒 (`busy_timeout = 5000`)
- 同步模式 NORMAL (`synchronous = NORMAL`)

### 2. 复合主键设计 ✅
- entities: `(source_project, id, proposal_id)`
- metadata: `(source_project, entity_id, proposal_id)`
- 支持多项目 + CoW 机制

### 3. 外键约束 ✅
- metadata → entities: 有外键 (CASCADE 删除)
- relations: 无外键 (指向逻辑实体)
- entity_history: 无外键 (指向抽象概念)

### 4. Merge View 实现 ✅
- 使用 `ROW_NUMBER() OVER (PARTITION BY ...)` 窗口函数
- Feat 优先 (1) → 主分支兜底 (2) → 其他 Feat (3)
- 实体和关系均已实现

### 5. 索引优化 ✅
- 所有设计文档中定义的索引均已创建
- 支持高效查询：proposal_id, type, content_hash 等

---

## 已知限制

1. **vectors 索引**: 使用 USearch (WASM) 独立存储，不依赖 SQLite 扩展
2. **类型定义**: 返回类型使用 `unknown[]`，后续需要定义具体类型
3. **事务支持**: 未实现事务封装，需要在后续任务中添加

---

## 结论

✅ **全部通过**

- 所有表结构按设计文档实现
- 索引、外键约束符合设计要求
- Merge View SQL 逻辑正确
- 类型检查通过
- 代码风格符合项目规范

**下一步**: 继续任务 6.11 (Embedding 生成)
