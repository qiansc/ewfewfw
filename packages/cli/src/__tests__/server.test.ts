import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { serverCommand } from "../commands/server.js";

describe("serverCommand", () => {
  const docker = {
    checkDockerInstalled: async () => true,
    getContainerStatus: async () => [],
    restartContainers: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    stopContainers: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    getContainerLogs: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  };

  const loadConfig = async () => ({
    server: { installed_at: "2026-01-01T00:00:00Z", url: "http://localhost:8051" },
  });

  const originalFetch = globalThis.fetch;

  function createMockMcpFetch(result: unknown) {
    return mock(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
      const id = payload.id ?? 1;
      if (payload.method === "initialize") {
        return {
          ok: true,
          headers: new Headers(),
          json: async () => ({ jsonrpc: "2.0", id, result: {} }),
        } as Response;
      }
      if (payload.method === "tools/call") {
        return {
          ok: true,
          headers: new Headers(),
          json: async () => ({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(result) }] },
          }),
        } as Response;
      }
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ jsonrpc: "2.0", id, result: {} }),
      } as Response;
    });
  }

  function findToolCall(mockFetchFn: ReturnType<typeof mock>) {
    const calls = mockFetchFn.mock.calls;
    const bodies = calls.map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
    return bodies.find((payload) => payload.method === "tools/call");
  }

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("backup calls mcp client with output", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const createMcpClient = (_options?: { baseUrl?: string; transport?: string }) =>
      ({
        request: async (method: string, params: unknown) => {
          calls.push({ method, params });
          return { success: true, file: "backup.tar.gz" };
        },
      }) as any;

    await serverCommand(["backup", "--output", "backup.tar.gz"], {
      docker,
      loadConfig,
      createMcpClient,
      emitError: () => {},
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("c4a_store_backup");
    expect((calls[0].params as { output: string }).output).toBe("backup.tar.gz");
  });

  test("restore calls mcp client and runs permission precheck", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const logs: string[] = [];
    let permissionChecked = false;
    const createMcpClient = (_options?: { baseUrl?: string; transport?: string }) =>
      ({
        request: async (method: string, params: unknown) => {
          calls.push({ method, params });
          return { success: true, stats: { entities: 1, relations: 2, vectors: 3 } };
        },
      }) as any;

    await serverCommand(["restore", "backup.tar.gz", "--yes", "--conflict-policy=override"], {
      docker,
      loadConfig,
      createMcpClient,
      emitError: () => {},
      permissionChecker: async (backupFile: string) => {
        permissionChecked = true;
        expect(backupFile).toBe("backup.tar.gz");
        return {
          total: 1,
          allowed: 1,
          denied: 0,
          projects: { "demo-project": { total: 1, allowed: 1, denied: 0 } },
        };
      },
      io: {
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
    });

    expect(permissionChecked).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("c4a_store_restore");
    expect((calls[0].params as { input: string }).input).toBe("backup.tar.gz");
    expect((calls[0].params as { conflict_policy: string }).conflict_policy).toBe("override");
  });

  test("status prints service summary", async () => {
    const logs: string[] = [];
    await serverCommand(["status"], {
      docker: {
        ...docker,
        getContainerStatus: async () => [
          { name: "c4a-mongodb", status: "Up 1 minute (healthy)", state: "running", health: "healthy" },
        ],
      },
      checkHealth: async () => ({
        mongodb: true,
        neo4j: false,
        milvus: false,
        ollama: false,
      }),
      loadConfig: async () => ({
        server: { installed_at: "2026-01-01T00:00:00Z", url: "http://localhost:8051" },
      }),
      io: {
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
      emitError: () => {},
    });

    expect(logs.join("\n")).toContain("MongoDB");
    expect(logs.join("\n")).toContain("运行中");
  });

  test("status prints service url when provided", async () => {
    const logs: string[] = [];
    await serverCommand(["status"], {
      docker,
      checkHealth: async () => ({
        mongodb: true,
        neo4j: true,
        milvus: true,
        ollama: true,
      }),
      loadConfig: async () => ({
        server: {
          installed_at: "2026-01-01T00:00:00Z",
          url: "http://localhost:8051",
          services: { mongodb: "localhost:27017" },
        },
      }),
      io: {
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
      emitError: () => {},
    });

    expect(logs.join("\n")).toContain("MongoDB: localhost:27017");
  });

  test("check-permissions outputs json when requested", async () => {
    const logs: string[] = [];
    await serverCommand(["check-permissions", "--backup", "backup.json", "--format=json"], {
      docker,
      loadConfig,
      emitError: () => {},
      permissionChecker: async () => ({
        total: 2,
        allowed: 2,
        denied: 0,
        projects: {
          "demo-project": { total: 2, allowed: 2, denied: 0 },
        },
      }),
      io: {
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
    });

    const output = logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.allowed).toBe(2);
    expect(parsed.projects["demo-project"].total).toBe(2);
  });

  test("check-consistency with --user", async () => {
    const mockFetch = createMockMcpFetch({
      scanned: 10,
      inconsistencies: [],
      stats: { neo4j_fixed: 0, milvus_fixed: 0, failed: 0 },
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await serverCommand(["check-consistency", "--user", "test-user"], {
      loadConfig,
      emitError: mock(() => {}),
      io: { log: mock(() => {}), error: mock(() => {}) },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/mcp"),
      expect.objectContaining({ method: "POST" }),
    );
    const toolCall = findToolCall(mockFetch);
    expect(toolCall?.params?.name).toBe("c4a_store_repair");
    expect(toolCall?.params?.arguments).toEqual({ scope: "all", dry_run: true });
  });

  test("rebuild-neo4j with --yes and --format=json", async () => {
    const logs: string[] = [];
    const mockFetch = createMockMcpFetch({
      scanned: 100,
      inconsistencies: [],
      stats: { neo4j_fixed: 100, milvus_fixed: 0, failed: 0 },
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await serverCommand(["rebuild-neo4j", "--yes", "--format", "json"], {
      loadConfig,
      emitError: mock(() => {}),
      confirm: mock(async () => true),
      io: {
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
    });

    expect(logs.join("\n")).toContain("\"neo4j_fixed\": 100");
  });

  test("rebuild-milvus prompts and calls repair", async () => {
    const logs: string[] = [];
    const confirm = mock(async () => true);
    const mockFetch = createMockMcpFetch({
      scanned: 50,
      inconsistencies: [],
      stats: { neo4j_fixed: 0, milvus_fixed: 50, failed: 0 },
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await serverCommand(["rebuild-milvus"], {
      loadConfig,
      emitError: mock(() => {}),
      confirm,
      io: {
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
    });

    expect(confirm).toHaveBeenCalled();
    const toolCall = findToolCall(mockFetch);
    expect(toolCall?.params?.name).toBe("c4a_store_repair");
    expect(toolCall?.params?.arguments).toEqual({ scope: "milvus", dry_run: false });
    expect(logs.join("\n")).toContain("✅ Milvus 重建完成");
  });
});

afterAll(() => {
  process.exitCode = 0;
});
