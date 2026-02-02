/**
 * get-adapter 配置加载测试
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAdapter, loadConfig, resetAdapter } from "../get-adapter.js";

async function withTempDir(fn: (dir: string) => void | Promise<void>): Promise<void> {
  const root = join(tmpdir(), "c4a-config-tests");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "c4a-config-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadConfig", () => {
  test("loads .context/.c4a.yaml when present", async () => {
    await withTempDir((dir) => {
      const contextDir = join(dir, ".context");
      mkdirSync(contextDir, { recursive: true });
      writeFileSync(
        join(contextDir, ".c4a.yaml"),
        "mode: server\nserver:\n  url: http://localhost:8055\n",
        "utf-8",
      );

      const config = loadConfig(dir);
      expect(config.mode).toBe("server");
      expect(config.server?.url).toBe("http://localhost:8055");
    });
  });

  test("ignores legacy .context/.c4a.yml", async () => {
    await withTempDir((dir) => {
      const previous = process.env.C4A_STORAGE_BACKEND_URL;
      delete process.env.C4A_STORAGE_BACKEND_URL;
      try {
        const contextDir = join(dir, ".context");
        mkdirSync(contextDir, { recursive: true });
        writeFileSync(
          join(contextDir, ".c4a.yml"),
          "mode: server\nserver:\n  url: http://localhost:8055\n",
          "utf-8",
        );

        const config = loadConfig(dir);
        expect(config.mode).toBe("local");
        expect(config.server?.url).toBeUndefined();
      } finally {
        if (previous === undefined) {
          delete process.env.C4A_STORAGE_BACKEND_URL;
        } else {
          process.env.C4A_STORAGE_BACKEND_URL = previous;
        }
      }
    });
  });

  test("searches parent directories for .context/.c4a.yaml", async () => {
    await withTempDir((dir) => {
      const contextDir = join(dir, ".context");
      const nestedDir = join(dir, "packages", "mcp-store");
      mkdirSync(contextDir, { recursive: true });
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(
        join(contextDir, ".c4a.yaml"),
        "mode: server\nserver:\n  url: http://localhost:8055\n",
        "utf-8",
      );

      const config = loadConfig(nestedDir);
      expect(config.mode).toBe("server");
      expect(config.server?.url).toBe("http://localhost:8055");
    });
  });

  test("uses C4A_STORAGE_BACKEND_URL when config missing", async () => {
    await withTempDir((dir) => {
      const nestedDir = join(dir, "packages", "mcp-store");
      mkdirSync(nestedDir, { recursive: true });
      const previous = process.env.C4A_STORAGE_BACKEND_URL;
      process.env.C4A_STORAGE_BACKEND_URL = "http://localhost:8055";
      try {
        const config = loadConfig(nestedDir);
        expect(config.mode).toBe("server");
        expect(config.server?.url).toBe("http://localhost:8055");
      } finally {
        if (previous === undefined) {
          delete process.env.C4A_STORAGE_BACKEND_URL;
        } else {
          process.env.C4A_STORAGE_BACKEND_URL = previous;
        }
      }
    });
  });
});

describe("getAdapter", () => {
  test("recreates adapter when local config changes", async () => {
    await withTempDir(async (dir) => {
      const dbPathA = join(dir, "a.db");
      const dbPathB = join(dir, "b.db");
      const adapterA = await getAdapter({
        basePath: dir,
        config: {
          dbPath: dbPathA,
          defaultProject: "alpha",
          enableVectorSearch: false,
        },
      }) as { config?: { dbPath?: string } };
      const adapterB = await getAdapter({
        basePath: dir,
        config: {
          dbPath: dbPathB,
          defaultProject: "alpha",
          enableVectorSearch: false,
        },
      }) as { config?: { dbPath?: string } };

      expect(adapterA).not.toBe(adapterB);
      expect(adapterB.config?.dbPath).toBe(dbPathB);
      resetAdapter();
    });
  });
});
