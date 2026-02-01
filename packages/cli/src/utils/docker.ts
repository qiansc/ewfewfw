import { execFile } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface ContainerStatus {
  name: string;
  status: string;
  state: "running" | "exited" | "paused" | "unknown" | "not_found";
  health?: "healthy" | "unhealthy" | "starting";
  ports?: string;
}

function createDefaultRunner(): CommandRunner {
  return async (command: string, args: string[]) =>
    new Promise<CommandResult>((resolve) => {
      execFile(command, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const exitCode = typeof code === "number" ? code : 1;
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? (error as Error).message,
            exitCode,
          });
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      });
    });
}

const DEFAULT_CONTAINER_NAMES = [
  "c4a-mongodb",
  "c4a-neo4j",
  "c4a-milvus",
  "c4a-ollama",
  "c4a-storage-backend",
];

function parseContainerStatusLine(line: string): ContainerStatus | null {
  if (!line.trim()) return null;
  const [name, status = "", ports = ""] = line.split("\t");
  const healthMatch = status.match(/\((healthy|unhealthy|starting|health: starting)\)/);
  let state: ContainerStatus["state"] = "unknown";
  if (status.startsWith("Up")) {
    state = "running";
  } else if (status.startsWith("Exited")) {
    state = "exited";
  } else if (status.startsWith("Paused")) {
    state = "paused";
  }
  return {
    name,
    status,
    state,
    health: healthMatch
      ? (healthMatch[1] === "health: starting" ? "starting" : (healthMatch[1] as ContainerStatus["health"]))
      : undefined,
    ports: ports || undefined,
  };
}

export async function checkDockerInstalled(
  runner: CommandRunner = createDefaultRunner(),
): Promise<boolean> {
  const result = await runner("docker", ["--version"]);
  return result.exitCode === 0;
}

export async function getContainerStatus(
  names?: string[],
  runner: CommandRunner = createDefaultRunner(),
): Promise<ContainerStatus[]> {
  const result = await runner("docker", ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "无法获取 Docker 容器状态");
  }

  const items = result.stdout
    .split("\n")
    .map((line) => parseContainerStatusLine(line))
    .filter((item): item is ContainerStatus => Boolean(item));

  const targetNames = names ?? DEFAULT_CONTAINER_NAMES;
  if (targetNames.length === 0) {
    return items;
  }

  const nameSet = new Set(targetNames);
  const found = new Map(items.map((item) => [item.name, item]));
  return targetNames.map((name) => {
    const item = found.get(name);
    if (item) {
      return item;
    }
    return {
      name,
      status: "not_found",
      state: "not_found",
      ports: undefined,
    };
  });
}

export async function startContainers(
  names?: string[],
  runner: CommandRunner = createDefaultRunner(),
): Promise<CommandResult> {
  const targetNames = names ?? DEFAULT_CONTAINER_NAMES;
  if (targetNames.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  return runner("docker", ["start", ...targetNames]);
}

export async function stopContainers(
  names?: string[],
  runner: CommandRunner = createDefaultRunner(),
): Promise<CommandResult> {
  const targetNames = names ?? DEFAULT_CONTAINER_NAMES;
  if (targetNames.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  return runner("docker", ["stop", ...targetNames]);
}

export async function restartContainers(
  names?: string[],
  runner: CommandRunner = createDefaultRunner(),
): Promise<CommandResult> {
  const targetNames = names ?? DEFAULT_CONTAINER_NAMES;
  if (targetNames.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  return runner("docker", ["restart", ...targetNames]);
}

export async function getContainerLogs(
  name?: string,
  options?: { tail?: number; since?: string; timestamps?: boolean },
  runner: CommandRunner = createDefaultRunner(),
): Promise<CommandResult> {
  const args = ["logs"];
  if (options?.timestamps) {
    args.push("--timestamps");
  }
  if (options?.since) {
    args.push("--since", options.since);
  }
  if (options?.tail) {
    args.push("--tail", String(options.tail));
  }
  if (name) {
    args.push(name);
    return runner("docker", args);
  }

  const targetNames = DEFAULT_CONTAINER_NAMES;
  const outputs: string[] = [];
  let exitCode = 0;
  let stderr = "";
  for (const container of targetNames) {
    const result = await runner("docker", [...args, container]);
    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
      stderr = stderr || result.stderr;
    }
    const header = `==== ${container} ====`;
    outputs.push([header, result.stdout].filter(Boolean).join("\n"));
  }
  return {
    stdout: outputs.join("\n"),
    stderr,
    exitCode,
  };
}
