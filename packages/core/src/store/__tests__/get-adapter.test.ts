/**
 * get-adapter 配置加载测试
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../get-adapter.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "c4a-config-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadConfig", () => {
  test("loads .context/.c4a.yaml when present", () => {
    withTempDir((dir) => {
      const contextDir = join(dir, ".context");
      mkdirSync(contextDir, { recursive: true });
      writeFileSync(
        join(contextDir, ".c4a.yaml"),
        "mode: server\nserver:\n  url: http://localhost:8050\n",
        "utf-8",
      );

      const config = loadConfig(dir);
      expect(config.mode).toBe("server");
      expect(config.server?.url).toBe("http://localhost:8050");
    });
  });

  test("ignores legacy .context/.c4a.yml", () => {
    withTempDir((dir) => {
      const contextDir = join(dir, ".context");
      mkdirSync(contextDir, { recursive: true });
      writeFileSync(
        join(contextDir, ".c4a.yml"),
        "mode: server\nserver:\n  url: http://localhost:8050\n",
        "utf-8",
      );

      const config = loadConfig(dir);
      expect(config.mode).toBe("local");
      expect(config.server?.url).toBeUndefined();
    });
  });
});
