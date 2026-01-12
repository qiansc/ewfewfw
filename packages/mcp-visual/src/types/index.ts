/**
 * Visual Service 类型定义
 */

// ============ 图片生成相关 ============

export interface GenerateImageResult {
  success: boolean;
  image_id: string;
  path: string;
  format: string;
  size: string;
  aspect_ratio: string;
  storage_mode: string;
  metadata: ImageMetadata;
}

export interface ImageMetadata {
  prompt: string;
  template_id?: string;
  model: string;
  generated_at: string;
  file_size: number;
  dimensions: {
    width: number;
    height: number;
  };
}

// ============ 图表渲染相关 ============

export interface RenderChartResult {
  success: boolean;
  image_id: string;
  path: string;
  format: string;
  type: string;
  storage_mode: string;
}

// ============ 模板相关 ============

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  file: string;
  variables: TemplateVariable[];
}

export interface TemplateVariable {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface TemplateIndex {
  version: string;
  default_template: string;
  categories: Record<string, TemplateCategory>;
}

export interface TemplateCategory {
  name: string;
  description: string;
  templates: Template[];
}

export interface RenderTemplateResult {
  success: boolean;
  rendered: string;
  template_id: string;
  variables_used: string[];
}

// ============ 存储相关 ============

export type StorageMode = "cache" | "permanent" | "report";
export type ReferenceType = "relative" | "absolute" | "url" | "markdown";

export interface StoredImage {
  id: string;
  path: string;
  format: string;
  storage_mode: StorageMode;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface SaveImageResult {
  success: boolean;
  image_id: string;
  path: string;
  storage_mode: StorageMode;
}

export interface GetReferenceResult {
  success: boolean;
  reference: string;
  reference_type: ReferenceType;
  image_id: string;
}

// ============ 配置相关 ============

export interface VisualConfig {
  gemini_api_key: string;
  storage_base_path: string;
  templates_path: string;
  default_template: string;
  cache_ttl_hours: number;
}
