/**
 * c4a_store_save 工具实现
 *
 * 保存/更新实体到数据库
 */
import type { StoreSaveInput, StoreSaveResult } from "../schemas.js";
import { StoreSaveInputSchemaWithRefine } from "../schemas.js";
import type { Entity, StorageAdapter } from "@c4a/storage";
import { getAdapter, isRemoteMode, loadConfig } from "@c4a/storage";
import { InputError, INPUT_ERROR_CODES } from "@c4a/core/types";
import type { Warning } from "../schemas.js";
import YAML from "yaml";

function parseContent(content: string, format: "yaml" | "json"): Record<string, unknown> {
  if (format === "json") {
    return JSON.parse(content) as Record<string, unknown>;
  }
  return YAML.parse(content) as Record<string, unknown>;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function resolveIdFromData(data: Record<string, unknown>, type: string): string | undefined {
  const direct = getStringField(data, "id");
  if (direct) return direct;

  const key = type === "system" ? "system" : type;
  const nested = data[key];
  if (nested && typeof nested === "object") {
    return getStringField(nested as Record<string, unknown>, "id");
  }

  return undefined;
}

async function resolveExistingEntity(
  adapter: StorageAdapter,
  options: {
    uuid?: string;
    rootId: string;
    id: string;
    version: string;
  }
): Promise<Entity | null> {
  if (options.uuid) {
    const entity = await adapter.readByUuid(options.uuid);
    if (entity) return entity;
  }

  const exact = await adapter.read(options.rootId, options.id, options.version);
  if (exact) return exact;

  const latest = await adapter.read(options.rootId, options.id, "0.0.0");
  if (latest) return latest;

  const candidates = await adapter.list({ root_id: options.rootId, id: options.id });
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1) {
    throw new InputError(
      INPUT_ERROR_CODES.INVALID_FIELD_FORMAT,
      {
        field: "uuid",
        expected: "唯一实体 uuid",
        actual: "",
        suggestion: "目标版本未找到且存在多条记录，请显式传入 uuid",
      },
      "无法确定要保存的实体"
    );
  }

  return null;
}

function mergeEntityData(
  base: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  return { ...(base ?? {}), ...(incoming ?? {}) };
}

function requireEntityUuid(entity: Entity): string {
  if (!entity.uuid) {
    throw new InputError(
      INPUT_ERROR_CODES.INVALID_FIELD_FORMAT,
      {
        field: "uuid",
        expected: "非空字符串",
        actual: "",
        suggestion: "请确保实体包含 uuid",
      },
      "缺少实体 uuid"
    );
  }
  return entity.uuid;
}

/**
 * c4a_store_save 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 保存结果
 */
export async function storeSaveHandler(args: StoreSaveInput): Promise<StoreSaveResult> {
  const parsed = StoreSaveInputSchemaWithRefine.parse(args);
  const config = loadConfig();
  const adapter = await getAdapter();
  const warnings: Warning[] = [];

  // 确保适配器已初始化
  await adapter.initialize();

  const data = parsed.data ?? parseContent(parsed.content ?? "", parsed.format ?? "yaml");
  if (!data || typeof data !== "object") {
    throw new InputError(
      INPUT_ERROR_CODES.INVALID_FIELD_FORMAT,
      {
        field: "data",
        expected: "object",
        actual: String(data),
        suggestion: "请提供合法的实体数据对象或正确的 content 内容",
      },
      "实体数据解析失败"
    );
  }

  const resolvedId = parsed.id ?? resolveIdFromData(data, parsed.type);
  if (!resolvedId) {
    throw new InputError(
      INPUT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      {
        field: "id",
        expected: "非空字符串",
        actual: "",
        suggestion: "请在参数中传入 id，或在 data 中包含 id 字段",
      },
      "缺少实体 id"
    );
  }

  const dataRootId =
    getStringField(data, "root_id") ??
    (data.metadata && typeof data.metadata === "object"
      ? getStringField(data.metadata as Record<string, unknown>, "root_id")
      : undefined);
  const defaultRootId = config.local?.defaultProject ?? config.root_id;
  let resolvedRootId = parsed.root_id ?? dataRootId ?? defaultRootId;
  if (resolvedRootId === undefined || resolvedRootId === null) {
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

  const requirementId = parsed.requirement_id ?? getStringField(data, "requirement_id");
  const componentId = parsed.component_id ?? getStringField(data, "component_id");
  let resolvedUuid = parsed.uuid ?? getStringField(data, "uuid");
  const targetVersion = parsed.version;

  if ("versions" in data) {
    delete (data as Record<string, unknown>).versions;
    warnings.push({
      code: "C4A-VERSION-IGNORED",
      message: "versions 字段为受控字段，已忽略传入值",
      severity: "warning",
      details: { field: "versions" },
    });
  }

  let dataForSave = data;
  let existingEntity: Entity | null = null;

  if (targetVersion) {
    existingEntity = await resolveExistingEntity(adapter, {
      uuid: resolvedUuid,
      rootId: resolvedRootId,
      id: resolvedId,
      version: targetVersion,
    });

    if (existingEntity) {
      resolvedUuid = requireEntityUuid(existingEntity);

      if (!existingEntity.versions?.includes(targetVersion)) {
        existingEntity = await adapter.addVersion(requireEntityUuid(existingEntity), targetVersion);
      }

      if ((existingEntity.versions ?? []).length > 1) {
        const mergedData = mergeEntityData(existingEntity.data ?? {}, data);
        const splitUuid = await adapter.splitEntity(
          requireEntityUuid(existingEntity),
          targetVersion,
          mergedData
        );
        resolvedUuid = splitUuid;
        dataForSave = mergedData;
      }
    }
  }

  // 调用 StorageAdapter.save()
  const result = await adapter.save(
    {
      uuid: resolvedUuid,
      id: resolvedId,
      root_id: resolvedRootId,
      type: parsed.type,
      data: dataForSave,
      requirement_id: requirementId,
      component_id: componentId,
      kind: getStringField(dataForSave, "kind"),
      scope: getStringField(dataForSave, "scope"),
      perspective: getStringField(dataForSave, "perspective"),
      versions: targetVersion && !existingEntity ? [targetVersion] : undefined,
    },
    {
      expected_updated_at: parsed.expected_updated_at,
      force: parsed.force ?? false,
    }
  );

  return {
    success: true,
    id: result.id,
    status: result.metadata.status,
    entity: result,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
