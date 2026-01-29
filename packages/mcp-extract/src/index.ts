#!/usr/bin/env node
/**
 * @c4a/mcp-extract - 代码分析 MCP Server
 *
 * 提供 c4a_extract_* 工具（接口提取/分析/AST/契约）
 *
 * 运行方式: stdio（必须本地）
 *
 * 环境变量:
 * - MCP_TRANSPORT: 仅允许 stdio（默认 stdio）
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

const transport = process.env.MCP_TRANSPORT || "stdio";

async function startStdioServer() {
  const server = createServer();
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  // 重要：stdio 模式下只能向 stderr 输出日志
  console.error("c4a-extract-mcp server started (stdio)");
}

async function main() {
  if (transport !== "stdio") {
    console.error(
      `c4a-extract-mcp 仅支持 stdio 模式，当前 MCP_TRANSPORT=${transport}`
    );
    process.exit(1);
  }

  await startStdioServer();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
