/**
 * MCP Server 工厂函数
 *
 * 本文件只注册 c4a_query_* 工具
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  QuerySearchInputSchema,
  QueryDepsInputSchema,
  QueryImpactInputSchema,
} from "./schemas.js";
import {
  querySearchHandler,
  queryDepsHandler,
  queryImpactHandler,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "c4a-query-mcp",
    version: "0.1.0",
  });

  server.tool(
    "c4a_query_search",
    "语义搜索",
    QuerySearchInputSchema.shape,
    async (args) => {
      try {
        const result = await querySearchHandler(args as never);
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
              text: `QUERY_SEARCH_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "c4a_query_deps",
    "依赖查询",
    QueryDepsInputSchema.shape,
    async (args) => {
      try {
        const result = await queryDepsHandler(args as never);
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
              text: `QUERY_DEPS_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "c4a_query_impact",
    "影响分析",
    QueryImpactInputSchema.shape,
    async (args) => {
      try {
        const result = await queryImpactHandler(args as never);
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
              text: `QUERY_IMPACT_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
