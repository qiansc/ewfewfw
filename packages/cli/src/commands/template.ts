import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getEntityPath, getPerspectiveFromId } from "@c4a/core";
import { parseArgs } from "../utils/args.js";
import { promptInput } from "../utils/prompt.js";
import { generateTemplate, type TemplateType } from "../core/templates.js";

const TEMPLATE_TYPES: TemplateType[] = [
  "system",
  "container",
  "component",
  "adr",
  "process",
  "sor",
];

function printHelp(): void {
  console.log("c4a template <type> [--id=<id>] [--output=<path>] [--stdout]");
  console.log(`支持类型: ${TEMPLATE_TYPES.join(", ")}`);
}

function resolveType(value: string | undefined): TemplateType | null {
  if (!value) return null;
  if (TEMPLATE_TYPES.includes(value as TemplateType)) {
    return value as TemplateType;
  }
  return null;
}

function labelForType(type: TemplateType): string {
  switch (type) {
    case "system":
      return "系统";
    case "container":
      return "容器";
    case "component":
      return "组件";
    case "adr":
      return "ADR";
    case "process":
      return "流程";
    case "sor":
      return "SoR";
    default:
      return "实体";
  }
}

function relatedLabelForType(type: TemplateType): string | null {
  switch (type) {
    case "container":
      return "所属系统 ID";
    case "component":
      return "所属容器 ID";
    case "adr":
      return "关联系统 ID（可选）";
    case "sor":
      return "关联实体 ID";
    case "system":
      return "关联产品 ID（可选）";
    default:
      return null;
  }
}

async function resolvePerspective(
  type: TemplateType,
  id: string,
  allowPrompt: boolean,
): Promise<"business" | "technical" | undefined> {
  if (type !== "process" && type !== "sor") {
    return undefined;
  }
  const fromId = getPerspectiveFromId(id);
  if (fromId) {
    return fromId;
  }
  if (!allowPrompt) {
    return "technical";
  }
  const answer = await promptInput("视角 (business/technical)", "technical");
  return answer === "business" ? "business" : "technical";
}

export async function templateCommand(args: string[]): Promise<void> {
  const { positionals, options } = parseArgs(args);
  const type = resolveType(positionals[0]);

  if (!type || options.help) {
    printHelp();
    if (!type) {
      process.exitCode = 1;
    }
    return;
  }

  const skipPrompt = typeof options.id === "string";
  const label = labelForType(type);
  const id = skipPrompt ? (options.id as string) : await promptInput(`${label} ID`);
  if (!id) {
    console.error("ID 不能为空");
    process.exitCode = 1;
    return;
  }

  let name: string | undefined;
  let related: string | undefined;
  if (!skipPrompt) {
    name = await promptInput(`${label}名称`);
    const relatedLabel = relatedLabelForType(type);
    if (relatedLabel) {
      related = await promptInput(relatedLabel);
    }
  } else {
    if (typeof options.name === "string") {
      name = options.name;
    }
    if (typeof options.related === "string") {
      related = options.related;
    }
  }

  const perspective = await resolvePerspective(type, id, !skipPrompt);
  const template = generateTemplate(type, {
    id,
    name,
    related,
    perspective,
  });

  if (options.stdout) {
    console.log(template);
    return;
  }

  const output =
    typeof options.output === "string"
      ? options.output
      : getEntityPath(id, type, perspective ? { perspective } : undefined);

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, template, "utf-8");
  console.log(`模板已生成: ${output}`);
}
