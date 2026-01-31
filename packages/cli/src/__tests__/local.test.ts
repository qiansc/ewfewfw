import { describe, expect, test } from "bun:test";
import { localCommand } from "../commands/local.js";

describe("localCommand", () => {
  const loadGlobalConfig = async () => ({
    local: { installed_at: "2026-01-01T00:00:00Z" },
  });

  test("backup uses default output when not provided", async () => {
    const backupCalls: Array<{ output: string }> = [];
    const adapterFactory = () =>
      ({
        initialize: async () => {},
        close: async () => {},
        backup: async (params: { output: string }) => {
          backupCalls.push(params);
          return { success: true, file: params.output };
        },
      }) as any;

    await localCommand(["backup"], {
      adapterFactory,
      loadGlobalConfig,
      emitError: () => {},
    });

    expect(backupCalls).toHaveLength(1);
    expect(backupCalls[0].output.startsWith("c4a-backup-")).toBe(true);
  });

  test("clean removes db and vector files", async () => {
    const removed: string[] = [];
    const fileOps = {
      existsSync: () => true,
      stat: async () => ({ size: 0, mtime: new Date() }),
      rm: async (path: string) => {
        removed.push(path);
      },
    } as any;

    await localCommand(["clean", "--yes"], {
      loadGlobalConfig,
      fileOps,
      resolveDbPath: () => "/tmp/store.db",
      emitError: () => {},
    });

    expect(removed).toContain("/tmp/store.db");
    expect(removed).toContain("/tmp/c4a.usearch");
    expect(removed).toContain("/tmp/c4a.keymap.json");
  });

  test("status prints db stats and counts", async () => {
    const logs: string[] = [];
    const adapterFactory = () =>
      ({
        initialize: async () => {},
        close: async () => {},
        list: async ({ group_by }: { group_by: string }) => {
          if (group_by === "type") {
            return { groups: { system: { count: 2 } } };
          }
          return { groups: { published: { count: 1 } } };
        },
      }) as any;

    await localCommand(["status"], {
      adapterFactory,
      loadGlobalConfig: async () => ({ local: { installed_at: "2026-01-01T00:00:00Z" } }),
      resolveDbPath: () => "/tmp/store.db",
      fileOps: {
        existsSync: () => true,
        stat: async () => ({ size: 2048, mtime: new Date("2026-01-01T00:00:00Z") }),
        rm: async () => {},
      },
      io: {
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
      emitError: () => {},
    });

    const output = logs.join("\n");
    expect(output).toContain("数据库: /tmp/store.db");
    expect(output).toContain("system: 2");
    expect(output).toContain("published: 1");
  });
});
