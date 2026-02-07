import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { ContainerStatus } from "../utils/docker.js";
import type { BackupEntity, PermissionSummary, ServiceHealth } from "./serverTypes.js";

export const SERVER_STATUS_SERVICES = [
  { label: "MongoDB", container: "c4a-mongodb", ports: "27017" },
  { label: "Neo4j", container: "c4a-neo4j", ports: "7474/7687" },
  { label: "Milvus", container: "c4a-milvus", ports: "19530" },
  { label: "Ollama", container: "c4a-ollama", ports: "11434" },
];

export const SERVER_CONTAINERS = SERVER_STATUS_SERVICES.map((item) => item.container);

const SERVER_CONTAINER_ALIASES: Record<string, string> = {
  mongodb: "c4a-mongodb",
  neo4j: "c4a-neo4j",
  milvus: "c4a-milvus",
  ollama: "c4a-ollama",
};

type HealthResponse = {
  status?: string;
  mongodb?: boolean;
  neo4j?: boolean;
  milvus?: boolean;
  ollama?: boolean;
  service?: string;
};

export async function fetchServerHealth(baseUrl?: string): Promise<HealthResponse | null> {
  if (!baseUrl) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeHttpUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `http://${value}`;
}

export function resolveServerUrl(config?: { server?: { url?: string } }): string {
  const serverUrl = normalizeHttpUrl(config?.server?.url);
  return serverUrl ?? "http://localhost:8051";
}

function isContainerHealthy(item?: ContainerStatus): boolean {
  if (!item) return false;
  if (item.state !== "running") return false;
  if (!item.health) return true;
  return item.health === "healthy";
}

export function deriveContainerHealth(statusMap: Map<string, ContainerStatus>): ServiceHealth {
  return {
    mongodb: isContainerHealthy(statusMap.get("c4a-mongodb")),
    neo4j: isContainerHealthy(statusMap.get("c4a-neo4j")),
    milvus: isContainerHealthy(statusMap.get("c4a-milvus")),
    ollama: isContainerHealthy(statusMap.get("c4a-ollama")),
  };
}

export function formatBytes(size?: number): string {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function resolveContainerName(input: string): string {
  return SERVER_CONTAINER_ALIASES[input] ?? input;
}

export function formatContainerSummary(
  service: { label: string; container: string; ports: string },
  item?: ContainerStatus,
): string {
  const state =
    item?.state === "running"
      ? "运行中"
      : item?.state === "exited"
        ? "已停止"
        : item?.state === "not_found"
          ? "未创建"
          : "未知";
  const health =
    item?.health === "healthy"
      ? "健康"
      : item?.health === "unhealthy"
        ? "异常"
        : item?.health === "starting"
          ? "启动中"
          : "未知";
  const ports = item?.ports ?? service.ports;
  return `${service.label} (${service.container}) | ${ports} | ${state} | ${health}`;
}

export function buildBackupFilename(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const name = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `c4a-backup-${name}.tar.gz`;
}

function extractTarJson(archive: Buffer): string {
  if (archive.length < 512) {
    throw new Error("备份文件格式错误");
  }
  const sizeRaw = archive.toString("utf-8", 124, 136).replace(/\0.*$/, "").trim();
  const size = Number.parseInt(sizeRaw, 8);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("备份文件格式错误");
  }
  const start = 512;
  const end = start + size;
  if (end > archive.length) {
    throw new Error("备份文件格式错误");
  }
  return archive.toString("utf-8", start, end);
}

export async function readBackupEntities(backupFile: string): Promise<BackupEntity[]> {
  const raw = await readFile(backupFile);
  const isGzip = backupFile.endsWith(".gz");
  const buffer = isGzip ? gunzipSync(raw) : raw;
  const isTar = backupFile.endsWith(".tar.gz") || backupFile.endsWith(".tgz");
  const jsonText = isTar ? extractTarJson(buffer) : buffer.toString("utf-8");
  const data = JSON.parse(jsonText) as { entities?: BackupEntity[] };
  if (!Array.isArray(data.entities)) {
    throw new Error("备份文件缺少 entities 字段");
  }
  return data.entities.map((entity) => ({
    root_id: entity.root_id ?? entity.metadata?.root_id,
  }));
}

export function summarizePermissions(entities: BackupEntity[]): PermissionSummary {
  const projects: PermissionSummary["projects"] = {};
  for (const entity of entities) {
    const project = entity.root_id || "unknown";
    if (!projects[project]) {
      projects[project] = { total: 0, allowed: 0, denied: 0 };
    }
    projects[project].total += 1;
  }
  return {
    total: 0,
    allowed: 0,
    denied: 0,
    projects,
  };
}

export async function checkProjectPermission(
  baseUrl: string,
  userId: string,
  rootId: string,
): Promise<boolean> {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${trimmedBase}/permissions/check`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-User-ID": userId,
    },
    body: JSON.stringify({ user_id: userId, root_id: rootId, action: "write" }),
  });
  if (!response.ok) {
    if (response.status === 404) {
      return true;
    }
    return false;
  }
  const data = (await response.json()) as { allowed?: boolean };
  return data.allowed === true;
}

export async function summarizePermissionsWithCheck(
  summary: PermissionSummary,
  check?: (projectId: string) => Promise<boolean>,
): Promise<PermissionSummary> {
  const projects = summary.projects;
  for (const [projectId, stats] of Object.entries(projects)) {
    if (projectId === "unknown") {
      stats.denied = stats.total;
      continue;
    }
    if (!check) {
      stats.allowed = stats.total;
      continue;
    }
    try {
      const allowed = await check(projectId);
      if (allowed) {
        stats.allowed = stats.total;
      } else {
        stats.denied = stats.total;
      }
    } catch {
      stats.denied = stats.total;
    }
  }

  const totals = Object.values(projects).reduce(
    (acc, stats) => {
      acc.total += stats.total;
      acc.allowed += stats.allowed;
      acc.denied += stats.denied;
      return acc;
    },
    { total: 0, allowed: 0, denied: 0 },
  );
  return { ...summary, ...totals };
}
