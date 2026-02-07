/**
 * Skill prompt template rendering.
 */
import { fileExists, joinPath, readFileContent } from "./fileUtils.js";
import { logger } from "./logger.js";

export interface SkillTemplateContext {
  current_feat_uuid?: string | null;
  current_feat_status?: string | null;
  current_feat_title?: string | null;
}

function readEnvContext(): SkillTemplateContext {
  return {
    current_feat_uuid: process.env.C4A_CURRENT_FEAT_UUID || null,
    current_feat_status: process.env.C4A_CURRENT_FEAT_STATUS || null,
    current_feat_title: process.env.C4A_CURRENT_FEAT_TITLE || null,
  };
}

async function readFileContext(baseDir: string): Promise<SkillTemplateContext> {
  const contextPath = joinPath(baseDir, ".context", "feat", "current.json");
  if (!(await fileExists(contextPath))) {
    return {};
  }
  try {
    const raw = await readFileContent(contextPath);
    const parsed = JSON.parse(raw) as {
      id?: string;
      status?: string;
      title?: string;
    };
    return {
      current_feat_uuid: parsed.id ?? null,
      current_feat_status: parsed.status ?? null,
      current_feat_title: parsed.title ?? null,
    };
  } catch (error) {
    logger.warn(`读取当前 Feature 上下文失败: ${contextPath}`);
    return {};
  }
}

export async function loadSkillTemplateContext(baseDir: string): Promise<SkillTemplateContext> {
  const fileContext = await readFileContext(baseDir);
  const envContext = readEnvContext();
  return {
    ...fileContext,
    ...Object.fromEntries(
      Object.entries(envContext).filter(([, value]) => value !== null && value !== undefined)
    ),
  };
}

function replaceIfBlock(template: string, hasFeat: boolean): string {
  const ifPattern =
    /{{#if\s+current_feat_uuid\s*}}([\s\S]*?)(?:{{else}}([\s\S]*?))?{{\/if}}/g;
  return template.replace(ifPattern, (_match, ifBlock, elseBlock) =>
    hasFeat ? ifBlock : elseBlock ?? ""
  );
}

function replaceVariable(
  template: string,
  key: keyof SkillTemplateContext,
  value: string | null | undefined
): string {
  if (!value) return template;
  const pattern = new RegExp(`{{${key}}}`, "g");
  return template.replace(pattern, value);
}

export function renderSkillTemplate(
  template: string,
  context: SkillTemplateContext
): string {
  const hasFeat = Boolean(context.current_feat_uuid);
  let rendered = replaceIfBlock(template, hasFeat);
  rendered = replaceVariable(rendered, "current_feat_uuid", context.current_feat_uuid);
  rendered = replaceVariable(rendered, "current_feat_status", context.current_feat_status);
  rendered = replaceVariable(rendered, "current_feat_title", context.current_feat_title);
  return rendered;
}
