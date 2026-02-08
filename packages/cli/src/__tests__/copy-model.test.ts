import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MODEL_SEGMENTS,
  encodePath,
  findModelDirBySearch,
  isModelDir,
  resolveModelDirFromBase,
} from "../../scripts/copy-model.js";

async function withTempDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function createModelDir(baseDir: string): Promise<string> {
  const modelDir = join(baseDir, ...MODEL_SEGMENTS, "onnx");
  await mkdir(modelDir, { recursive: true });
  await writeFile(join(modelDir, "model.onnx"), "");
  return join(baseDir, ...MODEL_SEGMENTS);
}

describe("copy-model helpers", () => {
  test("encodePath encodes path segments", () => {
    const encoded = encodePath("a b/c+d");
    expect(encoded).toBe("a%20b/c%2Bd");
  });

  test("resolveModelDirFromBase finds nested model dir", async () => {
    await withTempDir("copy-model-resolve", async (dir) => {
      const nested = await createModelDir(dir);
      const resolved = resolveModelDirFromBase(dir);
      expect(resolved).toBe(nested);
    });
  });

  test("isModelDir detects model dir", async () => {
    await withTempDir("copy-model-isdir", async (dir) => {
      const nested = await createModelDir(dir);
      expect(isModelDir(nested)).toBe(true);
    });
  });

  test("findModelDirBySearch finds model dir within depth", async () => {
    await withTempDir("copy-model-search", async (dir) => {
      const nestedBase = join(dir, "cache", "huggingface");
      const nested = await createModelDir(nestedBase);
      const found = await findModelDirBySearch(dir, 4);
      expect(found).toBe(nested);
    });
  });
});
