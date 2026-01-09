/**
 * c4a_dsl_schema 工具实现
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SchemaInput } from "../schemas/inputSchemas.js";
import { SchemaNotFoundError } from "../errors/index.js";

// 获取 @c4a/core 的 schemas 路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_DIR = join(__dirname, "../../node_modules/@c4a/core/src/schemas");

// 备选路径（workspace 模式）
const WORKSPACE_SCHEMA_DIR = join(__dirname, "../../../core/src/schemas");

const schemaFiles: Record<string, string> = {
  system: "c4a-system.schema.json",
  container: "c4a-container.schema.json",
  component: "c4a-component.schema.json",
  adr: "c4a-adr.schema.json",
  contract: "c4a-contract.schema.json",
};

function loadSchema(filename: string): Record<string, unknown> | null {
  // 尝试多个路径
  const paths = [
    join(SCHEMA_DIR, filename),
    join(WORKSPACE_SCHEMA_DIR, filename),
  ];

  for (const schemaPath of paths) {
    try {
      const content = readFileSync(schemaPath, "utf-8");
      return JSON.parse(content);
    } catch {
      // 继续尝试下一个路径
    }
  }

  return null;
}

export async function schemaHandler(
  input: SchemaInput
): Promise<Record<string, unknown>> {
  const filename = schemaFiles[input.type];

  if (!filename) {
    throw new SchemaNotFoundError(input.type);
  }

  const schema = loadSchema(filename);

  if (!schema) {
    throw new SchemaNotFoundError(input.type);
  }

  return schema;
}
