import { describe, expect, test } from "bun:test";
import { statusCommand } from "../commands/status.js";
import type { ProjectConfig } from "../core/config.js";
import type { McpTransport } from "../core/mcp-client.js";

type McpClientLike = {
  request: <T>(method: string, params: unknown) => Promise<T>;
};

describe("statusCommand", () => {
  test("prints config, stats, and skills", async () => {
    const logs: string[] = [];
    const deps = {
      loadGlobalConfig: async () => ({ local: { installed_at: "2026-01-01T00:00:00Z" } }),
      loadProjectConfig: async () =>
        ({
          project_id: "demo",
          repo_id: "acme/demo",
          mode: "remote",
          remote: { url: "https://c4a.example.com:8050" },
          skills: { cursor: true, claude: false, opencode: true },
        }) satisfies ProjectConfig,
      createMcpClient: (_options: { baseUrl?: string; transport?: McpTransport }): McpClientLike => ({
        request: async <T>() =>
          ({
            groups: {
              system: { count: 1 },
              container: { count: 2 },
            },
          }) as T,
      }),
      now: () => 1000,
      log: (message: string) => logs.push(message),
      error: (message: string) => logs.push(message),
    };

    await statusCommand([], deps);

    const output = logs.join("\n");
    expect(output).toContain("已安装模式: Local");
    expect(output).toContain("项目 ID: demo");
    expect(output).toContain("System: 1 个");
    expect(output).toContain("Container: 2 个");
    expect(output).toContain("Cursor: ✅ 已配置");
    expect(output).toContain("Claude Code: ❌ 未配置");
  });
});
