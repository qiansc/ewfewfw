/**
 * 路径工具单元测试
 * 基于 v0.3.0 架构设计：.context/ + business/technical/feat 双视角结构
 */

import { describe, expect, test } from 'bun:test';
import {
  CONTEXT_ROOT_DIR,
  CONFIG_FILENAME,
  DSL_EXTENSION,
  TYPE_TO_DIR,
  getPerspective,
  getPerspectiveFromId,
  getEntityPath,
  getFeatPath,
  getConfigPath,
  getAssetsPath,
  parseEntityPath,
} from '../path.js';

describe('constants', () => {
  test('CONTEXT_ROOT_DIR is .context', () => {
    expect(CONTEXT_ROOT_DIR).toBe('.context');
  });

  test('CONFIG_FILENAME is .c4a.yaml', () => {
    expect(CONFIG_FILENAME).toBe('.c4a.yaml');
  });

  test('DSL_EXTENSION is .c4a.yaml', () => {
    expect(DSL_EXTENSION).toBe('.c4a.yaml');
  });

  test('TYPE_TO_DIR maps correctly', () => {
    expect(TYPE_TO_DIR.system).toBe('systems');
    expect(TYPE_TO_DIR.container).toBe('containers');
    expect(TYPE_TO_DIR.component).toBe('components');
    expect(TYPE_TO_DIR.adr).toBe('adrs');
    expect(TYPE_TO_DIR.product).toBe('products');
    expect(TYPE_TO_DIR.process).toBe('processes');
    expect(TYPE_TO_DIR.sor).toBe('sors');
  });
});

describe('getPerspective', () => {
  test('returns business for product', () => {
    expect(getPerspective('product')).toBe('business');
  });

  test('returns technical for system/container/component/adr/contract', () => {
    expect(getPerspective('system')).toBe('technical');
    expect(getPerspective('container')).toBe('technical');
    expect(getPerspective('component')).toBe('technical');
    expect(getPerspective('adr')).toBe('technical');
    expect(getPerspective('contract')).toBe('technical');
  });

  test('returns null for process/sor (needs ID prefix)', () => {
    expect(getPerspective('process')).toBeNull();
    expect(getPerspective('sor')).toBeNull();
  });
});

describe('getPerspectiveFromId', () => {
  test('returns business for prc-b/sor-b prefix', () => {
    expect(getPerspectiveFromId('prc-b-a001')).toBe('business');
    expect(getPerspectiveFromId('sor-b-a001')).toBe('business');
  });

  test('returns technical for prc-t/sor-t prefix', () => {
    expect(getPerspectiveFromId('prc-t-a001')).toBe('technical');
    expect(getPerspectiveFromId('sor-t-a001')).toBe('technical');
  });

  test('returns null for other IDs', () => {
    expect(getPerspectiveFromId('my-system')).toBeNull();
    expect(getPerspectiveFromId('feat-a001')).toBeNull();
  });
});

describe('getEntityPath', () => {
  test('generates technical path for system', () => {
    const path = getEntityPath('my-system', 'system');
    expect(path).toBe('.context/technical/systems/my-system.c4a.yaml');
  });

  test('generates technical path for container', () => {
    const path = getEntityPath('auth-service', 'container');
    expect(path).toBe('.context/technical/containers/auth-service.c4a.yaml');
  });

  test('generates technical path for adr', () => {
    const path = getEntityPath('adr-a001-init', 'adr');
    expect(path).toBe('.context/technical/adrs/adr-a001-init.c4a.yaml');
  });

  test('generates business path for product', () => {
    const path = getEntityPath('e-commerce', 'product');
    expect(path).toBe('.context/business/products/e-commerce.c4a.yaml');
  });

  test('generates business path for business process', () => {
    const path = getEntityPath('prc-b-a001', 'process');
    expect(path).toBe('.context/business/processes/prc-b-a001.c4a.yaml');
  });

  test('generates technical path for technical process', () => {
    const path = getEntityPath('prc-t-a001', 'process');
    expect(path).toBe('.context/technical/processes/prc-t-a001.c4a.yaml');
  });

  test('generates feat path for entity in feat', () => {
    const path = getEntityPath('auth-service', 'container', { featId: 'feat-a001-user-login' });
    expect(path).toBe('.context/feat/feat-a001-user-login/technical/containers/auth-service.c4a.yaml');
  });

  test('allows explicit perspective override', () => {
    const path = getEntityPath('my-sor', 'sor', { perspective: 'business' });
    expect(path).toBe('.context/business/sors/my-sor.c4a.yaml');
  });
});

describe('getFeatPath', () => {
  test('generates feat metadata path', () => {
    const path = getFeatPath('feat-a001-user-login');
    expect(path).toBe('.context/feat/feat-a001-user-login/feat.yaml');
  });
});

describe('getConfigPath', () => {
  test('generates config path', () => {
    const path = getConfigPath();
    expect(path).toBe('.context/.c4a.yaml');
  });
});

describe('getAssetsPath', () => {
  test('generates main branch assets path', () => {
    const path = getAssetsPath();
    expect(path).toBe('.context/assets');
  });

  test('generates feat assets path', () => {
    const path = getAssetsPath('feat-a001-user-login');
    expect(path).toBe('.context/feat/feat-a001-user-login/assets');
  });
});

describe('parseEntityPath', () => {
  test('parses technical entity path', () => {
    const result = parseEntityPath('.context/technical/systems/my-system.c4a.yaml');
    expect(result.valid).toBe(true);
    expect(result.id).toBe('my-system');
    expect(result.type).toBe('system');
    expect(result.perspective).toBe('technical');
    expect(result.featId).toBeNull();
  });

  test('parses business entity path', () => {
    const result = parseEntityPath('.context/business/products/e-commerce.c4a.yaml');
    expect(result.valid).toBe(true);
    expect(result.id).toBe('e-commerce');
    expect(result.type).toBe('product');
    expect(result.perspective).toBe('business');
    expect(result.featId).toBeNull();
  });

  test('parses feat entity path', () => {
    const result = parseEntityPath('.context/feat/feat-a001-user-login/technical/containers/auth-service.c4a.yaml');
    expect(result.valid).toBe(true);
    expect(result.id).toBe('auth-service');
    expect(result.type).toBe('container');
    expect(result.perspective).toBe('technical');
    expect(result.featId).toBe('feat-a001-user-login');
  });

  test('parses adr path', () => {
    const result = parseEntityPath('.context/technical/adrs/adr-a001-init.c4a.yaml');
    expect(result.valid).toBe(true);
    expect(result.id).toBe('adr-a001-init');
    expect(result.type).toBe('adr');
    expect(result.perspective).toBe('technical');
  });

  test('returns invalid for non-context path', () => {
    const result = parseEntityPath('/some/other/path.yaml');
    expect(result.valid).toBe(false);
  });

  test('returns invalid for wrong extension', () => {
    const result = parseEntityPath('.context/technical/systems/my-system.yaml');
    expect(result.valid).toBe(false);
  });

  test('handles empty input', () => {
    const result = parseEntityPath('');
    expect(result.valid).toBe(false);
  });

  test('handles absolute path with .context', () => {
    const result = parseEntityPath('/home/user/project/.context/technical/systems/my-system.c4a.yaml');
    expect(result.valid).toBe(true);
    expect(result.id).toBe('my-system');
    expect(result.type).toBe('system');
  });
});
