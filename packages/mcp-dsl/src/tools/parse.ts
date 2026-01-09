/**
 * c4a_dsl_parse 工具实现
 */
import { parseDSL } from "@c4a/core";
import type { ParseInput, DSLType } from "../schemas/inputSchemas.js";
import { DSLParseError } from "../errors/index.js";

const typeMapping: Record<DSLType, string> = {
  system: "software-system",
  container: "container",
  component: "component",
  adr: "adr",
  contract: "contract",
};

export async function parseHandler(
  input: ParseInput
): Promise<{ parsed: unknown; type: string }> {
  try {
    const parsed = parseDSL<Record<string, unknown>>(input.content);

    // 验证 type 字段匹配
    const expectedType = typeMapping[input.type];
    const actualType = parsed.type as string;

    if (actualType !== expectedType) {
      throw new DSLParseError(
        `Type mismatch: expected ${expectedType}, got ${actualType}`
      );
    }

    return { parsed, type: input.type };
  } catch (error) {
    if (error instanceof DSLParseError) {
      throw error;
    }
    throw new DSLParseError(
      `Failed to parse DSL: ${(error as Error).message}`,
      error as Error
    );
  }
}
