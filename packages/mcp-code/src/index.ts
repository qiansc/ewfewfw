#!/usr/bin/env node
/**
 * @c4a/mcp-code - 代码分析 MCP Server
 *
 * 提供代码提取、分析、AST、契约生成等工具
 *
 * 支持两种 transport 模式:
 * - stdio (默认): 被 Agent 自动拉起
 * - streamable-http: Docker 部署，暴露 HTTP 端口
 *
 * 环境变量:
 * - MCP_TRANSPORT: stdio | streamable-http (默认 stdio)
 * - MCP_PORT: HTTP 端口 (默认 8052)
 */
import { createServer } from "./server.js";

const transport = process.env.MCP_TRANSPORT || "stdio";
const port = parseInt(process.env.MCP_PORT || "8052", 10);

async function startStdioServer() {
  const server = createServer();
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  // 重要：stdio 模式下只能向 stderr 输出日志
  console.error("c4a-code-mcp server started (stdio)");
}

async function startHttpServer() {
  const { createServer: createHttpServer } = await import("node:http");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { isInitializeRequest } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  const { randomUUID } = await import("node:crypto");

  // Session 管理
  const sessions: Map<
    string,
    { transport: InstanceType<typeof StreamableHTTPServerTransport>; server: ReturnType<typeof createServer> }
  > = new Map();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // 健康检查端点
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "c4a-code-mcp" }));
      return;
    }

    // MCP 端点
    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // 读取请求体
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());

        let session = sessionId ? sessions.get(sessionId) : undefined;

        if (!session && isInitializeRequest(body)) {
          // 新会话初始化
          const mcpServer = createServer();
          const httpTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { transport: httpTransport, server: mcpServer });
              console.log(`Session initialized: ${id}`);
            },
          });

          httpTransport.onclose = () => {
            if (httpTransport.sessionId) {
              sessions.delete(httpTransport.sessionId);
              console.log(`Session closed: ${httpTransport.sessionId}`);
            }
          };

          await mcpServer.connect(httpTransport);
          session = { transport: httpTransport, server: mcpServer };
        }

        if (session) {
          await session.transport.handleRequest(req, res, body);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Invalid session" },
              id: null,
            })
          );
        }
      } else if (req.method === "GET") {
        // SSE stream for notifications
        const session = sessionId ? sessions.get(sessionId) : undefined;
        if (session) {
          await session.transport.handleRequest(req, res);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid session");
        }
      } else if (req.method === "DELETE") {
        // Session termination
        const session = sessionId ? sessions.get(sessionId) : undefined;
        if (session) {
          await session.transport.handleRequest(req, res);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid session");
        }
      } else {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method not allowed");
      }
      return;
    }

    // 404 for other paths
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`c4a-code-mcp server started (http://0.0.0.0:${port}/mcp)`);
    console.log(`Health check: http://0.0.0.0:${port}/health`);
  });
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
