## 6. 目录结构

### 6.1 用户 CLI

```
packages/cli/
├── src/
│   ├── index.tsx
│   ├── App.tsx
│   ├── commands/
│   │   ├── init.ts
│   │   ├── sync.ts
│   │   ├── status.ts
│   │   ├── install.ts       # 新增
│   │   ├── server.ts        # 新增
│   │   └── local.ts         # 新增
│   ├── components/
│   │   ├── CascadeMenu.tsx
│   │   ├── InstallWizard.tsx  # 新增
│   │   └── ...
│   ├── core/
│   │   ├── store/           # SQLite (Local 模式)
│   │   ├── extract/          # 内嵌 mcp-extract 逻辑
│   │   └── config.ts
│   └── utils/
│       ├── docker.ts        # 新增：Docker 管理
│       └── ...
├── dist/                    # 编译输出（build 生成）
│   ├── index.js
│   ├── skills/              # 打包的 Skills
│   ├── core/                # 内嵌的 MCP 逻辑
│   ├── schemas/             # JSON Schema
│   └── package.json
└── package.json
```

### 6.2 开发 CLI

```
packages/cli-dev/
├── src/
│   ├── index.tsx
│   ├── App.tsx
│   ├── commands/
│   │   ├── dev.ts
│   │   ├── build.ts         # 新增：编译用户 CLI
│   │   └── ...
│   ├── components/
│   └── utils/
│       ├── build.ts         # 新增：编译逻辑
│       └── ...
└── package.json
```

---

## 7. 迁移计划

### 7.1 步骤

1. **重命名现有 CLI**
   ```bash
   mv packages/cli packages/cli-dev
   ```

2. **更新 start.sh**
   ```bash
   exec bun "$SCRIPT_DIR/packages/cli-dev/src/index.tsx" "$@"
   ```

3. **创建用户 CLI 骨架**
   ```bash
   mkdir -p packages/cli/src/{commands,components,core,utils}
   ```

4. **实现核心功能**
   - P0: `c4a init`
   - P0: `c4a install local`
   - P0: `c4a install server`
   - P1: `c4a sync`
   - P1: `c4a status`
   - P2: `c4a server/*`
   - P2: `c4a local/*`

5. **实现编译功能**
   - P1: `./start.sh build`
   - P2: `./start.sh build --publish`

### 7.2 优先级

| 阶段 | 任务 | 优先级 |
|------|------|--------|
| P0 | 重命名 cli → cli-dev | 高 |
| P0 | 实现 `c4a init` | 高 |
| P0 | 实现 `c4a install local` | 高 |
| P0 | 实现 `c4a install server` | 高 |
| P1 | 实现 `c4a sync` | 高 |
| P1 | 实现 `c4a status` | 高 |
| P1 | 实现 `./start.sh build` | 高 |
| P2 | 实现 `c4a server/*` | 中 |
| P2 | 实现 `c4a local/*` | 中 |
| P2 | 实现 `./start.sh build --publish` | 中 |
| P3 | npm 发布流程 | 低 |

---

## 8. 总结

### 8.1 核心变化

1. **用户 CLI 支持三种模式**：Local (SQLite)、Server (Docker) 和 Remote (远程服务)
2. **通过 `c4a install` 选择模式**：local、server 或 remote
3. **动态菜单**：根据安装的模式显示 `server` 或 `local` 子菜单
4. **开发 CLI 增加编译能力**：`./start.sh build`
5. **依赖检查延迟**：仅在需要时检查
6. **CLI 命令与 Command 分离**：不重复实现

### 8.2 用户体验

**首次使用**：

```bash
# 1. 安装
npm install -g @c4a/cli

# 2. 安装运行模式（全局）
c4a install local      # 或 c4a install server

# 3. 初始化项目（选择项目使用的模式）
cd my-project
c4a init
# 选择: local / server / remote

# 4. 使用 Agent 创建知识
# (通过 Cursor/Claude/OpenCode)

# 5. 同步到数据库（如果使用 local/server 模式）
c4a sync
```

**团队协作**：

```bash
# 成员 A: 本地开发
c4a install local
cd team-project
c4a init  # 选择 mode: local

# 成员 B: 使用团队共享服务
c4a install server
cd team-project
c4a init  # 选择 mode: server, url: https://c4a.team.com:8050

# 成员 C: 仅使用远程服务
# 无需安装本地模式
cd team-project
c4a init  # 选择 mode: remote, url: https://c4a.team.com:8050
```

**日常使用**：

```bash
# 交互式菜单
c4a

# 或直接命令
c4a sync
c4a status
c4a server status  # Server 模式
c4a local status   # Local 模式
```
