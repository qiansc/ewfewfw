/**
 * 配置工具单元测试
 * 基于 v0.3.0 架构设计：.context/.c4a.yaml
 */

import { describe, expect, test } from 'bun:test';
import { validateConfig, getDefaultConfig, loadConfig, type C4AConfig } from '../config.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('getDefaultConfig', () => {
  test('returns default config with local mode', () => {
    const config = getDefaultConfig();
    expect(config.mode).toBe('local');
  });
});

describe('validateConfig', () => {
  test('validates valid local config', () => {
    const config: C4AConfig = {
      root_id: '@acme/payment-service',
      version: '1.0.0',
      mode: 'local',
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validates valid server config', () => {
    const config: C4AConfig = {
      root_id: '@acme/payment-service',
      version: '1.0.0',
      mode: 'server',
      server: {
        url: 'http://localhost:8055',
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validates valid remote config', () => {
    const config: C4AConfig = {
      root_id: '@acme/payment-service',
      version: '1.0.0',
      mode: 'remote',
      remote: {
        url: 'https://c4a.example.com:8055',
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects invalid mode', () => {
    const config = {
      mode: 'invalid' as any,
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid mode: invalid');
  });

  test('rejects server mode without url', () => {
    const config: C4AConfig = {
      mode: 'server',
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Server mode requires server.url');
  });

  test('rejects remote mode without url', () => {
    const config: C4AConfig = {
      mode: 'remote',
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Remote mode requires remote.url');
  });

  test('accepts empty config', () => {
    const config: C4AConfig = {};
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });
});

describe('loadConfig', () => {
  const TMP_ROOT = join(process.cwd(), '.tmp', 'config-tests');

  test('returns default config when file is missing', async () => {
    const root = join(TMP_ROOT, `missing-${Date.now()}`);
    const config = await loadConfig(root);
    expect(config.mode).toBe('local');
  });

  test('throws on invalid YAML', async () => {
    const root = join(TMP_ROOT, `invalid-${Date.now()}`);
    const contextDir = join(root, '.context');
    mkdirSync(contextDir, { recursive: true });
    const configPath = join(contextDir, '.c4a.yaml');
    writeFileSync(configPath, 'mode: [local', 'utf-8');

    await expect(loadConfig(root)).rejects.toBeTruthy();

    rmSync(root, { recursive: true, force: true });
  });
});
