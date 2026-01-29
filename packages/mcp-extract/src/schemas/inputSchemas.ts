/**
 * Zod schemas for MCP tool inputs
 */
import { z } from "zod";

/**
 * Supported languages
 */
export const SupportedLanguageSchema = z.enum(["typescript", "go", "python"]);

/**
 * c4a_extract_interfaces input schema
 */
export const ExtractInputSchema = z.object({
  path: z.string().describe("File or directory path to extract from"),
  language: SupportedLanguageSchema.optional().describe(
    "Language hint (auto-detected if not provided)"
  ),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Recursively process directories"),
  include: z
    .array(z.string())
    .optional()
    .describe("Glob patterns to include (e.g., ['**/*.ts'])"),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Glob patterns to exclude (e.g., ['node_modules/**'])"),
});

export type ExtractInput = z.infer<typeof ExtractInputSchema>;

/**
 * c4a_extract_analyze input schema
 */
export const AnalyzeInputSchema = z.object({
  path: z.string().describe("File or directory path to analyze"),
  language: SupportedLanguageSchema.optional().describe(
    "Language hint (auto-detected if not provided)"
  ),
  includeMetrics: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include code metrics"),
  includeDependencies: z
    .boolean()
    .optional()
    .default(true)
    .describe("Analyze and include dependencies"),
  summary_only: z
    .boolean()
    .optional()
    .default(false)
    .describe("Only return summary without file details"),
  limit: z
    .number()
    .int()
    .min(1)
    .default(100)
    .describe("File details limit"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Pagination offset"),
});

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

/**
 * c4a_extract_ast input schema
 */
export const ASTInputSchema = z.object({
  path: z.string().describe("File path to parse"),
  language: SupportedLanguageSchema.optional().describe(
    "Language hint (auto-detected if not provided)"
  ),
  maxDepth: z
    .number()
    .min(0)
    .default(10)
    .describe("Maximum AST depth to return"),
  nodeTypes: z
    .array(z.string())
    .optional()
    .describe("Filter to specific node types"),
});

export type ASTInput = z.infer<typeof ASTInputSchema>;

/**
 * c4a_extract_contract input schema
 */
export const ContractInputSchema = z.object({
  path: z.string().describe("File or directory path to generate contract from"),
  format: z
    .enum(["openapi", "asyncapi", "proto"])
    .default("openapi")
    .describe("Output format"),
  version: z.string().optional().default("3.0.0").describe("Spec version"),
  title: z.string().optional().describe("API title"),
  description: z.string().optional().describe("API description"),
  baseUrl: z.string().optional().describe("Base URL for API"),
});

export type ContractInput = z.infer<typeof ContractInputSchema>;
