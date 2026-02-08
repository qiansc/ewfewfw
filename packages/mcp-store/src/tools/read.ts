/**
 * c4a_store_read 工具实现
 *
 * 读取实体/版本链
 */
import type {
  StoreReadInput,
  StoreReadResult,
  StoreReadFormattedResult,
} from "../schemas.js";
import { StoreReadInputSchema } from "../schemas.js";
import { getAdapter, isRemoteMode, loadConfig } from "@c4a/storage";
import { InputError, INPUT_ERROR_CODES } from "@c4a/core/types";
import YAML from "yaml";

function formatContent(data: Record<string, unknown>, format: "yaml" | "json"): string {
  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }
  return YAML.stringify(data, { indent: 2 });
}

/**
 * c4a_store_read 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Remote 两种模式。
 *
 * @param args - 输入参数
 * @returns 读取结果
 */
export async function storeReadHandler(
  args: StoreReadInput
): Promise<StoreReadResult | StoreReadFormattedResult | StoreReadFormattedResult[]> {
  const parsed = StoreReadInputSchema.parse(args);
  const adapter = await getAdapter();
  const config = loadConfig();

  // 确保适配器已初始化
  await adapter.initialize();

  const format = parsed.format ?? "object";
  const includeVersions = parsed.include_versions ?? false;

  if (includeVersions && format !== "object") {
    throw new InputError(
      INPUT_ERROR_CODES.INVALID_FIELD_FORMAT,
      {
        field: "format",
        expected: "object",
        actual: format,
        suggestion: "include_versions=true 时仅支持 object 格式",
      },
      "版本链查询仅支持 object 格式"
    );
  }

  if (parsed.uuid) {
    const entity = await adapter.readByUuid(parsed.uuid);
    if (!entity) {
      return {} as StoreReadResult;
    }
    if (format === "yaml" || format === "json") {
      return {
        uuid: entity.uuid,
        id: entity.id,
        type: entity.type,
        status: entity.metadata.status,
        content: formatContent(entity.data ?? {}, format),
        format,
      } as StoreReadFormattedResult;
    }
    return { entity, relations: [] } as StoreReadResult;
  }

  if (!parsed.id) {
    throw new InputError(
      INPUT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      {
        field: "id",
        expected: "非空字符串",
        actual: "",
        suggestion: "请提供 uuid，或提供 root_id + id",
      },
      "缺少实体标识"
    );
  }

  const rootId = parsed.root_id ?? config.local?.defaultProject ?? config.root_id;
  if (rootId === undefined || rootId === null) {
    throw new InputError(
      INPUT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      {
        field: "root_id",
        expected: "非空字符串",
        actual: "",
        suggestion: isRemoteMode()
          ? "Remote 模式必须显式传入 root_id"
          : "请在 .context/.c4a.yaml 配置 defaultProject 或在参数中传入 root_id",
      },
      "缺少 root_id"
    );
  }

  if (includeVersions) {
    const entities = await adapter.list({
      root_id: rootId,
      id: parsed.id,
    });
    return entities as StoreReadResult;
  }

  const entity = await adapter.read(rootId, parsed.id, parsed.version);
  if (!entity) {
    return {} as StoreReadResult;
  }

  if (format === "yaml" || format === "json") {
    return {
      uuid: entity.uuid,
      id: entity.id,
      type: entity.type,
      status: entity.metadata.status,
      content: formatContent(entity.data ?? {}, format),
      format,
    } as StoreReadFormattedResult;
  }

  return { entity, relations: [] } as StoreReadResult;
}
