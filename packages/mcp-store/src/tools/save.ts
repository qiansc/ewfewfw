/**
 * c4a_store_save 工具实现
 *
 * 保存/更新实体到数据库
 */
import type { StoreSaveInput, StoreSaveResult } from "../schemas.js";
import { StoreSaveInputSchemaWithRefine } from "../schemas.js";
import { getAdapter, isServerMode, loadConfig } from "@c4a/storage";
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
  if (parsed.type === "feat" || parsed.type === "checklist") {
    resolvedRootId = "";
  }

  if (resolvedRootId === undefined || resolvedRootId === null) {
    throw new InputError(
      INPUT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      {
        field: "root_id",
        expected: "非空字符串或空字符串（feat/checklist）",
        actual: "",
        suggestion: isServerMode()
          ? "Server 模式必须显式传入 root_id"
          : "请在 .context/.c4a.yaml 配置 defaultProject 或在参数中传入 root_id",
      },
      "缺少 root_id"
    );
  }

  const requirementId = parsed.requirement_id ?? getStringField(data, "requirement_id");
  const componentId = parsed.component_id ?? getStringField(data, "component_id");
  const uuid = parsed.uuid ?? getStringField(data, "uuid");

  if ("versions" in data) {
    delete (data as Record<string, unknown>).versions;
    warnings.push({
      code: "C4A-VERSION-IGNORED",
      message: "versions 字段为受控字段，已忽略传入值",
      severity: "warning",
      details: { field: "versions" },
    });
  }

  // 调用 StorageAdapter.save()
  const result = await adapter.save(
    {
      uuid,
      id: resolvedId,
      root_id: resolvedRootId,
      type: parsed.type,
      data,
      requirement_id: requirementId,
      component_id: componentId,
      kind: getStringField(data, "kind"),
      scope: getStringField(data, "scope"),
      perspective: getStringField(data, "perspective"),
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
