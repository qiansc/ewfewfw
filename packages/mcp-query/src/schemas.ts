/**
 * Query 工具的输入 Schema 定义
 *
 * 基于设计文档：v0.3.0/detailed-design/mcp/query.md
 */
import { z } from "zod";

/**
 * 实体类型
 */
export const EntityTypeSchema = z.enum([
  "system",
  "container",
  "component",
  "adr",
  "contract",
  "product",
  "process",
  "sor",
  "concept",
  "feat",
  "checklist",
  "spec",
]);

/**
 * 搜索范围（实体类型）
 */
export const QuerySearchScopeSchema = EntityTypeSchema.or(z.literal("all"));

/**
 * c4a_query_search 输入参数
 */
export const QuerySearchInputSchema = z.object({
  query: z.string().describe("搜索关键词"),
  scope: QuerySearchScopeSchema.optional().describe("实体类型筛选（all 表示不限）"),
  type_filter: QuerySearchScopeSchema.optional().describe("实体类型筛选（兼容字段）"),
  root_id: z.string().optional().describe("包边界 root_id（可选）"),
  versions: z.array(z.string()).optional().describe("版本过滤（可选，命中 versions 包含）"),
  limit: z.number().optional().default(20).describe("返回结果数量上限"),
  offset: z.number().optional().default(0).describe("分页偏移量"),
});

export type QuerySearchInput = z.infer<typeof QuerySearchInputSchema>;
export type QuerySearchScope = z.infer<typeof QuerySearchScopeSchema>;

/**
 * c4a_query_deps 输入参数
 */
export const QueryDepsDirectionSchema = z.enum(["upstream", "downstream", "both"]);

export const QueryDepsInputSchema = z.object({
  uuid: z.string().optional().describe("实体 UUID（优先使用）"),
  root_id: z.string().optional().describe("实体 root_id（与 id 搭配）"),
  id: z.string().optional().describe("实体 ID（与 root_id 搭配）"),
  direction: QueryDepsDirectionSchema.optional().describe("依赖方向"),
  depth: z.number().optional().describe("依赖深度"),
});

export type QueryDepsInput = z.infer<typeof QueryDepsInputSchema>;
export type QueryDepsDirection = z.infer<typeof QueryDepsDirectionSchema>;

/**
 * c4a_query_impact 输入参数
 */
export const QueryImpactInputSchema = z.object({
  uuid: z.string().optional().describe("实体 UUID（优先使用）"),
  root_id: z.string().optional().describe("实体 root_id（与 id 搭配）"),
  id: z.string().optional().describe("实体 ID（与 root_id 搭配）"),
  change_type: z
    .enum(["upgrade", "deprecate", "remove"])
    .optional()
    .describe("变更类型"),
  depth: z.number().optional().describe("影响深度"),
});

export type QueryImpactInput = z.infer<typeof QueryImpactInputSchema>;
