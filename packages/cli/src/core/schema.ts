import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { stringify } from "yaml";

export type SchemaType =
  | "system"
  | "container"
  | "component"
  | "adr"
  | "process"
  | "sor";

const SCHEMA_FILES: Record<SchemaType, string> = {
  system: "@c4a/core/schemas/c4a-system.schema.json",
  container: "@c4a/core/schemas/c4a-container.schema.json",
  component: "@c4a/core/schemas/c4a-component.schema.json",
  adr: "@c4a/core/schemas/c4a-adr.schema.json",
  process: "@c4a/core/schemas/c4a-process.schema.json",
  sor: "@c4a/core/schemas/c4a-sor.schema.json",
};

const require = createRequire(import.meta.url);

export async function loadSchema(type: SchemaType): Promise<Record<string, unknown>> {
  const schemaPath = require.resolve(SCHEMA_FILES[type]);
  const content = await readFile(schemaPath, "utf-8");
  return JSON.parse(content) as Record<string, unknown>;
}

export async function loadAllSchemas(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    (Object.keys(SCHEMA_FILES) as SchemaType[]).map(async (type) => [type, await loadSchema(type)]),
  );
  return Object.fromEntries(entries);
}

export function formatSchemaOutput(data: unknown, format: "json" | "yaml"): string {
  if (format === "yaml") {
    return stringify(data);
  }
  return JSON.stringify(data, null, 2);
}
