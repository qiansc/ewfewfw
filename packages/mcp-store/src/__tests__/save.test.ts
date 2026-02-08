import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

describe("storeSaveHandler", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    resetAdapter();
  });

  afterEach(() => {
    resetAdapter();
    process.chdir(originalCwd);
  });

  test("ignores versions field and returns warning", async () => {
    await withTempDir("mcp-save", async (dir) => {
      process.chdir(dir);
      await writeLocalConfig(dir, "root-1");

      const result = await storeSaveHandler({
        type: "system",
        data: {
          id: "order",
          name: "Order",
          versions: ["1.0.0"],
        },
      });

      expect(result.success).toBe(true);
      expect(result.warnings?.[0]?.code).toBe("C4A-VERSION-IGNORED");
      expect((result.entity as { data?: Record<string, unknown> }).data?.versions).toBeUndefined();
    });
  });
});
