import { describe, expect, test } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { initCommand } from "../commands/init.js";
import { loadProjectConfig } from "../core/config.js";

interface PrompterState {
  inputs: string[];
  confirms: boolean[];
  selects: string[];
}

function createPrompter(state: PrompterState) {
  return {
    input: async (_label: string, options?: { defaultValue?: string }) => {
      const value = state.inputs.shift();
      if (value === undefined) {
        throw new Error("缺少输入响应");
      }
      if (value === "" && options?.defaultValue) {
        return options.defaultValue;
      }
      return value;
    },
    confirm: async (_label: string, defaultValue = false) => {
      const value = state.confirms.shift();
      return value ?? defaultValue;
    },
    select: async <T extends string>(
      _label: string,
      _options: Array<{ label: string; value: T }>,
      defaultIndex = 0
    ): Promise<T> => {
      const value = state.selects.shift();
      if (value) {
        return value as T;
      }
      return _options[defaultIndex].value;
    },
    close: () => {},
  };
}

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

describe("initCommand", () => {
  test("writes project config and cursor templates", async () => {
    const previousHome = process.env.HOME;
    await withTempDir("cli-init", async (dir) => {
      process.env.HOME = dir;
      const previousCwd = process.cwd();
      process.chdir(dir);
      try {
        const prompter = createPrompter({
          inputs: ["my-project", "", "https://c4a.example.com:8055"],
          confirms: [false, false],
          selects: ["remote", "cursor"],
        });

        await initCommand([], {
          prompter,
          detectGitRemote: async () => "https://github.com/company/my-repo",
          loadGlobalConfig: async () => null,
        });

        const projectConfig = await loadProjectConfig();
        expect(projectConfig?.project_id).toBe("my-project");
        expect(projectConfig?.repo_id).toBe("https://github.com/company/my-repo");
        expect(projectConfig?.mode).toBe("remote");
        expect(projectConfig?.remote?.url).toBe("https://c4a.example.com:8055");

        const cursorConfigPath = join(dir, ".cursor", "mcp.json");
        const cursorConfig = JSON.parse(await readFile(cursorConfigPath, "utf-8"));
        expect(cursorConfig.mcpServers["c4a-store-mcp"].url).toBe(
          "https://c4a.example.com:8055/mcp"
        );

        const rulesContent = await readFile(join(dir, ".cursorrules"), "utf-8");
        expect(rulesContent).toContain("c4a sync");
      } finally {
        process.chdir(previousCwd);
      }
    });
    process.env.HOME = previousHome;
  });
});
