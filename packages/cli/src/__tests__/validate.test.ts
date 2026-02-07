import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateCommand } from "../commands/validate.js";

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const root = join(process.cwd(), ".tmp");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "c4a-cli-validate-"));
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

describe("validateCommand", () => {
  test("outputs JSON summary with errors", async () => {
    await withTempDir(async (dir) => {
      const systemDir = join(dir, ".context", "technical", "systems");
      const containerDir = join(dir, ".context", "technical", "containers");
      mkdirSync(systemDir, { recursive: true });
      mkdirSync(containerDir, { recursive: true });

      writeFileSync(
        join(systemDir, "demo.yaml"),
        "schema: c4a/v1\ntype: software-system\nsystem:\n  id: demo-system\n  name: Demo\n  description: Demo system\n  scope: project\n",
        "utf-8",
      );

      writeFileSync(
        join(containerDir, "bad.yaml"),
        "schema: c4a/v1\ntype: container\ncontainer:\n  id: bad-container\n  name: Bad\n  description: Bad\n  scope: project\n  system_id: missing-system\n",
        "utf-8",
      );

      const logs: string[] = [];
      const deps = {
        loadProjectConfig: async () => ({ root_id: "demo", repo_id: "acme/demo" }),
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      };

      await validateCommand(["--format=json"], deps);

      const output = JSON.parse(logs.join("\n"));
      expect(output.summary.errors).toBeGreaterThan(0);
      expect(output.results[0].issues.length).toBeGreaterThan(0);
      process.exitCode = 0;
    });
  });

  test("strict mode returns warning exit code", async () => {
    await withTempDir(async (dir) => {
      const featDir = join(dir, ".context", "feat", "feat-a001-test");
      mkdirSync(featDir, { recursive: true });
      writeFileSync(
        join(featDir, "feat.yaml"),
        [
          "type: feat",
          "uuid: 11111111-1111-4111-8111-111111111111",
          "root_id: \"\"",
          "versions:",
          "  - 0.0.0",
          "id: feat-a001-test",
          "name: Test",
          "status: draft",
          "scope: project",
          "related_adrs:",
          "  - adr-a001-missing",
          "",
        ].join("\n"),
        "utf-8",
      );

      const logs: string[] = [];
      const deps = {
        loadProjectConfig: async () => ({ root_id: "demo" }),
        log: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      };

      process.exitCode = undefined;
      await validateCommand(["--strict"], deps);
      expect(process.exitCode ?? 0).toBe(2);
      process.exitCode = 0;
    });
  });

  
});
