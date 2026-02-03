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
]);

/**
 * proposal_id 格式验证
 * 格式：^feat-[a-z0-9]+(-[a-z0-9]+)*$
 */
export const ProposalIdSchema = z
  .string()
  .regex(/^feat-[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: "proposal_id 必须符合格式：feat-{小写字母/数字/连字符}",
  })
  .nullable()
  .optional();

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
  proposal_id: ProposalIdSchema.describe("feat/提案隔离（主分支为 null）"),
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
  id: z.string().describe("实体 ID"),
  source_project: z
    .string()
    .optional()
    .describe("实体归属项目（可选，未传将从配置 project_id 自动补齐；Server 模式仍需有效值）"),
  direction: QueryDepsDirectionSchema.optional().describe("依赖方向"),
  depth: z.number().optional().describe("依赖深度"),
  proposal_id: ProposalIdSchema.describe("feat/提案隔离（主分支为 null）"),
});

export type QueryDepsInput = z.infer<typeof QueryDepsInputSchema>;
export type QueryDepsDirection = z.infer<typeof QueryDepsDirectionSchema>;

/**
 * c4a_query_impact 输入参数
 */
export const QueryImpactInputSchema = z.object({
  id: z.string().describe("实体 ID"),
  source_project: z
    .string()
    .optional()
    .describe("实体归属项目（可选，未传将从配置 project_id 自动补齐；Server 模式仍需有效值）"),
  change_type: z
    .enum(["upgrade", "deprecate", "remove"])
    .optional()
    .describe("变更类型"),
  depth: z.number().optional().describe("影响深度"),
  proposal_id: ProposalIdSchema.describe("feat/提案隔离（主分支为 null）"),
});

export type QueryImpactInput = z.infer<typeof QueryImpactInputSchema>;
