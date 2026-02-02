/**
 * Docker 操作工具函数
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..");
const DOCKER_COMPOSE_FILE = resolve(
  PROJECT_ROOT,
  "docker/docker-compose.server.yml"
);

function dockerCompose(...args: string[]) {
  return ["docker", "compose", "-f", DOCKER_COMPOSE_FILE, ...args];
}

export function checkDocker(): boolean {
  const result = spawnSync("docker", ["info"], { stdio: "pipe" });
  return result.status === 0;
}

/**
 * 尝试启动 Docker Desktop (macOS)
 * @param timeout 超时时间（毫秒），默认 60 秒
 * @param interval 检查间隔（毫秒），默认 2 秒
 * @returns 是否成功启动
 */
export async function startDockerDesktop(
  timeout: number = 60000,
  interval: number = 2000
): Promise<boolean> {
  // 已经在运行，直接返回
  if (checkDocker()) {
    return true;
  }

  // 仅支持 macOS
  if (process.platform !== "darwin") {
    return false;
  }

  // 尝试启动 Docker Desktop
  const result = spawnSync("open", ["-a", "Docker"], { stdio: "pipe" });
  if (result.status !== 0) {
    return false;
  }

  // 等待 Docker 启动就绪
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (checkDocker()) {
      return true;
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  等待 Docker 启动... ${elapsed}s`);

    await new Promise((r) => setTimeout(r, interval));
  }

  console.log(""); // 换行
  return false;
}

/**
 * 清理可能残留的旧容器
 */
function cleanupOldContainers(): void {
  const containers = [
    "c4a-mongodb",
    "c4a-neo4j",
    "c4a-milvus",
    "c4a-ollama",
    "c4a-ollama-init",
    "c4a-storage-backend",
  ];
  for (const container of containers) {
    // 尝试停止并删除旧容器（忽略错误）
    spawnSync("docker", ["rm", "-f", container], { stdio: "pipe" });
  }
}

export function startStorageServices(): Promise<void> {
  return new Promise((resolve, reject) => {
    // 先清理可能残留的旧容器
    cleanupOldContainers();

    const [cmd, ...args] = dockerCompose(
      "up",
      "-d",
      "mongodb",
      "neo4j",
      "milvus",
      "ollama",
      "ollama-init"
    );
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker compose failed with code ${code}`));
    });
  });
}

export function startAllServices(_profile: string = "mcp"): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = dockerCompose("up", "-d");
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker compose failed with code ${code}`));
    });
  });
}

export function startStorageBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = dockerCompose("up", "-d", "storage-backend");
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker compose failed with code ${code}`));
    });
  });
}

export function stopServices(): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = dockerCompose("down");
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker compose failed with code ${code}`));
    });
  });
}

export function showStatus(): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = dockerCompose("ps");
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker compose failed with code ${code}`));
    });
  });
}

export function showLogs(service?: string): Promise<void> {
  return new Promise((resolve) => {
    const args = service
      ? dockerCompose("logs", "-f", service)
      : dockerCompose("logs", "-f");
    const [cmd, ...rest] = args;
    const proc = spawn(cmd, rest, { stdio: "inherit" });
    // logs 是持续输出，用户 Ctrl+C 退出
    proc.on("close", () => resolve());
  });
}

export function cleanData(): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = dockerCompose("down", "-v");
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker compose failed with code ${code}`));
    });
  });
}

/**
 * 检查存储服务是否正在运行
 */
export function areStorageServicesRunning(): boolean {
  const containers = ["c4a-mongodb", "c4a-neo4j", "c4a-milvus", "c4a-ollama"];
  for (const container of containers) {
    const result = spawnSync("docker", ["ps", "-q", "-f", `name=${container}`], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!result.stdout.trim()) {
      return false;
    }
  }
  return true;
}

export function isStorageBackendRunning(): boolean {
  const result = spawnSync("docker", ["ps", "-q", "-f", "name=c4a-storage-backend"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return Boolean(result.stdout.trim());
}

/**
 * 检查单个容器的健康状态
 */
function checkContainerHealth(container: string): "healthy" | "unhealthy" | "starting" | "none" {
  const result = spawnSync("docker", [
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    container,
  ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

  if (result.status !== 0) {
    return "none";
  }

  const status = result.stdout.trim();
  if (status === "healthy") return "healthy";
  if (status === "unhealthy") return "unhealthy";
  return "starting";
}

/**
 * 等待所有存储服务健康
 * @param timeout 超时时间（毫秒），默认 120 秒
 * @param interval 检查间隔（毫秒），默认 3 秒
 */
export async function waitForServicesHealthy(
  timeout: number = 120000,
  interval: number = 3000
): Promise<boolean> {
  const services = [
    { name: "MongoDB", container: "c4a-mongodb" },
    { name: "Neo4j", container: "c4a-neo4j" },
    { name: "Milvus", container: "c4a-milvus" },
    { name: "Ollama", container: "c4a-ollama" },
  ];

  const startTime = Date.now();
  let lastStatus = "";

  while (Date.now() - startTime < timeout) {
    const statuses = services.map((s) => ({
      ...s,
      status: checkContainerHealth(s.container),
    }));

    const allHealthy = statuses.every((s) => s.status === "healthy");
    const anyUnhealthy = statuses.some((s) => s.status === "unhealthy");

    // 构建状态字符串
    const statusStr = statuses
      .map((s) => {
        const icon = s.status === "healthy" ? "✅" : s.status === "starting" ? "⏳" : "❌";
        return `${s.name}: ${icon}`;
      })
      .join("  ");

    // 只在状态变化时打印
    if (statusStr !== lastStatus) {
      console.log(`  ${statusStr}`);
      lastStatus = statusStr;
    }

    if (allHealthy) {
      return true;
    }

    if (anyUnhealthy) {
      console.log("❌ 有服务启动失败，请检查 docker logs");
      return false;
    }

    // 显示等待进度
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  等待中... ${elapsed}s`);

    await new Promise((r) => setTimeout(r, interval));
  }

  console.log("\n❌ 等待超时，部分服务未能启动");
  return false;
}
