# Part 12: 多 Agent 任务分配

> 基于 12-testing-docs.md，按 Agent 职责划分任务

---

## 任务总览

| Agent | 职责 | 任务数 | 依赖 |
|-------|------|--------|------|
| Agent A | 测试基线 | 4 | 无 |
| Agent B | 文档更新 | 4 | 无 |
| Agent C | 用户故事验证 | 6 | Agent A 完成后 |
| Agent D | 集成测试补充 | 4 | Agent A 完成后 |

**并行策略**：Agent A 和 Agent B 可并行执行，Agent C 和 Agent D 在 Agent A 完成后并行执行。

```
┌─────────┐     ┌─────────┐
│ Agent A │     │ Agent B │
│  测试   │     │  文档   │
└────┬────┘     └─────────┘
     │
     ▼
┌─────────┐     ┌─────────┐
│ Agent C │     │ Agent D │
│用户故事 │     │集成测试 │
└─────────┘     └─────────┘
```

---

## Agent A: 测试基线验证

**目标**：确保现有测试全部通过，建立稳定基线。

### 任务清单

- [ ] A.1 运行 TypeScript 全量测试
- [ ] A.2 运行 Python storage-backend 测试
- [ ] A.3 运行类型检查
- [ ] A.4 运行构建验证

### 执行命令

```bash
# A.1 TypeScript 全量测试
bun run test

# A.2 Python storage-backend 测试
cd packages/storage-backend
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -e ".[dev]"
python -m pytest

# A.3 类型检查
bun run typecheck

# A.4 构建验证
bun run build
```

### 验收标准

| 任务 | 验收条件 |
|------|---------|
| A.1 | 所有 TypeScript 测试通过 |
| A.2 | 所有 Python 测试通过 |
| A.3 | 无类型错误 |
| A.4 | 构建成功，无错误 |

### 完成后操作

更新 `summary.md`：
```markdown
| 12.5 | MCP Store 集成测试 | [ ] | ... |
```
改为（如果测试通过）：
```markdown
| 12.5 | MCP Store 集成测试 | [x] | ... |
```

---

## Agent B: 文档更新

**目标**：更新项目文档，反映 v0.3.0 变更。

### 任务清单

- [ ] B.1 更新 ARCHITECTURE.md
- [ ] B.2 更新 README.md
- [ ] B.3 编写 CHANGELOG.md
- [ ] B.4 文档化已知问题（更新 ISSUES.md 或 README）

### B.1 ARCHITECTURE.md 更新要点

**需要更新的内容**：

1. **包结构**
   ```
   packages/
   ├── core/           # 共享核心库
   ├── storage/        # 存储适配层
   ├── cli/            # 用户 CLI
   ├── cli-dev/        # 开发者 CLI (新增)
   ├── storage-backend/ # Python 后端服务 (新增)
   ├── mcp-store/      # 知识存储 MCP
   ├── mcp-query/      # 知识查询 MCP
   ├── mcp-extract/    # 知识采集 MCP
   └── mcp-visual/     # 可视化 MCP
   ```

2. **存储架构**
   - Local 模式: SQLite + USearch
   - Server 模式: MongoDB + Neo4j + Milvus
   - 模式切换机制

3. **MCP 工具命名**
   - 移除 `legacy_*` 接口
   - 统一为 `c4a_store_*` / `c4a_query_*`

4. **Skills 架构**
   - Skill 目录结构
   - 执行流程

### B.2 README.md 更新要点

**快速开始**：
```bash
# 安装
./start.sh install

# 启动 (Local 模式)
./start.sh dev

# 启动 (Server 模式)
./start.sh docker
```

**核心命令**：
- `c4a init` - 初始化项目
- `c4a sync` - 同步知识
- `c4a status` - 查看状态
- `c4a feat` - 管理 Feature

**Skills 使用**：
- `/c4a:feat` - Feature 管理
- `/c4a:specify` - 需求定义
- `/c4a:plan` - 技术设计
- `/c4a:implement` - 代码实现

### B.3 CHANGELOG.md 内容

```markdown
# Changelog

## [0.3.0] - 2026-02-XX

### Added
- Server 模式支持 (MongoDB + Neo4j + Milvus)
- Feat 生命周期管理
- Skills 系统 (/c4a:feat, /c4a:specify, /c4a:plan, /c4a:implement, /c4a:analyze)
- Data-Ops 模块 (transaction, workflow, sync, reference)
- 开发者 CLI (cli-dev)
- 安全工具 (DSL 注入防护, 路径安全校验)

### Changed
- 存储层重构为 StorageAdapter 接口
- MCP 工具重命名 (legacy_* → c4a_store_*)
- 配置系统统一到 .c4a/config.yaml

### Removed
- Legacy MCP 接口
- mcp-dsl 包 (合并到 storage)

### Fixed
- 并发修改预警
- 引用完整性检查
```

### B.4 已知问题文档化

在 README.md 或单独文档中说明：

1. **Server 模式一致性窗口**：MongoDB 写入后到 Neo4j/Milvus 同步完成前，查询可能返回过期数据
2. **Checklist 并发行为**：多人同时编辑时采用 Last Write Wins 策略
3. **跨项目权限死锁**：发布前需确认所有涉及项目的权限状态

### 验收标准

| 任务 | 验收条件 |
|------|---------|
| B.1 | ARCHITECTURE.md 包含 v0.3.0 所有架构变更 |
| B.2 | README.md 快速开始可正常执行 |
| B.3 | CHANGELOG.md 符合 Keep a Changelog 格式 |
| B.4 | 已知问题有明确的规避建议 |

### 完成后操作

更新 `summary.md`：
```markdown
| 12.8 | 更新 ARCHITECTURE.md | [x] | 反映 v0.3.0 架构变更 |
| 12.9 | 更新 README.md | [x] | 快速开始指南 |
| 12.10 | 编写 CHANGELOG.md | [x] | v0.3.0 变更记录 |
| 12.11 | 文档化已知问题 | [x] | Server 一致性/Checklist 并发/权限死锁 |
```

---

## Agent C: 用户故事验证

**目标**：验证 6 个核心用户故事可正常执行。

**前置条件**：Agent A 完成（测试基线通过）

### 任务清单

- [ ] C.1 US-001 需求迭代全流程验证
- [ ] C.2 US-002 研发主导流程验证
- [ ] C.3 US-003 ADR 流程验证
- [ ] C.4 US-004 契约补充验证
- [ ] C.5 US-005 业务知识验证
- [ ] C.6 US-006 存量知识验证

### C.1 US-001: 需求迭代全流程

**验证步骤**（在 Claude Code 中执行）：

```
# 1. 创建 Feature
/c4a:feat "用户登录功能"

# 2. 定义需求规格
/c4a:specify

# 3. 设计技术方案
/c4a:plan

# 4. 实现代码
/c4a:implement

# 5. 分析验收
/c4a:analyze

# 6. 发布
/c4a:feat --status=published
```

**验收标准**：
- [ ] Feature 创建成功，生成 feat_id
- [ ] Functional Spec 生成完整
- [ ] Technical Spec 生成完整
- [ ] Checklist 生成并可追踪
- [ ] 发布后实体状态变为 published

### C.2 US-002: 研发主导流程

**验证步骤**：

```
# 1. 创建 Feature（无 PRD）
/c4a:feat "CLI 性能优化"

# 2. 直接进入技术设计
/c4a:plan

# 3. 实现
/c4a:implement
```

**验收标准**：
- [ ] 可跳过 /c4a:specify 直接进入 /c4a:plan
- [ ] Technical Spec 生成完整
- [ ] 实现辅助正常工作

### C.3 US-003: ADR 流程

**验证步骤**：

```
# 1. 创建涉及架构变更的 Feature
/c4a:feat "引入消息队列"

# 2. 技术设计时触发 ADR 建议
/c4a:plan
# Agent 应识别架构变更并建议创建 ADR

# 3. 确认 ADR 创建
```

**验收标准**：
- [ ] Agent 识别架构变更
- [ ] ADR 创建成功
- [ ] ADR 与 Technical Spec 关联

### C.4 US-004: 契约补充

**验证步骤**：

```
# 1. 查看现有实体
/c4a:know:search "API 契约"

# 2. 补充契约信息
# 手动编辑 .c4a.yaml 文件添加 contract 字段

# 3. 同步
c4a sync
```

**验收标准**：
- [ ] 契约信息正确存储
- [ ] 关联关系建立

### C.5 US-005: 业务知识整理

**验证步骤**：

```
# 1. 使用 know:learn 录入知识
/c4a:know:learn ./docs/business-rules.md

# 2. 验证知识已存储
/c4a:know:search "业务规则"
```

**验收标准**：
- [ ] 知识正确解析
- [ ] 可通过搜索找到

### C.6 US-006: 存量知识整理

**验证步骤**：

```
# 1. 批量同步存量文档
c4a sync ./legacy-docs/

# 2. 验证同步结果
c4a status
```

**验收标准**：
- [ ] 存量文档正确解析
- [ ] 实体关系正确建立

### 完成后操作

更新 `summary.md`：
```markdown
| 12.1 | US-001 端到端验证 | [x] | 核心流程：feat→specify→plan→implement |
| 12.2 | US-002 端到端验证 | [x] | 研发主导流程 |
| 12.3 | US-003 ADR 流程验证 | [x] | 架构变更识别 + ADR 创建 |
| 12.4 | US-004/005/006 验证 | [x] | 契约补充/业务知识/存量知识 |
```

---

## Agent D: 集成测试补充

**目标**：补充 MCP 集成测试和 Server 模式测试。

**前置条件**：Agent A 完成（测试基线通过）

### 任务清单

- [ ] D.1 补充 MCP Store 集成测试
- [ ] D.2 补充 MCP Query 集成测试
- [ ] D.3 Server 模式集成测试
- [ ] D.4 模式切换测试

### D.1 MCP Store 集成测试

**文件**：`packages/mcp-store/src/__tests__/integration.test.ts`

**测试用例**：

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';

describe('MCP Store Integration', () => {
  // CRUD 操作
  describe('c4a_store_save', () => {
    it('should save entity with valid DSL', async () => {
      // 实现测试
    });

    it('should reject invalid DSL', async () => {
      // 实现测试
    });

    it('should handle concurrent modification warning', async () => {
      // 实现测试
    });
  });

  describe('c4a_store_read', () => {
    it('should read entity by id', async () => {
      // 实现测试
    });

    it('should return reference integrity warnings', async () => {
      // 实现测试
    });
  });

  describe('c4a_store_list', () => {
    it('should list entities with filters', async () => {
      // 实现测试
    });

    it('should support pagination', async () => {
      // 实现测试
    });
  });

  describe('c4a_store_delete', () => {
    it('should soft delete entity', async () => {
      // 实现测试
    });

    it('should check references before delete', async () => {
      // 实现测试
    });
  });

  // Feat 生命周期
  describe('c4a_store_feat_lifecycle', () => {
    it('should create feat', async () => {
      // 实现测试
    });

    it('should transition draft → approved → published', async () => {
      // 实现测试
    });

    it('should handle merge conflicts', async () => {
      // 实现测试
    });
  });

  // Sync 操作
  describe('c4a_store_sync', () => {
    it('should sync single file', async () => {
      // 实现测试
    });

    it('should sync directory', async () => {
      // 实现测试
    });

    it('should detect conflicts', async () => {
      // 实现测试
    });
  });
});
```

### D.2 MCP Query 集成测试

**文件**：`packages/mcp-query/src/__tests__/integration.test.ts`

**测试用例**：

```typescript
describe('MCP Query Integration', () => {
  describe('c4a_query_search', () => {
    it('should perform semantic search', async () => {
      // 实现测试
    });

    it('should filter by entity type', async () => {
      // 实现测试
    });
  });

  describe('c4a_query_deps', () => {
    it('should query dependencies', async () => {
      // 实现测试
    });

    it('should support depth limit', async () => {
      // 实现测试
    });
  });

  describe('c4a_query_impact', () => {
    it('should analyze impact', async () => {
      // 实现测试
    });
  });
});
```

### D.3 Server 模式集成测试

**前置条件**：

```bash
# 启动 Server 模式
./start.sh docker

# 等待服务就绪
./start.sh status
```

**执行测试**：

```bash
# 运行 Server 模式测试
C4A_STORAGE_BACKEND_URL=http://localhost:8055 bun run --filter @c4a/storage test
```

**验收标准**：
- [ ] MongoDB 操作正常
- [ ] Neo4j 图操作正常
- [ ] Milvus 向量操作正常
- [ ] 跨库一致性正常

### D.4 模式切换测试

**测试场景**：

1. Local → Server 迁移
2. Server → Local 回迁
3. 数据完整性验证

**验收标准**：
- [ ] 迁移后数据完整
- [ ] 关系正确保留
- [ ] 向量索引正确重建

### 完成后操作

更新 `summary.md`：
```markdown
| 12.5 | MCP Store 集成测试 | [x] | 完整 CRUD + Feat 生命周期 |
| 12.6 | MCP Query 集成测试 | [x] | 搜索 + 图查询测试 |
| 12.7 | Server 模式集成测试 | [x] | MongoDB + Neo4j + Milvus |
```

---

## 执行顺序

### 第一轮（并行）

| Agent | 任务 | 预计产出 |
|-------|------|---------|
| Agent A | 测试基线验证 | 测试报告 |
| Agent B | 文档更新 | ARCHITECTURE.md, README.md, CHANGELOG.md |

### 第二轮（并行，依赖第一轮）

| Agent | 任务 | 预计产出 |
|-------|------|---------|
| Agent C | 用户故事验证 | 验证报告 |
| Agent D | 集成测试补充 | 新增测试文件 |

---

## 最终检查清单

所有 Agent 完成后，验证 `summary.md` 中 Part 12 所有任务已打钩：

```markdown
## Part 12: Testing & Docs

| # | 功能 | 完成 | 描述 |
|---|------|:----:|------|
| 12.1 | US-001 端到端验证 | [x] | 核心流程：feat→specify→plan→implement |
| 12.2 | US-002 端到端验证 | [x] | 研发主导流程 |
| 12.3 | US-003 ADR 流程验证 | [x] | 架构变更识别 + ADR 创建 |
| 12.4 | US-004/005/006 验证 | [x] | 契约补充/业务知识/存量知识 |
| 12.5 | MCP Store 集成测试 | [x] | 完整 CRUD + Feat 生命周期 |
| 12.6 | MCP Query 集成测试 | [x] | 搜索 + 图查询测试 |
| 12.7 | Server 模式集成测试 | [x] | MongoDB + Neo4j + Milvus |
| 12.8 | 更新 ARCHITECTURE.md | [x] | 反映 v0.3.0 架构变更 |
| 12.9 | 更新 README.md | [x] | 快速开始指南 |
| 12.10 | 编写 CHANGELOG.md | [x] | v0.3.0 变更记录 |
| 12.11 | 文档化已知问题 | [x] | Server 一致性/Checklist 并发/权限死锁 |
```

---

## 风险与注意事项

1. **Agent C 依赖真实 Claude Code 环境**
   - 用户故事验证需要在 Claude Code 中手动执行
   - Skills 执行依赖 MCP 服务正常运行

2. **Agent D 的 Server 模式测试需要 Docker**
   - 确保 Docker 服务运行
   - 首次启动需要拉取镜像

3. **文档更新需要与代码同步**
   - Agent B 应在 Agent A 确认测试通过后再最终提交
   - 避免文档与实现不一致
