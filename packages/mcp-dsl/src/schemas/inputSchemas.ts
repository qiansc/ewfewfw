/**
 * MCP 工具输入 Schema 定义
 */
import { z } from "zod";

const DSLTypeEnum = z.enum([
  "system",
  "container",
  "component",
  "adr",
  "contract",
]);

export const ParseInputSchema = z.object({
  content: z.string().min(1, "DSL content cannot be empty"),
  type: DSLTypeEnum,
});

export const ValidateInputSchema = z.object({
  content: z.string().min(1, "DSL content cannot be empty"),
  type: DSLTypeEnum,
  rules: z
    .array(z.string())
    .optional()
    .describe("Optional list of validation rules to apply"),
});

export const GenerateInputSchema = z.object({
  type: z.enum(["system", "container", "component", "adr"]),
  description: z.string().min(1, "Description is required"),
  template: z.string().optional().describe("Optional custom template name"),
});

export const SchemaInputSchema = z.object({
  type: DSLTypeEnum,
});

// 导出类型
export type ParseInput = z.infer<typeof ParseInputSchema>;
export type ValidateInput = z.infer<typeof ValidateInputSchema>;
export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type SchemaInput = z.infer<typeof SchemaInputSchema>;
export type DSLType = z.infer<typeof DSLTypeEnum>;
