/**
 * 命令实现
 */
import { resolve } from "node:path";
import {
  checkDocker,
  startDockerDesktop,
  startStorageServices,
  startAllServices,
  stopServices,
  showStatus,
  showLogs,
  cleanData,
  waitForServicesHealthy,
  areStorageServicesRunning,
} from "../utils/docker.js";
import {
  checkBun,
  checkUv,
  checkOpencode,
  checkTtyd,
  startMcpData,
  stopMcpData,
  getProcessStatus,
  runForeground,
  getLocalIPs,
  startTtyd,
  stopTtyd,
  getOpencodeCommand,
  generateOpencodeConfig,
} from "../utils/process.js";
import { confirm } from "../components/index.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..");

// 颜色输出
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;

function info(msg: string) {
  console.log(blue(`ℹ️  ${msg}`));
}
function success(msg: string) {
  console.log(green(`✅ ${msg}`));
}
function warn(msg: string) {
  console.log(yellow(`⚠️  ${msg}`));
}
function error(msg: string) {
  console.log(red(`❌ ${msg}`));
}

async function checkDependencies(deps: string[]): Promise<boolean> {
  let allOk = true;

  if (deps.includes("docker")) {
    if (checkDocker()) {
      success("Docker 已运行");
    } else {
      // 尝试自动启动 Docker Desktop
      warn("Docker 未运行，正在尝试启动...");
      const started = await startDockerDesktop(60000, 2000);
      if (started) {
        console.log(""); // 清除进度行
        success("Docker 已启动");
      } else {
        error("Docker 启动失败或超时，请手动启动 Docker Desktop");
        allOk = false;
      }
    }
  }

  if (deps.includes("bun")) {
    if (checkBun()) {
      success("Bun 已安装");
    } else {
      error("Bun 未安装，请安装: curl -fsSL https://bun.sh/install | bash");
      allOk = false;
    }
  }

  if (deps.includes("uv")) {
    if (checkUv()) {
      success("uv 已安装");
    } else {
      error("uv 未安装，请安装: curl -LsSf https://astral.sh/uv/install.sh | sh");
      allOk = false;
    }
  }

  return allOk;
}


/**
 * 等待用户按 Enter 或输入内容（使用 Bun 原生方式）
 */
async function waitForInput(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  // 使用 Bun 的方式读取一行输入
  const reader = process.stdin;
  const buf = Buffer.alloc(1024);

  return new Promise((resolve) => {
    reader.once("readable", () => {
      const chunk = reader.read();
      if (chunk) {
        resolve(chunk.toString().trim());
      } else {
        resolve("");
      }
    });
  });
}

export async function runCommand(command: string, args: string[] = []) {
  switch (command) {
    case "dev":
      await cmdDev(args.includes("--force"));
      break;
    case "restart":
      await cmdRestart();
      break;
    case "docker":
      await cmdDocker();
      break;
    case "prod":
      await cmdProd();
      break;
    case "debug:dsl":
      await cmdDebugDsl();
      break;
    case "debug:code":
      await cmdDebugCode();
      break;
    case "debug:data":
      await cmdDebugData();
      break;
    case "status":
      await cmdStatus();
      break;
    case "stop":
      await cmdStop();
      break;
    case "logs":
      await cmdLogs(args[0]);
      break;
    case "clean":
      await cmdCleanAll();
      break;
    case "clean:storage":
      await cmdCleanStorage();
      break;
    case "clean:local":
      await cmdCleanLocal();
      break;
    case "install":
      await cmdInstall();
      break;
    case "test":
      await cmdTest();
      break;
    default:
      error(`未知命令: ${command}`);
      process.exit(1);
  }
}

async function cmdDev(forceRestart = false) {
  console.log("\n" + blue("═".repeat(50)));
  console.log(blue("  C4A v2 - 开发模式"));
  console.log(blue("═".repeat(50)) + "\n");

  // 1. 检查依赖
  info("检查依赖...");
  if (!(await checkDependencies(["docker", "bun", "uv"]))) {
    process.exit(1);
  }

  // 检查 opencode
  if (!checkOpencode()) {
    error("OpenCode 未安装，请先运行: bun install");
    process.exit(1);
  }
  success("OpenCode 已安装");

  // 2. 生成所有平台配置
  info("生成 Agent 配置...");
  const configGenerated = await generateOpencodeConfig();
  if (configGenerated) {
    success("Agent 配置已生成:");
    console.log("    - .opencode/opencode.json (OpenCode)");
    console.log("    - .cursor/mcp.json + .cursorrules (Cursor)");
    console.log("    - claude.json (Claude SDK)");
  } else {
    warn("Agent 配置生成失败，使用已有配置");
  }

  // 3. 检查存储服务状态
  const storageRunning = areStorageServicesRunning();
  if (storageRunning) {
    // 存储服务已在运行，检查健康状态
    info("存储服务已在运行，检查健康状态...");
    const servicesHealthy = await waitForServicesHealthy(30000, 2000); // 最多等 30 秒
    if (servicesHealthy) {
      success("存储服务健康，复用已有服务");
    } else {
      warn("存储服务不健康，建议运行 ./start.sh restart 重启");
    }
  } else {
    // 存储服务未运行，启动它们
    info("启动存储服务...");
    await startStorageServices();
    success("存储服务已启动");

    // 等待所有服务健康（特别是 Milvus，可能需要 60-90 秒）
    info("等待存储服务健康（Milvus 可能需要 60-90 秒）...");
    const servicesHealthy = await waitForServicesHealthy(120000, 3000);
    if (!servicesHealthy) {
      error("存储服务启动失败，请检查 Docker 日志");
      process.exit(1);
    }
    success("所有存储服务已就绪");
  }

  // 5. 启动 mcp-data（带健康检查和重试）
  info("启动 mcp-data...");
  try {
    const mcpPid = await startMcpData({
      force: forceRestart,
      retries: 3,
      startupWait: 5000,
    });
    success(`mcp-data 已启动 (PID: ${mcpPid})`);
  } catch (e) {
    error(`mcp-data 启动失败: ${e}`);
    error("请检查日志: .context/logs/mcp-data.log");
    process.exit(1);
  }

  // 6. 启动 ttyd (Web 终端，可选)
  let ttydPid: number | null = null;
  if (checkTtyd()) {
    info("启动 Web 终端 (ttyd)...");
    try {
      ttydPid = await startTtyd(7681);
      success(`ttyd 已启动 (PID: ${ttydPid})`);
    } catch (e) {
      warn(`ttyd 启动失败: ${e}`);
    }
  } else {
    warn("ttyd 未安装，跳过 Web 终端。安装: brew install ttyd");
  }

  // 7. 显示端口和访问信息
  const ips = getLocalIPs();

  console.log("\n" + green("═".repeat(50)));
  console.log(green("  服务已就绪"));
  console.log(green("═".repeat(50)));

  console.log("\n  存储服务:");
  console.log("    - MongoDB:  localhost:27017");
  console.log("    - Neo4j:    localhost:7474 (HTTP), localhost:7687 (Bolt)");
  console.log("    - Milvus:   localhost:19530");
  console.log("    - mcp-data: localhost:8050");

  if (ttydPid) {
    console.log("\n  远程终端 (Web 访问 OpenCode 开发环境):");
    console.log("    - 本机访问:   http://localhost:7681");
    if (ips.length > 0) {
      console.log("    - 局域网访问:");
      for (const ip of ips) {
        console.log(`        http://${ip}:7681`);
      }
    }
  }

  console.log("\n  本地终端 (命令行访问 OpenCode 开发环境):");
  console.log(`    ${getOpencodeCommand()}`);
  console.log("");
  console.log(yellow("服务已在后台运行，使用 ./start.sh stop 停止"));
  console.log(yellow("遇到问题？查看日志: .context/logs/"));
  console.log("");
}

async function cmdDocker() {
  console.log("\n" + blue("═".repeat(50)));
  console.log(blue("  C4A v2 - 全 Docker 模式"));
  console.log(blue("═".repeat(50)) + "\n");

  if (!(await checkDependencies(["docker"]))) {
    process.exit(1);
  }

  info("启动所有服务 (包含 MCP)...");
  await startAllServices("mcp");
  success("所有服务已启动");

  console.log("\n  MCP 端点:");
  console.log("    - mcp-dsl:  http://localhost:8051/mcp");
  console.log("    - mcp-code: http://localhost:8052/mcp");
  console.log("    - mcp-data: http://localhost:8050/mcp\n");
}

async function cmdProd() {
  console.log("\n" + blue("═".repeat(50)));
  console.log(blue("  C4A v2 - 生产模式"));
  console.log(blue("═".repeat(50)) + "\n");

  if (!(await checkDependencies(["docker"]))) {
    process.exit(1);
  }

  info("启动生产环境...");
  await startAllServices("prod");
  success("生产环境已启动");

  console.log("\n  MCP 端点:");
  console.log("    - mcp-dsl:  http://localhost:8051/mcp");
  console.log("    - mcp-code: http://localhost:8052/mcp");
  console.log("    - mcp-data: http://localhost:8050/mcp\n");
}

async function cmdDebugDsl() {
  info("前台运行 mcp-dsl (stdio 模式)...");
  info("按 Ctrl+C 退出\n");
  await runForeground("bun", ["run", "packages/mcp-dsl/src/index.ts"], {
    cwd: PROJECT_ROOT,
  });
}

async function cmdDebugCode() {
  info("前台运行 mcp-code (stdio 模式)...");
  info("按 Ctrl+C 退出\n");
  await runForeground("bun", ["run", "packages/mcp-code/src/index.ts"], {
    cwd: PROJECT_ROOT,
  });
}

async function cmdDebugData() {
  info("前台运行 mcp-data (HTTP 模式)...");
  info("按 Ctrl+C 退出\n");
  await runForeground("uv", ["run", "python", "-m", "c4a_data_mcp.server"], {
    cwd: resolve(PROJECT_ROOT, "packages/mcp-data"),
    env: { MCP_TRANSPORT: "streamable-http", MCP_PORT: "8050" },
  });
}

async function cmdStatus() {
  console.log("\n" + blue("Docker 容器状态:"));
  await showStatus();

  console.log("\n" + blue("本地进程状态:"));
  const mcpDataStatus = getProcessStatus("mcp-data");
  if (mcpDataStatus.running) {
    // 检查 HTTP 健康状态
    const isHealthy = await (await import("../utils/process.js")).checkHttpHealth("localhost", 8050);
    if (isHealthy) {
      console.log(green(`  mcp-data: 运行中 (PID: ${mcpDataStatus.pid}) ✅ 健康`));
    } else {
      console.log(red(`  mcp-data: 运行中 (PID: ${mcpDataStatus.pid}) ❌ HTTP 不响应`));
    }
  } else {
    console.log(yellow("  mcp-data: 未运行"));
  }

  const ttydStatus = getProcessStatus("ttyd");
  if (ttydStatus.running) {
    console.log(green(`  ttyd:     运行中 (PID: ${ttydStatus.pid}) -> http://localhost:7681`));
  } else {
    console.log(yellow("  ttyd:     未运行"));
  }

  console.log("\n" + blue("日志文件位置:"));
  const { resolve } = await import("node:path");
  const logsDir = resolve(PROJECT_ROOT, ".context/logs");
  console.log(`  ${logsDir}/mcp-data.log`);
  console.log(`  ${logsDir}/mcp-data.stdout.log`);
  console.log("");
}

async function cmdStop() {
  info("停止服务...");

  // 停止 ttyd
  if (stopTtyd()) {
    success("ttyd 已停止");
  }

  // 停止本地 mcp-data
  if (await stopMcpData()) {
    success("mcp-data 已停止");
  }

  // 停止 Docker 服务
  await stopServices();
  success("Docker 服务已停止");
}

async function cmdRestart() {
  console.log("\n" + blue("═".repeat(50)));
  console.log(blue("  C4A v2 - 重启所有服务"));
  console.log(blue("═".repeat(50)) + "\n");

  // 1. 停止本地进程
  info("停止本地进程...");
  if (stopTtyd()) {
    success("ttyd 已停止");
  }
  if (await stopMcpData()) {
    success("mcp-data 已停止");
  }

  // 2. 停止并重启存储服务
  info("重启存储服务（包括 MongoDB、Neo4j、Milvus、Ollama）...");
  await stopServices();
  success("存储服务已停止");

  info("启动存储服务...");
  await startStorageServices();
  success("存储服务已启动");

  // 3. 等待所有服务健康
  info("等待存储服务健康（Milvus 可能需要 60-90 秒）...");
  const servicesHealthy = await waitForServicesHealthy(120000, 3000);
  if (!servicesHealthy) {
    error("存储服务启动失败，请检查 Docker 日志");
    process.exit(1);
  }
  success("所有存储服务已就绪");

  // 4. 启动 mcp-data
  info("启动 mcp-data...");
  try {
    const mcpPid = await startMcpData({ force: true, retries: 3, startupWait: 5000 });
    success(`mcp-data 已启动 (PID: ${mcpPid})`);
  } catch (e) {
    error(`mcp-data 启动失败: ${e}`);
    error("请检查日志: .context/logs/mcp-data.log");
    process.exit(1);
  }

  // 5. 启动 ttyd（可选）
  if (checkTtyd()) {
    info("启动 Web 终端 (ttyd)...");
    try {
      const ttydPid = await startTtyd(7681);
      success(`ttyd 已启动 (PID: ${ttydPid})`);
    } catch (e) {
      warn(`ttyd 启动失败: ${e}`);
    }
  }

  console.log("\n" + green("═".repeat(50)));
  console.log(green("  ✅ 所有服务重启完成"));
  console.log(green("═".repeat(50)) + "\n");
}

async function cmdLogs(service?: string) {
  await showLogs(service);
}

async function cmdCleanStorage() {
  const confirmed = await confirm({
    title: "clean:storage - 清理远程存储数据",
    message: "将清理以下数据：",
    items: [
      "MongoDB 数据 (mongodb_data volume) - DSL 文档存储",
      "Neo4j 数据 (neo4j_data volume) - 图索引",
      "Milvus 数据 (milvus_data volume) - 向量索引",
      "Ollama 模型 (ollama_data volume) - embedding 模型缓存",
    ],
    warning: "本地 .context/ 目录的文件不受影响",
  });

  if (confirmed) {
    await stopMcpData();
    await cleanData();
    success("已清理远程存储数据");
    info("提示：下次启动时 Ollama 需要重新下载 embedding 模型（约 300MB）");
  } else {
    info("已取消");
  }
}

async function cmdCleanLocal() {
  const confirmed = await confirm({
    title: "clean:local - 清理本地知识文件",
    message: "将清理以下目录的内容：",
    items: [
      ".context/business/ - 业务视角 DSL 文件",
      ".context/technical/ - 技术视角 DSL 文件",
      ".context/feat/ - feat 迭代目录",
      ".context/assets/ - 资源文件",
      ".context/.schemas/ - 本地 Schema 缓存",
      ".context/logs/ - 本地日志",
    ],
    warning: "远程存储（MongoDB/Neo4j/Milvus）和日志文件不受影响",
  });

  if (confirmed) {
    const { rmSync, readdirSync, existsSync } = await import("node:fs");

    const contextDir = resolve(PROJECT_ROOT, ".context");

    // 清理 .context 指定子目录的内容（保留目录本身）
    const contextSubDirs = ["business", "technical", "feat", "assets", ".schemas", "logs"];
    for (const subDir of contextSubDirs) {
      const dirPath = resolve(contextDir, subDir);
      if (existsSync(dirPath)) {
        // 删除目录内的所有内容，但保留目录本身
        const entries = readdirSync(dirPath);
        for (const entry of entries) {
          rmSync(resolve(dirPath, entry), { recursive: true, force: true });
        }
        success(`已清空 .context/${subDir}/`);
      }
    }

    success("已清理本地知识文件");
  } else {
    info("已取消");
  }
}

async function cmdCleanAll() {
  const confirmed = await confirm({
    title: "clean:all - 清理所有数据",
    message: "此命令将清理：",
    items: [
      "远程存储 (MongoDB/Neo4j/Milvus/Ollama volumes)",
      "本地知识文件 (.context/ 指定目录内容)",
    ],
    warning: "此操作将删除所有数据，包括本地知识和远程存储！",
  });

  if (confirmed) {
    // 停止服务
    await stopMcpData();

    // 清理远程存储
    info("清理远程存储...");
    await cleanData();
    success("远程存储已清理");

    // 清理本地知识文件
    info("清理本地知识文件...");
    const { rmSync, readdirSync, existsSync } = await import("node:fs");

    const contextDir = resolve(PROJECT_ROOT, ".context");

    // 清理 .context 指定子目录的内容（保留目录本身）
    const contextSubDirs = ["business", "technical", "feat", "assets", ".schemas", "logs"];
    for (const subDir of contextSubDirs) {
      const dirPath = resolve(contextDir, subDir);
      if (existsSync(dirPath)) {
        const entries = readdirSync(dirPath);
        for (const entry of entries) {
          rmSync(resolve(dirPath, entry), { recursive: true, force: true });
        }
      }
    }

    success("本地知识文件已清理");
    success("已清理所有数据");
  } else {
    info("已取消");
  }
}

async function cmdInstall() {
  if (!(await checkDependencies(["bun"]))) {
    process.exit(1);
  }

  info("安装 TypeScript 依赖...");
  await runForeground("bun", ["install"], { cwd: PROJECT_ROOT });
  success("TypeScript 依赖安装完成");

  if (checkUv()) {
    info("安装 Python 依赖 (mcp-data)...");
    await runForeground("uv", ["sync"], {
      cwd: resolve(PROJECT_ROOT, "packages/mcp-data"),
    });
    success("Python 依赖安装完成");
  } else {
    warn("uv 未安装，跳过 Python 依赖安装");
  }
}

async function cmdTest() {
  if (!(await checkDependencies(["bun"]))) {
    process.exit(1);
  }

  info("运行测试...");
  await runForeground("bun", ["test"], { cwd: PROJECT_ROOT });
}
