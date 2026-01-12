/**
 * C4A Visual MCP - 知识可视化服务
 *
 * 提供图片生成（Gemini）、图表渲染（Mermaid）、模板管理和存储管理能力
 *
 * 支持两种 transport 模式:
 * - stdio (默认): 被 Agent 自动拉起
 * - streamable-http: Docker 部署，暴露 HTTP 端口
 *
 * 环境变量:
 * - MCP_TRANSPORT: stdio | streamable-http (默认 stdio)
 * - MCP_PORT: HTTP 端口 (默认 8053)
 */
import { createServer } from "./server.js";

const transport = process.env.MCP_TRANSPORT || "stdio";
const port = parseInt(process.env.MCP_PORT || "8053", 10);

async function startStdioServer() {
  const server = createServer();
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  // 重要：stdio 模式下只能向 stderr 输出日志
  console.error("🎨 c4a-visual-mcp server started (stdio)");
}

async function startHttpServer() {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const server = createServer();

  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // 启动 HTTP 服务
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // 健康检查
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "c4a-visual-mcp",
            version: "0.1.0",
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // MCP 端点
      if (url.pathname === "/mcp" || url.pathname === "/") {
        return httpTransport.handleRequest(req);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  await server.connect(httpTransport);

  console.log(`🎨 C4A Visual MCP Server running on http://localhost:${port}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   MCP:    http://localhost:${port}/mcp`);
}

async function main() {
  if (transport === "streamable-http") {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
