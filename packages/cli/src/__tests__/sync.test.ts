import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSyncArgs, syncCommand } from "../commands/sync.js";
import type { ProjectConfig } from "../core/config.js";
import type { McpTransport } from "../core/mcp-client.js";

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const root = join(process.cwd(), ".tmp");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "c4a-cli-sync-"));
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

describe("syncCommand", () => {
  test("parseSyncArgs rejects unknown or invalid options", () => {
    const invalidDirection = parseSyncArgs(["--direction", "sideways"]);
    expect(invalidDirection).toBeInstanceOf(Error);

    const invalidMode = parseSyncArgs(["--mode=fast"]);
    expect(invalidMode).toBeInstanceOf(Error);

    const unknown = parseSyncArgs(["--unknown"]);
    expect(unknown).toBeInstanceOf(Error);
  });

  test("local mode runs import then export on dual changes", async () => {
    await withTempDir(async (dir) => {
      const contextDir = join(dir, ".context", "technical", "containers");
      mkdirSync(contextDir, { recursive: true });
      writeFileSync(
        join(contextDir, "demo.yaml"),
        "schema: c4a/v1\ntype: container\ncontainer:\n  id: demo\n  name: Demo\n  description: Demo\n  scope: project\n  system_id: sys\n",
        "utf-8",
      );
      writeFileSync(
        join(dir, ".context", ".sync-state.json"),
        JSON.stringify({ synced_at: new Date(Date.now() - 3600_000).toISOString(), entities: {} }),
        "utf-8",
      );

      const calls: Array<{ method: string; params: unknown }> = [];
      const deps = {
        loadProjectConfig: async () =>
          ({
            mode: "local",
            root_id: "demo",
          }) satisfies ProjectConfig,
        createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }) => ({
          request: async <T>(method: string, params: unknown) => {
            calls.push({ method, params });
            if (method === "c4a_store_list") {
              return { items: [{ id: "x" }] } as T;
            }
            return {} as T;
          },
        }),
        log: () => undefined,
        error: () => undefined,
        prompt: async () => 0,
        now: () => new Date(),
      };

      await syncCommand([], deps);

      const syncCalls = calls.filter((call) => call.method === "c4a_store_sync");
      expect(syncCalls.length).toBeGreaterThan(0);
      expect((syncCalls[0].params as { direction: string }).direction).toBe("import");
      expect((syncCalls[1].params as { direction: string }).direction).toBe("export");
    });
  });

  test("remote mode resolves conflict using remote content", async () => {
    await withTempDir(async (dir) => {
      const contextDir = join(dir, ".context", "technical", "containers");
      mkdirSync(contextDir, { recursive: true });
      const filePath = join(contextDir, "demo.yaml");
      writeFileSync(
        filePath,
        "schema: c4a/v1\ntype: container\ncontainer:\n  id: demo\n  name: Demo\n  description: Local\n  scope: project\n  system_id: sys\n",
        "utf-8",
      );
      writeFileSync(
        join(dir, ".context", ".sync-state.json"),
        JSON.stringify({ synced_at: new Date().toISOString(), entities: {} }),
        "utf-8",
      );

      const deps = {
        loadProjectConfig: async () =>
          ({
            mode: "remote",
            root_id: "demo",
            remote: { url: "https://example.com" },
          }) satisfies ProjectConfig,
        createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }) => ({
          request: async <T>() =>
            ({
              success: true,
              executed: true,
              actions: [
                {
                  op: "conflict",
                  entity_id: "demo",
                  type: "container",
                  path: "technical/containers/demo.yaml",
                  conflict_type: "both_modified",
                  remote_content:
                    "schema: c4a/v1\ntype: container\ncontainer:\n  id: demo\n  name: Demo\n  description: Remote\n  scope: project\n  system_id: sys\n",
                },
              ],
              new_snapshot: { synced_at: new Date().toISOString(), entities: {} },
              stats: { to_download: 0, conflicts: 1 },
            }) as T,
        }),
        log: () => undefined,
        error: () => undefined,
        prompt: async () => 1,
        now: () => new Date(),
      };

      await syncCommand([], deps);

      const updated = readFileSync(filePath, "utf-8");
      expect(updated).toContain("description: Remote");
    });
  });

  test("remote mode plan sync omits requirement_id and keeps root_id on save", async () => {
    await withTempDir(async (dir) => {
      const contextDir = join(dir, ".context", "technical", "containers");
      mkdirSync(contextDir, { recursive: true });
      writeFileSync(
        join(contextDir, "demo.yaml"),
        "schema: c4a/v1\ntype: container\ncontainer:\n  id: demo\n  name: Demo\n  description: Demo\n  scope: project\n  system_id: sys\n",
        "utf-8",
      );
      writeFileSync(
        join(dir, ".context", ".sync-state.json"),
        JSON.stringify({ synced_at: new Date().toISOString(), entities: {} }),
        "utf-8",
      );

      const calls: Array<{ method: string; params: any }> = [];
      let planParams: any = null;
      const deps = {
        loadProjectConfig: async () =>
          ({
            mode: "remote",
            root_id: "legacy-project",
            remote: { url: "https://example.com" },
          }) satisfies ProjectConfig,
        createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }) => ({
          request: async <T>(method: string, params: any) => {
            calls.push({ method, params });
            if (method === "c4a_store_plan_sync") {
              planParams = params;
              return {
                success: true,
                executed: true,
                actions: [
                  {
                    op: "upload",
                    entity_id: "demo",
                    type: "container",
                    path: "technical/containers/demo.yaml",
                  },
                ],
                new_snapshot: { synced_at: new Date().toISOString(), entities: {} },
                stats: { to_download: 0, conflicts: 0 },
              } as T;
            }
            return {} as T;
          },
        }),
        log: () => undefined,
        error: () => undefined,
        prompt: async () => 0,
        now: () => new Date(),
      };

      await syncCommand([], deps);

      if (planParams?.options) {
        expect("requirement_id" in planParams.options).toBe(false);
      }

      const saveCall = calls.find((call) => call.method === "c4a_store_save");
      expect(saveCall?.params.root_id).toBe("legacy-project");
      expect(saveCall?.params).toBeDefined();
      if (saveCall) {
        expect("requirement_id" in saveCall.params).toBe(false);
      }
    });
  });
});
