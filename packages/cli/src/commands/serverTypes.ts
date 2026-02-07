import type { GlobalConfig } from "../core/config.js";
import type { McpClient, McpTransport } from "../core/mcp-client.js";
import type { buildErrorResponse } from "../utils/errorResponse.js";
import type { CommandResult, ContainerStatus } from "../utils/docker.js";

export interface CommandIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface BackupEntity {
  root_id?: string;
  metadata?: { root_id?: string };
}

export interface PermissionSummary {
  total: number;
  allowed: number;
  denied: number;
  projects: Record<string, { total: number; allowed: number; denied: number }>;
}

export interface ServiceHealth {
  mongodb: boolean;
  neo4j: boolean;
  milvus: boolean;
  ollama: boolean;
}

export interface ServerDockerDeps {
  checkDockerInstalled: () => Promise<boolean>;
  getContainerStatus: (names?: string[]) => Promise<ContainerStatus[]>;
  restartContainers: (names?: string[]) => Promise<CommandResult>;
  stopContainers: (names?: string[]) => Promise<CommandResult>;
  getContainerLogs: (
    name?: string,
    options?: { tail?: number; timestamps?: boolean },
  ) => Promise<CommandResult>;
}

export interface ServerCommandDeps {
  io?: CommandIO;
  docker?: ServerDockerDeps;
  confirm?: (message: string) => Promise<boolean>;
  loadConfig?: () => Promise<GlobalConfig | null>;
  createMcpClient?: (options: { baseUrl?: string; transport?: McpTransport }) => McpClient;
  emitError?: (response: ReturnType<typeof buildErrorResponse>) => void;
  permissionChecker?: (backupFile: string, user?: string) => Promise<PermissionSummary>;
  composeDown?: (composeFile: string) => Promise<CommandResult>;
  checkHealth?: (config: unknown, statuses: ContainerStatus[]) => Promise<ServiceHealth>;
}
