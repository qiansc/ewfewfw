/**
 * C4A 统一配置 Schema 定义
 *
 * 使用 Zod 定义统一配置格式，支持验证和类型推导
 */
import { z } from "zod";

/**
 * MCP Server 配置 Schema
 */
export const MCPServerSchema = z
  .object({
    // stdio 传输
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),

    // http 传输
    transport: z.enum(["stdio", "http"]).default("stdio"),
    url: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.transport === "stdio") {
        return !!data.command;
      }
      if (data.transport === "http") {
        return !!data.url;
      }
      return true;
    },
    { message: "stdio transport requires 'command', http transport requires 'url'" }
  );

/**
 * Agent 配置 Schema
 */
export const AgentSchema = z.object({
  description: z.string(),
  promptFile: z.string(),
  mode: z.enum(["primary", "subagent"]).optional(),
  allowedTools: z.array(z.string()).default([]),
  deniedTools: z.array(z.string()).default([]),
  subagents: z.array(z.string()).optional(),
});

/**
 * Skill 配置 Schema
 */
export const SkillSchema = z
  .object({
    description: z.string().describe("Skill 功能描述"),
    category: z.string().describe("Skill 分类，如 research, adr-workflow, adr-support"),
    args: z.string().optional().describe("命令参数，如 '<adr-id>'"),
    prompt: z.string().optional().describe("执行流程提示词（与 promptFile 二选一）"),
    promptFile: z.string().optional().describe("执行流程提示词文件路径（与 prompt 二选一）"),
    tools: z.array(z.string()).optional().describe("使用的工具列表"),
  })
  .refine(
    (data) => {
      // prompt 和 promptFile 必须有且只有一个
      return (!!data.prompt && !data.promptFile) || (!data.prompt && !!data.promptFile);
    },
    { message: "Skill must have either 'prompt' or 'promptFile', but not both" }
  );

/**
 * 统一配置 Schema
 */
export const UnifiedConfigSchema = z
  .object({
    version: z.literal("1.0"),

    // 项目说明文件列表
    instructions: z.array(z.string()).default([]),

    // Agent 定义
    agents: z.record(AgentSchema),

    // MCP Server 定义
    mcpServers: z.record(MCPServerSchema),

    // 默认 Agent
    defaultAgent: z.string(),

    // Skill 定义（可选）
    skills: z.record(SkillSchema).optional(),
  })
  .refine(
    (data) => {
      // 验证 defaultAgent 存在于 agents 中
      return Object.keys(data.agents).includes(data.defaultAgent);
    },
    { message: "defaultAgent must exist in agents" }
  )
  .refine(
    (data) => {
      // 验证所有 subagents 存在于 agents 中
      for (const agent of Object.values(data.agents)) {
        if (agent.subagents) {
          for (const subagent of agent.subagents) {
            if (!Object.keys(data.agents).includes(subagent)) {
              return false;
            }
          }
        }
      }
      return true;
    },
    { message: "All subagents must exist in agents" }
  );

export type UnifiedConfig = z.infer<typeof UnifiedConfigSchema>;
export type AgentConfig = z.infer<typeof AgentSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerSchema>;
export type SkillConfig = z.infer<typeof SkillSchema>;
