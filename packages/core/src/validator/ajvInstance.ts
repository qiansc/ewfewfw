/**
 * AJV 实例单例，预编译 Schema
 */
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SchemaType } from "../types/base.js";

// ESM 兼容：ajv 的 default export 处理
const Ajv = AjvModule.default ?? AjvModule;
type AjvInstance = InstanceType<typeof Ajv>;

// 获取当前文件路径（ESM 环境）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_DIR = join(__dirname, "../schemas");

let ajvInstance: AjvInstance | null = null;
const validators = new Map<string, ValidateFunction>();

/**
 * 获取 AJV 实例（单例）
 */
export function getAjv(): AjvInstance {
  if (!ajvInstance) {
    ajvInstance = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
    });

    // 添加格式验证支持（uri, date, email 等）
    const addFormats = (
      (addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule
    ) as (ajv: AjvInstance) => AjvInstance;
    addFormats(ajvInstance);

    loadSchemas(ajvInstance);
  }
  return ajvInstance;
}

/**
 * 加载所有 JSON Schema
 */
function loadSchemas(ajv: AjvInstance): void {
  const schemaFiles = readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith(".schema.json"))
    .sort();

  for (const file of schemaFiles) {
    const schemaPath = join(SCHEMA_DIR, file);
    try {
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      ajv.addSchema(schema);
    } catch (error) {
      throw new Error(`Failed to load schema: ${schemaPath}`, {
        cause: error,
      });
    }
  }
}

/**
 * 获取特定类型的验证器
 */
export function getValidator(type: SchemaType): ValidateFunction | null {
  const cacheKey = type;

  if (validators.has(cacheKey)) {
    return validators.get(cacheKey)!;
  }

  const ajv = getAjv();
  const schemaMap: Record<SchemaType, string> = {
    product: "https://context4ai.org/schemas/c4a-product.schema.json",
    system: "https://context4ai.org/schemas/c4a-system.schema.json",
    container: "https://context4ai.org/schemas/c4a-container.schema.json",
    component: "https://context4ai.org/schemas/c4a-component.schema.json",
    process: "https://context4ai.org/schemas/c4a-process.schema.json",
    sor: "https://context4ai.org/schemas/c4a-sor.schema.json",
    adr: "https://context4ai.org/schemas/c4a-adr.schema.json",
    contract: "https://context4ai.org/schemas/c4a-contract.schema.json",
    feat: "https://context4ai.org/schemas/c4a-feat.schema.json",
    checklist: "https://context4ai.org/schemas/c4a-checklist.schema.json",
    spec: "https://context4ai.org/schemas/c4a-spec.schema.json",
  };

  const schemaId = schemaMap[type];
  if (!schemaId) return null;

  const validator = ajv.getSchema(schemaId);
  if (!validator) return null;

  validators.set(cacheKey, validator);
  return validator;
}

/**
 * 清除缓存（用于测试）
 */
export function clearCache(): void {
  ajvInstance = null;
  validators.clear();
}
