import { describe, expect, test } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectConfig,
  saveProjectConfig,
  getInstalledModes,
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

describe("config", () => {
  test("global config roundtrip and installed modes", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("cli-config-home", async (dir) => {
      process.env.C4A_HOME = dir;
      await saveGlobalConfig({ local: { installed_at: "2026-01-01T00:00:00Z" } });
      const loaded = await loadGlobalConfig();
      expect(loaded?.local?.installed_at).toBe("2026-01-01T00:00:00Z");
      expect(getInstalledModes(loaded)).toEqual(["local"]);

      const configPath = join(dir, ".c4a", "config.yaml");
      const content = await readFile(configPath, "utf-8");
      expect(content).toContain("installed_at");
    });
    process.env.C4A_HOME = previousHome;
  });

  test("project config roundtrip", async () => {
    await withTempDir("cli-config-project", async (dir) => {
      const previousCwd = process.cwd();
      process.chdir(dir);
      try {
        await saveProjectConfig({
          root_id: "my-project",
          repo_id: "company/my-repo",
          mode: "local",
          skills: { cursor: true },
        });
        const loaded = await loadProjectConfig();
        expect(loaded?.root_id).toBe("my-project");
        expect(loaded?.repo_id).toBe("company/my-repo");
        expect(loaded?.skills?.cursor).toBe(true);
      } finally {
        process.chdir(previousCwd);
      }
    });
  });
});
