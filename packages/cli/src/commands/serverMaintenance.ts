import type { GlobalConfig } from "../core/config.js";
import { buildErrorResponse } from "../utils/errorResponse.js";
import type { CommandIO } from "./serverTypes.js";
import { resolveStorageBackendUrl } from "./serverHelpers.js";

export async function handleCheckConsistency(params: {
  io: CommandIO;
  config: GlobalConfig | null;
  options: Record<string, string | boolean>;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
  userId: string;
}): Promise<void> {
  const { io, config, options, emitError, userId } = params;
  const projectId = typeof options.project === "string" ? options.project : undefined;
  const format = options.format === "json" ? "json" : "text";

  const baseUrl = resolveStorageBackendUrl(config ?? undefined);
  const response = await fetch(`${baseUrl}/utils/check-consistency`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": userId,
    },
    body: JSON.stringify({ project_id: projectId }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    emitError(buildErrorResponse("C4A-SERVER-013", `一致性检查失败: ${errorText}`));
    process.exitCode = 1;
    return;
  }

  const result = (await response.json()) as {
    total: number;
    synced: number;
    pending: number;
    failed: number;
    no_status: number;
    details: Array<{ id: string; neo4j: string; milvus: string }>;
  };

  if (format === "json") {
    io.log(JSON.stringify(result, null, 2));
    return;
  }

  io.log("数据一致性检查结果:");
  io.log(`  总计: ${result.total} 个实体`);
  io.log(`  ✅ 已同步: ${result.synced}`);
  io.log(`  ⏳ 待同步: ${result.pending}`);
  io.log(`  ❌ 失败: ${result.failed}`);
  io.log(`  ⚠️  无状态: ${result.no_status}`);

  if (result.details.length > 0) {
    io.log("");
    io.log("待同步实体:");
    for (const item of result.details.slice(0, 10)) {
      io.log(`  - ${item.id}: Neo4j=${item.neo4j}, Milvus=${item.milvus}`);
    }
    if (result.details.length > 10) {
      io.log(`  ... 还有 ${result.details.length - 10} 个`);
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
  const baseUrl = resolveStorageBackendUrl(config ?? undefined);

  if (format === "text") {
    io.log("正在重建 Neo4j 数据...");
  }

  const response = await fetch(`${baseUrl}/utils/repair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": userId,
    },
    body: JSON.stringify({ scope: "neo4j" }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    emitError(buildErrorResponse("C4A-SERVER-014", `Neo4j 重建失败: ${errorText}`));
    process.exitCode = 1;
    return;
  }

  const result = (await response.json()) as {
    success: boolean;
    scanned: number;
    inconsistencies: Array<{ entity_id: string; issue: string; fixed: boolean }>;
    stats: { neo4j_fixed: number; milvus_fixed: number; failed: number };
  };

  if (format === "json") {
    io.log(JSON.stringify(result, null, 2));
    return;
  }

  io.log("✅ Neo4j 重建完成");
  io.log(`已同步 ${result.stats?.neo4j_fixed ?? 0} 个关系`);
  if (result.stats?.failed > 0) {
    io.log(`⚠️  失败 ${result.stats.failed} 个`);
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
  const baseUrl = resolveStorageBackendUrl(config ?? undefined);

  if (format === "text") {
    io.log("正在重建 Milvus 数据...");
  }

  const response = await fetch(`${baseUrl}/utils/repair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": userId,
    },
    body: JSON.stringify({ scope: "milvus" }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    emitError(buildErrorResponse("C4A-SERVER-015", `Milvus 重建失败: ${errorText}`));
    process.exitCode = 1;
    return;
  }

  const result = (await response.json()) as {
    success: boolean;
    scanned: number;
    inconsistencies: Array<{ entity_id: string; issue: string; fixed: boolean }>;
    stats: { neo4j_fixed: number; milvus_fixed: number; failed: number };
  };

  if (format === "json") {
    io.log(JSON.stringify(result, null, 2));
    return;
  }

  io.log("✅ Milvus 重建完成");
  io.log(`已同步 ${result.stats?.milvus_fixed ?? 0} 个向量`);
  if (result.stats?.failed > 0) {
    io.log(`⚠️  失败 ${result.stats.failed} 个`);
  }
}
