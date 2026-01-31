import { describe, expect, test } from "bun:test";
import { rm, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGitRemote } from "../utils/git.js";

async function withOsTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(previousCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

describe("detectGitRemote", () => {
  test("returns null when no git repo", async () => {
    await withOsTempDir("c4a-cli-git-", async () => {
      const previousGitDir = process.env.GIT_DIR;
      const previousWorkTree = process.env.GIT_WORK_TREE;
      process.env.GIT_DIR = undefined;
      process.env.GIT_WORK_TREE = undefined;
      try {
        const result = await detectGitRemote();
        expect(result).toBeNull();
      } finally {
        process.env.GIT_DIR = previousGitDir;
        process.env.GIT_WORK_TREE = previousWorkTree;
      }
    });
  });

  test("returns remote url when repo configured", async () => {
    if (spawnSync("git", ["--version"]).status !== 0) {
      return;
    }
    await withOsTempDir("c4a-cli-git-remote-", async (dir) => {
      const previousGitDir = process.env.GIT_DIR;
      const previousWorkTree = process.env.GIT_WORK_TREE;
      process.env.GIT_DIR = undefined;
      process.env.GIT_WORK_TREE = undefined;
      spawnSync("git", ["init"], { cwd: dir });
      spawnSync("git", ["remote", "add", "origin", "https://example.com/demo.git"], { cwd: dir });
      try {
        const result = await detectGitRemote();
        expect(result).toBe("https://example.com/demo.git");
      } finally {
        process.env.GIT_DIR = previousGitDir;
        process.env.GIT_WORK_TREE = previousWorkTree;
      }
    });
  });
});
