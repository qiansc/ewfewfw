/**
 * 菜单数据结构
 */
export interface MenuItem {
  id: string;
  label: string;
  description: string;
  children?: MenuItem[];
  separator?: boolean;
}

export const menuTree: MenuItem[] = [
  { id: "dev", label: "dev", description: "本地开发" },
  { id: "restart", label: "restart", description: "重启服务" },
  { id: "docker", label: "docker", description: "全 Docker 模式" },
  { id: "prod", label: "prod", description: "生产部署" },
  {
    id: "debug",
    label: "debug",
    description: "调试 MCP",
    children: [
      { id: "debug:dsl", label: "dsl", description: "DSL MCP" },
      { id: "debug:code", label: "code", description: "Code MCP" },
      { id: "debug:data", label: "data", description: "Data MCP" },
    ],
  },
  {
    id: "server",
    label: "server",
    description: "服务管理",
    children: [
      { id: "status", label: "status", description: "查看状态" },
      { id: "stop", label: "stop", description: "停止服务" },
      { id: "logs", label: "logs", description: "查看日志" },
    ],
  },
  { id: "install", label: "install", description: "安装依赖" },
  {
    id: "clean",
    label: "clean",
    description: "清理数据",
    children: [
      { id: "clean:storage", label: "storage", description: "清理远程存储" },
      { id: "clean:local", label: "local", description: "清理本地文件" },
      { id: "clean", label: "all", description: "清理全部数据" },
    ],
  },
  { id: "test", label: "test", description: "运行测试" },
];

/**
 * 命令帮助说明（单行格式，句号结尾）
 */
export const helpDescriptions: Record<string, string> = {
  dev: "启动存储服务(Docker) + mcp-data，带健康检查和自动重试。使用 ./start.sh dev --force 强制重启。",
  restart: "重启所有服务，包括 mcp-data 和 ttyd。适用于服务异常时恢复。",
  docker: "所有 MCP 服务容器化运行，暴露 HTTP 端口供远程 Agent 调用。适合团队共享和 CI/CD。",
  prod: "生产级部署，启用健康检查和自动重启，支持 TLS/认证。适合正式环境。",
  debug: "按 → 展开子菜单，选择要调试的 MCP 服务，前台运行可直接看日志。",
  "debug:dsl": "前台运行 mcp-dsl (stdio 模式)，可直接看到输入输出日志，Ctrl+C 退出。",
  "debug:code": "前台运行 mcp-code (stdio 模式)，可直接看到输入输出日志，Ctrl+C 退出。",
  "debug:data": "前台运行 mcp-data (HTTP 模式)，可直接看到请求日志，Ctrl+C 退出。",
  server: "按 → 展开子菜单，管理服务状态、日志和数据清理。",
  status: "显示所有服务运行状态，包括 HTTP 健康检查和日志文件位置。",
  stop: "停止所有运行中的服务，包括 Docker 容器和本地进程。",
  logs: "查看 Docker 容器日志，可指定服务名如 logs mongodb。",
  install: "安装项目依赖：TypeScript (bun install) + Python (uv sync)。",
  test: "运行项目测试：bun test (TypeScript) + pytest (Python)。",
  clean: "按 → 展开子菜单，选择清理范围：远程存储、本地文件或全部。",
  "clean:storage": "清理远程存储（MongoDB/Neo4j/Milvus/Ollama volumes）。本地 .c4a/ 文件不受影响。",
  "clean:local": "清理本地知识文件（.c4a/ 下的 drafts、approved、published、research、archive、cache）。远程存储和日志不受影响。",
};
