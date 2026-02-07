import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { GlobalConfig } from "../core/config.js";
import { buildErrorResponse } from "../utils/errorResponse.js";
import type { CommandResult, ContainerStatus } from "../utils/docker.js";
import type { CommandIO, ServerDockerDeps, ServiceHealth } from "./serverTypes.js";
import {
  SERVER_CONTAINERS,
  SERVER_STATUS_SERVICES,
  deriveContainerHealth,
  fetchServerHealth,
  formatContainerSummary,
  resolveContainerName,
  resolveServerUrl,
} from "./serverHelpers.js";

export async function runComposeDown(composeFile: string): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(
      "docker",
      ["compose", "-f", composeFile, "down", "-v"],
      { encoding: "utf-8" },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const exitCode = typeof code === "number" ? code : 1;
          resolveResult({
            stdout: stdout ?? "",
            stderr: stderr ?? (error as Error).message,
            exitCode,
          });
          return;
        }
        resolveResult({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      },
    );
  });
}

export async function handleStatus(params: {
  io: CommandIO;
  docker: ServerDockerDeps;
  config: GlobalConfig | null;
  checkHealth?: (config: unknown, statuses: ContainerStatus[]) => Promise<ServiceHealth>;
}): Promise<void> {
  const { io, docker, config, checkHealth } = params;
  const statuses = await docker.getContainerStatus(SERVER_CONTAINERS);
  const statusMap = new Map(statuses.map((item) => [item.name, item]));
  io.log("服务状态:");
  for (const service of SERVER_STATUS_SERVICES) {
    const item = statusMap.get(service.container);
    io.log(formatContainerSummary(service, item));
  }

  const baseUrl = resolveServerUrl(config ?? undefined);
  const containerHealth = deriveContainerHealth(statusMap);
  let serviceHealth: ServiceHealth | null = null;

  if (checkHealth) {
    serviceHealth = await checkHealth(config ?? null, statuses);
  } else {
    const remote = await fetchServerHealth(baseUrl);
    if (remote) {
      serviceHealth = {
        mongodb: typeof remote.mongodb === "boolean" ? remote.mongodb : containerHealth.mongodb,
        neo4j: typeof remote.neo4j === "boolean" ? remote.neo4j : containerHealth.neo4j,
        milvus: typeof remote.milvus === "boolean" ? remote.milvus : containerHealth.milvus,
        ollama: typeof remote.ollama === "boolean" ? remote.ollama : containerHealth.ollama,
      };
    }
  }

  if (!serviceHealth) {
    serviceHealth = containerHealth;
  }

  io.log("");
  io.log("服务健康状态:");
  io.log(`  MongoDB: ${serviceHealth.mongodb ? "✅" : "❌"}`);
  io.log(`  Neo4j: ${serviceHealth.neo4j ? "✅" : "❌"}`);
  io.log(`  Milvus: ${serviceHealth.milvus ? "✅" : "❌"}`);
  io.log(`  Ollama: ${serviceHealth.ollama ? "✅" : "❌"}`);

  io.log("");
  io.log("连接信息:");
  const services = config?.server?.services;
  if (services) {
    if (services.mongodb) io.log(`  MongoDB: ${services.mongodb}`);
    if (services.neo4j) io.log(`  Neo4j: ${services.neo4j}`);
    if (services.milvus) io.log(`  Milvus: ${services.milvus}`);
    if (services.ollama) io.log(`  Ollama: ${services.ollama}`);
  }
}

export async function handleRestart(params: {
  io: CommandIO;
  docker: ServerDockerDeps;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
}): Promise<void> {
  const { io, docker, emitError } = params;
  const result = await docker.restartContainers(SERVER_CONTAINERS);
  if (result.exitCode !== 0) {
    emitError(buildErrorResponse("C4A-SERVER-003", result.stderr || "重启失败"));
    process.exitCode = 1;
    return;
  }
  io.log("已重启 C4A 服务容器。");
}

export async function handleStop(params: {
  io: CommandIO;
  docker: ServerDockerDeps;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
}): Promise<void> {
  const { io, docker, emitError } = params;
  const result = await docker.stopContainers(SERVER_CONTAINERS);
  if (result.exitCode !== 0) {
    emitError(buildErrorResponse("C4A-SERVER-004", result.stderr || "停止失败"));
    process.exitCode = 1;
    return;
  }
  io.log("已停止 C4A 服务容器。");
}

export async function handleLogs(params: {
  io: CommandIO;
  docker: ServerDockerDeps;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
  target?: string;
  tail?: number;
}): Promise<void> {
  const { io, docker, emitError, target, tail } = params;
  const containerName = target ? resolveContainerName(target) : undefined;
  const safeTail = Number.isFinite(tail) ? tail : 200;
  const result = await docker.getContainerLogs(containerName, {
    tail: safeTail,
    timestamps: true,
  });
  if (result.exitCode !== 0) {
    emitError(buildErrorResponse("C4A-SERVER-005", result.stderr || "获取日志失败"));
    process.exitCode = 1;
    return;
  }
  io.log(result.stdout.trim() || "暂无日志");
}

export async function handleClean(params: {
  io: CommandIO;
  confirm: (message: string) => Promise<boolean>;
  composeDown: (composeFile: string) => Promise<CommandResult>;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
}): Promise<void> {
  const { io, confirm, composeDown, emitError } = params;
  const confirmed = await confirm("清理将删除所有服务数据，确认继续？");
  if (!confirmed) {
    io.log("已取消清理操作。");
    return;
  }
  const composeFile = resolve(import.meta.dirname, "../../../..", "docker", "docker-compose.server.yml");
  if (!existsSync(composeFile)) {
    emitError(buildErrorResponse("C4A-SERVER-009", "未找到 docker-compose.server.yml，无法执行清理"));
    process.exitCode = 1;
    return;
  }
  const result = await composeDown(composeFile);
  if (result.exitCode !== 0) {
    emitError(buildErrorResponse("C4A-SERVER-010", result.stderr || "清理失败"));
    process.exitCode = 1;
    return;
  }
  io.log("已清理服务数据。");
}
