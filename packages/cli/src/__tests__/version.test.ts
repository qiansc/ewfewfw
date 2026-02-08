import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { versionCommand } from "../commands/version.js";
import { getEntityPath } from "@c4a/core";
import type { C4aConfig } from "../utils/resolveConfig.js";
import type { McpTransport } from "../core/mcp-client.js";

type McpClientLike = {
  request: <T>(method: string, params: unknown) => Promise<T>;
};

describe("versionCommand", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  test("prints help when no subcommand", async () => {
    const logs: string[] = [];
    await versionCommand([], {
      createMcpClient: () => ({ request: async <T>() => ({}) as T }),
      resolveC4aConfig: async () => null,
      confirm: async () => false,
      log: (message) => logs.push(message),
      error: () => undefined,
    });

    expect(logs.join("\n")).toContain("用法: c4a version <command>");
  });

  test("list aggregates versions and returns json", async () => {
    const logs: string[] = [];
    const config: C4aConfig = {
      rootDir: "/tmp/project",
      configSource: "yaml",
      rootId: "root-1",
      version: "1.1.0",
      mode: "local",
      autoPull: false,
      hasContextDir: true,
    };

    await versionCommand(["list", "--json"], {
      createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }): McpClientLike => ({
        request: async <T>(method: string) => {
          if (method === "c4a_store_list") {
            return {
              items: [
                { uuid: "a", versions: ["0.0.0", "1.0.0"] },
                { uuid: "b", versions: ["1.0.0", "1.1.0"] },
                { uuid: "c", versions: ["0.0.0"] },
              ],
              pagination: { has_more: false },
            } as T;
          }
          return {} as T;
        },
      }),
      resolveC4aConfig: async () => config,
      confirm: async () => false,
      log: (message) => logs.push(message),
      error: () => undefined,
    });

    const payload = JSON.parse(logs[0] ?? "{}");
    expect(payload.versions).toEqual([
      { version: "0.0.0", entity_count: 2, is_latest: true, is_current: false },
      { version: "1.0.0", entity_count: 2, is_latest: false, is_current: false },
      { version: "1.1.0", entity_count: 1, is_latest: false, is_current: true },
    ]);
  });

  test("switch in minimal mode updates package.json and warns on leftover", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "c4a-version-"));
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "demo", c4a: { version: "1.0.0" } }, null, 2) + "\n",
      "utf-8",
    );
    await mkdir(join(workspace, ".context", "system"), { recursive: true });
    await writeFile(join(workspace, ".context", "system", "order.c4a.yaml"), "x", "utf-8");

    const logs: string[] = [];
    const config: C4aConfig = {
      rootDir: workspace,
      configSource: "package.json",
      rootId: "root-1",
      version: "1.0.0",
      mode: "local",
      autoPull: false,
      hasContextDir: false,
    };

    await versionCommand(["switch", "1.2.0"], {
      createMcpClient: () => ({
        request: async <T>(method: string) => {
          if (method === "c4a_store_list") {
            return { total: 1 } as T;
          }
          return {} as T;
        },
      }),
      resolveC4aConfig: async () => config,
      confirm: async () => false,
      log: (message) => logs.push(message),
      error: () => undefined,
    });

    const updated = JSON.parse(await readFile(join(workspace, "package.json"), "utf-8"));
    expect(updated.c4a.version).toBe("1.2.0");
    expect(logs.join("\n")).toContain("警告：检测到 .context/");
  });

  test("switch rejects unknown version", async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message ?? ""));
    };

    try {
      const config: C4aConfig = {
        rootDir: "/tmp/project",
        configSource: "yaml",
        rootId: "root-1",
        version: "1.0.0",
        mode: "local",
        autoPull: false,
        hasContextDir: true,
      };

      await versionCommand(["switch", "2.0.0"], {
        createMcpClient: () => ({
          request: async <T>(method: string) => {
            if (method === "c4a_store_list") {
              return { total: 0 } as T;
            }
            return {} as T;
          },
        }),
        resolveC4aConfig: async () => config,
        confirm: async () => false,
        log: () => undefined,
        error: () => undefined,
      });
    } finally {
      console.error = originalError;
    }

    expect(errors.join("\n")).toContain("C4A-VER-001");
  });

  test("switch in observable mode updates config and pulls entities", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "c4a-version-"));
    await mkdir(join(workspace, ".context"), { recursive: true });
    await writeFile(
      join(workspace, ".context", ".c4a.yaml"),
      "root_id: root-1\nversion: 1.0.0\nmode: local\n",
      "utf-8",
    );

    const config: C4aConfig = {
      rootDir: workspace,
      configSource: "yaml",
      rootId: "root-1",
      version: "1.0.0",
      mode: "local",
      autoPull: false,
      hasContextDir: true,
    };

    const calls: string[] = [];
    await versionCommand(["switch", "1.2.0", "--yes"], {
      createMcpClient: () => ({
        request: async <T>(method: string, params: unknown) => {
          calls.push(method);
          if (method === "c4a_store_list") {
            const input = params as { count_only?: boolean; version?: string };
            if (input.count_only) {
              return { total: 1 } as T;
            }
            return {
              items: [{ uuid: "uuid-1", id: "order", type: "system" }],
              pagination: { has_more: false },
            } as T;
          }
          if (method === "c4a_store_read") {
            return {
              entity: {
                uuid: "uuid-1",
                id: "order",
                type: "system",
                data: { id: "order", type: "system", name: "Order" },
              },
            } as T;
          }
          return {} as T;
        },
      }),
      resolveC4aConfig: async () => config,
      confirm: async () => true,
      log: () => undefined,
      error: () => undefined,
    });

    const updated = await readFile(join(workspace, ".context", ".c4a.yaml"), "utf-8");
    expect(updated).toContain("version: 1.2.0");
    const outputPath = join(workspace, getEntityPath("order", "system"));
    const dslContent = await readFile(outputPath, "utf-8");
    expect(dslContent).toContain("name: Order");
    expect(calls.filter((call) => call === "c4a_store_read").length).toBe(1);
  });

  test("pull outputs json and writes files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "c4a-version-"));
    await mkdir(join(workspace, ".context"), { recursive: true });
    await writeFile(
      join(workspace, ".context", ".c4a.yaml"),
      "root_id: root-1\nversion: 1.0.0\nmode: local\n",
      "utf-8",
    );

    const logs: string[] = [];
    const config: C4aConfig = {
      rootDir: workspace,
      configSource: "yaml",
      rootId: "root-1",
      version: "1.0.0",
      mode: "local",
      autoPull: false,
      hasContextDir: true,
    };

    await versionCommand(["pull", "--json"], {
      createMcpClient: () => ({
        request: async <T>(method: string) => {
          if (method === "c4a_store_list") {
            return {
              items: [{ uuid: "uuid-1", id: "order", type: "system" }],
              pagination: { has_more: false },
            } as T;
          }
          if (method === "c4a_store_read") {
            return {
              entity: {
                uuid: "uuid-1",
                id: "order",
                type: "system",
                data: { id: "order", type: "system", name: "Order" },
              },
            } as T;
          }
          return {} as T;
        },
      }),
      resolveC4aConfig: async () => config,
      confirm: async () => false,
      log: (message) => logs.push(message),
      error: () => undefined,
    });

    const payload = JSON.parse(logs[0] ?? "{}");
    expect(payload.version).toBe("1.0.0");
    expect(payload.root_id).toBe("root-1");
    expect(payload.entities).toBe(1);

    const outputPath = join(workspace, getEntityPath("order", "system"));
    const dslContent = await readFile(outputPath, "utf-8");
    expect(dslContent).toContain("name: Order");
  });

  test("pull returns error when config missing", async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message ?? ""));
    };

    try {
      await versionCommand(["pull"], {
        createMcpClient: () => ({ request: async <T>() => ({}) as T }),
        resolveC4aConfig: async () => null,
        confirm: async () => false,
        log: () => undefined,
        error: () => undefined,
      });
    } finally {
      console.error = originalError;
    }

    expect(errors.join("\n")).toContain("C4A-VER-999");
  });

  test("placeholder subcommands log not implemented", async () => {
    const logs: string[] = [];
    await versionCommand(["create", "1.0.0"], {
      createMcpClient: () => ({ request: async <T>() => ({}) as T }),
      resolveC4aConfig: async () => null,
      confirm: async () => false,
      log: (message) => logs.push(message),
      error: () => undefined,
    });

    expect(logs.join("\n")).toContain("尚未实现");
  });
});
