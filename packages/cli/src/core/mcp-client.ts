import { getAdapter, type StorageAdapter } from "@c4a/storage";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type McpTransport = "local" | "stdio" | "http";

export interface McpClientOptions {
  baseUrl?: string;
  transport?: McpTransport;
}

type RpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { message?: string };
};

type ToolResponse = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

const METHOD_MAP: Record<string, keyof StorageAdapter> = {
  c4a_store_save: "save",
  c4a_store_read: "read",
  c4a_store_list: "list",
  c4a_store_delete: "delete",
  c4a_store_sync: "sync",
  c4a_store_plan_sync: "planSync",
  c4a_query_search: "search",
  c4a_query_deps: "queryDeps",
  c4a_query_impact: "queryImpact",
  c4a_store_read_history: "readHistory",
  c4a_store_backup: "backup",
  c4a_store_restore: "restore",
  c4a_store_repair: "repair",
  c4a_store_validate: "validate",
};

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/mcp")) {
    return trimmed;
  }
  return `${trimmed}/mcp`;
}

function parseToolResult<T>(payload: ToolResponse): T {
  const text = payload.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("MCP 返回为空");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`MCP 返回解析失败: ${String(error)}`);
  }
  if (payload.isError) {
    const message =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message?: string }).message ?? "MCP 返回错误")
        : typeof parsed === "string"
          ? parsed
          : "MCP 返回错误";
    throw new Error(message);
  }
  return parsed as T;
}

function parseRpcResult<T>(response: RpcResponse): T {
  if (response.error) {
    throw new Error(response.error.message ?? "MCP RPC 调用失败");
  }
  if (!response.result) {
    throw new Error("MCP RPC 返回缺少 result");
  }
  return parseToolResult<T>(response.result as ToolResponse);
}

function ensureRpcSuccess(response: RpcResponse): void {
  if (response.error) {
    throw new Error(response.error.message ?? "MCP RPC 调用失败");
  }
}

class HttpMcpClient {
  private readonly endpoint: string;
  private sessionId?: string;
  private nextId = 1;
  private initialized = false;

  constructor(baseUrl: string) {
    this.endpoint = normalizeBaseUrl(baseUrl);
  }

  async callTool<T>(name: string, params: unknown): Promise<T> {
    if (!this.initialized) {
      await this.initialize();
    }
    const response = await this.sendRequest({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: {
        name,
        arguments: params,
      },
    });
    return parseRpcResult<T>(response);
  }

  private async initialize(): Promise<void> {
    const response = await this.sendRequest({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        clientInfo: { name: "c4a-cli", version: "0.3.1" },
        capabilities: {},
      },
    });
    ensureRpcSuccess(response);
    this.initialized = true;
  }

  private async sendRequest(payload: Record<string, unknown>): Promise<RpcResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(payload),
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }
    const json = (await response.json()) as RpcResponse;
    if (!response.ok) {
      throw new Error(json.error?.message ?? `HTTP ${response.status}`);
    }
    return json;
  }
}

class StdioMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private initialized = false;
  private pending = new Map<
    number,
    { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }
  >();

  constructor(command: string, args: string[]) {
    this.child = spawn(command, args, {
      stdio: "pipe",
      env: { ...process.env, MCP_TRANSPORT: "stdio" },
    });
    this.child.stdout.on("data", (chunk) => this.handleData(chunk));
    this.child.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf-8");
      if (message.trim()) {
        console.error(message.trim());
      }
    });
    this.child.on("exit", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("MCP stdio 连接已关闭"));
      }
      this.pending.clear();
    });
  }

  async callTool<T>(name: string, params: unknown): Promise<T> {
    if (!this.initialized) {
      await this.initialize();
    }
    const response = await this.sendRequest({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: {
        name,
        arguments: params,
      },
    });
    return parseRpcResult<T>(response);
  }

  private async initialize(): Promise<void> {
    const response = await this.sendRequest({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        clientInfo: { name: "c4a-cli", version: "0.3.1" },
        capabilities: {},
      },
    });
    ensureRpcSuccess(response);
    this.initialized = true;
  }

  private sendRequest(payload: Record<string, unknown>): Promise<RpcResponse> {
    const id = payload.id;
    if (typeof id !== "number") {
      return Promise.reject(new Error("MCP 请求缺少 id"));
    }
    const json = JSON.stringify(payload);
    const header = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n`;
    this.child.stdin.write(header + json);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headerText = this.buffer.slice(0, headerEnd).toString("utf-8");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(lengthMatch[1], 10);
      const totalLength = headerEnd + 4 + length;
      if (this.buffer.length < totalLength) return;
      const body = this.buffer.slice(headerEnd + 4, totalLength);
      this.buffer = this.buffer.slice(totalLength);
      let message: RpcResponse;
      try {
        message = JSON.parse(body.toString("utf-8")) as RpcResponse;
      } catch (error) {
        continue;
      }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.resolve(message);
        }
      }
    }
  }
}

function resolveMcpStoreEntrypoint(): string {
  if (process.env.C4A_MCP_STORE_PATH) {
    return process.env.C4A_MCP_STORE_PATH;
  }
  const localEntry = fileURLToPath(
    new URL("../../../mcp-store/src/index.ts", import.meta.url),
  );
  if (existsSync(localEntry)) {
    return localEntry;
  }
  const distEntry = fileURLToPath(
    new URL("../../../mcp-store/dist/index.js", import.meta.url),
  );
  if (existsSync(distEntry)) {
    return distEntry;
  }
  throw new Error("无法定位 @c4a/mcp-store 入口，请设置 C4A_MCP_STORE_PATH");
}

function resolveStdioCommand(): { command: string; args: string[] } {
  const command = process.env.C4A_MCP_STORE_CMD ?? "bun";
  if (process.env.C4A_MCP_STORE_ARGS) {
    const args = process.env.C4A_MCP_STORE_ARGS.split(" ").filter(Boolean);
    return { command, args };
  }
  return { command, args: [resolveMcpStoreEntrypoint()] };
}

export class McpClient {
  private readonly transport: McpTransport;
  private readonly baseUrl?: string;
  private localAdapter?: StorageAdapter;
  private httpClient?: HttpMcpClient;
  private stdioClient?: StdioMcpClient;

  constructor(options: McpClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.transport = options.transport ?? (this.baseUrl ? "http" : "local");
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (this.transport === "local") {
      return await this.requestLocal<T>(method, params);
    }
    if (this.transport === "http") {
      if (!this.baseUrl) {
        throw new Error("HTTP 模式需要 baseUrl");
      }
      if (!this.httpClient) {
        this.httpClient = new HttpMcpClient(this.baseUrl);
      }
      return await this.httpClient.callTool<T>(method, params);
    }
    if (!this.stdioClient) {
      const { command, args } = resolveStdioCommand();
      this.stdioClient = new StdioMcpClient(command, args);
    }
    return await this.stdioClient.callTool<T>(method, params);
  }

  private async requestLocal<T>(method: string, params: unknown): Promise<T> {
    const adapter = await this.getLocalAdapter();
    const mapped = METHOD_MAP[method];
    if (!mapped) {
      throw new Error(`未知 MCP 工具: ${method}`);
    }
    const handler = adapter[mapped] as (input: unknown) => Promise<T>;
    return await handler(params);
  }

  private async getLocalAdapter(): Promise<StorageAdapter> {
    if (!this.localAdapter) {
      const adapter = await getAdapter({ forceMode: "local" });
      await adapter.initialize();
      this.localAdapter = adapter;
    }
    return this.localAdapter;
  }
}
