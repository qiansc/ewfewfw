/**
 * C4A DSL 验证器
 */
import type { ValidateFunction } from "ajv";
import { getValidator } from "./ajvInstance.js";

export interface ValidationError {
  path: string;
  message: string;
  keyword?: string;
  params?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  data?: unknown;
}

export type DSLType = "system" | "container" | "component" | "adr" | "contract";

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
export function validateDSL(data: unknown, type: DSLType): ValidationResult {
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

  const errors: ValidationError[] = (validator.errors || []).map((err) => ({
    path: err.instancePath || "",
    message: err.message || "Unknown error",
    keyword: err.keyword,
    params: err.params as Record<string, unknown>,
  }));

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
  type: DSLType
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

  const typeMap: Record<string, DSLType> = {
    "software-system": "system",
    container: "container",
    component: "component",
    adr: "adr",
    contract: "contract",
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
