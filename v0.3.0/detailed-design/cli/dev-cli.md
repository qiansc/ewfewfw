## 3. 开发 CLI 设计

### 3.1 交互式菜单

```
$ ./start.sh

  ╔══════════════════════════════════════╗
  ║  C4A Dev CLI                         ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  > dev        本地开发               ║
  ║    docker     全 Docker 模式         ║
  ║    debug    ▶ 调试 MCP               ║
  ║    server   ▶ 服务管理               ║
  ║    build      编译用户 CLI           ║
  ║    install    安装依赖               ║
  ║    clean    ▶ 清理数据               ║
  ║    test       运行测试               ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  本地开发: 存储服务 Docker 运行，MCP Server 本地运行，支持热重载

  ↑/↓ 选择  → 展开  Enter 确认  q 退出
```

**菜单说明**（根据光标位置动态显示）：
- **dev**：存储服务 Docker 运行，MCP Server 本地运行，支持热重载，适合日常开发
- **docker**：所有服务容器化运行，暴露 HTTP 端口，适合 CI/CD 和团队共享
- **debug**：前台运行 MCP 服务，可直接查看日志，适合调试
- **server**：管理服务状态（status/restart/stop/logs）
- **build**：编译用户 CLI，打包 Skills 和 MCP 工具
- **install**：安装项目依赖（TypeScript + Python）
- **clean**：清理数据（远程存储/本地文件/全部）
- **test**：运行项目测试

### 3.2 命令列表

```bash
./start.sh                  # 交互式菜单
./start.sh dev              # 启动开发环境
./start.sh docker           # Docker 模式
./start.sh debug:code       # 调试 mcp-extract
./start.sh debug:store      # 调试 mcp-store
./start.sh status           # 服务状态
./start.sh restart          # 重启所有服务
./start.sh stop             # 停止服务
./start.sh logs [service]   # 查看日志
./start.sh build            # 编译用户 CLI
./start.sh build --publish  # 编译并发布到 npm
./start.sh install          # 安装依赖
./start.sh test             # 运行测试
./start.sh clean            # 清理全部数据
./start.sh clean:storage    # 清理远程存储
./start.sh clean:local      # 清理本地文件
```

**server 子菜单**：

```
$ ./start.sh

  ╔══════════════════════════════════════╗
  ║  server   ▶ 服务管理                 ║
  ╠══════════════════════════════════════╣
  ║                                      ║
  ║  > status     查看状态               ║
  ║    restart    重启服务               ║
  ║    stop       停止服务               ║
  ║    logs       查看日志               ║
  ║                                      ║
  ╚══════════════════════════════════════╝
```

### 3.3 新增：`build` 命令

编译用户 CLI，打包 Skills 和 MCP 工具。

**执行流程**：

```
$ ./start.sh build

  编译用户 CLI

1. 编译 TypeScript
   ✅ packages/cli/src/ → packages/cli/dist/

2. 打包 Skills
   ✅ prompts/skills/ → packages/cli/dist/skills/

3. 内嵌 MCP 工具 (Local 模式)
   ✅ mcp-extract 核心逻辑 → packages/cli/dist/core/extract/
   ✅ store 核心逻辑 → packages/cli/dist/core/store/

4. 复制资源文件
   ✅ JSON Schema → packages/cli/dist/schemas/
   ✅ embedding 模型配置 → packages/cli/dist/models/

5. 生成 package.json
   ✅ packages/cli/dist/package.json

✅ 编译完成

输出目录: packages/cli/dist/
大小: 12.5 MB

测试:
  cd packages/cli/dist && npm link
  c4a --version
```

**`./start.sh build --publish`**：

```
$ ./start.sh build --publish

  编译并发布用户 CLI

[执行 build 流程...]

✅ 编译完成

发布到 npm...
  ? 版本号: 0.3.0
  ? 确认发布? (y/n): y

  npm publish packages/cli/dist/

✅ 发布成功

  @c4a/cli@0.3.0
  https://www.npmjs.com/package/@c4a/cli
```

### 3.4 依赖检查延迟

**原设计**：启动时检查所有依赖（bun, uv, docker, ttyd）

**新设计**：按需检查

```typescript
// packages/cli-dev/src/index.tsx
const args = process.argv.slice(2);

// 不再前置检查依赖
// await checkDependencies();  // ❌ 删除

if (args.length > 0) {
  await runCommand(args[0], args.slice(1));
} else {
  render(React.createElement(App));
}
```

```typescript
// packages/cli-dev/src/commands/dev.ts
async function cmdDev() {
  // 仅在需要时检查
  await checkDependencies(['docker', 'bun', 'uv']);  // ✅
  
  // 启动服务...
}
```

**检查时机**：

| 命令 | 检查依赖 |
|------|---------|
| `dev` | docker, bun, uv |
| `docker` | docker |
| `prod` | docker |
| `debug:dsl` | bun |
| `debug:code` | bun |
| `debug:data` | uv |
| `build` | bun |
| `install` | bun, uv (可选) |
| `test` | bun |
| 其他 | 无 |

---

