/**
 * Visual Service 配置管理
 */
import type { VisualConfig } from "./types/index.js";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function loadConfig(): VisualConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.warn("⚠️ GEMINI_API_KEY not set. AI image generation will not work.");
  }

  return {
    gemini_api_key: geminiApiKey || "",
    storage_base_path: process.env.VISUAL_STORAGE_BASE_PATH || ".context",
    templates_path: process.env.VISUAL_TEMPLATES_PATH || "prompts/visual-templates",
    default_template: process.env.VISUAL_DEFAULT_TEMPLATE || "image/architecture-concept",
    cache_ttl_hours: parseInt(process.env.VISUAL_CACHE_TTL_HOURS || "24"),
    expose_internal_tools: parseBoolean(process.env.VISUAL_EXPOSE_INTERNAL_TOOLS, false),
  };
}

export const config = loadConfig();
