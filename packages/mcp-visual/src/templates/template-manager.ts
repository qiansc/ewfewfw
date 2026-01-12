/**
 * 提示词模板管理器
 *
 * 支持变量替换（Handlebars）和模板继承
 */
import Handlebars from "handlebars";
import { parse as parseYaml } from "yaml";
import { config } from "../config.js";
import type {
  Template,
  TemplateIndex,
  TemplateCategory,
  RenderTemplateResult,
} from "../types/index.js";
import { readFile, readdir } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";

// 模板缓存
const templateCache = new Map<string, string>();
let indexCache: TemplateIndex | null = null;

/**
 * 获取模板目录路径
 */
function getTemplatesPath(): string {
  return resolve(process.cwd(), config.templates_path);
}

/**
 * 加载模板索引
 */
export async function loadIndex(): Promise<TemplateIndex> {
  if (indexCache) {
    return indexCache;
  }

  const templatesPath = getTemplatesPath();
  const indexPath = join(templatesPath, "templates.yaml");

  if (!existsSync(indexPath)) {
    // 返回默认索引
    return getDefaultIndex();
  }

  try {
    const content = await readFile(indexPath, "utf-8");
    indexCache = parseYaml(content) as TemplateIndex;
    return indexCache;
  } catch {
    console.warn("Failed to load templates.yaml, using default index");
    return getDefaultIndex();
  }
}

/**
 * 获取默认模板索引
 */
function getDefaultIndex(): TemplateIndex {
  return {
    version: "1.0",
    default_template: "image/architecture-concept",
    categories: {
      architecture: {
        name: "架构图",
        description: "架构图生成模板",
        templates: [],
      },
      flowchart: {
        name: "流程图",
        description: "流程图生成模板",
        templates: [],
      },
      image: {
        name: "AI 图片",
        description: "AI 图片生成模板",
        templates: [],
      },
    },
  };
}

/**
 * 列出所有模板
 */
export async function listTemplates(category?: string): Promise<Template[]> {
  const index = await loadIndex();
  const templates: Template[] = [];

  for (const [catId, cat] of Object.entries(index.categories)) {
    if (category && catId !== category) {
      continue;
    }

    for (const template of cat.templates) {
      templates.push({
        ...template,
        category: catId,
      });
    }
  }

  return templates;
}

/**
 * 获取模板内容
 */
export async function getTemplate(templateId: string): Promise<string> {
  // 检查缓存
  if (templateCache.has(templateId)) {
    return templateCache.get(templateId)!;
  }

  const index = await loadIndex();

  // 查找模板定义
  let templateDef: Template | undefined;
  let categoryId: string | undefined;

  for (const [catId, cat] of Object.entries(index.categories)) {
    const found = cat.templates.find((t) => t.id === templateId);
    if (found) {
      templateDef = found;
      categoryId = catId;
      break;
    }
  }

  if (!templateDef) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // 读取模板文件
  const templatesPath = getTemplatesPath();
  const templatePath = join(templatesPath, templateDef.file);

  if (!existsSync(templatePath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }

  const content = await readFile(templatePath, "utf-8");

  // 处理模板继承
  const processedContent = await processInheritance(content, templatesPath);

  // 缓存模板
  templateCache.set(templateId, processedContent);

  return processedContent;
}

/**
 * 处理模板继承
 */
async function processInheritance(
  content: string,
  basePath: string
): Promise<string> {
  const extendsMatch = content.match(/^---\nextends:\s*(.+)\n---\n/);

  if (!extendsMatch) {
    return content;
  }

  const parentPath = join(basePath, extendsMatch[1]);
  const parentContent = await readFile(parentPath, "utf-8");

  // 移除 extends 头部
  const childContent = content.replace(extendsMatch[0], "");

  // 合并：子模板覆盖父模板的同名块
  return mergeTemplates(parentContent, childContent);
}

/**
 * 合并父子模板
 */
function mergeTemplates(parent: string, child: string): string {
  // 简单合并：子模板内容追加到父模板后面
  // 复杂的块替换逻辑可以后续实现
  return `${parent}\n\n${child}`;
}

/**
 * 渲染模板
 */
export async function renderTemplate(
  templateId: string,
  variables: Record<string, string>
): Promise<RenderTemplateResult> {
  const templateContent = await getTemplate(templateId);

  // 编译 Handlebars 模板
  const compiled = Handlebars.compile(templateContent);

  // 渲染模板
  const rendered = compiled(variables);

  // 收集使用的变量
  const variablesUsed = Object.keys(variables).filter((key) =>
    templateContent.includes(`{{${key}}}`) || templateContent.includes(`{{ ${key} }}`)
  );

  return {
    success: true,
    rendered,
    template_id: templateId,
    variables_used: variablesUsed,
  };
}

/**
 * 清除模板缓存
 */
export function clearCache(): void {
  templateCache.clear();
  indexCache = null;
}

/**
 * 全局风格配置接口
 */
export interface GlobalStyle {
  name: string;
  description: string;
  keywords: {
    en: string;
    zh: string;
  };
  environment: {
    background: string[];
    lighting: string[];
    atmosphere: string[];
  };
  materials: {
    primary: {
      name: string;
      properties: string[];
    };
    effects: string[];
  };
  colors: Record<string, Record<string, string>>;
  typography: {
    title: string[];
    labels: string[];
  };
}

export interface GetStyleResult {
  success: boolean;
  style: GlobalStyle | null;
  keywords: string;
  language: string;
}

/**
 * 获取全局风格配置
 */
export async function getGlobalStyle(language: "auto" | "zh" | "en" = "auto"): Promise<GetStyleResult> {
  const index = await loadIndex();
  
  // 检查是否有 style 配置
  const rawIndex = index as Record<string, unknown>;
  const style = rawIndex.style as GlobalStyle | undefined;
  
  if (!style) {
    return {
      success: false,
      style: null,
      keywords: "",
      language,
    };
  }

  // 确定语言
  const lang = language === "auto" ? "zh" : language;
  const keywords = style.keywords?.[lang] || style.keywords?.zh || "";

  return {
    success: true,
    style,
    keywords: keywords.trim(),
    language: lang,
  };
}

/**
 * 获取风格关键词（用于注入到提示词中）
 */
export async function getStyleKeywords(language: "auto" | "zh" | "en" = "auto"): Promise<string> {
  const result = await getGlobalStyle(language);
  return result.keywords;
}

/**
 * 获取语言配置
 */
export async function getLanguageConfig(): Promise<{
  rule: string;
  default: string;
  note: string;
}> {
  const index = await loadIndex();
  const rawIndex = index as Record<string, unknown>;
  const languageConfig = rawIndex.language as {
    rule: string;
    default: string;
    note: string;
  } | undefined;

  return languageConfig || {
    rule: "根据用户会话语言自动选择提示词语言",
    default: "auto",
    note: "",
  };
}

/**
 * 注册自定义 Handlebars 助手
 */
Handlebars.registerHelper("uppercase", (str: string) => str?.toUpperCase());
Handlebars.registerHelper("lowercase", (str: string) => str?.toLowerCase());
Handlebars.registerHelper("capitalize", (str: string) =>
  str ? str.charAt(0).toUpperCase() + str.slice(1) : ""
);
Handlebars.registerHelper("join", (arr: string[], separator: string) =>
  Array.isArray(arr) ? arr.join(separator) : ""
);
