/**
 * 配置工具单元测试
 * 基于 v0.3.0 架构设计：.context/.c4a.yaml
 */

import { describe, expect, test } from 'bun:test';
import { validateConfig, getDefaultConfig, type C4AConfig } from '../config';

describe('getDefaultConfig', () => {
  test('returns default config with local mode', () => {
    const config = getDefaultConfig();
    expect(config.mode).toBe('local');
  });
});

describe('validateConfig', () => {
  test('validates valid local config', () => {
    const config: C4AConfig = {
      repo_id: 'company/my-repo',
      project_id: 'my-project',
      mode: 'local',
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validates valid server config', () => {
    const config: C4AConfig = {
      repo_id: 'company/my-repo',
      project_id: 'my-project',
      mode: 'server',
      server: {
        url: 'http://localhost:8050',
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validates valid remote config', () => {
    const config: C4AConfig = {
      repo_id: 'company/my-repo',
      project_id: 'my-project',
      mode: 'remote',
      remote: {
        url: 'https://c4a.example.com:8050',
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
