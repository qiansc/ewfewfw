/**
 * C4A DSL 验证器
 */
import type { ValidateFunction } from "ajv";
import { getValidator } from "./ajvInstance.js";
import type { SchemaType } from "../types/base.js";

export interface ValidationError {
  path: string;
  message: string;
  keyword?: string;
  params?: Record<string, unknown>;
  hint?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  data?: unknown;
}

// 重新导出 SchemaType
export type { SchemaType };

/**
 * 格式化验证错误，提供更友好的提示
 */
function formatValidationError(
  err: {
    instancePath?: string;
    message?: string;
    keyword?: string;
    params?: Record<string, unknown>;
  },
  type: SchemaType
): ValidationError {
  const path = err.instancePath || "";
  const keyword = err.keyword;
  const params = err.params as Record<string, unknown>;

  let message = err.message || "Unknown error";
  let hint: string | undefined;

  // 针对 additionalProperties 错误提供更友好的提示
  if (keyword === "additionalProperties" && params?.additionalProperty) {
    const extraProp = params.additionalProperty as string;
    message = `不支持的字段: "${extraProp}"`;
    hint = `请检查 ${type} 类型的 schema 定义，确认允许的字段。`;
  }

  // 针对 required 错误
  if (keyword === "required" && params?.missingProperty) {
    const missingProp = params.missingProperty as string;
    message = `缺少必需字段: "${missingProp}"`;
    hint = `请在 ${path || "根对象"} 中添加 "${missingProp}" 字段。`;
  }

  // 针对 enum 错误
  if (keyword === "enum" && params?.allowedValues) {
    const allowed = params.allowedValues as string[];
    hint = `允许的值: ${allowed.join(", ")}`;
  }

  return {
    path,
    message,
    keyword,
    params,
    hint,
  };
}

/**
 * 验证 DSL 对象
 *
 * @param data - 待验证的 DSL 对象（已解析的 YAML/JSON）
 * @param type - DSL 类型
 * @returns 验证结果
 *
 * @example
 * ```typescript
 * const result = validateDSL(dslData, 'system');
 * if (!result.valid) {
 *   console.error('Validation failed:', result.errors);
 * }
 * ```
 */
export function validateDSL(data: unknown, type: SchemaType): ValidationResult {
  const validator = getValidator(type);

  if (!validator) {
    return {
      valid: false,
      errors: [{ path: "", message: `Unknown DSL type: ${type}` }],
    };
  }

  const valid = validator(data);

  if (valid) {
    return { valid: true, data };
  }

  const errors: ValidationError[] = (validator.errors || []).map((err) =>
    formatValidationError(err, type)
  );

  return { valid: false, errors };
}

/**
 * 验证 DSL 字符串（YAML）
 *
 * @param content - DSL YAML 字符串
 * @param type - DSL 类型
 * @returns 验证结果
 */
export async function validateDSLString(
  content: string,
  type: SchemaType
): Promise<ValidationResult> {
  const { parseDSL } = await import("../utils/index.js");

  try {
    const data = parseDSL<unknown>(content);
    return validateDSL(data, type);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          path: "",
          message: `YAML parsing failed: ${(error as Error).message}`,
        },
      ],
    };
  }
}

/**
 * 自动检测并验证 DSL
 * 根据 data.type 字段自动判断 DSL 类型
 */
export function validateDSLAuto(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return {
      valid: false,
      errors: [{ path: "", message: "DSL must be an object" }],
    };
  }

  const obj = data as Record<string, unknown>;
  const type = obj.type as string;

  const typeMap: Record<string, SchemaType> = {
    product: "product",
    "software-system": "system",
    container: "container",
    component: "component",
    process: "process",
    sor: "sor",
    adr: "adr",
    contract: "contract",
    feat: "feat",
    checklist: "checklist",
  };

  const mappedType = typeMap[type];
  if (!mappedType) {
    return {
      valid: false,
      errors: [{ path: "type", message: `Invalid type: ${type}` }],
    };
  }

  return validateDSL(data, mappedType);
}

export type { ValidateFunction };
export { getValidator, clearCache } from "./ajvInstance.js";
