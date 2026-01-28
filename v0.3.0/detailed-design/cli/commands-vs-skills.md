## 5. CLI 命令 vs Command (Skills)

**CLI 命令**：
- 用户直接执行的命令（如 `c4a init`, `c4a sync`）
- 提供基础的项目管理和数据同步功能
- 不涉及架构知识的创建和编辑

**Command (Skills)**：
- Agent 在对话中调用的工作流
- 通过 MCP 工具操作架构知识
- 如 `/c4a:feat`, `/c4a:specify`, `/c4a:plan`

**功能对比**：

| 功能 | CLI 命令 | Command (Skill) |
|------|---------|----------------|
| 初始化项目 | `c4a init` | 无 |
| 同步知识 | `c4a sync` | 无需（Agent 自动调用 MCP） |
| 查看状态 | `c4a status` | 无需（Agent 自动调用 MCP） |
| 验证 DSL | `c4a validate` | 无需（Agent 自动调用 MCP） |
| 安装模式 | `c4a install` | 无 |
| 渲染 Checklist | `c4a feat render` | 无需（Agent 自动调用 MCP） |
| 生成模板 | `c4a template` | 无 |
| 查看 Schema | `c4a schema` | 无 |
| 备份数据 | `c4a server backup` / `c4a local backup` | 无 |
| 创建 feat | 无 | `/c4a:feat` |
| 架构分析 | 无 | `/c4a:analyze` |
| 生成 DSL | 无 | `/c4a:specify` |
| 架构规划 | 无 | `/c4a:plan` |

**CLI 命令清单**：

```bash
c4a init              # 初始化项目
c4a sync              # 同步数据
c4a status            # 查看状态
c4a validate          # 验证 DSL 文件
c4a install           # 安装模式
c4a server            # 服务管理（仅 Server 模式）
c4a local             # 本地管理（仅 Local 模式）
c4a feat render <id>  # 渲染 Checklist
c4a template <type>   # 生成 DSL 模板
c4a schema <type>     # 查看 JSON Schema
c4a help              # 帮助信息
```

---

## 5. MCP 工具来源

### 5.1 用户 CLI 的 MCP 工具

**Local 模式**：
- 内嵌在 CLI 中（编译时打包）
- 来源：`packages/cli/dist/core/`
- 不依赖外部 MCP 服务

**Server 模式**：
- 连接远程 MCP 服务
- 来源：用户通过 `c4a install server` 启动的 Docker 容器
- 不使用开发环境的 MCP 服务

**Remote 模式**：
- 连接团队共享的远程 MCP 服务
- 来源：项目配置中指定的远程服务地址
- 不安装本地存储

### 5.2 开发 CLI 的 MCP 工具

**来源**：
- 本地源码：`packages/mcp-code/`, `packages/mcp-data/`
- 用于开发和调试

**不混用**：
- 开发 CLI 不使用编译后的用户 CLI
- 用户 CLI 不依赖开发环境

---

