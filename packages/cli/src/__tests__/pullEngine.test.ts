import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeContentHash, getEntityPath } from "@c4a/core";
import type { C4aConfig } from "../utils/resolveConfig.js";
import { pullVersion } from "../core/pullEngine.js";

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

function getWorkspaceDir(projectDir: string, homeDir: string): string {
  const absolutePath = resolve(projectDir);
  const hash = createHash("sha256").update(absolutePath).digest("hex").slice(0, 16);
  return join(homeDir, ".c4a", "tmp", hash);
}

describe("pullVersion", () => {
  test("writes DSL files, clears old files, and updates sync state in remote mode", async () => {
    const previousHome = process.env.C4A_HOME;
    await withTempDir("pull-engine-remote", async (dir) => {
      const homeDir = join(dir, "home");
      process.env.C4A_HOME = homeDir;

      const projectDir = join(dir, "project");
      await mkdir(join(projectDir, ".context", "technical", "systems"), { recursive: true });
      await writeFile(join(projectDir, ".context", ".c4a.yaml"), "root_id: my-project\n", "utf-8");
      await writeFile(
        join(projectDir, ".context", "technical", "systems", "old.c4a.yaml"),
        "type: system\nid: old\n",
        "utf-8",
      );

      const entityData = {
        id: "sys-one",
        type: "system",
        name: "System One",
      };

      const client: { request: <T>(method: string, params: unknown) => Promise<T> } = {
        async request<T>(method: string, params: unknown): Promise<T> {
          if (method === "c4a_store_list") {
            const payload = params as { count_only?: boolean };
            if (payload.count_only) {
              return { total: 1 } as T;
            }
            return {
              items: [{ uuid: "u1", id: "sys-one", type: "system", content_hash: "hash" }],
              pagination: { has_more: false },
            } as T;
          }
          if (method === "c4a_store_read") {
            return {
              entity: {
                uuid: "u1",
                id: "sys-one",
                type: "system",
                data: entityData,
              },
            } as T;
          }
          throw new Error(`unexpected method: ${method}`);
        },
      };

      const config: C4aConfig = {
        rootDir: projectDir,
        configSource: "yaml",
        rootId: "my-project",
        version: "1.0.0",
        mode: "remote",
        autoPull: false,
        serverUrl: "http://example",
        hasContextDir: true,
      };

      const result = await pullVersion({
        client,
        config,
        confirmCreateContext: async () => true,
      });

      const newPath = join(projectDir, getEntityPath("sys-one", "system"));
      expect(existsSync(newPath)).toBe(true);
      expect(existsSync(join(projectDir, ".context", "technical", "systems", "old.c4a.yaml"))).toBe(
        false,
      );
      expect(existsSync(join(projectDir, ".context", ".c4a.yaml"))).toBe(true);

      const workspaceDir = getWorkspaceDir(projectDir, homeDir);
      const syncStatePath = join(workspaceDir, ".sync-state.json");
      expect(existsSync(syncStatePath)).toBe(true);
      const snapshot = JSON.parse(await readFile(syncStatePath, "utf-8")) as {
        version: string;
        entities: Record<string, { content_hash: string }>;
      };
      expect(snapshot.version).toBe("1.0.0");
      expect(snapshot.entities["sys-one"].content_hash).toBe(computeContentHash(entityData));
      expect(result.syncStateUpdated).toBe(true);
    });
    if (previousHome === undefined) {
      delete process.env.C4A_HOME;
    } else {
      process.env.C4A_HOME = previousHome;
    }
  });

  test("cancels pull when minimal mode declines creating .context", async () => {
    await withTempDir("pull-engine-minimal", async (dir) => {
      const projectDir = join(dir, "project");
      await mkdir(projectDir, { recursive: true });

      const client: { request: <T>(method: string, params: unknown) => Promise<T> } = {
        async request<T>(): Promise<T> {
          throw new Error("should not be called");
        },
      };

      const config: C4aConfig = {
        rootDir: projectDir,
        configSource: "package.json",
        rootId: "my-project",
        version: "0.0.0",
        mode: "local",
        autoPull: false,
        hasContextDir: false,
      };

      const result = await pullVersion({
        client,
        config,
        confirmCreateContext: async () => false,
      });

      expect(result.canceled).toBe(true);
      expect(existsSync(join(projectDir, ".context"))).toBe(false);
    });
  });

  test("creates .context in minimal mode when confirmed", async () => {
    await withTempDir("pull-engine-minimal-confirm", async (dir) => {
      const projectDir = join(dir, "project");
      await mkdir(projectDir, { recursive: true });

      const client: { request: <T>(method: string, params: unknown) => Promise<T> } = {
        async request<T>(method: string): Promise<T> {
          if (method === "c4a_store_list") {
            return {
              items: [],
              pagination: { has_more: false },
            } as T;
          }
          throw new Error("should not be called");
        },
      };

      const config: C4aConfig = {
        rootDir: projectDir,
        configSource: "package.json",
        rootId: "my-project",
        version: "0.0.0",
        mode: "local",
        autoPull: false,
        hasContextDir: false,
      };

      const result = await pullVersion({
        client,
        config,
        confirmCreateContext: async () => true,
      });

      expect(result.canceled).toBe(false);
      expect(existsSync(join(projectDir, ".context"))).toBe(true);
    });
  });

  test("pulls specified version and validates existence", async () => {
    await withTempDir("pull-engine-version", async (dir) => {
      const projectDir = join(dir, "project");
      await mkdir(join(projectDir, ".context", "technical", "systems"), { recursive: true });
      await writeFile(join(projectDir, ".context", ".c4a.yaml"), "root_id: my-project\n", "utf-8");

      let countOnlyCalled = false;
      const client: { request: <T>(method: string, params: unknown) => Promise<T> } = {
        async request<T>(method: string, params: unknown): Promise<T> {
          if (method === "c4a_store_list") {
            const payload = params as { count_only?: boolean; version?: string };
            expect(payload.version).toBe("2.0.0");
            if (payload.count_only) {
              countOnlyCalled = true;
              return { total: 1 } as T;
            }
            return {
              items: [{ uuid: "u2", id: "sys-two", type: "system" }],
              pagination: { has_more: false },
            } as T;
          }
          if (method === "c4a_store_read") {
            return {
              entity: {
                uuid: "u2",
                id: "sys-two",
                type: "system",
                data: { id: "sys-two", type: "system", name: "System Two" },
              },
            } as T;
          }
          throw new Error(`unexpected method: ${method}`);
        },
      };

      const config: C4aConfig = {
        rootDir: projectDir,
        configSource: "yaml",
        rootId: "my-project",
        version: "1.0.0",
        mode: "local",
        autoPull: false,
        hasContextDir: true,
      };

      const result = await pullVersion({
        client,
        config,
        version: "2.0.0",
        confirmCreateContext: async () => true,
      });

      expect(result.version).toBe("2.0.0");
      expect(countOnlyCalled).toBe(true);
    });
  });
});
