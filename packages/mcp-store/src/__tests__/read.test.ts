import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { storeReadHandler } from "../tools/read.js";
import { storeSaveHandler } from "../tools/save.js";
import { resetAdapter } from "@c4a/storage";

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

async function writeLocalConfig(rootDir: string, rootId: string): Promise<void> {
  const contextDir = join(rootDir, ".context");
  await mkdir(contextDir, { recursive: true });
  const config = [
    "mode: local",
    `root_id: ${rootId}`,
    "local:",
    `  dbPath: ${join(".context", "c4a-test.db")}`,
    `  defaultProject: ${rootId}`,
    "",
  ].join("\n");
  await writeFile(join(contextDir, ".c4a.yaml"), config, "utf-8");
}

describe("storeReadHandler", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    resetAdapter();
  });

  afterEach(() => {
    resetAdapter();
    process.chdir(originalCwd);
  });

  test("throws when include_versions with non-object format", async () => {
    await withTempDir("mcp-read-format", async (dir) => {
      process.chdir(dir);
      await writeLocalConfig(dir, "root-1");

      let error: unknown;
      try {
        await storeReadHandler({
          id: "order",
          root_id: "root-1",
          include_versions: true,
          format: "yaml",
        });
      } catch (err) {
        error = err;
      }

      expect((error as { code?: string })?.code).toBe("C4A-INPUT-002");
    });
  });

  test("throws when missing id and uuid", async () => {
    await withTempDir("mcp-read-missing", async (dir) => {
      process.chdir(dir);
      await writeLocalConfig(dir, "root-1");

      let error: unknown;
      try {
        await storeReadHandler({ root_id: "root-1" });
      } catch (err) {
        error = err;
      }

      expect((error as { code?: string })?.code).toBe("C4A-INPUT-001");
    });
  });

  test("include_versions returns array of entities", async () => {
    await withTempDir("mcp-read-versions", async (dir) => {
      process.chdir(dir);
      await writeLocalConfig(dir, "root-1");

      await storeSaveHandler({
        type: "system",
        data: { id: "order", name: "Order" },
      });

      const result = await storeReadHandler({
        id: "order",
        root_id: "root-1",
        include_versions: true,
        format: "object",
      });

      expect(Array.isArray(result)).toBe(true);
      expect((result as Array<{ id?: string }>)[0]?.id).toBe("order");
    });
  });
});
