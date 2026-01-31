import { afterAll, describe, expect, test } from "bun:test";
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

  test("status prints service summary", async () => {
    const logs: string[] = [];
    await serverCommand(["status"], {
      docker: {
        ...docker,
        getContainerStatus: async () => [
          { name: "c4a-mongodb", status: "Up 1 minute (healthy)", state: "running", health: "healthy" },
        ],
      },
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
});

afterAll(() => {
  process.exitCode = 0;
});
