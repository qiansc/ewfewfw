## 2. 用户 CLI 设计

### 2.1 首次运行引导

用户首次执行 `c4a` 时，如果未安装任何模式（local 或 server），会显示模式选择引导：

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  欢迎使用 C4A CLI                    ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  检测到尚未安装存储模式              ║
  ║                                      ║
  ║  > local   - 本地模式                ║
  ║    server  - 服务模式                ║
  ║    remote  - 远程模式                ║
  ║    skip    - 稍后决定                ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  本地模式: SQLite 单文件数据库，无需 Docker，适合个人使用

  ↑/↓ 选择  Enter 确认  q 退出
```

**选项说明**（根据光标位置动态显示）：
- **local**：SQLite 单文件数据库，无需 Docker，适合个人使用
- **server**：MongoDB + Neo4j + Milvus，需要 Docker，可提供远程服务，适合团队协作
- **remote**：不安装本地存储，使用项目配置的远程服务，适合使用团队共享服务
- **skip**：跳过安装，稍后通过 `c4a install` 命令安装

#### 选择 skip 后的行为

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  欢迎使用 C4A CLI                    ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  检测到尚未安装存储模式              ║
  ║                                      ║
  ║    local   - 本地模式                ║
  ║    server  - 服务模式                ║
  ║    remote  - 远程模式                ║
  ║  > skip    - 稍后决定                ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  跳过安装: 稍后通过 c4a install 命令安装

  ↑/↓ 选择  Enter 确认  q 退出

─────────────────────────────────────────
选择: skip
─────────────────────────────────────────

✅ 已跳过安装

你可以稍后通过以下命令安装:
  c4a install local   - 安装本地模式
  c4a install server  - 安装服务模式

或在项目中直接使用远程服务:
  c4a init            - 初始化项目并选择 remote 模式
```

**跳过安装后的菜单**：

**情况 1：不在项目目录下，或项目未配置 remote 模式**

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  C4A CLI                             ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  > install  ▶ 安装模式               ║
  ║    help       帮助信息               ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  ⚠️  尚未安装任何存储模式
  请先运行 c4a install 安装 local 或 server 模式
  或在项目中运行 c4a init 选择 remote 模式

  ↑/↓ 选择  → 展开  Enter 确认  q 退出
```

**情况 2：在项目目录下，且项目配置了 remote 模式**

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  C4A CLI                             ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  > init       初始化项目             ║
  ║    sync     ▶ 同步知识               ║
  ║    status     查看状态               ║
  ║    install  ▶ 安装模式               ║
  ║    help       帮助信息               ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  ℹ️  当前项目使用 remote 模式
  远程服务: https://c4a.example.com:8051

  ↑/↓ 选择  → 展开  Enter 确认  q 退出
```

> **设计原则**：`c4a sync` 命令在所有模式下行为一致，不区分 import/export。Remote 模式下的同步逻辑与 Local/Server 模式相同，由 Server 端统一处理三方对比。

**命令可用性**：

| 命令 | 未安装任何模式 | 项目配置了 remote 模式 |
|------|---------------|---------------------|
| `c4a install` | ✅ 可用 | ✅ 可用 |
| `c4a init` | ✅ 可用（可选 remote） | ✅ 可用 |
| `c4a sync` | ❌ 提示需要安装 | ✅ 可用（通过远程 HTTP API） |
| `c4a status` | ❌ 提示需要安装 | ✅ 可用（显示 remote 状态） |
| `c4a validate` | ✅ 可用（离线验证） | ✅ 可用（离线验证） |
| `c4a server` | ❌ 不显示 | ❌ 不显示 |
| `c4a local` | ❌ 不显示 | ❌ 不显示 |
| `c4a feat render` | ❌ 提示需要安装 | ✅ 可用（从远程获取数据） |
| `c4a template` | ✅ 可用（离线生成） | ✅ 可用（离线生成） |
| `c4a schema` | ✅ 可用（离线查看） | ✅ 可用（离线查看） |
| `c4a help` | ✅ 可用 | ✅ 可用 |
| `c4a --version` | ✅ 可用 | ✅ 可用 |

**说明**：
- 如果项目配置了 `mode: remote`，CLI 会读取项目配置并连接远程服务
- `c4a sync` 在 remote 模式下通过远程 MCP 服务的 HTTP API 实现双向同步
- `c4a status` 在 remote 模式下显示远程服务连接状态

**`c4a init` 在未安装模式时的行为**：

```
$ c4a init

  C4A 项目初始化

⚠️  检测到尚未安装任何存储模式

? 项目标识 (project_id): my-project
? 仓库标识 (repo_id): company/my-repo
? 选择项目使用的模式:
  > remote - 使用远程服务（推荐）
    local  - 使用本地数据库（需先安装）
    server - 使用 Docker 服务（需先安装）

─────────────────────────────────────────
选择: local
─────────────────────────────────────────

❌ 错误: Local 模式尚未安装

请先运行以下命令安装:
  c4a install local

或选择 remote 模式直接使用远程服务。
```

如果选择 `remote` 模式，则正常初始化：

```
─────────────────────────────────────────
选择: remote
─────────────────────────────────────────

? 远程 MCP 服务地址: https://c4a.example.com:8051

? 选择 AI IDE:
  > Cursor
    Claude Code
    OpenCode
    全部安装

✅ 初始化完成

已创建:
  .context/
  ├── .c4a.yaml          # 项目配置（mode: remote）
  ├── business/          # 业务视角
  └── technical/         # 技术视角

已安装 Skills:
  .cursor/mcp.json       # Cursor 配置（指向远程服务）
  .cursorrules           # Cursor 规则

下一步:
  使用 Agent 创建架构知识（自动同步到远程服务）

> **注意**：v0.3.0 暂不支持认证，远程服务允许匿名访问。Token 认证将在后续版本中实现。
```

### 2.2 交互式菜单

安装模式后的正常菜单（动态显示）：

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  C4A CLI                             ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  > init       初始化项目             ║
  ║    sync       同步知识               ║
  ║    status     查看状态               ║
  ║    install  ▶ 安装模式               ║
  ║    server   ▶ 服务管理               ║
  ║    local    ▶ 本地管理               ║
  ║    help       帮助信息               ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  ↑/↓ 选择  → 展开  Enter 确认  q 退出
```

**动态菜单规则**：
- `server` 菜单项：仅在 Server 模式已安装时显示
- `local` 菜单项：仅在 Local 模式已安装时显示
- 通过检查 `~/.c4a/config.yaml` 中的 `server.installed_at` 和 `local.installed_at` 判断

### 2.3 命令列表

```bash
c4a                     # 交互式菜单
c4a init                # 初始化项目
c4a sync                # 同步知识
c4a status              # 查看状态
c4a validate            # 验证 DSL 文件（用于 CI/CD）
c4a install             # 安装模式选择（子菜单）
c4a install local       # 安装 Local 模式
c4a install server      # 安装 Server 模式
c4a server              # 服务管理（仅 Server 模式）
c4a local               # 本地管理（仅 Local 模式）
c4a feat render <id>    # 渲染 Checklist 到本地（只读视图）
c4a rollback <feat-id>  # 紧急回滚（v0.4.0 计划）
c4a template <type>     # 生成 DSL 模板
c4a schema <type>       # 查看 DSL JSON Schema
c4a help                # 帮助信息
c4a --version           # 版本号
```

### 2.4 命令详细设计

#### `c4a init`

初始化当前项目的 C4A 配置。

**交互流程**：

```
$ c4a init

  C4A 项目初始化

? 项目标识 (project_id): my-project
? 仓库标识 (repo_id): company/my-repo    # 自动检测 Git remote
? 选择项目使用的模式:
  > local  - 使用本地数据库
    server - 使用 Docker 服务
    remote - 使用远程服务
? 数据库变更后自动导出到 .context/?
  > 否 - 仅手动导出 (推荐)
    是 - 自动保持同步
? 选择 AI IDE:
  > Cursor
    Claude Code
    OpenCode
    全部安装

✅ 初始化完成

已创建:
  .context/
  ├── .c4a.yaml          # 项目配置 (mode: local)
  ├── business/          # 业务视角
  └── technical/         # 技术视角

已安装 Skills:
  .cursor/mcp.json       # Cursor 配置
  .cursorrules           # Cursor 规则

下一步:
  1. 使用 Agent 创建架构知识
  2. DSL 实体自动双写到数据库和文件系统
  3. 使用 c4a sync 同步项目数据
```

**source_repo 检测**：

`c4a init` 会自动检测 Git remote URL 作为 `source_repo`。如果检测失败（当前目录不是 Git 仓库或未配置 remote），会强制要求用户手动输入：

```
$ c4a init

  C4A 项目初始化

? 项目标识 (project_id): my-project

⚠️  未检测到 Git remote，请手动输入仓库标识
   （用于标识实体来源，确保数据可追溯）

? 仓库标识 (source_repo): https://github.com/company/my-repo
```

> **设计理由**：`source_repo` 是数据完整性的必填字段。在 `c4a init` 阶段强制获取，可以避免后续创建实体时因缺少 `source_repo` 而报错（`C4A-INPUT-001`）。详见 [cross-project-auth.md#source_repo-获取失败时的处理](../permissions/cross-project-auth.md#source_repo-获取失败时的处理)。

**Skills 安装**：
- 根据用户选择的 AI IDE 安装对应配置
- Cursor: `.cursor/mcp.json` + `.cursorrules`
- Claude Code: `.mcp.json` + `.claude/settings.local.json`
  - `enabledMcpjsonServers` 需与 `.mcp.json` 中的服务名一致
  - 推荐服务名：`c4a-store-mcp`、`c4a-query-mcp`、`c4a-extract-mcp`、`c4a-visual-mcp`
- OpenCode: `.opencode/opencode.json`
- 全部安装：创建所有配置文件

#### `c4a install`

安装 C4A 运行模式。

**交互流程**：

```
$ c4a install

  选择安装模式

? 选择模式:
  > local  - 本地模式 (SQLite, 无需 Docker)
    server - 服务器模式 (MongoDB + Neo4j + Milvus)

─────────────────────────────────────────
选择: local
─────────────────────────────────────────

正在安装 Local 模式...

✅ 创建全局目录
   ~/.c4a/

✅ 初始化数据库
   ~/.c4a/store.db

✅ 下载 embedding 模型
   all-MiniLM-L6-v2 (80MB)

✅ 安装完成

使用方式:
  c4a sync    # 同步知识到本地数据库
  c4a status  # 查看状态
```

**`c4a install local`**：
1. 创建全局缓存目录
2. 初始化 SQLite 数据库
3. 下载本地 embedding 模型
4. 写入全局配置 `~/.c4a/config.yaml`

**`c4a install server`**：

```
$ c4a install server

  安装 Server 模式

检查依赖...
  ❌ Docker 未安装

? 是否自动安装 Docker?
  > 是 - 自动安装 (推荐)
    否 - 手动安装后重试

正在安装 Docker...
  [████████████████████████] 100%

✅ Docker 已安装

启动存储服务...
  ✅ MongoDB   :27017
  ✅ Neo4j     :7474/:7687
  ✅ Milvus    :19530
  ✅ Ollama    (embedding)

✅ 安装完成

服务管理:
  c4a server status   # 查看服务状态
  c4a server stop     # 停止服务
  c4a server restart  # 重启服务
  c4a server logs     # 查看日志
```

**依赖检查与安装**：
1. 检查 Docker 是否安装
2. 未安装则询问是否自动安装
3. 启动 Docker 容器（MongoDB + Neo4j + Milvus + Ollama）
4. 等待服务健康检查通过
5. 写入全局配置

**Remote 模式下的 `c4a install` 行为**：

当用户已配置 Remote 模式时，运行 `c4a install` 的语义是"切换到本地存储模式"：

```
$ c4a install

  切换存储模式

⚠️  您当前处于 Remote 模式
   远程服务: https://c4a.example.com:8051

安装 Local 或 Server 模式将切换到本地存储。
切换后，您需要重新同步数据到本地。

? 是否继续？
  > 是 - 安装本地存储模式
    否 - 保持 Remote 模式

─────────────────────────────────────────
选择: 是
─────────────────────────────────────────

? 选择模式:
  > local  - 本地模式 (SQLite, 无需 Docker)
    server - 服务器模式 (MongoDB + Neo4j + Milvus)

...（后续流程与正常安装相同）
```

**切换后的数据同步**：
- 切换模式后，本地数据库为空
- 用户需要运行 `c4a sync` 从远程服务拉取数据
- 或者从备份恢复：`c4a local restore` / `c4a server restore`

#### `c4a sync`

双向同步当前项目的架构知识（`.context/` ↔ 数据库）。

> **说明**：
> - DSL 实体在保存时自动双写（数据库 + 文件系统）
> - `c4a sync` 用于双向同步：本地新的推送到服务端，服务端新的拉取到本地
> - 默认同步主分支（`proposal_id=null`）
> - 可指定 feat：`c4a sync feat-a001-user-login`
> - 自动更新图谱关系（Neo4j）和向量索引（Milvus）

**基本用法**：

```bash
c4a sync                    # 同步主分支（双向）
c4a sync feat-a001          # 同步指定 feat（双向）
```

**交互流程**：

```
$ c4a sync

  同步架构知识 (双向)

检测变更...
  📁 本地: 3 个新增, 2 个修改
  ☁️  服务端: 1 个新增, 1 个修改

同步方向:
  ⬆️  本地 → 服务端: 5 个文件
  ⬇️  服务端 → 本地: 2 个文件

? 发现冲突文件:
    - container/api-gateway.yaml (本地和服务端都有修改)

? 冲突处理:
  > 使用本地版本
    使用服务端版本
    逐个确认
    取消同步

─────────────────────────────────────────
选择: 使用本地版本
─────────────────────────────────────────

正在同步...
  ⬆️  上传: system/my-system.yaml
  ⬆️  上传: container/user-service.yaml
  ⬆️  上传: container/api-gateway.yaml (覆盖服务端)
  ⬇️  下载: component/auth-handler.yaml
  ⬇️  下载: adrs/adr-002.yaml

更新图谱关系...
  ✅ Neo4j: 8 个关系已更新
  ✅ Milvus: 5 个向量已索引

✅ 同步完成
  - 上传: 3 个实体
  - 下载: 2 个实体
  - 冲突: 1 个（已解决）
```

**同步 feat**：

```
$ c4a sync feat-a001-user-login

  同步 feat (双向)

检测变更...
  📁 本地 feat: 2 个新增
  ☁️  服务端 feat: 1 个修改

正在同步...
  ⬆️  上传: feat/feat-a001-user-login/feat.yaml (Feat 元数据)
  ⬆️  上传: feat/feat-a001-user-login/technical/adrs/adr-003.yaml
  ⬆️  上传: feat/feat-a001-user-login/technical/containers/auth-service.yaml
  ⬇️  下载: feat/feat-a001-user-login/feat.yaml (状态更新)

✅ 同步完成
```

**Checklist 处理说明**：

> **关键设计**：Checklist **不参与同步**，数据库是唯一数据源。
> - Agent 通过 `c4a_store_feat_checklist` 直接操作数据库
> - CLI 的 `c4a feat render` 命令将数据库中的 checklist 渲染为本地 `checklist.md`（只读视图）
> - 本地文件仅供人类查看，不作为数据源，不参与 `c4a sync`

**存储策略**：
- **数据源**：MongoDB `feats` 集合的 `checklist` 字段（唯一权威源）
- **本地文件**：`.context/feat/{feat-id}/checklist.md`（渲染的只读视图）
- **同步方向**：单向：数据库 → 本地文件（仅渲染，不上传）

**设计理由**：
- **避免双重标准**：checklist 不是普通文件，不需要 CLI 硬编码特殊处理
- **避免状态分裂**：Agent 修改数据库后，不会与本地文件产生冲突
- **简化同步逻辑**：`c4a sync` 只处理 DSL 文件，checklist 由专用接口管理

**文件位置**：

```
.context/feat/feat-a001-user-login/
├── feat.yaml              # Feat 元数据（同步到服务端）
├── checklist.md           # Checklist 只读视图（渲染生成，不参与同步）
├── technical/
│   ├── adrs/
│   │   └── adr-003.yaml   # ADR（同步到服务端）
│   └── containers/
│       └── auth-service.yaml  # Container（同步到服务端）
```

**同步逻辑**：

1. 扫描 `.context/` 目录和数据库，比较时间戳
2. 本地新的 → 推送到服务端
3. 服务端新的 → 拉取到本地
4. 双方都修改 → 提示用户选择
5. 自动更新 Neo4j 关系图和 Milvus 向量索引
6. 失败时回滚事务

> **注意**：Checklist 不参与 `c4a sync`。Checklist 数据由 Agent 通过 `c4a_store_feat_checklist` MCP 工具直接操作数据库，本地文件通过 `c4a feat render` 命令从数据库拉取生成只读视图。

**注意事项**：
- 同步前会自动验证 DSL 格式
- 冲突检测基于 `metadata.updated_at` 字段
- Remote 模式下通过远程 MCP 服务的 HTTP API 实现
- 同步时自动更新图谱关系和向量索引

#### `c4a validate`

验证 DSL 文件的格式和一致性，主要用于 CI/CD 流程。

> **说明**：
> - 此命令专为 CI/CD 场景设计，用于在提交前或合并前验证 DSL 文件
> - 日常开发中，IDE 提供实时验证，`c4a sync` 在同步前自动验证
> - 验证范围：DSL 格式、Schema 合规性、引用完整性、关系有效性

**基本用法**：

```bash
c4a validate                    # 验证当前项目所有 DSL 文件
c4a validate .context/technical/containers/  # 验证指定目录
c4a validate .context/technical/containers/auth-service.yaml  # 验证单个文件
```

**交互流程**：

```
$ c4a validate

  验证 DSL 文件

扫描文件...
  📁 .context/technical/: 15 个文件
  📁 .context/business/: 8 个文件

正在验证...
  ✅ system/e-commerce-system.yaml
  ✅ container/user-service.yaml
  ✅ container/order-service.yaml
  ❌ container/payment-service.yaml
     - [Schema] 缺少必填字段: data.technology
     - [Reference] container_id 'invalid-id' 不存在
  ⚠️  component/auth-handler.yaml
     - [Warning] 缺少描述字段: data.description

验证完成
  - 总计: 23 个文件
  - 通过: 21 个
  - 错误: 1 个
  - 警告: 1 个

❌ 验证失败，发现 1 个错误
```

**CI/CD 集成示例**：

**Pre-commit Hook**：

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "验证 DSL 文件..."
c4a validate --quiet

if [ $? -ne 0 ]; then
  echo "❌ DSL 验证失败，请修复后再提交"
  exit 1
fi

echo "✅ DSL 验证通过"
```

**GitHub Actions**：

```yaml
name: Validate C4A DSL

on:
  pull_request:
    paths:
      - '.context/**/*.yaml'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install C4A CLI
        run: npm install -g @c4a/cli

      - name: Validate DSL files
        run: c4a validate --format=github
```

**命令参数**：

```bash
c4a validate [path]              # 验证指定路径（默认 .context/）
c4a validate --quiet             # 静默模式，仅输出错误
c4a validate --format=json       # JSON 格式输出（用于 CI）
c4a validate --format=github     # GitHub Actions 格式（带注释）
c4a validate --strict            # 严格模式，警告也视为错误
c4a validate --scope=published   # 仅验证已发布的实体
```

**输出格式**：

**JSON 格式**（`--format=json`）：

```json
{
  "success": false,
  "summary": {
    "total": 23,
    "passed": 21,
    "errors": 1,
    "warnings": 1
  },
  "results": [
    {
      "file": ".context/technical/containers/payment-service.yaml",
      "status": "error",
      "issues": [
        {
          "level": "error",
          "code": "C4A-INPUT-001",
          "message": "缺少必填字段: data.technology",
          "line": 5
        },
        {
          "level": "error",
          "code": "C4A-DATA-001",
          "message": "container_id 'invalid-id' 不存在",
          "line": 8
        }
      ]
    }
  ]
}
```

**GitHub Actions 格式**（`--format=github`）：

```
::error file=.context/technical/containers/payment-service.yaml,line=5::缺少必填字段: data.technology
::error file=.context/technical/containers/payment-service.yaml,line=8::container_id 'invalid-id' 不存在
::warning file=.context/technical/components/auth-handler.yaml,line=3::缺少描述字段: data.description
```

**验证规则**：

| 规则类型 | 说明 | 级别 |
|---------|------|------|
| **Schema 验证** | 检查字段类型、必填字段、格式 | Error |
| **引用完整性** | 检查 entity_id、container_id 等引用是否存在 | Warning（draft）/ Error（published） |
| **关系有效性** | 检查关系类型是否正确、方向是否合理 | Error |
| **命名规范** | 检查 ID 格式（字母、数字、连字符） | Error |
| **描述完整性** | 检查是否缺少描述字段 | Warning |
| **ADR 关联** | 检查 System/Container 是否关联 ADR | Warning（可配置） |

> **关键设计：引用完整性的状态感知**
>
> 为支持"先引用后实现"的工作流（如 feat 内先定义依赖关系，后创建被依赖的实体），引用完整性检查采用**状态感知**策略：
> - **draft/approved 状态**：悬空引用只报 Warning，不阻塞保存/同步
> - **published 状态**：悬空引用报 Error，必须解决后才能发布
>
> 这避免了"无法保存因为有悬空引用，无法创建被引用实体因为无法保存"的死循环。

**与其他验证机制的关系**：

| 验证时机 | 工具 | 用途 | 验证范围 |
|---------|------|------|---------|
| **编辑时** | IDE (JSON Schema) | 实时反馈 | 单文件格式 |
| **保存时** | `c4a_store_save` | 运行时检查 | 单实体完整性 |
| **同步前** | `c4a sync` | 自动验证 | 变更文件 |
| **提交前** | `c4a validate` | CI/CD 检查 | 全部文件 |

**验证职责边界**：

> **关键设计**：CLI 和 MCP 工具的验证职责明确分离，避免重复实现。

| 验证类型 | CLI (`c4a validate`) | MCP (`c4a_store_save`) |
|---------|---------------------|----------------------|
| **Schema 验证** | ✅ 批量文件 | ✅ 单实体 |
| **引用完整性** | ✅ 跨文件检查 | ❌ 不检查（允许悬空引用） |
| **关系有效性** | ✅ 全局检查 | ❌ 不检查 |
| **权限检查** | ❌ 不检查 | ✅ Server 模式检查 |
| **数据库连接** | ❌ 不需要 | ✅ 需要 |
| **适用场景** | CI/CD、批量验证 | 运行时保存 |

**`c4a validate` vs `c4a local validate` 区别**：

| 维度 | `c4a validate` | `c4a local validate` |
|------|---------------|---------------------|
| **验证对象** | 本地 DSL 文件（`.context/`） | 数据库中的实体 |
| **数据库连接** | ❌ 不需要（离线验证） | ✅ 需要（在线验证） |
| **验证内容** | DSL 格式、Schema、引用完整性 | 数据完整性、迁移兼容性 |
| **适用场景** | CI/CD、提交前检查 | 模式切换前、数据迁移前 |
| **错误类型** | 格式错误、引用错误 | 缺少必填字段、格式不兼容 |

**设计理由**：
- `c4a validate` 是离线验证，不依赖数据库，适合 CI/CD
- `c4a local validate` 是在线验证，检查数据库数据的迁移兼容性
- 两者职责不重叠：一个验证文件，一个验证数据库

**退出码**：

| 退出码 | 说明 |
|--------|------|
| 0 | 验证通过（无错误） |
| 1 | 验证失败（有错误） |
| 2 | 严格模式下有警告（`--strict`） |
| 3 | 命令参数错误 |

**注意事项**：
- 验证不会修改文件或数据库
- 验证速度快（纯文件扫描，不连接数据库）
- 适合在 pre-commit hook 或 CI pipeline 中使用
- 不替代运行时验证（`c4a_store_save` 仍会在保存时验证）

#### `c4a feat render`

渲染 Feat 相关内容到本地文件（只读视图）。

> **v0.3.0 说明**：
> - 当前版本仅支持渲染 **checklist**（默认目标）
> - 命令结构设计为可扩展，未来版本可能支持其他渲染目标（如 summary、timeline 等）
> - Checklist 数据存储在数据库中，本地文件仅供人类查看
> - Agent 通过 `c4a_store_feat_checklist` MCP 工具直接操作数据库

**数据获取方式**：

| 模式 | 数据获取方式 |
|------|-------------|
| **Local** | 直接查询本地 SQLite 数据库 |
| **Server** | 通过 stdio 调用 MCP 工具 `c4a_store_feat_checklist` |
| **Remote** | 通过 HTTP API 调用远程 MCP 服务 |

**基本用法**：

```bash
c4a feat render <feat-id>           # 渲染 checklist（默认）
c4a feat render feat-a001-user-login
# v0.3.0 暂不支持其他目标，以下为未来扩展预留：
# c4a feat render <feat-id> --target=checklist  # 显式指定目标
```

**交互流程**：

```
$ c4a feat render feat-a001-user-login

  渲染 Checklist

正在获取 Feat 数据...
  ✅ Feat: feat-a001-user-login
  ✅ 状态: approved
  ✅ Checklist: 12 个条目

正在渲染...
  ✅ 写入: .context/feat/feat-a001-user-login/checklist.md

✅ 渲染完成

文件位置: .context/feat/feat-a001-user-login/checklist.md

⚠️  注意: 此文件为只读视图，修改不会同步到数据库
    如需更新 Checklist，请使用 Agent 操作
```

**错误处理**：

```
$ c4a feat render invalid-feat-id

❌ 错误: Feat 'invalid-feat-id' 不存在

可用的 Feat:
  - feat-a001-user-login (approved)
  - feat-a002-payment (draft)
```

**命令参数**：

```bash
c4a feat render <feat-id>            # 渲染到默认位置
c4a feat render <feat-id> --output ./checklist.md  # 指定输出路径
c4a feat render <feat-id> --format=md   # Markdown 格式（默认）
c4a feat render <feat-id> --format=json # JSON 格式
```

#### `c4a template`

生成 DSL 模板文件。

**基本用法**：

```bash
c4a template <type>                  # 生成指定类型的 DSL 模板
c4a template system                  # 生成 System DSL 模板
c4a template container               # 生成 Container DSL 模板
c4a template component               # 生成 Component DSL 模板
c4a template adr                     # 生成 ADR DSL 模板
```

**交互流程**：

```
$ c4a template container

  生成 Container DSL 模板

? 容器 ID: user-service
? 容器名称: 用户服务
? 所属系统 ID: e-commerce-system

✅ 模板已生成

文件位置: .context/technical/containers/user-service.c4a.yaml

内容预览:
───────────────────────────────────────
type: container
id: user-service
data:
  name: 用户服务
  description: ""  # TODO: 添加描述
  system_id: e-commerce-system
  technology: []   # TODO: 添加技术栈
  kind: service
metadata:
  status: draft
  created_at: 2026-01-25T10:00:00Z
───────────────────────────────────────

下一步:
  1. 编辑文件补充详细信息
  2. 使用 c4a sync 同步到数据库
```

**命令参数**：

```bash
c4a template <type>                  # 交互式生成
c4a template <type> --id=<id>        # 指定 ID（跳过交互）
c4a template <type> --output=<path>  # 指定输出路径
c4a template <type> --stdout         # 输出到标准输出（不创建文件）
```

#### `c4a schema`

查看 DSL 的 JSON Schema 定义。

**基本用法**：

```bash
c4a schema <type>                    # 查看指定类型的 JSON Schema
c4a schema system                    # System DSL Schema
c4a schema container                 # Container DSL Schema
c4a schema component                 # Component DSL Schema
c4a schema adr                       # ADR DSL Schema
```

**交互流程**：

```
$ c4a schema container

  Container DSL JSON Schema

{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["type", "id", "data"],
  "properties": {
    "type": { "const": "container" },
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "data": {
      "type": "object",
      "required": ["name", "system_id"],
      "properties": {
        "name": { "type": "string" },
        "description": { "type": "string" },
        "system_id": { "type": "string" },
        "technology": { "type": "string" },
        "kind": { "enum": ["service", "database", "queue", "cache", "gateway"] }
      }
    }
  }
}

提示: 将此 Schema 配置到 IDE 可获得实时验证和自动补全
```

**命令参数**：

```bash
c4a schema <type>                    # 输出到终端
c4a schema <type> --output=<path>    # 输出到文件
c4a schema <type> --format=json      # JSON 格式（默认）
c4a schema <type> --format=yaml      # YAML 格式
c4a schema all                       # 输出所有类型的 Schema
```

#### `c4a rollback` (v0.4.0 计划)

紧急回滚指定的 feat，绕过常规审批流程。

> **v0.3.0 状态**：此命令计划在 v0.4.0 实现。当前版本用户需要通过创建"回滚 feat"手动执行回滚操作。
> 详见 [conflict-rollback.md#4.1](../data-ops/conflict-rollback.md#41-回滚流程)

**适用场景**：生产事故、安全漏洞等紧急情况

**基本用法**：

```bash
c4a rollback <feat-id> --reason="<reason>"
c4a rollback feat-a005-payment-refactor --reason="生产事故：支付服务宕机"
```

**交互流程**（v0.4.0 计划）：

```
$ c4a rollback feat-a005-payment-refactor --reason="生产事故：支付服务宕机"

⚠️  紧急回滚模式

feat: feat-a005-payment-refactor
发布时间: 2026-01-22 14:30:00
涉及实体: 5 个 (payment-service, order-service, ...)

? 确认回滚？此操作将立即生效，无法撤销。
  > 是，立即回���
    否，取消

─────────────────────────────────────────
选择: 是，立即回滚
─────────────────────────────────────────

正在回滚...
  ⏪ 恢复: payment-service (v2 → v1)
  ⏪ 恢复: order-service (v3 → v2)
  ⏪ 更新图谱关系...
  ⏪ 更新向量索引...

✓ 紧急回滚完成

审计记录已生成。请在 24 小时内补充正式的回滚 feat 文档。
```

**限制**：
- 仅限管理员使用（通过项目配置的 `admin_users` 列表验证）
- 必须提供回滚原因（`--reason` 参数，不少于 10 字）
- 24 小时内需补充正式 feat 文档（系统自动提醒）
- 紧急回滚次数有限制（每月不超过 3 次，超过需审批）

#### `c4a server` (仅 Server 模式安装后显示)

服务管理子菜单。

**交互菜单**：

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  server   ▶ 服务管理                 ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  > status     查看状态               ║
  ║    restart    重启服务               ║
  ║    stop       停止服务               ║
  ║    logs       查看日志               ║
  ║    backup     备份数据               ║
  ║    restore    恢复数据               ║
  ║    clean      清理数据               ║
  ║                                      ║
  ╚══════════════════════════════════════╝
```

**命令**：

```bash
c4a server status    # 查看服务状态
c4a server restart   # 重启所有服务
c4a server stop      # 停止所有服务
c4a server logs      # 查看日志
c4a server backup    # 备份全量数据为压缩包
c4a server restore   # 从压缩包恢复全量数据
c4a server clean     # 清理数据
c4a server check-permissions  # 检查备份文件的权限兼容性
```

**`c4a server backup` 详细流程**：

```
$ c4a server backup

  备份服务器数据 (MongoDB/Neo4j/Milvus → 压缩包)

? 备份文件名: c4a-backup-20260122-153045.tar.gz
? 是否包含草稿状态的实体?
  > 否 - 仅备份 published 状态 (推荐)
    是 - 备份所有状态

正在备份...
  ✅ 导出 MongoDB: 50 个实体
  ✅ 导出 Neo4j: 120 个关系
  ✅ 导出 Milvus: 50 个向量
  ✅ 压缩数据...

✅ 备份完成
  文件: ./c4a-backup-20260122-153045.tar.gz
  大小: 2.3 MB
  包含: 50 个实体, 120 个关系
```

**`c4a server restore` 详细流程**：

> **权限校验**：Server 模式下恢复数据时会检查当前用户对各项目的写权限。
> 详见 [cross-project-auth.md#1.1.3](../permissions/cross-project-auth.md#113-local--server-数据迁移时的权限校验)。

```
$ c4a server restore c4a-backup-20260122-153045.tar.gz

  恢复服务器数据 (压缩包 → MongoDB/Neo4j/Milvus)

⚠️  警告: 恢复操作将覆盖现有数据

? 确认恢复?
  > 是 - 继续恢复
    否 - 取消操作

正在恢复...
  ✅ 解压数据...
  ✅ 导入 MongoDB: 50 个实体
  ✅ 重建 Neo4j 关系: 120 个关系
  ✅ 重建 Milvus 向量: 50 个向量

✅ 恢复完成
  - 实体: 50 个
  - 关系: 120 个
  - 向量: 50 个
```

**权限校验失败时的流程**：

```
$ c4a server restore backup.tar.gz

  恢复服务器数据 (压缩包 → MongoDB/Neo4j/Milvus)

正在检查权限...

⚠️  权限校验失败

以下实体无法导入（权限不足）：
1. auth-service (project: backend-api)
   建议：联系项目管理员 @bob 授权

2. payment-db (project: infrastructure)
   建议：联系项目管理员 @charlie 授权

导入结果：
✅ 成功：15 个实体
❌ 失败：2 个实体（权限不足）

? 如何处理？
  > 联系项目管理员授权后重试
    跳过失败的实体，继续使用已导入的数据
    取消导入，回滚所有变更
```

**`c4a server check-permissions` 详细流程**：

检查备份文件中的实体在当前用户权限下是否可以导入。用于迁移前的权限预检查。

```
$ c4a server check-permissions --backup backup.tar.gz --user alice@example.com

  权限预检查

正在分析备份文件...
  ✅ 解析: backup.tar.gz
  ✅ 实体数量: 50 个
  ✅ 涉及项目: 3 个

检查用户权限: alice@example.com

项目权限检查:
  ✅ backend-api: 有写权限
  ❌ infrastructure: 无写权限（需要联系 @bob 授权）
  ✅ frontend-app: 有写权限

实体导入预测:
  - 可导入: 42 个实体
  - 无权限: 8 个实体（属于 infrastructure 项目）

⚠️  部分实体无法导入

建议:
  1. 联系 @bob 获取 infrastructure 项目的写权限
  2. 或使用 --skip-unauthorized 参数跳过无权限的实体
```

**命令参数**：

```bash
c4a server check-permissions --backup <file>           # 检查备份文件
c4a server check-permissions --backup <file> --user <email>  # 指定用户
c4a server check-permissions --backup <file> --format=json   # JSON 格式输出
```

#### `c4a local` (仅 Local 模式安装后显示)

本地数据管理子菜单。

**交互菜单**：

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  local    ▶ 本地管理                 ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  > status     数据库状态             ║
  ║    validate   检查数据完整性         ║
  ║    repair     修复数据问题           ║
  ║    backup     备份数据               ║
  ║    restore    恢复数据               ║
  ║    clean      清理数据库             ║
  ║    vacuum     压缩数据库             ║
  ║                                      ║
  ╚══════════════════════════════════════╝
```

**命令**：

```bash
c4a local status     # 查看数据库状态
c4a local validate   # 检查数据完整性
c4a local repair     # 修复数据完整性问题
c4a local backup     # 备份全量数据为压缩包
c4a local restore    # 从压缩包恢复全量数据
c4a local clean      # 清理本地数据库
c4a local vacuum     # 压缩数据库
```

**`c4a local validate` 详细流程**：

> **MCP 工具调用**：`c4a local validate` 底层调用 `c4a_store_validate` MCP 工具进行数据完整性检查。
> 该工具检查数据库中实体的格式、必填字段、引用完整性等，返回错误和警告列表。

```
$ c4a local validate

  数据完整性校验

正在扫描实体...
  ✅ 已扫描 50 个实体

检查结果:

❌ 发现 3 个错误:

  auth-service (container):
    - [C4A-MIGRATE-001] 缺少 source_project 字段
      修复: 需要指定实体归属的项目
    - [C4A-MIGRATE-002] 缺少 source_repo 字段
      修复: 需要指定实体归属的代码仓库

  payment-service (container):
    - [C4A-MIGRATE-001] 缺少 source_project 字段
      修复: 需要指定实体归属的项目

  user-db (container):
    - [C4A-MIGRATE-003] source_project 格式不正确
      修复: 只能包含小写字母、数字和连字符

⚠️  发现 2 个警告:

  order-state-machine (process):
    - [C4A-MIGRATE-005] domain 层级实体不应有 source_project
      建议: 移除 source_project 字段

  mongodb (container):
    - [C4A-MIGRATE-008] external 实体缺少 external_url
      建议: 添加外部系统的 URL

=================================================
总计: 3 个错误, 2 个警告

⚠️  迁移到 Server 模式前必须修复所有错误
使用 "c4a local repair" 自动修复这些问题
```

**命令参数**：

```bash
c4a local validate                    # 检查所有实体
c4a local validate --status=published # 仅检查已发布实体
c4a local validate --format=json      # JSON 格式输出（用于 CI/CD）
c4a local validate --quiet            # 静默模式，仅输出错误
```

**`c4a local repair` 详细流程**：

```
$ c4a local repair

  数据完整性修复

正在读取项目配置...
  ✅ 项目 ID: my-project
  ✅ 仓库 ID: company/my-repo

正在修复实体...

  auth-service (container):
    ✅ 补全 source_project: my-project
    ✅ 补全 source_repo: company/my-repo

  payment-service (container):
    ✅ 补全 source_project: my-project
    ✅ 补全 source_repo: company/my-repo

  user-db (container):
    ✅ 修复 source_project 格式: User_DB → user-db

  order-state-machine (process):
    ✅ 移除不应存在的 source_project 字段

  mongodb (container):
    ⏭️  跳过: external_url 缺失（需要手动补充）

=================================================
修复完成:
  - 成功: 4 个实体
  - 跳过: 1 个实体（需要手动处理）

⚠️  以下实体需要手动处理:
  - mongodb: 缺少 external_url，请手动添加外部系统的 URL
```

**命令参数**：

```bash
c4a local repair                                      # 自动修复所有问题
c4a local repair --dry-run                            # 预览修复操作（不实际修改）
c4a local repair --entity-ids=auth-service,payment-service  # 仅修复特定实体
```

**`c4a local backup` 详细流程**（含数据完整性检查）：

```
$ c4a local backup

  备份本地数据 (SQLite → 压缩包)

? 备份文件名: c4a-backup-20260124.tar.gz
? 是否包含草稿状态的实体?
  > 否 - 仅备份 published 状态 (推荐)
    是 - 备份所有状态

正在扫描实体...
  ✅ 已扫描 50 个实体

⚠️  数据完整性检查失败

发现 3 个实体缺少必要字段:
  - auth-service (container): 缺少 source_project
  - payment-service (container): 缺少 source_project
  - user-db (container): source_project 格式不正确

? 如何处理？
  > 自动补全缺失字段（使用当前项目配置）
    跳过这些实体，仅备份有效数据
    取消备份，手动修复后重试

─────────────────────────────────────���───
选择: 自动补全缺失字段
─────────────────────────────────────────

正在修复...
  ✅ auth-service: 补全 source_project = my-project
  ✅ payment-service: 补全 source_project = my-project
  ✅ user-db: 修复 source_project 格式

正在备份...
  ✅ 导出 SQLite: 50 个实体
  ✅ 导出关系: 120 个关系
  ✅ 导出向量: 50 个向量
  ✅ 压缩数据...

✅ 备份完成
  文件: ./c4a-backup-20260124.tar.gz
  大小: 2.3 MB
  包含: 50 个实体, 120 个关系
```

**`c4a local restore` 详细流程**：

```
$ c4a local restore c4a-backup-20260122-153045.tar.gz

  恢复本地数据 (压缩包 → SQLite)

⚠️  警告: 恢复操作将覆盖现有数据

? 确认恢复?
  > 是 - 继续恢复
    否 - 取消操作

正在恢复...
  ✅ 解压数据...
  ✅ 导入 SQLite: 20 个实体
  ✅ 重建关系: 45 个关系
  ✅ 重建向量: 20 个向量

✅ 恢复完成
  - 实体: 20 个
  - 关系: 45 个
  - 向量: 20 个
```

**模式切换示例**（推荐流程）：

```bash
# Local → Server（推荐流程）
# 1. 检查数据完整性
c4a local validate

# 2. 自动修复问题
c4a local repair

# 3. 再次验证
c4a local validate

# 4. 备份数据（会再次校验）
c4a local backup --output ./backup.tar.gz

# 5. 切换到 Server 模式
# 编辑 .context/.c4a.yaml，设置 mode: server

# 6. 恢复数据到 Server
c4a server restore ./backup.tar.gz --conflict-policy=merge

# Server → Local
c4a server backup --output ./backup.tar.gz
c4a local restore ./backup.tar.gz
```

#### 多模式支持

用户可以同时安装 Local 和 Server 模式，每个项目通过项目配置选择使用哪种模式。

**协作场景示例**：

团队成员 A（本地开发）：
```yaml
# ~/.c4a/config.yaml (成员 A)
local:
  installed_at: "2026-01-22T10:00:00Z"
  # ...

# .context/.c4a.yaml (项目配置)
mode: local  # 使用本地模式
```

团队成员 B（远程协作）：
```yaml
# ~/.c4a/config.yaml (成员 B)
server:
  installed_at: "2026-01-22T11:00:00Z"
  # ...

# .context/.c4a.yaml (项目配置)
mode: server  # 使用团队共享服务
server:
  url: https://c4a.team.com:8055
```

#### 模式切换

通过修改项目配置的 `mode` 字段切换模式：

```bash
# 方式 1: 直接编辑项目配置
vim .context/.c4a.yaml
# 修改 mode: local → mode: server

# 方式 2: 通过 c4a init 重新配置
c4a init
# 选择新的模式
```

**注意**：
- 切换模式前需要先安装对应模式（`c4a install local/server`）
- 切换模式不会自动迁移数据
### 2.4 全局配置

`~/.c4a/config.yaml`:

```yaml
# C4A 全局配置 - 记录"装了什么"
version: 0.3.0

# Local 模式安装信息
local:
  db_path: ~/.c4a/store.db
  embedding_model: all-MiniLM-L6-v2
  installed_at: "2026-01-22T10:00:00Z"

# Server 模式安装信息（可选）
server:
  url: http://localhost:8051  # 本地 Docker 服务地址
  installed_at: "2026-01-22T11:00:00Z"
  services:
    mongodb: localhost:27017
    neo4j: localhost:7474
    milvus: localhost:19530

# Remote 模式选择记录（可选）
remote:
  # 不安装本地存储，使用项目配置的远程服务
  selected_at: "2026-01-22T12:00:00Z"
```

**说明**：
- 全局配置只记录"装了什么"（安装信息）
- 不记录"用什么"（使用模式由项目配置决定）
- 团队成员可以有不同的全局配置（各自装了什么）
- 但项目配置统一（决定这个项目用什么模式）

### 2.5 项目配置

`.context/.c4a.yaml`:

```yaml
# C4A 项目配置
repo_id: company/my-repo
project_id: my-project

# 项目使用的模式（覆盖全局配置）
mode: local  # local | server | remote

# Skills 配置
skills:
  cursor: true
  claude: false
  opencode: false

# ADR 策略配置
adr_policy:
  enforce: true  # 是否强制要求 ADR
  scope: ["system", "container"]  # 哪些类型需要 ADR（可选 component）
  on_missing: "error"  # error | warning | ignore

# Server 模式配置（mode: server 时使用）
server:
  url: http://localhost:8051  # 本地服务或团队共享服务地址

# Remote 模式配置（mode: remote 时使用）
remote:
  url: https://c4a.example.com:8051
  # v0.3.0 暂不支持认证，允许匿名访问
  # 认证功能将在后续版本中实现
```

**ADR 策略说明**：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `enforce` | 是否强制要求 ADR | `false` |
| `scope` | 哪些实体类型需要 ADR | `["system", "container"]` |
| `on_missing` | 缺少 ADR 时的行为 | `"warning"` |

**`on_missing` 行为**：

| 值 | 行为 | 适用场景 |
|----|------|----------|
| `error` | 阻止发布，返回错误 | 严格模式，强制架构决策记录 |
| `warning` | 允许发布，但显示警告 | 推荐模式，提醒但不阻止 |
| `ignore` | 不检查 ADR | 宽松模式，适合快速迭代 |

**示例场景**：

```yaml
# 场景 1：严格模式（企业级项目）
adr_policy:
  enforce: true
  scope: ["system", "container", "component"]
  on_missing: "error"

# 场景 2：推荐模式（团队协作）
adr_policy:
  enforce: true
  scope: ["system", "container"]
  on_missing: "warning"

# 场景 3：宽松模式（个人项目/快速原型）
adr_policy:
  enforce: false
  on_missing: "ignore"
```

**数据存储说明**：
- **DSL 实体**：数据库 + 文件系统双写（数据库用于查询，文件系统用于版本控制）
  - 保存时自动双写到数据库和文件系统
  - 用户手动编辑 DSL 文件后，使用 `c4a sync` 同步到数据库
- **Feat 元数据**：数据库 + 文件系统（`feat.yaml`，自动同步）
- **Checklist**：数据库是唯一数据源，本地 `checklist.md` 是只读视图
  - Agent 通过 `c4a_store_feat_checklist` 直接操作数据库
  - CLI 通过 `c4a feat render` 渲染到本地
  - 详见 [mcp-tools.md#c4a_store_feat_checklist](./mcp-tools.md#37-c4a_store_feat_checklist-checklist-管理)
- **Assets**：仅文件系统（原始文档、生成的图片）
  - **不在 C4A 同步范围内**，由 Git 进行版本控制
- **Contracts**：仅文件系统（大型契约文件，如 OpenAPI YAML）
  - **不在 C4A 同步范围内**，由 Git 进行版本控制
  - Contract 实体的 `spec_uri` 字段指向这些文件

**`c4a sync` 同步范围**：
- ✅ 同步：DSL 实体文件（`.yaml` 文件）
- ❌ 不同步：Assets 目录、Contracts 目录下的非 DSL 文件
- 这些非 DSL 文件应通过 Git 进行版本控制

> **Remote 模式限制**：Remote 模式下，Server 端无法访问本地的 Assets 和 Contracts 文件。
> 涉及深度解析 Contract 内容的服务端功能（如契约一致性检查、代码生成）在 Remote 模式下可能不可用。
> 这些功能需要在 Local 或 Server 模式下使用，或通过 Git 共享文件后在服务端本地执行。

### 2.6 Remote 模式详细设计

#### 选择 Remote 模式

用户在首次运行引导中选择 `remote` 选项：

```
$ c4a

  ╔══════════════════════════════════════╗
  ║  欢迎使用 C4A CLI                    ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  检测到尚未安装存储模式              ║
  ║                                      ║
  ║  > local   - 本地模式                ║
  ║    server  - 服务模式                ║
  ║    remote  - 远程模式                ║
  ║    skip    - 稍后决定                ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  远程模式: 不安装本地存储，使用项目配置的远程服务，适合使用团队共享服务

  ↑/↓ 选择  Enter 确认  q 退出
```

选择 `remote` 后：

```
─────────────────────────────────────────
选择: remote
─────────────────────────────────────────

✅ 已选择 Remote 模式

Remote 模式不需要安装本地存储服务。
远程服务地址将从项目配置 (.context/.c4a.yaml) 中读取。

配置示例:
  .context/.c4a.yaml:
    remote:
      url: https://c4a.example.com:8051

下一步:
  1. 在项目中运行 c4a init 初始化配置
  2. 在 .context/.c4a.yaml 中配置远程服务地址

> **注意**：v0.3.0 暂不支持认证，远程服务允许匿名访问。
```

#### Remote 模式下的命令可用性

| 命令 | 可用性 | 说明 |
|------|--------|------|
| `c4a init` | ✅ 可用 | 初始化项目配置，需配置 remote.url |
| `c4a sync` | ✅ 可用 | 双向同步项目数据到远程数据库 |
| `c4a status` | ✅ 可用 | 显示项目配置和远程连接状态 |
| `c4a install` | ✅ 可用 | 可切换到其他模式 |
| `c4a server` | ❌ 不可用 | 无本地服务 |
| `c4a local` | ❌ 不可用 | 无本地数据库 |
| `c4a help` | ✅ 可用 | 显示帮助信息 |

#### Remote 模式的 `c4a init`

```
$ c4a init

  C4A 项目初始化

? 项目标识 (project_id): my-project
? 仓库标识 (repo_id): company/my-repo
? 选择项目使用的模式:
  > local  - 使用本地数据库
    server - 使用 Docker 服务
    remote - 使用远程服务

─────────────────────────────────────────
选择: remote
─────────────────────────────────────────

? 远程 MCP 服务地址: https://c4a.example.com:8051
? 选择 AI IDE:
  > Cursor
    Claude Code
    OpenCode
    全部安装

✅ 初始化完成

已创建:
  .context/
  ├── .c4a.yaml          # 项目配置（mode: remote）
  ├── business/          # 业务视角（可选，用于本地查看）
  └── technical/         # 技术视角（可选，用于本地查看）

已安装 Skills:
  .cursor/mcp.json       # Cursor 配置（指向远程服务）
  .cursorrules           # Cursor 规则

下一步:
  使用 Agent 创建架构知识（自动同步到远程服务）

> **注意**：v0.3.0 暂不支持认证，远程服务允许匿名访问。Token 认证将在后续版本中实现。
```

#### Remote 模式的 `c4a status`

```
$ c4a status

  C4A 状态

全局配置:
  配置文件: ~/.c4a/config.yaml
  已安装模式: Local, Server

项目配置:
  项目 ID: my-project
  仓库 ID: company/my-repo
  使用模式: remote
  配置文件: .context/.c4a.yaml

远程服务:
  地址: https://c4a.example.com:8051
  状态: ✅ 连接正常
  延迟: 45ms

Skills:
  Cursor: ✅ 已配置
  Claude Code: ❌ 未配置
  OpenCode: ❌ 未配置
```

#### Remote 模式的 `c4a sync`

Remote 模式下，`c4a sync` 通过远程 MCP 服务的 HTTP API 实现双向同步。


---
