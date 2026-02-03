import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { cmdBuild } from "../commands/build.js";

const ROOT_DIR = resolve(process.cwd());
const TMP_ROOT = join(ROOT_DIR, ".tmp", "cli-dev-build-tests", randomUUID());
const CLI_DIR = join(TMP_ROOT, "packages", "cli");
const DIST_DIR = join(CLI_DIR, "dist");
const SKILLS_SRC = join(TMP_ROOT, "prompts", "skills");
const SCHEMAS_SRC = join(TMP_ROOT, "packages", "core", "src", "schemas");

beforeAll(() => {
  mkdirSync(join(CLI_DIR, "dist"), { recursive: true });
  mkdirSync(SKILLS_SRC, { recursive: true });
  mkdirSync(SCHEMAS_SRC, { recursive: true });

  writeFileSync(join(SKILLS_SRC, "demo.md"), "# demo\n", "utf-8");
  writeFileSync(join(SCHEMAS_SRC, "demo.schema.json"), "{\"title\": \"demo\"}", "utf-8");

  writeFileSync(
    join(CLI_DIR, "package.json"),
    JSON.stringify(
      {
        name: "@c4a/cli",
        version: "0.1.0",
        dependencies: {
          "@c4a/core": "workspace:*",
          "@c4a/storage": "workspace:*",
          "left-pad": "^1.0.0",
        },
      },
      null,
      2
    ),
    "utf-8"
  );
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("cli-dev build command", () => {
  test("cmdBuild assembles dist artifacts", async () => {
    const logs: { info: string[]; warn: string[]; success: string[]; error: string[] } = {
      info: [],
      warn: [],
      success: [],
      error: [],
    };
    let buildCalled = false;
    let depsRequested: string[] | null = null;

    await cmdBuild([], {
      projectRoot: TMP_ROOT,
      checkDependencies: async (required) => {
        depsRequested = required;
        return true;
      },
      runForeground: async (command, args, options) => {
        if (command === "bun" && args.join(" ") === "run build" && options?.cwd === CLI_DIR) {
          buildCalled = true;
          mkdirSync(DIST_DIR, { recursive: true });
          writeFileSync(join(DIST_DIR, "index.js"), "console.log('ok');\n", "utf-8");
        }
      },
      info: (msg) => logs.info.push(msg),
      success: (msg) => logs.success.push(msg),
      warn: (msg) => logs.warn.push(msg),
      error: (msg) => logs.error.push(msg),
      blue: (msg) => msg,
      green: (msg) => msg,
      confirm: async () => false,
      waitForInput: async () => "",
    });

    expect(buildCalled).toBe(true);
    const requested: string[] = depsRequested ?? [];
    expect(requested).toEqual(["bun"]);

    const distIndex = join(DIST_DIR, "index.js");
    const distPkg = JSON.parse(readFileSync(join(DIST_DIR, "package.json"), "utf-8"));

    expect(readFileSync(distIndex, "utf-8").startsWith("#!/usr/bin/env bun")).toBe(true);
    expect(distPkg.dependencies).toEqual({ "left-pad": "^1.0.0" });
    expect(existsSync(join(DIST_DIR, "skills", "demo.md"))).toBe(true);
    expect(existsSync(join(DIST_DIR, "schemas", "demo.schema.json"))).toBe(true);

    const mode = statSync(distIndex).mode & 0o111;
    expect(mode).toBeGreaterThan(0);

    const yogaDest = join(DIST_DIR, "yoga.wasm");
    expect(existsSync(yogaDest) || logs.warn.some((msg) => msg.includes("yoga.wasm"))).toBe(true);
  });
});
