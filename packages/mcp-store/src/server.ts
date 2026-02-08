/**
 * MCP Server 工厂函数
 *
 * 本文件只注册 mcp-tools.md 中定义的 c4a_store_* 工具
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToMcpResponse, type McpErrorResponse } from "@c4a/core/types";
import { getAdapter } from "@c4a/storage";
import {
  StoreSaveInputSchema,
  StoreReadInputSchema,
  StoreListInputSchema,
  StoreDeleteInputSchema,
  StoreAddVersionInputSchema,
  StoreRemoveVersionInputSchema,
  StorePublishVersionInputSchema,
  StoreSyncInputSchema,
  StoreSyncStatusInputSchema,
  StorePlanSyncInputSchema,
  StoreReadHistoryInputSchema,
  StoreBackupInputSchema,
  StoreRestoreInputSchema,
  StoreRepairInputSchema,
  StoreValidateInputSchema,
} from "./schemas.js";
import {
  storeSaveHandler,
  storeReadHandler,
  storeListHandler,
  storeDeleteHandler,
  storeAddVersionHandler,
  storeRemoveVersionHandler,
  storePublishVersionHandler,
  storeSyncHandler,
  storeSyncStatusHandler,
  storePlanSyncHandler,
  storeReadHistoryHandler,
  storeBackupHandler,
  storeRestoreHandler,
  storeRepairHandler,
  storeValidateHandler,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "c4a-store-mcp",
    version: "0.1.0",
  });

  const adapterReady = getAdapter();
  adapterReady.catch((error) => {
    console.error(`[c4a-store-mcp] adapter init failed: ${String(error)}`);
  });

  // ============ Store 工具（数据库操作）============
  // 参考文档: v0.3.0/detailed-design/mcp-tools.md

  // 注册 c4a_store_save 工具
  server.tool(
    "c4a_store_save",
    "保存/更新实体到数据库",
    StoreSaveInputSchema.shape,
    async (args) => {
      try {
        const result = await storeSaveHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_read 工具
  server.tool(
    "c4a_store_read",
    "读取实体/列表",
    StoreReadInputSchema.shape,
    async (args) => {
      try {
        const result = await storeReadHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_list 工具
  server.tool(
    "c4a_store_list",
    "列出实体概要",
    StoreListInputSchema.shape,
    async (args) => {
      try {
        const result = await storeListHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_delete 工具
  server.tool(
    "c4a_store_delete",
    "删除实体",
    StoreDeleteInputSchema.shape,
    async (args) => {
      try {
        const result = await storeDeleteHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_add_version 工具
  server.tool(
    "c4a_store_add_version",
    "向实体追加版本标签",
    StoreAddVersionInputSchema.shape,
    async (args) => {
      try {
        const result = await storeAddVersionHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_remove_version 工具
  server.tool(
    "c4a_store_remove_version",
    "从实体移除版本标签",
    StoreRemoveVersionInputSchema.shape,
    async (args) => {
      try {
        const result = await storeRemoveVersionHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_publish_version 工具
  server.tool(
    "c4a_store_publish_version",
    "发布版本并处理 latest 指针",
    StorePublishVersionInputSchema.shape,
    async (args) => {
      try {
        const result = await storePublishVersionHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_sync 工具
  server.tool(
    "c4a_store_sync",
    "文件系统 ↔ 数据库同步（Local 模式）",
    StoreSyncInputSchema.shape,
    async (args) => {
      try {
        const result = await storeSyncHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_sync_status 工具
  server.tool(
    "c4a_store_sync_status",
    "Server 模式同步状态查询",
    StoreSyncStatusInputSchema.shape,
    async (args) => {
      try {
        const result = await storeSyncStatusHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_plan_sync 工具
  server.tool(
    "c4a_store_plan_sync",
    "Server/Remote 模式同步计划",
    StorePlanSyncInputSchema.shape,
    async (args) => {
      try {
        const result = await storePlanSyncHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_read_history 工具
  server.tool(
    "c4a_store_read_history",
    "查询实体变更历史",
    StoreReadHistoryInputSchema.shape,
    async (args) => {
      try {
        const result = await storeReadHistoryHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_backup 工具
  server.tool(
    "c4a_store_backup",
    "备份数据到文件",
    StoreBackupInputSchema.shape,
    async (args) => {
      try {
        const result = await storeBackupHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_restore 工具
  server.tool(
    "c4a_store_restore",
    "从备份文件恢复数据",
    StoreRestoreInputSchema.shape,
    async (args) => {
      try {
        const result = await storeRestoreHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_repair 工具
  server.tool(
    "c4a_store_repair",
    "修复数据一致性（仅 Server 模式需要，Local 模式使用 SQLite 事务保证一致性）",
    StoreRepairInputSchema.shape,
    async (args) => {
      try {
        const result = await storeRepairHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 c4a_store_validate 工具
  server.tool(
    "c4a_store_validate",
    "架构一致性检查，支持 Functional Spec、Technical Spec、契约、引用、ADR、Checklist 检查",
    StoreValidateInputSchema.shape,
    async (args) => {
      try {
        const result = await storeValidateHandler(args as never);
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
              text: JSON.stringify(buildErrorResponse(error), null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

function buildErrorResponse(error: unknown): McpErrorResponse {
  return errorToMcpResponse(error);
}
