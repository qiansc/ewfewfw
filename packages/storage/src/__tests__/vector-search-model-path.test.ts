import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveLocalModelBasePath } from '../vector-search.js';

const ENV_KEY = 'C4A_MODELS_DIR';
let tempDir = '';

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  }
  delete process.env[ENV_KEY];
});

describe('resolveLocalModelBasePath', () => {
  test('prefers C4A_MODELS_DIR when model exists', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'c4a-models-'));
    const modelDir = join(tempDir, 'Xenova', 'all-MiniLM-L6-v2', 'onnx');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'model.onnx'), '');

    process.env[ENV_KEY] = tempDir;

    const resolved = resolveLocalModelBasePath();
    expect(resolved).toBe(tempDir);
  });
});
