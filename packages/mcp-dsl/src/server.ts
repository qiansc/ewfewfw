/**
 * MCP Server 工厂函数
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ParseInputSchema,
  ValidateInputSchema,
  GenerateInputSchema,
  SchemaInputSchema,
} from "./schemas/inputSchemas.js";
import {
  InitRepoInputSchema,
  ListFilesInputSchema,
  ReadFileInputSchema,
  WriteFileInputSchema,
  TransitionStatusInputSchema,
} from "./schemas/storageSchemas.js";
import { parseHandler } from "./tools/parse.js";
import { validateHandler } from "./tools/validate.js";
import { generateHandler } from "./tools/generate.js";
import { schemaHandler } from "./tools/schema.js";
import {
  initHandler,
  listHandler,
  readHandler,
  writeHandler,
  transitionHandler,
} from "./tools/storage/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "c4a-dsl-mcp",
    version: "0.1.0",
  });

  // ============ DSL 纯解析工具（无 I/O）============

  // 注册 c4a_dsl_parse 工具
  server.tool(
    "c4a_dsl_parse",
    "解析 C4A DSL 文件（YAML → Object）",
    ParseInputSchema.shape,
    async (args) => {
      try {
        const result = await parseHandler(args as never);
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
              text: `PARSE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_dsl_validate 工具
  server.tool(
    "c4a_dsl_validate",
    "验证 C4A DSL 正确性",
    ValidateInputSchema.shape,
    async (args) => {
      try {
        const result = await validateHandler(args as never);
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
              text: `VALIDATION_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_dsl_generate 工具
  server.tool(
    "c4a_dsl_generate",
    "生成 C4A DSL 模板",
    GenerateInputSchema.shape,
    async (args) => {
      try {
        const result = await generateHandler(args as never);
        return {
          content: [
            {
              type: "text" as const,
              text: result,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `GENERATE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_dsl_schema 工具
  server.tool(
    "c4a_dsl_schema",
    "获取 C4A DSL JSON Schema",
    SchemaInputSchema.shape,
    async (args) => {
      try {
        const result = await schemaHandler(args as never);
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
              text: `SCHEMA_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============ 本地仓库操作工具（.c4a/ 目录）============

  // 注册 c4a_local_init_repo 工具
  server.tool(
    "c4a_local_init_repo",
    "初始化 C4A 架构知识目录结构 (.c4a/)",
    InitRepoInputSchema.shape,
    async (args) => {
      try {
        const result = await initHandler(args as never);
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
              text: `INIT_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_local_list_files 工具
  server.tool(
    "c4a_local_list_files",
    "列出本地架构知识文件，支持按状态和类型筛选",
    ListFilesInputSchema.shape,
    async (args) => {
      try {
        const result = await listHandler(args as never);
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
              text: `LIST_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_local_read_file 工具
  server.tool(
    "c4a_local_read_file",
    "读取本地 DSL 文件，返回内容和验证结果",
    ReadFileInputSchema.shape,
    async (args) => {
      try {
        const result = await readHandler(args as never);
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
              text: `READ_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_local_write_file 工具
  server.tool(
    "c4a_local_write_file",
    "写入本地 DSL 文件，自动验证并创建目录",
    WriteFileInputSchema.shape,
    async (args) => {
      try {
        const result = await writeHandler(args as never);
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
              text: `WRITE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_local_transition_status 工具
  server.tool(
    "c4a_local_transition_status",
    "流转 DSL 状态 (draft → approved → published → deprecated → archived)",
    TransitionStatusInputSchema.shape,
    async (args) => {
      try {
        const result = await transitionHandler(args as never);
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
              text: `TRANSITION_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
