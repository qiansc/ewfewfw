# Part 12: Testing & Docs - 执行规划

> 基于 v0.3.0-plan-opus/summary.md 和代码分析

---

## 一、当前状态总结

### 1.1 测试覆盖现状

| 包 | 测试文件数 | 覆盖范围 |
|---|-----------|---------|
| `@c4a/core` | 14 | types, validator, utils (security/schema/yaml/path/hash/date/id/config/logger) |
| `@c4a/storage` | 37 | lite-adapter, server-adapter, data-ops (transaction/workflow/sync/reference), vector, graph |
| `@c4a/cli` | 18 | commands (init/sync/validate/feat/status/local/docker/git/server), schema, config |
| `@c4a/cli-dev` | 1 | mcpStoreHandlers |
| `storage-backend` (Python) | 13 | API endpoints, adapters, health checks |
| `@c4a/mcp-store` | 1 | smoke test |
| `@c4a/mcp-query` | 2 | handlers, smoke test |
| `@c4a/mcp-extract` | 1 | smoke test |
| `@c4a/mcp-visual` | 1 | smoke test |
| `@c4a/config-generator` | 1 | smoke test |

### 1.2 文档现状

| 文档 | 位置 | 状态 |
|------|------|------|
| CLAUDE.md | 根目录 | ✅ 已更新 |
| ARCHITECTURE.md | 根目录 | ⚠️ 需要更新（v0.3.0 变更） |
| README.md | 根目录 | ⚠️ 需要更新 |
| Skills 文档 | prompts/skills/ | ✅ 已完成 |
| 设计文档 | v0.3.0/ | ✅ 参考用 |

### 1.3 用户故事验证状态

| 用户故事 | 描述 | 验证状态 |
|---------|------|---------|
| US-001 | 需求迭代全流程（MRD → Code） | [ ] 未验证 |
| US-002 | 研发主导的工具开发 | [ ] 未验证 |
| US-003 | 架构变更与 ADR 创建 | [ ] 未验证 |
| US-004 | 契约补充与完善 | [ ] 未验证 |
| US-005 | 业务知识整理与发布 | [ ] 未验证 |
| US-006 | 存量知识整理与发布 | [ ] 未验证 |

---

## 二、待完成任务

### 2.1 用户故事验证

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| 12.1 | US-001 端到端验证 | P0 | 核心流程：/c4a:feat → /c4a:specify → /c4a:plan → /c4a:implement |
| 12.2 | US-002 端到端验证 | P1 | 研发主导流程 |
| 12.3 | US-003 ADR 流程验证 | P1 | 架构变更识别 + ADR 创建 |
| 12.4 | US-004 契约补充验证 | P2 | Contract 完善流程 |
| 12.5 | US-005 业务知识验证 | P2 | /c4a:know:learn 流程 |
| 12.6 | US-006 存量知识验证 | P2 | 存量文档整理流程 |

### 2.2 测试补充

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| 12.7 | MCP Store 集成测试 | P0 | 完整 CRUD + Feat 生命周期测试 |
| 12.8 | MCP Query 集成测试 | P1 | 搜索 + 图查询测试 |
| 12.9 | Skills 端到端测试 | P1 | 验证 Skill 格式和执行 |
| 12.10 | Server 模式集成测试 | P1 | MongoDB + Neo4j + Milvus 集成 |
| 12.11 | 模式切换测试 | P2 | Local ↔ Server 迁移测试 |

### 2.3 文档更新

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| 12.12 | 更新 ARCHITECTURE.md | P0 | 反映 v0.3.0 架构变更 |
| 12.13 | 更新 README.md | P0 | 快速开始指南 |
| 12.14 | 编写 CHANGELOG.md | P1 | v0.3.0 变更记录 |
| 12.15 | 更新 CLI 帮助文档 | P2 | c4a --help 输出 |

### 2.4 已知问题处理

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| 12.16 | 文档化 Server 一致性窗口 | P1 | ISSUES.md §A |
| 12.17 | 文档化 Checklist 并发行为 | P2 | ISSUES.md §C |
| 12.18 | 文档化权限死锁规避 | P2 | ISSUES.md §D |

---

## 三、执行计划

### 阶段 1: 核心验证 (P0)

- [ ] 1.1 运行现有测试套件，确保全部通过
- [ ] 1.2 US-001 端到端验证（手动）
- [ ] 1.3 补充 MCP Store 集成测试
- [ ] 1.4 更新 ARCHITECTURE.md
- [ ] 1.5 更新 README.md

### 阶段 2: 扩展验证 (P1)

- [ ] 2.1 US-002 端到端验证
- [ ] 2.2 US-003 ADR 流程验证
- [ ] 2.3 补充 MCP Query 集成测试
- [ ] 2.4 补充 Skills 端到端测试
- [ ] 2.5 Server 模式集成测试
- [ ] 2.6 编写 CHANGELOG.md
- [ ] 2.7 文档化 Server 一致性窗口

### 阶段 3: 完善收尾 (P2)

- [ ] 3.1 US-004/005/006 验证
- [ ] 3.2 模式切换测试
- [ ] 3.3 更新 CLI 帮助文档
- [ ] 3.4 文档化 Checklist 并发行为
- [ ] 3.5 文档化权限死锁规避

---

## 四、用户故事验证清单

### US-001: 需求迭代全流程

**验证步骤：**

```bash
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

**验收标准：**
- [ ] Feature 创建成功，生成 feat_id
- [ ] Functional Spec 生成完整
- [ ] Technical Spec 生成完整
- [ ] Checklist 生成并可追踪
- [ ] 发布后实体状态变为 published

### US-002: 研发主导的工具开发

**验证步骤：**

```bash
# 1. 创建 Feature（无 PRD）
/c4a:feat "CLI 性能优化"

# 2. 直接进入技术设计
/c4a:plan

# 3. 实现
/c4a:implement
```

**验收标准：**
- [ ] 可跳过 /c4a:specify 直接进入 /c4a:plan
- [ ] Technical Spec 生成完整
- [ ] 实现辅助正常工作

### US-003: 架构变更与 ADR 创建

**验证步骤：**

```bash
# 1. 创建涉及架构变更的 Feature
/c4a:feat "引入消息队列"

# 2. 技术设计时触发 ADR 建议
/c4a:plan
# Agent 应识别架构变更并建议创建 ADR

# 3. 确认 ADR 创建
```

**验收标准：**
- [ ] Agent 识别架构变更
- [ ] ADR 创建成功
- [ ] ADR 与 Technical Spec 关联

---

## 五、测试补充详情

### 5.1 MCP Store 集成测试

**文件**: `packages/mcp-store/src/__tests__/integration.test.ts`

**测试用例：**

```typescript
describe('MCP Store Integration', () => {
  // CRUD 操作
  describe('c4a_store_save', () => {
    it('should save entity with valid DSL')
    it('should reject invalid DSL')
    it('should handle concurrent modification warning')
  })

  describe('c4a_store_read', () => {
    it('should read entity by id')
    it('should return reference integrity warnings')
  })

  describe('c4a_store_list', () => {
    it('should list entities with filters')
    it('should support pagination')
  })

  describe('c4a_store_delete', () => {
    it('should soft delete entity')
    it('should check references before delete')
  })

  // Feat 生命周期
  describe('c4a_store_feat_lifecycle', () => {
    it('should create feat')
    it('should transition draft → approved → published')
    it('should handle merge conflicts')
  })

  // Sync 操作
  describe('c4a_store_sync', () => {
    it('should sync single file')
    it('should sync directory')
    it('should detect conflicts')
  })
})
```

### 5.2 Server 模式集成测试

**前置条件**: Docker 服务运行

```bash
./start.sh docker
```

**测试用例：**

```typescript
describe('Server Mode Integration', () => {
  describe('MongoDB Operations', () => {
    it('should save and read entity')
    it('should handle transactions')
  })

  describe('Neo4j Graph Operations', () => {
    it('should create relationships')
    it('should query dependencies')
    it('should analyze impact')
  })

  describe('Milvus Vector Operations', () => {
    it('should index entity embeddings')
    it('should perform semantic search')
  })

  describe('Cross-DB Consistency', () => {
    it('should sync data across all databases')
    it('should handle partial failures')
  })
})
```

---

## 六、文档更新详情

### 6.1 ARCHITECTURE.md 更新要点

1. **包结构更新**
   - 新增 `@c4a/cli-dev` 包
   - 新增 `storage-backend`（Python 服务）
   - 更新包依赖关系图

2. **存储架构更新**
   - Local 模式: SQLite + USearch
   - Server 模式: MongoDB + Neo4j + Milvus
   - 模式切换机制

3. **MCP 工具更新**
   - 移除 legacy 接口
   - 新增 Utils 工具 (backup/restore/repair/validate)
   - 新增 Feat 工具 (lifecycle/checklist)

4. **Skills 架构**
   - Skill 目录结构
   - Skill 执行流程

### 6.2 README.md 更新要点

1. **快速开始**
   ```bash
   # 安装
   ./start.sh install

   # 启动 (Local 模式)
   ./start.sh dev

   # 启动 (Server 模式)
   ./start.sh docker
   ```

2. **核心命令**
   - `c4a init` - 初始化项目
   - `c4a sync` - 同步知识
   - `c4a status` - 查看状态
   - `c4a feat` - 管理 Feature

3. **Skills 使用**
   - `/c4a:feat` - Feature 管理
   - `/c4a:specify` - 需求定义
   - `/c4a:plan` - 技术设计
   - `/c4a:implement` - 代码实现

### 6.3 CHANGELOG.md 结构

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

---

## 七、验证方法

### 7.1 测试执行（TypeScript）

```bash
# 全量测试
bun run test

# 单包测试
bun run --filter @c4a/storage test
bun run --filter @c4a/cli test

# 类型检查
bun run typecheck

# 构建验证
bun run build
```

### 7.2 测试执行（Python storage-backend）

```bash
# 进入 storage-backend 目录
cd packages/storage-backend

# 创建虚拟环境并安装依赖
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -e ".[dev]"

# 运行测试
python -m pytest

# 运行特定测试
python -m pytest tests/test_api.py -v
```

**注意**：Server 模式集成测试需要同时运行 TypeScript 和 Python 测试，确保完整覆盖。

### 7.3 用户故事验证

```bash
# 启动开发环境
./start.sh dev

# 在 Claude Code 中执行 Skills
/c4a:feat "测试功能"
```

### 7.4 Server 模式验证

```bash
# 启动 Server 模式
./start.sh docker

# 检查服务状态
./start.sh status

# 查看日志
./start.sh logs

# 运行 Server 模式集成测试（需要服务已启动）
C4A_STORAGE_BACKEND_URL=http://localhost:8055 bun run --filter @c4a/storage test
```

---

## 八、风险与注意事项

1. **用户故事验证依赖 Agent 能力**
   - 需要在真实 Claude Code 环境中验证
   - Skills 执行依赖 MCP 服务正常运行

2. **Server 模式测试需要 Docker**
   - 确保 Docker 服务运行
   - 首次启动需要拉取镜像

3. **文档更新需要与代码同步**
   - 先完成代码验证，再更新文档
   - 避免文档与实现不一致

---

## 九、关键文件清单

### 需要创建的文件

| 文件 | 说明 |
|------|------|
| `packages/mcp-store/src/__tests__/integration.test.ts` | MCP Store 集成测试 |
| `packages/mcp-query/src/__tests__/integration.test.ts` | MCP Query 集成测试 |
| `CHANGELOG.md` | 版本变更记录 |

### 需要更新的文件

| 文件 | 说明 |
|------|------|
| `ARCHITECTURE.md` | 架构文档 |
| `README.md` | 项目说明 |
| `v0.3.0-plan-opus/summary.md` | 进度更新 |

### 只读验证的文件

| 文件 | 说明 |
|------|------|
| `v0.3.0/user-stories.md` | 用户故事定义 |
| `v0.3.0/ISSUES.md` | 已知问题 |
| `prompts/skills/*/SKILL.md` | Skills 定义 |

---

## 十、执行建议

**推荐顺序**:

1. **先运行现有测试** - 确保基线稳定
2. **US-001 手动验证** - 核心流程验证
3. **补充集成测试** - 自动化保障
4. **更新文档** - 反映最终状态
5. **处理已知问题** - 文档化规避方案

**并行方案**:

```
Agent 1 (测试):
├── 运行现有测试
├── 补充 MCP Store 集成测试
└── 补充 MCP Query 集成测试

Agent 2 (文档):
├── 更新 ARCHITECTURE.md
├── 更新 README.md
└── 编写 CHANGELOG.md

Agent 3 (验证):
├── US-001 端到端验证
├── US-002 端到端验证
└── US-003 ADR 流程验证
```
