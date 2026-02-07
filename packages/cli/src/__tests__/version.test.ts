import { describe, expect, test } from "bun:test";
import { versionCommand } from "../commands/version.js";
import type { ProjectConfig } from "../core/config.js";
import type { McpTransport } from "../core/mcp-client.js";

type McpClientLike = {
  request: <T>(method: string, params: unknown) => Promise<T>;
};

describe("versionCommand", () => {
  test("switch writes version to project config", async () => {
    let savedConfig: { version?: string } | null = null;
    const deps = {
      loadProjectConfig: async () => ({ root_id: "demo" }) satisfies ProjectConfig,
      saveProjectConfig: async (config: ProjectConfig) => {
        savedConfig = config;
      },
      createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }): McpClientLike => ({
        request: async <T>() => ({}) as T,
      }),
      log: () => undefined,
      error: () => undefined,
    };

    await versionCommand(["switch", "1.2.0"], deps);

    expect(savedConfig).toMatchObject({ version: "1.2.0" });
  });

  test("add --entity calls add version tool", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const deps = {
      loadProjectConfig: async () =>
        ({
          root_id: "demo",
          mode: "server",
          server: { url: "https://c4a.example.com" },
        }) satisfies ProjectConfig,
      saveProjectConfig: async () => undefined,
      createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }): McpClientLike => ({
        request: async <T>(method: string, params: unknown) => {
          calls.push({ method, params });
          return { versions: ["0.0.0", "1.0.0"] } as T;
        },
      }),
      log: () => undefined,
      error: () => undefined,
    };

    await versionCommand(["add", "1.0.0", "--entity", "uuid-1"], deps);

    expect(calls[0]?.method).toBe("c4a_store_add_version");
    expect(calls[0]?.params).toEqual({ uuid: "uuid-1", version: "1.0.0" });
  });

  test("add --all paginates and applies to all entities", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const deps = {
      loadProjectConfig: async () =>
        ({
          root_id: "demo",
          mode: "server",
          server: { url: "https://c4a.example.com" },
        }) satisfies ProjectConfig,
      saveProjectConfig: async () => undefined,
      createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }): McpClientLike => ({
        request: async <T>(method: string, params: unknown) => {
          calls.push({ method, params });
          if (method === "c4a_store_list" && calls.filter((c) => c.method === method).length === 1) {
            return {
              items: [{ uuid: "a" }, { uuid: "b" }],
              pagination: { has_more: true },
            } as T;
          }
          if (method === "c4a_store_list") {
            return {
              items: [{ uuid: "c" }],
              pagination: { has_more: false },
            } as T;
          }
          return {} as T;
        },
      }),
      log: () => undefined,
      error: () => undefined,
    };

    await versionCommand(["add", "1.1.0", "--all"], deps);

    const addCalls = calls.filter((call) => call.method === "c4a_store_add_version");
    expect(addCalls.length).toBe(3);
  });

  test("list --entity prints versions", async () => {
    const logs: string[] = [];
    const deps = {
      loadProjectConfig: async () =>
        ({
          root_id: "demo",
          mode: "server",
          server: { url: "https://c4a.example.com" },
        }) satisfies ProjectConfig,
      saveProjectConfig: async () => undefined,
      createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }): McpClientLike => ({
        request: async <T>() => ({ entity: { versions: ["1.0.0", "1.1.0"] } }) as T,
      }),
      log: (message: string) => logs.push(message),
      error: () => undefined,
    };

    await versionCommand(["list", "--entity", "uuid-1"], deps);

    expect(logs.join("\n")).toContain("1.0.0");
    expect(logs.join("\n")).toContain("1.1.0");
  });

  test("publish passes transfer_latest flag", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const deps = {
      loadProjectConfig: async () =>
        ({
          root_id: "demo",
          mode: "server",
          server: { url: "https://c4a.example.com" },
        }) satisfies ProjectConfig,
      saveProjectConfig: async () => undefined,
      createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }): McpClientLike => ({
        request: async <T>(method: string, params: unknown) => {
          calls.push({ method, params });
          return { version: "1.0.0" } as T;
        },
      }),
      log: () => undefined,
      error: () => undefined,
    };

    await versionCommand(["publish", "1.0.0", "--latest"], deps);

    expect(calls[0]?.method).toBe("c4a_store_publish_version");
    expect(calls[0]?.params).toEqual({ root_id: "demo", version: "1.0.0", transfer_latest: true });
  });
});
