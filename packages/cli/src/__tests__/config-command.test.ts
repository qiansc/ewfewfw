import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { configCommand } from "../commands/config.js";
import {
  getGlobalConfigPath,
  loadGlobalConfig,
  saveGlobalConfig,
} from "../core/config.js";

async function withTempDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const tmpRoot = join(process.cwd(), ".tmp");
  await mkdir(tmpRoot, { recursive: true });
  const dir = join(tmpRoot, `${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("configCommand", () => {
  test("config set updates global config", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("cli-config-set", async (dir) => {
      process.env.C4A_HOME = dir;
      await configCommand(["set", "--mode=remote", "--server_url=http://example.com:8055"], {
        io: { log: () => {}, error: () => {} },
        checkServerUrl: async () => true,
        ensureLocalStore: async () => {},
      });

      const config = await loadGlobalConfig();
      expect(config?.mode).toBe("remote");
      expect(config?.server_url).toBe("http://example.com:8055");
      expect(config?.local?.db_path).toContain(".c4a");
    });
    process.env.C4A_HOME = previousHome;
  });

  test("config mode switches via prompt", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("cli-config-mode", async (dir) => {
      process.env.C4A_HOME = dir;
      const prompter = {
        input: async () => "http://localhost:8055",
        confirm: async () => true,
        select: async <T extends string>() => "remote" as T,
      };

      await configCommand(["mode"], {
        io: { log: () => {}, error: () => {} },
        prompter,
        checkServerUrl: async () => true,
        ensureLocalStore: async () => {},
      });

      const config = await loadGlobalConfig();
      expect(config?.mode).toBe("remote");
    });
    process.env.C4A_HOME = previousHome;
  });

  test("config reset removes config file", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("cli-config-reset", async (dir) => {
      process.env.C4A_HOME = dir;
      await saveGlobalConfig({
        version: "0.3.2",
        mode: "local",
        server_url: "http://localhost:8055",
        local: { db_path: join(dir, ".c4a", "store.db") },
      });

      const prompter = {
        input: async () => "",
        confirm: async () => true,
        select: async <T extends string>() => "local" as T,
      };

      await configCommand(["reset"], {
        io: { log: () => {}, error: () => {} },
        prompter,
      });

      const config = await loadGlobalConfig();
      expect(config).toBeNull();

      const configPath = getGlobalConfigPath();
      expect(configPath).toContain(".c4a");
    });
    process.env.C4A_HOME = previousHome;
  });
});
