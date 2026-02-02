/**
 * Skill prompt template rendering.
 */
import { fileExists, joinPath, readFileContent } from "./fileUtils.js";
import { logger } from "./logger.js";

export interface SkillTemplateContext {
  current_proposal_id?: string | null;
  current_proposal_status?: string | null;
  current_proposal_title?: string | null;
}

function readEnvContext(): SkillTemplateContext {
  return {
    current_proposal_id: process.env.C4A_CURRENT_PROPOSAL_ID || null,
    current_proposal_status: process.env.C4A_CURRENT_PROPOSAL_STATUS || null,
    current_proposal_title: process.env.C4A_CURRENT_PROPOSAL_TITLE || null,
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
      current_proposal_id: parsed.id ?? null,
      current_proposal_status: parsed.status ?? null,
      current_proposal_title: parsed.title ?? null,
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

function replaceIfBlock(template: string, hasProposal: boolean): string {
  const ifPattern =
    /{{#if\s+current_proposal_id\s*}}([\s\S]*?)(?:{{else}}([\s\S]*?))?{{\/if}}/g;
  return template.replace(ifPattern, (_match, ifBlock, elseBlock) =>
    hasProposal ? ifBlock : elseBlock ?? ""
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
  const hasProposal = Boolean(context.current_proposal_id);
  let rendered = replaceIfBlock(template, hasProposal);
  rendered = replaceVariable(rendered, "current_proposal_id", context.current_proposal_id);
  rendered = replaceVariable(rendered, "current_proposal_status", context.current_proposal_status);
  rendered = replaceVariable(rendered, "current_proposal_title", context.current_proposal_title);
  return rendered;
}
