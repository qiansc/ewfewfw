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

function lineWithTodo(
  label: string,
  value: string | undefined,
  todo: string,
  indent: string = ""
): string {
  if (value && value.trim().length > 0) {
    return `${indent}${label}: ${stringifyValue(value)}`;
  }
  return `${indent}${label}: ""  # TODO: ${todo}`;
}

function lineWithLiteral(
  label: string,
  literal: string,
  todo?: string,
  indent: string = ""
): string {
  const suffix = todo ? `  # TODO: ${todo}` : "";
  return `${indent}${label}: ${literal}${suffix}`;
}

function addCommonData(lines: string[], options: TemplateOptions, indent: string): void {
  lines.push(lineWithTodo("name", options.name, "补充名称", indent));
  lines.push(lineWithLiteral("description", '""', "补充描述", indent));
}

export function generateTemplate(type: TemplateType, options: TemplateOptions): string {
  const lines: string[] = [];
  lines.push("schema: c4a/v1");

  switch (type) {
    case "system": {
      lines.push("type: software-system");
      lines.push("system:");
      lines.push(lineWithLiteral("id", options.id, undefined, "  "));
      addCommonData(lines, options, "  ");
      lines.push(lineWithLiteral("scope", "project", undefined, "  "));
      lines.push(lineWithTodo("corresponds_to", options.related, "关联产品 ID（可选）", "  "));
      break;
    }
    case "container": {
      lines.push("type: container");
      lines.push("container:");
      lines.push(lineWithLiteral("id", options.id, undefined, "  "));
      addCommonData(lines, options, "  ");
      lines.push(lineWithLiteral("scope", "project", undefined, "  "));
      lines.push(lineWithTodo("system_id", options.related, "填写所属系统 ID", "  "));
      lines.push(lineWithLiteral("technology", "[]", "补充技术栈", "  "));
      break;
    }
    case "component": {
      lines.push("type: component");
      lines.push("component:");
      lines.push(lineWithLiteral("id", options.id, undefined, "  "));
      addCommonData(lines, options, "  ");
      lines.push(lineWithLiteral("scope", "project", undefined, "  "));
      lines.push(lineWithTodo("container_id", options.related, "填写所属容器 ID", "  "));
      lines.push(lineWithLiteral("technology", '""', "补充实现技术或设计模式", "  "));
      break;
    }
    case "adr": {
      lines.push("type: adr");
      lines.push("adr:");
      lines.push(lineWithLiteral("id", options.id, undefined, "  "));
      lines.push(lineWithTodo("title", options.name, "补充 ADR 标题", "  "));
      lines.push(lineWithLiteral("status", "draft", undefined, "  "));
      lines.push(lineWithTodo("system_id", options.related, "关联系统 ID（可选）", "  "));
      lines.push(lineWithLiteral("context", '""', "补充决策背景"));
      lines.push(lineWithLiteral("decision", '""', "补充决策内容"));
      break;
    }
    case "process": {
      lines.push("type: process");
      lines.push("process:");
      lines.push(lineWithLiteral("id", options.id, undefined, "  "));
      addCommonData(lines, options, "  ");
      lines.push(lineWithLiteral("process_type", '""', "business 或 technical", "  "));
      lines.push(lineWithLiteral("scope", "project", undefined, "  "));
      break;
    }
    case "sor": {
      lines.push("type: sor");
      lines.push("sor:");
      lines.push(lineWithLiteral("id", options.id, undefined, "  "));
      lines.push(lineWithTodo("name", options.name, "补充 SoR 名称", "  "));
      lines.push(lineWithLiteral("sor_type", '""', "填写 SoR 类型", "  "));
      lines.push(lineWithLiteral("entity_type", '""', "关联实体类型", "  "));
      lines.push(lineWithTodo("entity_id", options.related, "关联实体 ID", "  "));
      lines.push(lineWithLiteral("description", '""', "补充描述", "  "));
      lines.push(lineWithLiteral("scope", "project", undefined, "  "));
      lines.push(lineWithLiteral("process_id", '""', "关联流程 ID（可选）", "  "));
      break;
    }
    default:
      lines.push(`type: ${type}`);
  }

  return lines.join("\n");
}
