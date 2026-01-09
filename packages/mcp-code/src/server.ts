/**
 * MCP Server factory for c4a-code-mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ExtractInputSchema,
  AnalyzeInputSchema,
  ASTInputSchema,
  ContractInputSchema,
} from "./schemas/inputSchemas.js";
import { extract } from "./tools/extract.js";
import { analyze } from "./tools/analyze.js";
import { getAST } from "./tools/ast.js";
import { generateContract } from "./tools/contract.js";

/**
 * Create and configure the MCP Server
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "c4a-code-mcp",
    version: "0.1.0",
  });

  // Register c4a_code_extract tool
  server.tool(
    "c4a_code_extract",
    "从代码文件中提取接口、类型、类等定义",
    ExtractInputSchema.shape,
    async (args) => {
      try {
        const result = await extract(args as Parameters<typeof extract>[0]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register c4a_code_analyze tool
  server.tool(
    "c4a_code_analyze",
    "分析代码结构和依赖关系",
    AnalyzeInputSchema.shape,
    async (args) => {
      try {
        const result = await analyze(args as Parameters<typeof analyze>[0]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register c4a_code_ast tool
  server.tool(
    "c4a_code_ast",
    "获取代码文件的 AST 抽象语法树结构",
    ASTInputSchema.shape,
    async (args) => {
      try {
        const result = await getAST(args as Parameters<typeof getAST>[0]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register c4a_code_contract tool
  server.tool(
    "c4a_code_contract",
    "从代码生成 API 契约（OpenAPI、AsyncAPI、Proto）",
    ContractInputSchema.shape,
    async (args) => {
      try {
        const result = await generateContract(
          args as Parameters<typeof generateContract>[0]
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
