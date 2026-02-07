import type { GlobalConfig } from "../core/config.js";
import { McpClient, type McpTransport } from "../core/mcp-client.js";
import { buildErrorResponse } from "../utils/errorResponse.js";
import type { CommandIO } from "./serverTypes.js";

function resolveServerUrl(config: GlobalConfig | null): string {
  const serverUrl = config?.server?.url?.trim().replace(/\/+$/, "");
  return serverUrl ? serverUrl : "http://localhost:8051";
}

function createMcpClient(config: GlobalConfig | null): McpClient {
  return new McpClient({ baseUrl: resolveServerUrl(config), transport: "http" as McpTransport });
}

export async function handleCheckConsistency(params: {
  io: CommandIO;
  config: GlobalConfig | null;
  options: Record<string, string | boolean>;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
  userId: string;
}): Promise<void> {
  const { io, config, options, emitError, userId } = params;
  const format = options.format === "json" ? "json" : "text";
  void userId;
  const client = createMcpClient(config);
  let result: {
    scanned: number;
    inconsistencies: Array<{ entity_id: string; issue: string; fixed: boolean }>;
    stats?: { neo4j_fixed: number; milvus_fixed: number; failed: number };
    message?: string;
  };
  try {
    result = await client.request("c4a_store_repair", { scope: "all", dry_run: true });
  } catch (error) {
    emitError(buildErrorResponse("C4A-SERVER-013", `一致性检查失败: ${String(error)}`));
    process.exitCode = 1;
    return;
  }

  if (format === "json") {
    io.log(JSON.stringify(result, null, 2));
    return;
  }

  io.log("数据一致性检查结果:");
  io.log(`  扫描: ${result.scanned} 个实体`);
  io.log(`  发现问题: ${result.inconsistencies.length}`);

  if (result.inconsistencies.length > 0) {
    io.log("");
    io.log("待同步实体:");
    for (const item of result.inconsistencies.slice(0, 10)) {
      io.log(`  - ${item.entity_id}: ${item.issue}`);
    }
    if (result.inconsistencies.length > 10) {
      io.log(`  ... 还有 ${result.inconsistencies.length - 10} 个`);
    }
  }
}

export async function handleRebuildNeo4j(params: {
  io: CommandIO;
  config: GlobalConfig | null;
  options: Record<string, string | boolean>;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
  confirm: (message: string) => Promise<boolean>;
  userId: string;
}): Promise<void> {
  const { io, config, options, emitError, confirm, userId } = params;
  const confirmed =
    options.yes === true ? true : await confirm("重建 Neo4j 将重新同步所有关系数据，确认继续？");
  if (!confirmed) {
    io.log("已取消操作。");
    return;
  }

  const format = options.format === "json" ? "json" : "text";
  const client = createMcpClient(config);

  if (format === "text") {
    io.log("正在重建 Neo4j 数据...");
  }

  void userId;
  let result: {
    scanned: number;
    inconsistencies: Array<{ entity_id: string; issue: string; fixed: boolean }>;
    stats?: { neo4j_fixed: number; milvus_fixed: number; failed: number };
  };
  try {
    result = await client.request("c4a_store_repair", { scope: "neo4j", dry_run: false });
  } catch (error) {
    emitError(buildErrorResponse("C4A-SERVER-014", `Neo4j 重建失败: ${String(error)}`));
    process.exitCode = 1;
    return;
  }

  if (format === "json") {
    io.log(JSON.stringify(result, null, 2));
    return;
  }

  io.log("✅ Neo4j 重建完成");
  io.log(`已同步 ${result.stats?.neo4j_fixed ?? 0} 个关系`);
  if ((result.stats?.failed ?? 0) > 0) {
    io.log(`⚠️  失败 ${result.stats?.failed ?? 0} 个`);
  }
}

export async function handleRebuildMilvus(params: {
  io: CommandIO;
  config: GlobalConfig | null;
  options: Record<string, string | boolean>;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
  confirm: (message: string) => Promise<boolean>;
  userId: string;
}): Promise<void> {
  const { io, config, options, emitError, confirm, userId } = params;
  const confirmed =
    options.yes === true ? true : await confirm("重建 Milvus 将重新生成所有向量数据，确认继续？");
  if (!confirmed) {
    io.log("已取消操作。");
    return;
  }

  const format = options.format === "json" ? "json" : "text";
  const client = createMcpClient(config);

  if (format === "text") {
    io.log("正在重建 Milvus 数据...");
  }

  void userId;
  let result: {
    scanned: number;
    inconsistencies: Array<{ entity_id: string; issue: string; fixed: boolean }>;
    stats?: { neo4j_fixed: number; milvus_fixed: number; failed: number };
  };
  try {
    result = await client.request("c4a_store_repair", { scope: "milvus", dry_run: false });
  } catch (error) {
    emitError(buildErrorResponse("C4A-SERVER-015", `Milvus 重建失败: ${String(error)}`));
    process.exitCode = 1;
    return;
  }

  if (format === "json") {
    io.log(JSON.stringify(result, null, 2));
    return;
  }

  io.log("✅ Milvus 重建完成");
  io.log(`已同步 ${result.stats?.milvus_fixed ?? 0} 个向量`);
  if ((result.stats?.failed ?? 0) > 0) {
    io.log(`⚠️  失败 ${result.stats?.failed ?? 0} 个`);
  }
}
