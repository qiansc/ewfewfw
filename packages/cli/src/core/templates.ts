export type TemplateType = "system" | "container" | "component" | "adr" | "process" | "sor";

export interface TemplateOptions {
  id: string;
  name?: string;
  related?: string;
  perspective?: "business" | "technical";
  now?: Date;
}

function stringifyValue(value: string): string {
  return JSON.stringify(value);
}

function lineWithTodo(label: string, value: string | undefined, todo: string): string {
  if (value && value.trim().length > 0) {
    return `  ${label}: ${stringifyValue(value)}`;
  }
  return `  ${label}: ""  # TODO: ${todo}`;
}

function lineWithLiteral(label: string, literal: string, todo?: string): string {
  const suffix = todo ? `  # TODO: ${todo}` : "";
  return `  ${label}: ${literal}${suffix}`;
}

function addCommonData(lines: string[], options: TemplateOptions): void {
  lines.push(lineWithTodo("name", options.name, "补充名称"));
  lines.push(lineWithLiteral("description", '""', "补充描述"));
}

export function generateTemplate(type: TemplateType, options: TemplateOptions): string {
  const now = options.now ?? new Date();
  const lines: string[] = [];
  lines.push(`type: ${type}`);
  lines.push(`id: ${options.id}`);
  lines.push("data:");

  switch (type) {
    case "system": {
      addCommonData(lines, options);
      lines.push(lineWithTodo("corresponds_to", options.related, "关联产品 ID（可选）"));
      break;
    }
    case "container": {
      addCommonData(lines, options);
      lines.push(lineWithTodo("system_id", options.related, "填写所属系统 ID"));
      lines.push(lineWithLiteral("technology", "[]", "补充技术栈"));
      break;
    }
    case "component": {
      addCommonData(lines, options);
      lines.push(lineWithTodo("container_id", options.related, "填写所属容器 ID"));
      lines.push(lineWithLiteral("technology", '""', "补充技术栈"));
      break;
    }
    case "adr": {
      addCommonData(lines, options);
      lines.push(lineWithTodo("system_id", options.related, "关联系统 ID（可选）"));
      lines.push(lineWithLiteral("context", '""', "补充决策背景"));
      lines.push(lineWithLiteral("decision", '""', "补充决策内容"));
      break;
    }
    case "process": {
      addCommonData(lines, options);
      lines.push(lineWithLiteral("process_type", '""', "business 或 technical"));
      break;
    }
    case "sor": {
      addCommonData(lines, options);
      lines.push(lineWithLiteral("sor_type", '""', "填写 SoR 类型"));
      lines.push(lineWithLiteral("entity_type", '""', "关联实体类型"));
      lines.push(lineWithTodo("entity_id", options.related, "关联实体 ID"));
      lines.push(lineWithLiteral("process_id", '""', "关联流程 ID（可选）"));
      break;
    }
    default:
      addCommonData(lines, options);
  }

  lines.push("metadata:");
  lines.push("  status: draft");
  lines.push(`  created_at: ${stringifyValue(now.toISOString())}`);

  return lines.join("\n");
}
