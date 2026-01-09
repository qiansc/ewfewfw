/**
 * c4a_dsl_generate 工具实现
 */
import { generateId } from "@c4a/core";
import type { GenerateInput } from "../schemas/inputSchemas.js";
import { getTemplate, renderTemplate } from "../templates/index.js";
import { TemplateNotFoundError } from "../errors/index.js";

export async function generateHandler(input: GenerateInput): Promise<string> {
  const templateName = input.template || input.type;
  const template = getTemplate(templateName);

  if (!template) {
    throw new TemplateNotFoundError(templateName);
  }

  // 准备模板数据
  const data: Record<string, string> = {
    id: generateId(input.type),
    name: inferName(input.description),
    description: input.description,
    date: new Date().toISOString().split("T")[0],
    number: String(Math.floor(Math.random() * 900) + 100),
  };

  return renderTemplate(template, data);
}

/**
 * 从描述推断名称
 */
function inferName(description: string): string {
  // 取第一句话，去除标点，转为标题格式
  const firstSentence = description.split(/[。.!?]/)[0];
  return firstSentence.trim().substring(0, 50);
}
