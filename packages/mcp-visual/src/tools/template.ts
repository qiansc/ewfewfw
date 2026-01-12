/**
 * 模板管理工具
 */
import type {
  ListTemplatesInput,
  RenderTemplateInput,
} from "../schemas/inputSchemas.js";
import type { Template, RenderTemplateResult } from "../types/index.js";
import {
  listTemplates,
  renderTemplate,
} from "../templates/template-manager.js";

export interface ListTemplatesResult {
  success: boolean;
  templates: Template[];
  total: number;
}

export async function listTemplatesHandler(
  input: ListTemplatesInput
): Promise<ListTemplatesResult> {
  const templates = await listTemplates(input.category);

  return {
    success: true,
    templates,
    total: templates.length,
  };
}

export async function renderTemplateHandler(
  input: RenderTemplateInput
): Promise<RenderTemplateResult> {
  return renderTemplate(input.template_id, input.variables);
}
