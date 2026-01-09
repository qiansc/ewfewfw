/**
 * AJV 实例单例，预编译 Schema
 */
import Ajv, { type ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 获取当前文件路径（ESM 环境）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_DIR = join(__dirname, "../schemas");

let ajvInstance: Ajv | null = null;
const validators = new Map<string, ValidateFunction>();

/**
 * 获取 AJV 实例（单例）
 */
export function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
    });

    loadSchemas(ajvInstance);
  }
  return ajvInstance;
}

/**
 * 加载所有 JSON Schema
 */
function loadSchemas(ajv: Ajv): void {
  const schemaFiles = [
    "c4a-common.schema.json",
    "c4a-system.schema.json",
    "c4a-container.schema.json",
    "c4a-component.schema.json",
    "c4a-adr.schema.json",
    "c4a-contract.schema.json",
    "c4a-constraints.schema.json",
    "c4a-risks.schema.json",
    "c4a-history.schema.json",
  ];

  for (const file of schemaFiles) {
    const schemaPath = join(SCHEMA_DIR, file);
    try {
      const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
      ajv.addSchema(schema);
    } catch {
      // 忽略不存在的 schema 文件
    }
  }
}

/**
 * 获取特定类型的验证器
 */
export function getValidator(
  type: "system" | "container" | "component" | "adr" | "contract"
): ValidateFunction | null {
  const cacheKey = type;

  if (validators.has(cacheKey)) {
    return validators.get(cacheKey)!;
  }

  const ajv = getAjv();
  const schemaMap: Record<string, string> = {
    system: "https://c4a.dev/schema/c4a-system.schema.json",
    container: "https://c4a.dev/schema/c4a-container.schema.json",
    component: "https://c4a.dev/schema/c4a-component.schema.json",
    adr: "https://c4a.dev/schema/c4a-adr.schema.json",
    contract: "https://c4a.dev/schema/c4a-contract.schema.json",
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
