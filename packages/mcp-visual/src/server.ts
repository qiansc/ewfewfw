/**
 * MCP Server 工厂函数 - Visual Service
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GenerateImageInputSchema,
  RenderChartInputSchema,
  ListTemplatesInputSchema,
  RenderTemplateInputSchema,
  SaveImageInputSchema,
  GetReferenceInputSchema,
  RenderC4InputSchema,
  CleanupInputSchema,
  StorageStatsInputSchema,
  GetStyleInputSchema,
} from "./schemas/inputSchemas.js";
import { generateImageHandler } from "./tools/generateImage.js";
import { renderChartHandler } from "./tools/renderChart.js";
import { listTemplatesHandler, renderTemplateHandler } from "./tools/template.js";
import { saveImageHandler, getReferenceHandler } from "./tools/storage.js";
import { renderC4Handler } from "./tools/renderC4.js";
import { cleanupHandler, storageStatsHandler } from "./tools/cleanup.js";
import { getGlobalStyle } from "./templates/template-manager.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "c4a-visual-mcp",
    version: "0.1.0",
  });

  // ============ 图片生成工具 ============

  // 注册 c4a_visual_generate 工具 - AI 图片生成
  server.tool(
    "c4a_visual_generate",
    "使用 Gemini 3 Pro Image API 生成图片",
    GenerateImageInputSchema.shape,
    async (args) => {
      try {
        const result = await generateImageHandler(args as never);
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
              text: `GENERATE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============ 图表渲染工具 ============

  // 注册 c4a_visual_render 工具 - Mermaid 图表渲染
  server.tool(
    "c4a_visual_render",
    "渲染 Mermaid 图表为 SVG/PNG",
    RenderChartInputSchema.shape,
    async (args) => {
      try {
        const result = await renderChartHandler(args as never);
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
              text: `RENDER_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============ 模板管理工具 ============

  // 注册 c4a_visual_list_templates 工具
  server.tool(
    "c4a_visual_list_templates",
    "列出可用的可视化提示词模板",
    ListTemplatesInputSchema.shape,
    async (args) => {
      try {
        const result = await listTemplatesHandler(args as never);
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
              text: `LIST_TEMPLATES_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_visual_render_template 工具
  server.tool(
    "c4a_visual_render_template",
    "渲染提示词模板，替换变量",
    RenderTemplateInputSchema.shape,
    async (args) => {
      try {
        const result = await renderTemplateHandler(args as never);
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
              text: `RENDER_TEMPLATE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============ 存储管理工具 ============

  // 注册 c4a_visual_save 工具
  server.tool(
    "c4a_visual_save",
    "保存图片到指定存储位置",
    SaveImageInputSchema.shape,
    async (args) => {
      try {
        const result = await saveImageHandler(args as never);
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
              text: `SAVE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_visual_get_reference 工具
  server.tool(
    "c4a_visual_get_reference",
    "获取已保存图片的引用路径",
    GetReferenceInputSchema.shape,
    async (args) => {
      try {
        const result = await getReferenceHandler(args as never);
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
              text: `GET_REFERENCE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============ C4 架构图工具 ============

  // 注册 c4a_visual_render_c4 工具 - C4 架构图生成
  server.tool(
    "c4a_visual_render_c4",
    "从 Neo4j 查询架构数据，生成 C4 架构图（系统上下文/容器/组件）",
    RenderC4InputSchema.shape,
    async (args) => {
      try {
        const result = await renderC4Handler(args as never);
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
              text: `RENDER_C4_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============ 清理和统计工具 ============

  // 注册 c4a_visual_cleanup 工具 - 清理过期临时文件
  server.tool(
    "c4a_visual_cleanup",
    "清理过期的临时缓存文件",
    CleanupInputSchema.shape,
    async (args) => {
      try {
        const result = await cleanupHandler(args as never);
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
              text: `CLEANUP_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_visual_storage_stats 工具 - 获取存储统计
  server.tool(
    "c4a_visual_storage_stats",
    "获取图片存储统计信息（各模式的文件数和大小）",
    StorageStatsInputSchema.shape,
    async () => {
      try {
        const result = await storageStatsHandler();
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
              text: `STORAGE_STATS_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_visual_get_style 工具 - 获取全局风格配置
  server.tool(
    "c4a_visual_get_style",
    "获取全局视觉风格配置和关键词",
    GetStyleInputSchema.shape,
    async (args) => {
      try {
        const input = args as { language?: "auto" | "zh" | "en" };
        const result = await getGlobalStyle(input.language || "auto");
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
              text: `GET_STYLE_ERROR: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
