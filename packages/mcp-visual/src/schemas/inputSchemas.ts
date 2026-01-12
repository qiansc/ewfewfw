/**
 * MCP 工具输入参数 Schema 定义
 */
import { z } from "zod";

// ============ 图片生成参数 ============

export const GenerateImageInputSchema = z.object({
  prompt: z.string().describe("图片描述提示词"),
  template_id: z.string().optional().describe("可选的模板 ID，使用模板生成提示词"),
  template_variables: z.record(z.string()).optional().describe("模板变量"),
  size: z.enum(["1K", "2K", "4K"]).default("2K").describe("图片分辨率"),
  aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("16:9").describe("宽高比"),
  format: z.enum(["PNG", "JPEG"]).default("PNG").describe("输出格式"),
  storage_mode: z.enum(["cache", "permanent", "report"]).default("cache").describe("存储模式"),
  report_id: z.string().optional().describe("报告 ID（storage_mode 为 report 时必需）"),
  filename: z.string().optional().describe("自定义文件名"),
});

export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

// ============ 图表渲染参数 ============

export const RenderChartInputSchema = z.object({
  code: z.string().describe("Mermaid 代码"),
  type: z.enum(["flowchart", "sequence", "class", "state", "gantt", "c4"]).default("flowchart").describe("图表类型"),
  output_format: z.enum(["svg", "png"]).default("svg").describe("输出格式"),
  theme: z.enum(["default", "dark", "forest", "neutral"]).default("default").describe("主题"),
  storage_mode: z.enum(["cache", "permanent", "report"]).default("cache").describe("存储模式"),
  report_id: z.string().optional().describe("报告 ID（storage_mode 为 report 时必需）"),
  filename: z.string().optional().describe("自定义文件名"),
});

export type RenderChartInput = z.infer<typeof RenderChartInputSchema>;

// ============ 模板管理参数 ============

export const ListTemplatesInputSchema = z.object({
  category: z.string().optional().describe("按类别筛选（architecture, flowchart, image）"),
});

export type ListTemplatesInput = z.infer<typeof ListTemplatesInputSchema>;

export const RenderTemplateInputSchema = z.object({
  template_id: z.string().describe("模板 ID"),
  variables: z.record(z.string()).describe("模板变量"),
});

export type RenderTemplateInput = z.infer<typeof RenderTemplateInputSchema>;

// ============ 存储管理参数 ============

export const SaveImageInputSchema = z.object({
  data: z.string().describe("Base64 编码的图片数据"),
  format: z.enum(["PNG", "JPEG", "SVG"]).describe("图片格式"),
  storage_mode: z.enum(["cache", "permanent", "report"]).describe("存储模式"),
  report_id: z.string().optional().describe("报告 ID（storage_mode 为 report 时必需）"),
  filename: z.string().optional().describe("自定义文件名"),
  metadata: z.record(z.unknown()).optional().describe("附加元数据"),
});

export type SaveImageInput = z.infer<typeof SaveImageInputSchema>;

export const GetReferenceInputSchema = z.object({
  image_id: z.string().describe("图片 ID"),
  reference_type: z.enum(["relative", "absolute", "url", "markdown"]).default("relative").describe("引用类型"),
  base_path: z.string().optional().describe("基准路径（用于生成相对路径）"),
  alt_text: z.string().optional().describe("替代文本（用于 markdown 格式）"),
});

export type GetReferenceInput = z.infer<typeof GetReferenceInputSchema>;

// ============ C4 架构图参数 ============

export const RenderC4InputSchema = z.object({
  level: z.enum(["context", "container", "component"]).describe("C4 层级（context=系统上下文, container=容器, component=组件）"),
  entity_id: z.string().optional().describe("可选的实体 ID，用于聚焦特定实体"),
  output_format: z.enum(["svg", "png"]).default("svg").describe("输出格式"),
  theme: z.enum(["default", "dark", "forest", "neutral"]).default("default").describe("主题"),
  storage_mode: z.enum(["cache", "permanent", "report"]).default("cache").describe("存储模式"),
  report_id: z.string().optional().describe("报告 ID（storage_mode 为 report 时必需）"),
  filename: z.string().optional().describe("自定义文件名"),
});

export type RenderC4Input = z.infer<typeof RenderC4InputSchema>;

// ============ 清理工具参数 ============

export const CleanupInputSchema = z.object({
  older_than_hours: z.number().default(24).describe("清理超过指定小时数的临时文件（默认 24 小时）"),
});

export type CleanupInput = z.infer<typeof CleanupInputSchema>;

// ============ 存储统计参数 ============

export const StorageStatsInputSchema = z.object({});

export type StorageStatsInput = z.infer<typeof StorageStatsInputSchema>;

// ============ 全局风格参数 ============

export const GetStyleInputSchema = z.object({
  language: z.enum(["auto", "zh", "en"]).default("auto").describe("返回风格关键词的语言"),
});

export type GetStyleInput = z.infer<typeof GetStyleInputSchema>;
