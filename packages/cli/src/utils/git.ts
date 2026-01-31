import { spawnSync } from "node:child_process";

export async function detectGitRemote(): Promise<string | null> {
  try {
    const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    if (inside.status !== 0) {
      return null;
    }
    if (inside.stdout.trim() !== "true") {
      return null;
    }

    const result = spawnSync("git", ["config", "--get", "remote.origin.url"], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    if (result.status !== 0) {
      return null;
    }
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
