/**
 * 进程管理工具函数
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { networkInterfaces } from "node:os";

const PROJECT_ROOT = pathResolve(import.meta.dirname, "../../../..");
const LOGS_DIR = pathResolve(PROJECT_ROOT, ".c4a/logs");

// 项目内安装的 opencode 路径
const LOCAL_OPENCODE = pathResolve(PROJECT_ROOT, "node_modules/.bin/opencode");

/**
 * 确保日志目录存在
 */
function ensureLogsDir() {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * 写入日志
 */
function appendLog(service: string, message: string) {
  ensureLogsDir();
  const timestamp = new Date().toISOString();
  const logFile = pathResolve(LOGS_DIR, `${service}.log`);
  appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

/**
 * 检查端口是否可用
 */
export async function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = require('net').createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * 杀死占用指定端口的进程
 * @param port 端口号
 * @returns 是否成功释放端口
 */
export function killProcessOnPort(port: number, service: string = "mcp-store"): boolean {
  try {
    // 使用 lsof 查找占用端口的进程
    const result = spawnSync("lsof", ["-t", `-i:${port}`], { encoding: "utf-8" });
    const pids = result.stdout.trim().split("\n").filter(Boolean);

    if (pids.length === 0) {
      return true; // 没有进程占用
    }

    appendLog(service, `发现 ${pids.length} 个进程占用端口 ${port}: ${pids.join(", ")}`);

    // 先尝试 SIGTERM
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
        appendLog(service, `已发送 SIGTERM 到进程 ${pid}`);
      } catch {
        // 进程可能已经退出
      }
    }

    // 等待 1 秒
    spawnSync("sleep", ["1"]);

    // 检查是否还有进程占用
    const checkResult = spawnSync("lsof", ["-t", `-i:${port}`], { encoding: "utf-8" });
    const remainingPids = checkResult.stdout.trim().split("\n").filter(Boolean);

    if (remainingPids.length > 0) {
      // 强制杀死
      appendLog(service, `进程未响应 SIGTERM，使用 SIGKILL: ${remainingPids.join(", ")}`);
      for (const pid of remainingPids) {
        try {
          process.kill(Number(pid), "SIGKILL");
          appendLog(service, `已发送 SIGKILL 到进程 ${pid}`);
        } catch {
          // 进程可能已经退出
        }
      }
      // 再等待一下
      spawnSync("sleep", ["0.5"]);
    }

    // 最终检查
    const finalResult = spawnSync("lsof", ["-t", `-i:${port}`], { encoding: "utf-8" });
    const finalPids = finalResult.stdout.trim().split("\n").filter(Boolean);

    if (finalPids.length === 0) {
      appendLog(service, `端口 ${port} 已成功释放`);
      return true;
    } else {
      appendLog(service, `无法释放端口 ${port}，仍有进程占用: ${finalPids.join(", ")}`);
      return false;
    }
  } catch (err) {
    appendLog(service, `检查/杀死端口进程时出错: ${(err as Error).message}`);
    return false;
  }
}

/**
 * 检查 HTTP 健康状态
 */
export async function checkHttpHealth(
  host: string,
  port: number,
  path: string = "/",
  timeout: number = 5000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = require('net').createConnection({ host, port, timeout }, () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });

    socket.on('data', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function getPidFile(name: string): string {
  ensureLogsDir();
  return pathResolve(LOGS_DIR, `${name}.pid`);
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getProcessStatus(name: string): { running: boolean; pid?: number } {
  const pidFile = getPidFile(name);
  if (!existsSync(pidFile)) {
    return { running: false };
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  if (isProcessRunning(pid)) {
    return { running: true, pid };
  } else {
    // 清理过期的 PID 文件
    unlinkSync(pidFile);
    return { running: false };
  }
}

/**
 * 启动 mcp-store 服务
 * @param options 配置选项
 * @returns 进程 PID
 */
export async function startMcpStore(options?: {
  force?: boolean;      // 强制重启
  retries?: number;     // 重试次数（默认 3）
  startupWait?: number; // 启动等待时间（毫秒，默认 5000）
}): Promise<number> {
  const { force = false, retries = 3, startupWait = 5000 } = options || {};

  const pidFile = getPidFile("mcp-store");
  const mcpStoreDir = `${PROJECT_ROOT}/packages/mcp-store`;
  const port = 8051;

  appendLog("mcp-store", `=== 尝试启动 (force=${force}) ===`);

  // 检查是否已在运行
  const status = getProcessStatus("mcp-store");
  if (status.running && !force) {
    // 进一步检查 HTTP 健康状态
    const isHealthy = await checkHttpHealth("localhost", port);
    if (isHealthy) {
      appendLog("mcp-store", `服务已在运行且健康 (PID: ${status.pid})`);
      console.log(`✅ mcp-store 已在运行 (PID: ${status.pid})`);
      return status.pid!;
    } else {
      // 进程存在但服务不健康，强制重启
      appendLog("mcp-store", `进程存在 (PID: ${status.pid}) 但 HTTP 不响应，将重启`);
      await stopMcpStore();
    }
  }

  // 检查端口是否可用，如果被占用则自动杀死占用进程
  let portAvailable = await checkPortAvailable(port);
  if (!portAvailable) {
    appendLog("mcp-store", `端口 ${port} 被占用，尝试自动释放...`);
    console.log(`⚠️  端口 ${port} 被占用，正在自动释放...`);

    const released = killProcessOnPort(port);
    if (released) {
      // 再次检查端口
      portAvailable = await checkPortAvailable(port);
    }

    if (!portAvailable) {
      appendLog("mcp-store", `无法释放端口 ${port}`);
      throw new Error(`端口 ${port} 被占用且无法自动释放，请手动检查: lsof -i :${port}`);
    }

    console.log(`✅ 端口 ${port} 已释放`);
  }

  // 启动进程（带重试）
  let lastError: Error | null = null;
  const logFile = pathResolve(LOGS_DIR, "mcp-store.stdout.log");

  for (let attempt = 1; attempt <= retries; attempt++) {
    appendLog("mcp-store", `启动尝试 ${attempt}/${retries}`);

    const proc = spawn("bun", ["run", "src/index.ts"], {
      cwd: mcpStoreDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"], // 捕获 stdout 和 stderr 以便调试
      env: {
        ...process.env,
        MCP_TRANSPORT: "streamable-http",
        MCP_PORT: String(port),
      },
    });

    if (!proc.pid) {
      lastError = new Error("启动失败: 无法获取进程 PID");
      appendLog("mcp-store", lastError.message);
      if (attempt < retries) continue;
      throw lastError;
    }

    // 记录进程输出到日志文件
    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        appendFileSync(logFile, `[STDOUT] ${data}`);
      });
    }
    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        appendFileSync(logFile, `[STDERR] ${data}`);
      });
    }

    // 监听进程退出
    proc.on('exit', (code, signal) => {
      appendLog("mcp-store", `进程退出: code=${code}, signal=${signal}`);
    });

    proc.on('error', (err) => {
      appendLog("mcp-store", `进程错误: ${err.message}`);
    });

    writeFileSync(pidFile, String(proc.pid));
    appendLog("mcp-store", `进程已启动: PID=${proc.pid}`);

    proc.unref();

    // 等待服务启动
    appendLog("mcp-store", `等待服务启动 (${startupWait}ms)...`);
    await new Promise(r => setTimeout(r, startupWait));

    // 验证服务是否健康
    const isHealthy = await checkHttpHealth("localhost", port);

    if (isHealthy) {
      appendLog("mcp-store", `✅ 服务启动成功 (PID: ${proc.pid})`);
      console.log(`✅ mcp-store 已启动 (PID: ${proc.pid})`);
      return proc.pid;
    } else {
      appendLog("mcp-store", `❌ HTTP 健康检查失败，尝试 ${attempt}/${retries}`);
      // 停止不健康的进程
      await stopMcpStore();
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000)); // 重试前等待 1 秒
        continue;
      }
    }
  }

  const error = new Error(
    `mcp-store 启动失败，已重试 ${retries} 次。\n` +
    `详细日志: ${logFile}`
  );
  appendLog("mcp-store", error.message);
  throw error;
}

/**
 * 停止 mcp-store 服务
 * @param waitForPort 是否等待端口释放（默认 true）
 * @param timeout 等待超时时间（毫秒，默认 5000）
 */
export async function stopMcpStore(waitForPort: boolean = true, timeout: number = 5000): Promise<boolean> {
  const port = 8051;
  const status = getProcessStatus("mcp-store");

  // 1. 通过 PID 文件停止
  if (status.running && status.pid) {
    try {
      process.kill(status.pid, "SIGTERM");
      appendLog("mcp-store", `已发送 SIGTERM 到进程 ${status.pid}`);
      const pidFile = getPidFile("mcp-store");
      if (existsSync(pidFile)) {
        unlinkSync(pidFile);
      }
    } catch {
      // 进程可能已经退出
    }
  }

  // 2. 额外检查：确保端口上没有残留进程
  const portAvailable = await checkPortAvailable(port);
  if (!portAvailable) {
    appendLog("mcp-store", `端口 ${port} 仍被占用，尝试释放...`);
    killProcessOnPort(port);
  }

  // 3. 等待端口释放
  if (waitForPort) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const available = await checkPortAvailable(port);
      if (available) {
        appendLog("mcp-store", `端口 ${port} 已释放`);
        return true;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    appendLog("mcp-store", `等待端口 ${port} 释放超时`);
    return false;
  }

  return true;
}

/**
 * 启动 mcp-query 服务
 * @param options 配置选项
 * @returns 进程 PID
 */
export async function startMcpQuery(options?: {
  force?: boolean;
  retries?: number;
  startupWait?: number;
}): Promise<number> {
  const { force = false, retries = 3, startupWait = 5000 } = options || {};

  const pidFile = getPidFile("mcp-query");
  const mcpQueryDir = `${PROJECT_ROOT}/packages/mcp-query`;
  const port = 8054;

  appendLog("mcp-query", `=== 尝试启动 (force=${force}) ===`);

  const status = getProcessStatus("mcp-query");
  if (status.running && !force) {
    const isHealthy = await checkHttpHealth("localhost", port);
    if (isHealthy) {
      appendLog("mcp-query", `服务已在运行且健康 (PID: ${status.pid})`);
      console.log(`✅ mcp-query 已在运行 (PID: ${status.pid})`);
      return status.pid!;
    } else {
      appendLog("mcp-query", `进程存在 (PID: ${status.pid}) 但 HTTP 不响应，将重启`);
      await stopMcpQuery();
    }
  }

  let portAvailable = await checkPortAvailable(port);
  if (!portAvailable) {
    appendLog("mcp-query", `端口 ${port} 被占用，尝试自动释放...`);
    console.log(`⚠️  端口 ${port} 被占用，正在自动释放...`);

    const released = killProcessOnPort(port, "mcp-query");
    if (released) {
      portAvailable = await checkPortAvailable(port);
    }

    if (!portAvailable) {
      appendLog("mcp-query", `无法释放端口 ${port}`);
      throw new Error(`端口 ${port} 被占用且无法自动释放，请手动检查: lsof -i :${port}`);
    }

    console.log(`✅ 端口 ${port} 已释放`);
  }

  let lastError: Error | null = null;
  const logFile = pathResolve(LOGS_DIR, "mcp-query.stdout.log");

  for (let attempt = 1; attempt <= retries; attempt++) {
    appendLog("mcp-query", `启动尝试 ${attempt}/${retries}`);

    const proc = spawn("bun", ["run", "src/index.ts"], {
      cwd: mcpQueryDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MCP_TRANSPORT: "streamable-http",
        MCP_PORT: String(port),
      },
    });

    if (!proc.pid) {
      lastError = new Error("启动失败: 无法获取进程 PID");
      appendLog("mcp-query", lastError.message);
      if (attempt < retries) continue;
      throw lastError;
    }

    if (proc.stdout) {
      proc.stdout.on("data", (data) => {
        appendFileSync(logFile, `[STDOUT] ${data}`);
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", (data) => {
        appendFileSync(logFile, `[STDERR] ${data}`);
      });
    }

    proc.on("exit", (code, signal) => {
      appendLog("mcp-query", `进程退出: code=${code}, signal=${signal}`);
    });

    proc.on("error", (err) => {
      appendLog("mcp-query", `进程错误: ${err.message}`);
    });

    writeFileSync(pidFile, String(proc.pid));
    appendLog("mcp-query", `进程已启动: PID=${proc.pid}`);

    proc.unref();

    appendLog("mcp-query", `等待服务启动 (${startupWait}ms)...`);
    await new Promise((r) => setTimeout(r, startupWait));

    const isHealthy = await checkHttpHealth("localhost", port);

    if (isHealthy) {
      appendLog("mcp-query", `✅ 服务启动成功 (PID: ${proc.pid})`);
      console.log(`✅ mcp-query 已启动 (PID: ${proc.pid})`);
      return proc.pid;
    } else {
      appendLog("mcp-query", `❌ HTTP 健康检查失败，尝试 ${attempt}/${retries}`);
      await stopMcpQuery();
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
    }
  }

  const error = new Error(
    `mcp-query 启动失败，已重试 ${retries} 次。\n` + `详细日志: ${logFile}`
  );
  appendLog("mcp-query", error.message);
  throw error;
}

/**
 * 停止 mcp-query 服务
 */
export async function stopMcpQuery(
  waitForPort: boolean = true,
  timeout: number = 5000
): Promise<boolean> {
  const port = 8054;
  const status = getProcessStatus("mcp-query");

  if (status.running && status.pid) {
    try {
      process.kill(status.pid, "SIGTERM");
      appendLog("mcp-query", `已发送 SIGTERM 到进程 ${status.pid}`);
      const pidFile = getPidFile("mcp-query");
      if (existsSync(pidFile)) {
        unlinkSync(pidFile);
      }
    } catch {
      // 进程可能已经退出
    }
  }

  const portAvailable = await checkPortAvailable(port);
  if (!portAvailable) {
    appendLog("mcp-query", `端口 ${port} 仍被占用，尝试释放...`);
    killProcessOnPort(port, "mcp-query");
  }

  if (waitForPort) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const available = await checkPortAvailable(port);
      if (available) {
        appendLog("mcp-query", `端口 ${port} 已释放`);
        return true;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    appendLog("mcp-query", `等待端口 ${port} 释放超时`);
    return false;
  }

  return true;
}

export function checkBun(): boolean {
  const result = spawnSync("bun", ["--version"], { stdio: "pipe" });
  return result.status === 0;
}

export function checkUv(): boolean {
  const result = spawnSync("uv", ["--version"], { stdio: "pipe" });
  return result.status === 0;
}

export function checkOpencode(): boolean {
  // 优先检查项目内安装的 opencode
  if (existsSync(LOCAL_OPENCODE)) {
    return true;
  }
  // 回退到全局安装
  const result = spawnSync("opencode", ["--version"], { stdio: "pipe" });
  return result.status === 0;
}

export function getOpencodeCommand(): string {
  // 优先使用项目内安装的 opencode
  if (existsSync(LOCAL_OPENCODE)) {
    return LOCAL_OPENCODE;
  }
  return "opencode";
}

export function getLocalIPs(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // 跳过 localhost 和 IPv6
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

/**
 * 检查 ttyd 是否已安装
 */
export function checkTtyd(): boolean {
  const result = spawnSync("ttyd", ["--version"], { stdio: "pipe" });
  return result.status === 0;
}

/**
 * 启动 ttyd Web 终端
 * ttyd 是一个轻量级的 web 终端工具，通过 brew install ttyd 安装
 */
export function startTtyd(port: number = 7681): Promise<number> {
  return new Promise((resolve, reject) => {
    const pidFile = getPidFile("ttyd");

    // 检查是否已在运行
    const status = getProcessStatus("ttyd");
    if (status.running) {
      console.log(`ttyd 已在运行 (PID: ${status.pid})`);
      resolve(status.pid!);
      return;
    }

    // 检查 ttyd 是否安装
    if (!checkTtyd()) {
      reject(new Error("ttyd 未安装，请运行: brew install ttyd"));
      return;
    }

    const opencodeCmd = getOpencodeCommand();

    // 启动 ttyd，执行 opencode
    const proc = spawn(
      "ttyd",
      [
        "-p", String(port),
        "-W",  // 允许写入（客户端可以输入）
        opencodeCmd,
      ],
      {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          // opencode 配置文件路径
          OPENCODE_CONFIG: pathResolve(PROJECT_ROOT, ".opencode/opencode.json"),
        },
      }
    );

    proc.unref();

    if (proc.pid) {
      writeFileSync(pidFile, String(proc.pid));
      resolve(proc.pid);
    } else {
      reject(new Error("Failed to start ttyd"));
    }
  });
}

export function stopTtyd(): boolean {
  const status = getProcessStatus("ttyd");
  if (!status.running || !status.pid) {
    return false;
  }

  try {
    process.kill(status.pid, "SIGTERM");
    const pidFile = getPidFile("ttyd");
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
    return true;
  } catch {
    return false;
  }
}

export function runForeground(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
    });
    proc.on("close", () => resolve());
  });
}

/**
 * 生成 OpenCode 配置文件
 * 调用 config-generator 生成 .opencode/opencode.json
 * @deprecated 使用 generateAllConfigs 代替
 */
export async function generateOpencodeConfig(): Promise<boolean> {
  return generateAllConfigs();
}

/**
 * 生成所有平台的配置文件
 * 调用 config-generator 生成：
 * - .opencode/opencode.json (OpenCode)
 * - .cursor/mcp.json + .cursorrules (Cursor)
 * - claude.json (Claude SDK)
 */
export async function generateAllConfigs(): Promise<boolean> {
  return new Promise((resolve) => {
    const configGeneratorPath = pathResolve(PROJECT_ROOT, "packages/config-generator/src/index.ts");

    const proc = spawn("bun", ["run", configGeneratorPath, "--target", "all"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}
