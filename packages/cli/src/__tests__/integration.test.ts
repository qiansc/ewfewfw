import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initCommand } from "../commands/init.js";
import { installCommand } from "../commands/install.js";
import { statusCommand } from "../commands/status.js";
import { syncCommand } from "../commands/sync.js";
import { buildMainMenu } from "../menuData.js";
import type { ProjectConfig } from "../core/config.js";
import type { McpTransport } from "../core/mcp-client.js";

type McpClientLike = {
  request: <T>(method: string, params: unknown) => Promise<T>;
};

function createMockClient(
  handler: (method: string, params: unknown) => unknown,
): McpClientLike {
  return {
    request: async <T>(method: string, params: unknown) => handler(method, params) as T,
  };
}

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const root = join(process.cwd(), ".tmp");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "c4a-cli-integration-"));
  const cwd = process.cwd();
  process.chdir(dir);
  const cleanup = () => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn(dir);
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(cleanup);
    }
    cleanup();
    return Promise.resolve();
  } catch (error) {
    cleanup();
    return Promise.reject(error);
  }
}

describe("cli integration flow", () => {
  test("init -> install -> sync -> status (local)", async () => {
    await withTempDir(async (dir) => {
      let savedProject: any = null;
      let savedGlobal: any = null;

      await installCommand(["local"], {
        io: { log: () => {}, error: () => {} },
        prompter: {
          select: async (_label, options, defaultIndex = 0) => options[defaultIndex].value,
          confirm: async () => true,
          close: () => {},
        },
        now: () => new Date("2026-01-01T00:00:00Z"),
        loadGlobalConfig: async () => ({}),
        saveGlobalConfig: async (config) => {
          savedGlobal = config as Record<string, unknown>;
        },
        ensureDir: async () => {},
        createLocalDb: async () => {},
        downloadEmbeddingModel: async () => {},
      });

      await initCommand([], {
        prompter: {
          input: async (label, options) => {
            if (label.includes("项目标识")) return "demo-project";
            if (options?.defaultValue) return options.defaultValue;
            return "acme/demo";
          },
          confirm: async () => false,
          select: async (_label, options, defaultIndex = 0) => options[defaultIndex].value,
          close: () => {},
        },
        detectGitRemote: async () => "acme/demo",
        loadGlobalConfig: async () => ({ local: { installed_at: "2026-01-01T00:00:00Z" } }),
        saveProjectConfig: async (config) => {
          savedProject = config as Record<string, unknown>;
        },
        ensureContextDirs: async () => {},
        writeCursorConfig: async () => {},
        writeClaudeConfig: async () => {},
        writeOpenCodeConfig: async () => {},
      });

      expect(savedGlobal?.local).toBeTruthy();
      expect(savedProject?.mode).toBe("local");

      const contextDir = join(dir, ".context", "technical", "systems");
      mkdirSync(contextDir, { recursive: true });
      writeFileSync(
        join(contextDir, "demo.c4a.yaml"),
        "schema: c4a/v1\ntype: system\nsystem:\n  id: demo\n  name: Demo\n",
        "utf-8",
      );

      const syncCalls: Array<{ method: string }> = [];
      await syncCommand([], {
        loadProjectConfig: async () =>
          ({
            mode: "local",
            root_id: "demo",
          }) satisfies ProjectConfig,
        createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }) =>
          createMockClient((method) => {
            syncCalls.push({ method });
            if (method === "c4a_store_list") {
              return { items: [] };
            }
            return {};
          }),
        log: () => undefined,
        error: () => undefined,
        prompt: async () => 0,
        now: () => new Date(),
      });

      expect(syncCalls.some((call) => call.method === "c4a_store_sync")).toBe(true);

      const logs: string[] = [];
      await statusCommand([], {
        loadGlobalConfig: async () => ({ local: { installed_at: "2026-01-01T00:00:00Z" } }),
        loadProjectConfig: async () =>
          ({
            mode: "local",
            root_id: "demo",
          }) satisfies ProjectConfig,
        createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }) =>
          createMockClient(() => ({ groups: { system: { count: 1 } } })),
        now: () => 1000,
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      });

      expect(logs.join("\n")).toContain("System: 1 个");
    });
  });

  test("menu availability toggles by mode", () => {
    const menuNoInstall = buildMainMenu({ installedModes: [], projectMode: undefined });
    expect(menuNoInstall.find((item) => item.id === "server")).toBeUndefined();
    expect(menuNoInstall.find((item) => item.id === "local")).toBeUndefined();

    const menuRemote = buildMainMenu({
      installedModes: [],
      projectMode: "remote",
      remoteUrl: "https://c4a.example.com",
    });
    const syncItem = menuRemote.find((item) => item.id === "sync");
    expect(Boolean(syncItem?.disabled)).toBe(false);

    const menuLocal = buildMainMenu({ installedModes: ["local"], projectMode: "local" });
    expect(menuLocal.find((item) => item.id === "local")).toBeTruthy();
  });

  test("sync mode selects transport", async () => {
    const transports: Array<string | undefined> = [];
    await syncCommand([], {
      loadProjectConfig: async () =>
        ({
          mode: "remote",
          root_id: "demo",
          remote: { url: "https://example.com" },
        }) satisfies ProjectConfig,
      createMcpClient: (options: { baseUrl?: string; transport?: McpTransport }) => {
        transports.push(options.transport);
        return createMockClient(() => ({
          success: true,
          executed: true,
          actions: [],
          new_snapshot: { synced_at: new Date().toISOString(), entities: {} },
          stats: {},
        }));
      },
      log: () => undefined,
      error: () => undefined,
      prompt: async () => 0,
      now: () => new Date(),
    });

    expect(transports[0]).toBe("http");
  });

  test("sync remote actions apply root_id for save/delete", async () => {
    await withTempDir(async (dir) => {
      const contextDir = join(dir, ".context", "technical", "systems");
      mkdirSync(contextDir, { recursive: true });
      writeFileSync(
        join(contextDir, "demo.c4a.yaml"),
        "schema: c4a/v1\ntype: system\nsystem:\n  id: demo\n  name: Demo\n",
        "utf-8",
      );

      const calls: Array<{ method: string; params: any }> = [];
      await syncCommand([], {
        loadProjectConfig: async () =>
          ({
            mode: "remote",
            root_id: "demo-root",
            remote: { url: "https://example.com" },
          }) satisfies ProjectConfig,
        createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }) =>
          createMockClient((method, params) => {
            calls.push({ method, params });
            if (method === "c4a_store_plan_sync") {
              return {
                success: true,
                executed: true,
                actions: [
                  {
                    op: "upload",
                    entity_id: "demo",
                    type: "system",
                    path: "technical/systems/demo.c4a.yaml",
                  },
                  {
                    op: "delete_remote",
                    entity_id: "legacy",
                  },
                ],
                new_snapshot: { synced_at: new Date().toISOString(), entities: {} },
                stats: { to_download: 0, conflicts: 0 },
                results: { uploaded: [] },
              };
            }
            if (method === "c4a_store_read") {
              return { uuid: "legacy-uuid" };
            }
            return {};
          }),
        log: () => undefined,
        error: () => undefined,
        prompt: async () => 0,
        now: () => new Date(),
      });

      const saveCall = calls.find((call) => call.method === "c4a_store_save");
      expect(saveCall?.params?.root_id).toBe("demo-root");

      const deleteCall = calls.find((call) => call.method === "c4a_store_delete");
      expect(deleteCall?.params?.uuid).toBe("legacy-uuid");
    });
  });
});
