import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadGlobalConfig } from "../core/config.js";
import { runFirstRunGuide } from "../core/firstRun.js";

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

describe("firstRun", () => {
  test("runFirstRunGuide writes global config", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("cli-first-run", async (dir) => {
      process.env.C4A_HOME = dir;
      const prompter = {
        input: async () => "",
        confirm: async () => true,
        select: async <T extends string>() => "local" as T,
      };

      await runFirstRunGuide({
        io: { log: () => {}, error: () => {} },
        prompter,
        ensureLocalStore: async () => {},
      });

      const config = await loadGlobalConfig();
      expect(config?.mode).toBe("local");
      expect(config?.version).toBe("0.3.2");
    });
    process.env.C4A_HOME = previousHome;
  });
});
