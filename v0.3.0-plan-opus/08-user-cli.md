# Part 08 User CLI - Agent 提示词

> 执行顺序：Agent-0（前置准备）→ Agent-1~4 并行 → Agent-5（集成收尾）

---

## 概述

User CLI 模块实现用户交互的命令行工具，包括：

| 子模块 | 设计文档 | 核心能力 | 任务编号 |
|--------|---------|---------|---------|
| CLI 架构与目录迁移 | [structure-migration.md](../v0.3.0/detailed-design/cli/structure-migration.md) | cli → cli-dev 重命名、用户 CLI 骨架 | 8.1, 8.21 |
| 首次运行与安装 | [user-cli.md](../v0.3.0/detailed-design/cli/user-cli.md) §2.1-2.3 | 模式选择引导、install 命令 | 8.2, 8.6, 8.14-8.16 |
| 核心命令 | [user-cli.md](../v0.3.0/detailed-design/cli/user-cli.md) §2.4 | init/status/sync/validate | 8.4-8.5, 8.7-8.8 |
| 辅助命令 | [user-cli.md](../v0.3.0/detailed-design/cli/user-cli.md) §2.4 | feat render/template/schema | 8.9-8.10 |
| 模式子菜单 | [user-cli.md](../v0.3.0/detailed-design/cli/user-cli.md) §2.4 | server/local 子命令 | 8.11-8.12 |
| CLI-MCP 映射 | [mcp-mapping.md](../v0.3.0/detailed-design/cli/mcp-mapping.md) | 命令到工具映射、sync 实现 | 8.17-8.19 |

**依赖关系**：
- 依赖 Part 06 Local Mode 的 SQLite 存储层
- 依赖 Part 07 Data Ops 的同步/导出引擎
- 依赖 Part 03 MCP Store 工具
- 被 Part 09 Dev CLI 依赖（build 命令编译用户 CLI）

**优先级说明**：

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | Agent-0 + 8.1, 8.4, 8.6 | 目录迁移 + init + install local |
| P0 | 8.5, 8.7, 8.8 | status + sync + validate |
| P1 | 8.2, 8.3, 8.9-8.10 | 首次引导 + 辅助命令 |
| P1 | 8.11-8.12 | server/local 子菜单 |
| P2 | 8.13-8.16 | rollback(v0.4.0) + 多模式 + Remote |

---

## Agent-0：前置准备（必须先完成）

```
请执行 Part 08 User CLI 的前置准备任务：

1. 阅读设计文档：
   - v0.3.0/detailed-design/cli-design.md（入口索引）
   - v0.3.0/detailed-design/cli/overview.md（概述）
   - v0.3.0/detailed-design/cli/user-cli.md（用户 CLI 设计）
   - v0.3.0/detailed-design/cli/structure-migration.md（目录迁移）
   - v0.3.0/detailed-design/cli/commands-vs-skills.md（命令 vs Skills）

2. 确认依赖模块已完成：
   - Part 06 Local Mode：SQLite 存储层可用
   - Part 07 Data Ops：sync/export 引擎可用
   - Part 03 MCP Store：c4a_store_* 工具可用
   - 验证：bun run --filter @c4a/storage test

3. 执行目录迁移（任务 8.21）：

   Step 1: 重命名现有 CLI 为开发 CLI
   ```bash
   mv packages/cli packages/cli-dev
   ```

   Step 2: 更新 start.sh 入口
   ```bash
   # 修改 start.sh 中的路径
   exec bun "$SCRIPT_DIR/packages/cli-dev/src/index.tsx" "$@"
   ```

   Step 3: 更新 package.json
   - packages/cli-dev/package.json: name 改为 "@c4a/cli-dev"

   Step 4: 更新 monorepo 配置
   - 根目录 package.json 的 workspaces
   - tsconfig.json 的 references

4. 创建用户 CLI 骨架（任务 8.1）：

   packages/cli/
   ├── src/
   │   ├── index.tsx              # 入口
   │   ├── App.tsx                # 主应用
   │   ├── commands/              # 命令实现
   │   │   ├── index.ts
   │   │   ├── init.ts            # c4a init
   │   │   ├── install.ts         # c4a install
   │   │   ├── sync.ts            # c4a sync
   │   │   ├── status.ts          # c4a status
   │   │   ├── validate.ts        # c4a validate
   │   │   ├── feat.ts            # c4a feat render
   │   │   ├── template.ts        # c4a template
   │   │   ├── schema.ts          # c4a schema
   │   │   ├── server.ts          # c4a server 子命令
   │   │   └── local.ts           # c4a local 子命令
   │   ├── components/            # UI 组件
   │   │   ├── index.ts
   │   │   ├── Header.tsx
   │   │   ├── CascadeMenu.tsx
   │   │   ├── InstallWizard.tsx  # 安装向导
   │   │   ├── SyncProgress.tsx   # 同步进度
   │   │   └── ConfirmDialog.tsx
   │   ├── core/                  # 核心逻辑
   │   │   ├── config.ts          # 配置管理
   │   │   ├── adapter.ts         # 存储适配器
   │   │   └── mcp-client.ts      # MCP 客户端
   │   ├── utils/                 # 工具函数
   │   │   ├── index.ts
   │   │   ├── docker.ts          # Docker 管理
   │   │   ├── git.ts             # Git 操作
   │   │   └── hash.ts            # 哈希计算
   │   └── types.ts               # 类型定义
   ├── package.json
   └── tsconfig.json

5. 创建 package.json：
   ```json
   {
     "name": "@c4a/cli",
     "version": "0.3.0",
     "type": "module",
     "bin": {
       "c4a": "./dist/index.js"
     },
     "scripts": {
       "dev": "bun run src/index.tsx",
       "build": "bun build src/index.tsx --outdir dist --target node",
       "typecheck": "tsc --noEmit",
       "test": "bun test"
     },
     "dependencies": {
       "@c4a/core": "workspace:*",
       "@c4a/storage": "workspace:*",
       "ink": "^4.4.1",
       "react": "^18.2.0",
       "commander": "^11.1.0",
       "yaml": "^2.3.4"
     },
     "devDependencies": {
       "@types/react": "^18.2.0",
       "typescript": "^5.3.0"
     }
   }
   ```

6. 产物：
   - packages/cli-dev/ 目录（原 cli 重命名）
   - packages/cli/ 目录（新用户 CLI 骨架）
   - start.sh 更新完成
   - monorepo 配置更新完成
   - 验证：bun install && bun run typecheck

完成后告诉我，我会启动 Agent-1~4 并行执行。
```

---

## Agent-1：核心命令 - init/install（8.4, 8.6）

```
请实现 c4a init 和 c4a install 命令。

1. 阅读设计文档：
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a init
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a install

2. 任务 8.4 - c4a init 命令：
   - 实现 packages/cli/src/commands/init.ts
   - 交互流程：
     - 输入 project_id（必填）
     - 输入 repo_id（自动检测 Git remote，检测失败则必填）
     - 选择模式（local/server/remote）
     - 选择是否自动导出到 .context/
     - 选择 AI IDE（Cursor/Claude Code/OpenCode/全部）
     - 配置 ADR 策略（可选，默认 enforce=false）
   - 创建目录结构：
     ```
     .context/
     ├── .c4a.yaml          # 项目配置
     ├── business/          # 业务视角
     │   ├── products/
     │   ├── processes/
     │   └── sors/
     └── technical/         # 技术视角
         ├── adrs/
         ├── systems/
         ├── containers/
         ├── components/
         ├── processes/
         └── sors/
     ```
   - 生成 .c4a.yaml 配置文件
   - 根据选择安装 Skills 配置（.cursor/mcp.json 等）

3. 任务 8.6 - c4a install 命令：
   - 实现 packages/cli/src/commands/install.ts

   **c4a install local**：
   - 创建全局目录 ~/.c4a/
   - 初始化 SQLite 数据库 ~/.c4a/store.db
   - 下载 embedding 模型（all-MiniLM-L6-v2）
   - 写入全局配置 ~/.c4a/config.yaml
   - 记录 local.installed_at

   **c4a install server**：
   - 检查 Docker 是否安装
   - 未安装则询问是否自动安装
   - 启动 Docker 容器（MongoDB + Neo4j + Milvus）
   - 等待服务健康检查通过
   - 写入全局配置
   - 记录 server.installed_at

   **Remote 模式下的 install 行为（模式切换）**：
   - 检测当前是否处于 Remote 模式
   - 如果是，显示警告："切换到本地存储模式将需要重新同步数据"
   - 询问用户确认后再执行安装
   - 参考 user-cli.md §2.4 c4a install 的"Remote 模式下的行为"

4. 实现 InstallWizard 组件：
   - packages/cli/src/components/InstallWizard.tsx
   - 模式选择界面（local/server/remote/skip）
   - 安装进度显示
   - 错误处理和重试

5. 实现配置管理：
   - packages/cli/src/core/config.ts
   - loadGlobalConfig(): 读取 ~/.c4a/config.yaml
   - saveGlobalConfig(): 写入全局配置
   - loadProjectConfig(): 读取 .context/.c4a.yaml
   - saveProjectConfig(): 写入项目配置
   - getInstalledModes(): 获取已安装的模式列表

6. 实现 Git 工具：
   - packages/cli/src/utils/git.ts
   - detectGitRemote(): 检测 Git remote URL
   - 用于自动填充 repo_id

7. 测试用例（packages/cli/src/__tests__/）：
   - init.test.ts：初始化流程测试
   - install.test.ts：安装流程测试
   - config.test.ts：配置管理测试
   - 测试覆盖率要求：核心逻辑 ≥ 80%

8. 错误处理规范：
   - 所有用户可见错误必须使用 ErrorResponse 格式
   - 包含 code、message、details、recoverable_actions
   - 参考 CLAUDE.md 中的 MCP 错误响应规范
```

---

## Agent-2：核心命令 - status/sync/validate（8.5, 8.7, 8.8）

```
请实现 c4a status、c4a sync 和 c4a validate 命令。

1. 阅读设计文档：
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a status
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a sync
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a validate
   - v0.3.0/detailed-design/cli/mcp-mapping.md §4.2 sync 命令详细映射
   - v0.3.0/detailed-design/cli/mcp-mapping.md §4.3 冲突检测算法

2. 任务 8.5 - c4a status 命令：
   - 实现 packages/cli/src/commands/status.ts
   - 显示内容：
     - 全局配置（已安装模式）
     - 项目配置（project_id, repo_id, mode）
     - 数据库统计（按类型分组）
     - Skills 配置状态
   - 调用 MCP 工具：c4a_store_list（group_by: "type"）

3. 任务 8.7 - c4a sync 命令：
   - 实现 packages/cli/src/commands/sync.ts

   **Local 模式**：
   - 检测变更方向（文件 vs 数据库）
   - 调用 c4a_store_sync 工具
   - 支持参数：
     - direction: "import" | "export"
     - status_filter: "published" | "approved" | "all"
     - mode: "incremental" | "full"

   **Server/Remote 模式**：
   - 收集本地文件摘要（包含内容）
   - 读取同步快照 .context/.sync-state.json
   - 调用 c4a_store_plan_sync（execute=true）
   - 处理下载/冲突/删除操作
   - 保存新的同步快照

   **同步忽略规则**（不参与同步的文件）：
   - checklist.md：只读视图，数据库是唯一数据源
   - feat.yaml：Feat 元数据通过专用 MCP 工具管理
   - .sync-state.json：同步状态快照，仅本地使用
   - .c4a.yaml：项目配置文件，不同步到数据库

   **冲突处理**：
   - 实现 handleConflict() 函数
   - 支持选项：使用本地/使用远程/查看差异/跳过
   - 基于 content_hash + updated_at 检测冲突

4. 任务 8.8 - c4a validate 命令：
   - 实现 packages/cli/src/commands/validate.ts
   - 离线验证（不连接数据库）
   - 验证内容：
     - Schema 验证（JSON Schema）
     - 引用完整性（跨文件检查）
     - 关系有效性
     - 命名规范
   - 输出格式：
     - 默认：人类可读
     - --format=json：JSON 格式
     - --format=github：GitHub Actions 格式
   - 退出码：0=通过，1=错误，2=警告（--strict）

5. 实现 SyncProgress 组件：
   - packages/cli/src/components/SyncProgress.tsx
   - 显示同步进度
   - 显示上传/下载/冲突统计

6. 实现哈希计算工具：
   - packages/cli/src/utils/hash.ts
   - calculateHash(): 跨平台规范化哈希
   - 规范化步骤：
     - 统一换行符为 LF
     - YAML 解析后按字母顺序重新序列化
     - 移除末尾多余换行符

7. 测试用例：
   - status.test.ts：状态查询测试
   - sync.test.ts：同步流程测试（含冲突处理）
   - validate.test.ts：验证规则测试
   - hash.test.ts：跨平台哈希规范化测试
   - 测试覆盖率要求：核心逻辑 ≥ 80%

8. 错误处理规范：
   - 同步失败时提供 recoverable_actions（重试、跳过、强制覆盖）
   - 冲突时显示清晰的差异信息和解决选项
```

---

## Agent-3：辅助命令（8.9, 8.10）

```
请实现 c4a feat render、c4a template 和 c4a schema 命令。

1. 阅读设计文档：
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a feat render
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a template
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a schema

2. 任务 8.9 - c4a feat render 命令：
   - 实现 packages/cli/src/commands/feat.ts
   - 渲染 Checklist 到本地文件（只读视图）
   - 数据获取方式：
     - Local：直接查询 SQLite
     - Server：通过 stdio 调用 c4a_store_feat_checklist
     - Remote：通过 HTTP API 调用
   - 输出格式：
     - 默认：Markdown（.context/feat/{feat-id}/checklist.md）
     - --format=json：JSON 格式
   - 参数：
     - feat-id：必填
     - --output：指定输出路径

3. 任务 8.10 - c4a template 命令：
   - 实现 packages/cli/src/commands/template.ts
   - 支持类型：system, container, component, adr, process, sor
   - 交互流程：
     - 输入实体 ID
     - 输入实体名称
     - 输入关联实体（如 system_id）
   - 生成文件到对应目录
   - 参数：
     - type：必填
     - --id：跳过交互
     - --output：指定输出路径
     - --stdout：输出到标准输出

4. 任务 8.10 - c4a schema 命令：
   - 实现 packages/cli/src/commands/schema.ts
   - 输出 JSON Schema 定义
   - 支持类型：system, container, component, adr, process, sor, feat, checklist
   - 参数：
     - type：必填（或 "all"）
     - --output：输出到文件
     - --format：json（默认）或 yaml

5. 实现模板生成器：
   - packages/cli/src/core/templates.ts
   - generateTemplate(type, options): 生成 DSL 模板
   - 模板内容包含：
     - type 字段
     - id 字段
     - data 字段（带 TODO 注释）
     - metadata 字段（status: draft, created_at）

6. 测试用例：
   - feat.test.ts：Checklist 渲染测试
   - template.test.ts：模板生成测试
   - schema.test.ts：Schema 输出测试
   - 测试覆盖率要求：核心逻辑 ≥ 80%
```

---

## Agent-4：模式子菜单（8.11, 8.12）

```
请实现 c4a server 和 c4a local 子菜单命令。

1. 阅读设计文档：
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a server
   - v0.3.0/detailed-design/cli/user-cli.md §2.4 c4a local

2. 任务 8.11 - c4a server 子菜单：
   - 实现 packages/cli/src/commands/server.ts
   - 仅在 Server 模式安装后显示

   **c4a server status**：
   - 查看 Docker 容器状态
   - 显示各服务端口和健康状态

   **c4a server restart**：
   - 重启所有 Docker 容器

   **c4a server stop**：
   - 停止所有 Docker 容器

   **c4a server logs**：
   - 查看服务日志
   - 支持指定服务名

   **c4a server backup**：
   - 调用 c4a_store_backup MCP 工具
   - 导出 MongoDB/Neo4j/Milvus 数据
   - 生成压缩包

   **c4a server restore**：
   - 调用 c4a_store_restore MCP 工具
   - 从压缩包恢复数据
   - 权限校验（检查用户对各项目的写权限）

   **c4a server clean**：
   - 清理数据（需确认）

   **c4a server check-permissions**：
   - 检查备份文件中实体的权限兼容性
   - 参数：--backup <file>、--user <email>、--format=json
   - 用于迁移前的权限预检查
   - 显示可导入/无权限的实体统计

3. 任务 8.12 - c4a local 子菜单：
   - 实现 packages/cli/src/commands/local.ts
   - 仅在 Local 模式安装后显示

   **c4a local status**：
   - 显示数据库文件状态
   - 显示实体统计

   **c4a local validate**：
   - 调用 c4a_store_validate MCP 工具
   - 检查数据完整性
   - 显示错误和警告

   **c4a local repair**：
   - 调用 c4a_store_repair MCP 工具
   - 自动修复数据问题
   - 支持 --dry-run 预览

   **c4a local backup**：
   - 调用 c4a_store_backup MCP 工具
   - 导出 SQLite 数据
   - 生成压缩包

   **c4a local restore**：
   - 调用 c4a_store_restore MCP 工具
   - 从压缩包恢复数据
   - 重建向量索引

   **c4a local clean**：
   - 清理数据库（需确认）

   **c4a local vacuum**：
   - 压缩数据库文件

4. 实现 Docker 工具：
   - packages/cli/src/utils/docker.ts
   - checkDockerInstalled(): 检查 Docker 是否安装
   - getContainerStatus(): 获取容器状态
   - startContainers(): 启动容器
   - stopContainers(): 停止容器
   - restartContainers(): 重启容器
   - getContainerLogs(): 获取日志

5. 实现动态菜单：
   - 更新 packages/cli/src/App.tsx
   - 根据已安装模式动态显示 server/local 菜单项
   - 检查 ~/.c4a/config.yaml 中的 installed_at 字段

6. 测试用例：
   - server.test.ts：Server 子命令测试
   - local.test.ts：Local 子命令测试
   - docker.test.ts：Docker 工具测试
   - 测试覆盖率要求：核心逻辑 ≥ 80%
```

---

## Agent-5：集成收尾（等待 Agent-1~4 全部完成）

```
请执行 Part 08 User CLI 的集成收尾任务。

1. 阅读设计文档：
   - v0.3.0/detailed-design/cli/user-cli.md（确认所有命令已实现）
   - v0.3.0/detailed-design/cli/mcp-mapping.md（确认映射正确）

2. 集成任务：

   **更新入口文件**：
   - packages/cli/src/index.tsx
   - 解析命令行参数
   - 路由到对应命令
   - 支持交互式菜单（无参数时）

   **更新主应用**：
   - packages/cli/src/App.tsx
   - 实现交互式菜单
   - 动态显示菜单项（根据已安装模式）
   - 首次运行引导（未安装任何模式时）

   **更新菜单数据**：
   - packages/cli/src/menuData.ts
   - 定义菜单结构
   - 定义命令映射

3. 实现首次运行引导（任务 8.2, 8.3）：
   - 检测是否已安装任何模式
   - 未安装时显示模式选择引导
   - 选项：local/server/remote/skip
   - 根据选择执行安装或跳过

4. 实现 MCP 客户端：
   - packages/cli/src/core/mcp-client.ts
   - Local 模式：直接调用 @c4a/storage
   - Server 模式：通过 stdio 调用 MCP Server
   - Remote 模式：通过 HTTP API 调用

5. 创建集成测试：
   - packages/cli/src/__tests__/integration.test.ts
   - 端到端测试：init → install → sync → status
   - 模式切换测试
   - 命令可用性测试（根据模式）

6. 文档更新：
   - 更新 packages/cli/README.md
   - 添加命令说明
   - 添加使用示例

7. 验证清单：
   - [x] c4a init：正确创建目录和配置
   - [x] c4a install local：正确初始化 SQLite
   - [x] c4a install server：正确启动 Docker 容器
     - 验证命令：`bun packages/cli/src/index.tsx install server`
   - [x] c4a sync：Local/Server 模式同步正常
   - [x] c4a status：正确显示状态信息
   - [x] c4a validate：正确验证 DSL 文件
   - [x] c4a feat render：正确渲染 Checklist
   - [x] c4a template：正确生成模板
   - [x] c4a schema：正确输出 Schema
   - [x] c4a server/*：Server 子命令正常
   - [x] c4a local/*：Local 子命令正常
   - [x] 动态菜单：根据模式正确显示
   - [x] 首次引导：未安装时正确引导

8. 产物：
   - packages/cli/ 完整实现
   - 集成测试通过
   - README 文档更新
```

---

## 执行检查清单

| 步骤 | Agent | 任务编号 | 状态 | 完成时间 |
|------|-------|---------|:----:|---------|
| 0 | Agent-0 | 前置准备 + 目录迁移 | [x] | 2026-01-31 |
| 1 | Agent-1 | 8.4, 8.6 (init/install) | [x] | 2026-01-31 |
| 1 | Agent-2 | 8.5, 8.7, 8.8 (status/sync/validate) | [x] | 2026-01-31 |
| 1 | Agent-3 | 8.9, 8.10 (feat/template/schema) | [x] | 2026-01-31 |
| 1 | Agent-4 | 8.11, 8.12 (server/local) | [x] | 2026-01-31 |
| 2 | Agent-5 | 集成收尾 | [x] | 2026-01-31 |

---

## 任务编号索引

| 编号 | 任务 | Agent |
|------|------|-------|
| 8.1 | CLI 架构设计 | Agent-0 |
| 8.2 | 首次运行引导 | Agent-5 |
| 8.3 | 动态菜单显示 | Agent-5 |
| 8.4 | c4a init | Agent-1 |
| 8.5 | c4a status | Agent-2 |
| 8.6 | c4a install | Agent-1 |
| 8.7 | c4a sync | Agent-2 |
| 8.8 | c4a validate | Agent-2 |
| 8.9 | c4a feat render | Agent-3 |
| 8.10 | c4a template/schema | Agent-3 |
| 8.11 | c4a server 子菜单 | Agent-4 |
| 8.12 | c4a local 子菜单 | Agent-4 |
| 8.13 | c4a rollback (v0.4.0) | 挂起 |
| 8.14 | 多模式支持 | Agent-1 |
| 8.15 | 全局/项目配置 | Agent-1 |
| 8.16 | Remote 模式设计 | Agent-1 |
| 8.17 | CLI-MCP 映射 | Agent-2 |
| 8.18 | sync 实现细节 | Agent-2 |
| 8.19 | 冲突检测算法 | Agent-2 |
| 8.20 | Commands vs Skills | Agent-0 |
| 8.21 | CLI 目录迁移 | Agent-0 |

---

## 关键设计决策

### 1. CLI 与 MCP 工具映射

| CLI 命令 | Local 模式 | Server 模式 | Remote 模式 |
|---------|-----------|------------|------------|
| c4a init | 无 MCP 调用 | 无 MCP 调用 | 无 MCP 调用 |
| c4a sync | c4a_store_sync | c4a_store_plan_sync | c4a_store_plan_sync |
| c4a status | c4a_store_list | c4a_store_list | c4a_store_list |
| c4a validate | 无 MCP 调用 | 无 MCP 调用 | 无 MCP 调用 |
| c4a local validate | c4a_store_validate | N/A | N/A |
| c4a feat render | c4a_store_feat_checklist | c4a_store_feat_checklist | c4a_store_feat_checklist |

### 2. 同步策略

**Local 模式**：
- MCP 工具嵌入 CLI，可直接访问本地文件系统
- 使用 c4a_store_sync 工具
- 支持 import/export 方向

**Server/Remote 模式**：
- MCP 服务运行在独立进程
- 使用 c4a_store_plan_sync（execute=true）
- Server 端计算同步计划，CLI 执行

### 3. 冲突检测

```typescript
// 基于 content_hash + updated_at 的冲突检测
if (localHash === remoteHash) {
  return { action: 'skip' };  // 内容相同，跳过
}

const localModified = localMtime > lastSyncTime;
const remoteModified = remoteUpdatedAt > lastSyncTime;

if (localModified && !remoteModified) {
  return { action: 'upload' };  // 仅本地修改
} else if (!localModified && remoteModified) {
  return { action: 'download' };  // 仅远程修改
} else if (localModified && remoteModified) {
  return { hasConflict: true };  // 双方都修改，需用户选择
}
```

### 4. 配置文件结构

**全局配置 ~/.c4a/config.yaml**：
```yaml
version: 0.3.0
local:
  db_path: ~/.c4a/store.db
  embedding_model: all-MiniLM-L6-v2
  installed_at: "2026-01-22T10:00:00Z"
server:
  url: http://localhost:8050
  installed_at: "2026-01-22T11:00:00Z"
```

**项目配置 .context/.c4a.yaml**：
```yaml
repo_id: company/my-repo
project_id: my-project
mode: local
skills: {cursor: true, claude: false, opencode: false}
adr_policy: {enforce: true, scope: [system, container], on_missing: warning}
```

### 5. 动态菜单规则

- `server` 菜单项：仅在 Server 模式已安装时显示
- `local` 菜单项：仅在 Local 模式已安装时显示
- 通过检查 `~/.c4a/config.yaml` 中的 `installed_at` 字段判断

---

## 挂起任务

| 任务 | 挂起原因 | 解除条件 |
|------|----------|----------|
| 8.13 c4a rollback | v0.4.0 计划 | v0.4.0 版本 |
| Remote 模式完整实现 | 依赖 Part 13 Server 模式 | Part 13 完成 |
