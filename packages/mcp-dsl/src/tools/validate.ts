/**
 * c4a_dsl_validate 工具实现
 */
import { parseDSL, validateDSL, type ValidationResult } from "@c4a/core";
import type { ValidateInput, DSLType } from "../schemas/inputSchemas.js";

export interface ValidateResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
    rule?: string;
  }>;
}

export async function validateHandler(
  input: ValidateInput
): Promise<ValidateResult> {
  try {
    // 1. 先解析 YAML
    const parsed = parseDSL<Record<string, unknown>>(input.content);

    // 2. Schema 验证
    const result = validateDSL(parsed, input.type as DSLType);

    if (!result.valid) {
      const errors = (result.errors || []).map((err) => ({
        path: err.path,
        message: err.message,
        rule: err.keyword,
      }));

      // 3. 如果指定了规则过滤，只返回匹配的错误
      const filteredErrors = input.rules
        ? errors.filter((e) => e.rule && input.rules!.includes(e.rule))
        : errors;

      return {
        valid: filteredErrors.length === 0,
        errors: filteredErrors,
      };
    }

    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          path: "",
          message: `Validation failed: ${(error as Error).message}`,
        },
      ],
    };
  }
}
