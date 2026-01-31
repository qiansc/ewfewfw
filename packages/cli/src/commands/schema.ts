import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "../utils/args.js";
import {
  loadSchema,
  loadAllSchemas,
  formatSchemaOutput,
  type SchemaType,
} from "../core/schema.js";

const SCHEMA_TYPES: SchemaType[] = [
  "system",
  "container",
  "component",
  "adr",
  "process",
  "sor",
  "feat",
  "checklist",
];

function printHelp(): void {
  console.log("c4a schema <type|all> [--output=<path>] [--format=json|yaml]");
  console.log(`支持类型: ${SCHEMA_TYPES.join(", ")}, all`);
}

function resolveSchemaType(type: string | undefined): SchemaType | null {
  if (!type) return null;
  if (SCHEMA_TYPES.includes(type as SchemaType)) {
    return type as SchemaType;
  }
  return null;
}

export async function schemaCommand(args: string[]): Promise<void> {
  const { positionals, options } = parseArgs(args);
  const rawType = positionals[0];

  if (!rawType || rawType === "help" || options.help) {
    printHelp();
    if (!rawType) {
      process.exitCode = 1;
    }
    return;
  }

  const format =
    typeof options.format === "string" && options.format === "yaml" ? "yaml" : "json";
  const outputPath = typeof options.output === "string" ? options.output : undefined;

  let data: unknown;
  if (rawType === "all") {
    data = await loadAllSchemas();
  } else {
    const schemaType = resolveSchemaType(rawType);
    if (!schemaType) {
      console.error(`未知 Schema 类型: ${rawType}`);
      printHelp();
      process.exitCode = 1;
      return;
    }
    data = await loadSchema(schemaType);
  }

  const content = formatSchemaOutput(data, format);

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf-8");
    console.log(`Schema 已输出: ${outputPath}`);
    return;
  }

  console.log(content);
}
