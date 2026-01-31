import { describe, expect, test } from "bun:test";
import { installCommand } from "../commands/install.js";
import type { GlobalConfig } from "../core/config.js";

function createPrompter(confirmValue = true) {
  return {
    select: async <T extends string>(
      _label: string,
      options: Array<{ label: string; value: T }>,
      defaultIndex = 0,
    ): Promise<T> => options[defaultIndex].value,
    confirm: async () => confirmValue,
    close: () => {},
  };
}

describe("installCommand", () => {
  test("local install writes global config and initializes dependencies", async () => {
    const previousHome = process.env.C4A_HOME;
    process.env.C4A_HOME = "/tmp/c4a-test-home";

    let capturedConfig: GlobalConfig | null = null;
    let capturedDbPath: string | null = null;
    let downloadCalled = false;

    await installCommand(["local"], {
      io: { log: () => {}, error: () => {} },
      prompter: createPrompter(),
      now: () => new Date("2026-01-01T00:00:00Z"),
      loadGlobalConfig: async () => ({}),
      saveGlobalConfig: async (config) => {
        capturedConfig = config;
      },
      ensureDir: async () => {},
      createLocalDb: async (dbPath) => {
        capturedDbPath = dbPath;
      },
      downloadEmbeddingModel: async () => {
        downloadCalled = true;
      },
    });

    expect(capturedConfig?.version).toBe("0.3.0");
    expect(capturedConfig?.local?.installed_at).toBe("2026-01-01T00:00:00.000Z");
    expect(capturedConfig?.local?.embedding_model).toBe("all-MiniLM-L6-v2");
    expect(capturedDbPath).toContain("/tmp/c4a-test-home/.c4a/store.db");
    expect(downloadCalled).toBe(true);

    process.env.C4A_HOME = previousHome;
  });

  test("remote project mode prompts for switch and cancels when declined", async () => {
    let createDbCalled = false;
    let saveCalled = false;

    await installCommand(["local"], {
      io: { log: () => {}, error: () => {} },
      prompter: createPrompter(false),
      loadProjectConfig: async () => ({ mode: "remote", remote: { url: "https://c4a.example.com" } }),
      loadGlobalConfig: async () => ({}),
      saveGlobalConfig: async () => {
        saveCalled = true;
      },
      ensureDir: async () => {},
      createLocalDb: async () => {
        createDbCalled = true;
      },
      downloadEmbeddingModel: async () => {},
    });

    expect(createDbCalled).toBe(false);
    expect(saveCalled).toBe(false);
  });

  test("local install preserves existing server config (multi-mode)", async () => {
    let capturedConfig: GlobalConfig | null = null;

    await installCommand(["local"], {
      io: { log: () => {}, error: () => {} },
      prompter: createPrompter(),
      now: () => new Date("2026-01-02T00:00:00Z"),
      loadGlobalConfig: async () => ({
        server: {
          installed_at: "2026-01-01T00:00:00Z",
          url: "http://localhost:8050",
        },
      }),
      saveGlobalConfig: async (config) => {
        capturedConfig = config;
      },
      ensureDir: async () => {},
      createLocalDb: async () => {},
      downloadEmbeddingModel: async () => {},
    });

    expect(capturedConfig?.server?.installed_at).toBe("2026-01-01T00:00:00Z");
    expect(capturedConfig?.local?.installed_at).toBe("2026-01-02T00:00:00.000Z");
  });

  test("remote selection preserves installed modes", async () => {
    let capturedConfig: GlobalConfig | null = null;

    await installCommand(["remote"], {
      io: { log: () => {}, error: () => {} },
      prompter: createPrompter(),
      now: () => new Date("2026-01-03T00:00:00Z"),
      loadGlobalConfig: async () => ({
        local: { installed_at: "2026-01-01T00:00:00Z" },
        server: { installed_at: "2026-01-02T00:00:00Z" },
      }),
      saveGlobalConfig: async (config) => {
        capturedConfig = config;
      },
    });

    expect(capturedConfig?.remote?.selected_at).toBe("2026-01-03T00:00:00.000Z");
    expect(capturedConfig?.local?.installed_at).toBe("2026-01-01T00:00:00Z");
    expect(capturedConfig?.server?.installed_at).toBe("2026-01-02T00:00:00Z");
  });
});
