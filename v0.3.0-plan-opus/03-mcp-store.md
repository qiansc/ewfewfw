# Part 03: MCP Store 工具 - 执行规划

> 基于 v0.3.0-plan-opus/summary.md 和代码分析

---

## 一、当前状态总结

### 1.1 已完成的任务

| 任务 | 描述 | 实现位置 | 状态 |
|------|------|---------|------|
| 3.1-3.17 | CRUD/Sync/Feat 工具 | `packages/cli/src/mcp/store/*.ts` | ✅ 已完成 |
| 3.18 | 并发修改预警 | `packages/storage/src/lite-adapter/crud-save.ts` L175-220 | ✅ 已实现 |
| 3.19 | 引用完整性预警 | `packages/storage/src/lite-adapter/crud-read.ts` L241-292 | ✅ 已实现 |
| 3.20 | c4a_store_read_history | `packages/storage/src/lite-adapter/utilsHistory.ts` | ✅ 已实现 |
| 3.21 | c4a_store_backup/restore | `packages/storage/src/lite-adapter/utilsBackup.ts` / `packages/storage/src/lite-adapter/utilsRestore.ts` | ✅ 已实现 |
| 3.22 | c4a_store_repair | `packages/storage/src/lite-adapter/utilsRepair.ts` | ✅ 已实现 |
| 3.23 | c4a_store_validate | `packages/storage/src/lite-adapter/utilsValidate.ts` | ✅ 已实现 |

### 1.2 待完成的任务

已全部完成。

---

## 二、3.24 移除 Legacy 接口 - 详细分析

### 2.1 Legacy 接口分布

| 文件 | 引用数量 | 类型 |
|------|---------|------|
| `ARCHITECTURE.md` | 9 | 文档 |
| `prompts/c4a.md` | 18 | Prompt |
| `prompts/AGENTS.md` | 2 | Prompt |
| `prompts/skills/c4a-adr-draft.md` | 2 | Skill |
| `prompts/skills/c4a-adr-review.md` | 12 | Skill |
| `.claude/settings.json` | 9 | 配置 |
| `.env.example` | 2 | 环境变量 |

### 2.2 接口映射表

| 旧接口 | 新接口 | 说明 |
|--------|--------|------|
| `legacy_save_entity` | `c4a_store_save` | 保存实体 |
| `legacy_get_entity` | `c4a_store_read` | 读取实体 |
| `legacy_delete_entity` | `c4a_store_delete` | 删除实体 |
| `legacy_search_semantic` | `c4a_query_search` | 语义搜索 (Part 04) |
| `legacy_query_deps` | `c4a_query_deps` | 依赖查询 (Part 04) |
| `legacy_query_impact` | `c4a_query_impact` | 影响分析 (Part 04) |
| `legacy_exec_cypher` | 移除 | 不再暴露原生查询 |
| `legacy_sync_file` | `c4a_store_sync` | 同步单文件 |
| `legacy_sync_local` | `c4a_store_sync` | 批量同步 |

---

## 三、执行计划

### 阶段 1: 验证现有实现 (只读)

- [x] 1.1 验证 MCP 工具注册完整性 (`server.ts`)
- [x] 1.2 验证 3.18 并发修改预警与设计文档一致
- [x] 1.3 验证 3.19 引用完整性预警与设计文档一致
- [x] 1.4 验证 Utils 工具实现与设计文档一致

### 阶段 2: 移除 Legacy 接口

- [x] 2.1 更新 `ARCHITECTURE.md` - 替换 legacy 接口为新接口
- [x] 2.2 更新 `prompts/c4a.md` - 替换所有 legacy 引用
- [x] 2.3 更新 `prompts/AGENTS.md` - 替换同步说明
- [x] 2.4 更新 `prompts/skills/c4a-adr-draft.md`
- [x] 2.5 更新 `prompts/skills/c4a-adr-review.md`
- [x] 2.6 更新 `.claude/settings.json` - 移除旧工具权限（已确认无残留）
- [x] 2.7 更新 `.env.example` - 更新注释
- [x] 2.8 全局搜索验证无 legacy 接口残留

### 阶段 3: 更新进度文档

- [x] 3.1 更新 `summary.md` 中 3.18-3.24 为 `[x]`
- [x] 3.2 更新相关设计文档表格的"已实现"列

---

## 四、并行工作方案

### 方案 A: 双 Agent 并行（推荐）

```
Agent 1 (文档更新):
├── 2.1 ARCHITECTURE.md
├── 2.2 prompts/c4a.md
├── 2.3 prompts/AGENTS.md
├── 2.4 prompts/skills/c4a-adr-draft.md
└── 2.5 prompts/skills/c4a-adr-review.md

Agent 2 (配置 + 收尾):
├── 2.6 .claude/settings.json
├── 2.7 .env.example
├── 2.8 全局验证
├── 3.1 summary.md
└── 3.2 设计文档表格
```

**依赖关系**: Agent 1 和 Agent 2 无依赖，可完全并行

### 方案 B: 单 Agent 顺序执行

按阶段顺序执行所有任务，适合需要严格控制的场景。

---

## 五、关键文件清单

### 需要修改的文件

| 文件 | 修改类型 | 优先级 |
|------|---------|--------|
| `ARCHITECTURE.md` | 替换接口名称 | P0 |
| `prompts/c4a.md` | 替换接口名称 | P0 |
| `prompts/AGENTS.md` | 替换接口名称 | P1 |
| `prompts/skills/c4a-adr-draft.md` | 替换接口名称 | P1 |
| `prompts/skills/c4a-adr-review.md` | 替换接口名称 | P1 |
| `.claude/settings.json` | 移除旧权限 | P0 |
| `.env.example` | 更新注释 | P2 |
| `v0.3.0-plan-opus/summary.md` | 更新完成状态 | P0 |

### 只读验证的文件

| 文件 | 验证内容 |
|------|---------|
| `packages/cli/src/mcp/server.ts` | 工具注册完整性 |
| `packages/storage/src/lite-adapter/crud-save.ts` | 并发预警实现 |
| `packages/storage/src/lite-adapter/crud-read.ts` | 引用预警实现 |
| `packages/storage/src/lite-adapter/utils*.ts` | Utils 工具实现 |

---

## 六、验证方法

### 6.1 功能验证

```bash
# 类型检查
bun run typecheck

# 单元测试
bun run test

# 构建验证
bun run build
```

### 6.2 Legacy 接口清理验证

```bash
# 确认无残留
rg --glob="*.md" --glob="*.json" --glob="*.ts" "legacy_"
```

### 6.3 MCP 工具验证

```bash
# 启动 MCP 服务测试
./start.sh debug:code
```

---

## 七、风险与注意事项

1. **Prompt 文件修改**: 可能影响 Agent 行为，需要仔细测试
2. **配置文件兼容性**: `.claude/settings.json` 修改需确保不影响现有工作流
3. **Query 工具**: `c4a_query_*` 属于 Part 04，本阶段仅更新文档引用
4. **legacy_exec_cypher**: 完全移除，不提供替代接口

---

## 八、预计工作量

| 阶段 | 任务数 | 说明 |
|------|--------|------|
| 阶段 1 验证 | 4 | 只读检查 |
| 阶段 2 移除 Legacy | 8 | 主要工作 |
| 阶段 3 更新文档 | 2 | 收尾 |
| **总计** | **14** | - |

---

## 九、执行建议

**推荐方案**: 方案 A (双 Agent 并行)

理由:
1. 文档更新和配置更新相互独立
2. 可以加快执行速度
3. 任务边界清晰，不会产生冲突
