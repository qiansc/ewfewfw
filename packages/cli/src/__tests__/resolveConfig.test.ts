import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveC4aConfig } from "../utils/resolveConfig.js";

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

describe("resolveC4aConfig", () => {
  test("prefers .context/.c4a.yaml and merges global defaults", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("resolve-config-yaml", async (dir) => {
      const homeDir = join(dir, "home");
      await mkdir(join(homeDir, ".c4a"), { recursive: true });
      await writeFile(
        join(homeDir, ".c4a", "config.yaml"),
        ["mode: remote", "server_url: http://global.example", ""].join("\n"),
        "utf-8",
      );
      process.env.C4A_HOME = homeDir;

      const projectDir = join(dir, "project");
      await mkdir(join(projectDir, ".context"), { recursive: true });
      await writeFile(
        join(projectDir, ".context", ".c4a.yaml"),
        ["root_id: my-project", "version: 1.2.3", "auto_pull: true", ""].join("\n"),
        "utf-8",
      );
      const nestedDir = join(projectDir, "src", "nested");
      await mkdir(nestedDir, { recursive: true });

      const resolved = await resolveC4aConfig(nestedDir);
      expect(resolved).not.toBeNull();
      expect(resolved?.configSource).toBe("yaml");
      expect(resolved?.hasContextDir).toBe(true);
      expect(resolved?.rootDir).toBe(projectDir);
      expect(resolved?.rootId).toBe("my-project");
      expect(resolved?.version).toBe("1.2.3");
      expect(resolved?.autoPull).toBe(true);
      expect(resolved?.mode).toBe("remote");
      expect(resolved?.serverUrl).toBe("http://global.example");
    });
    process.env.C4A_HOME = previousHome;
  });

  test("reads package.json config and falls back to global server_url", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("resolve-config-pkg", async (dir) => {
      const homeDir = join(dir, "home");
      await mkdir(join(homeDir, ".c4a"), { recursive: true });
      await writeFile(
        join(homeDir, ".c4a", "config.yaml"),
        ["mode: local", "server_url: http://global.example", ""].join("\n"),
        "utf-8",
      );
      process.env.C4A_HOME = homeDir;

      const projectDir = join(dir, "project");
      await mkdir(projectDir, { recursive: true });
      const pkg = {
        name: "my-package",
        c4a: {
          root_id: "pkg-root",
          mode: "remote",
          server_url: "",
        },
      };
      await writeFile(join(projectDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");

      const resolved = await resolveC4aConfig(projectDir);
      expect(resolved).not.toBeNull();
      expect(resolved?.configSource).toBe("package.json");
      expect(resolved?.hasContextDir).toBe(false);
      expect(resolved?.rootDir).toBe(projectDir);
      expect(resolved?.rootId).toBe("pkg-root");
      expect(resolved?.version).toBe("0.0.0");
      expect(resolved?.autoPull).toBe(false);
      expect(resolved?.mode).toBe("remote");
      expect(resolved?.serverUrl).toBe("http://global.example");
    });
    process.env.C4A_HOME = previousHome;
  });

  test("returns null when no config found", async () => {
    const rootDir = process.platform === "win32" ? "C:\\" : "/";
    const resolved = await resolveC4aConfig(rootDir);
    expect(resolved).toBeNull();
  });
});
