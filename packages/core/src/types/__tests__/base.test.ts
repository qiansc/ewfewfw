/**
 * 基础类型与状态流转测试
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUSINESS_ENTITY_TYPES,
  DIR_TO_ENTITY_TYPE,
  ENTITY_TYPE_DEFS,
  ENTITY_TYPE_TO_DIR,
  SCHEMA_TYPES,
  SOR_ENTITY_TYPES,
  TECHNICAL_PERSPECTIVE_TYPES,
  isValidStatusTransition,
} from '../base.js';

describe('isValidStatusTransition', () => {
  test('allows expected transitions', () => {
    expect(isValidStatusTransition('draft', 'approved')).toBe(true);
    expect(isValidStatusTransition('deprecated', 'archived')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(isValidStatusTransition('draft', 'published')).toBe(false);
    expect(isValidStatusTransition('published', 'archived')).toBe(false);
  });
});

describe('entity type definitions', () => {
  test('ENTITY_TYPE_DEFS matches TYPE_TO_DIR and DIR_TO_ENTITY_TYPE', () => {
    for (const [type, def] of Object.entries(ENTITY_TYPE_DEFS)) {
      const typedType = type as keyof typeof ENTITY_TYPE_DEFS;
      expect(ENTITY_TYPE_TO_DIR[typedType]).toBe(def.dir);
      expect(DIR_TO_ENTITY_TYPE[def.dir]).toBe(typedType);
    }
  });

  test('directory names are unique', () => {
    const dirs = Object.values(ENTITY_TYPE_DEFS).map(def => def.dir);
    const uniqueDirs = new Set(dirs);
    expect(uniqueDirs.size).toBe(dirs.length);
  });

  test('entity type subsets stay within defined types', () => {
    const allTypes = new Set(Object.keys(ENTITY_TYPE_DEFS));
    for (const type of BUSINESS_ENTITY_TYPES) {
      expect(allTypes.has(type)).toBe(true);
    }
    for (const type of TECHNICAL_PERSPECTIVE_TYPES) {
      expect(allTypes.has(type)).toBe(true);
    }
    for (const type of SOR_ENTITY_TYPES) {
      expect(allTypes.has(type)).toBe(true);
    }
  });
});

describe('schema types coverage', () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const SCHEMA_DIR = join(__dirname, '../../schemas');

  test('SCHEMA_TYPES are covered by schema files', () => {
    const schemaFiles = readdirSync(SCHEMA_DIR).filter(file => file.endsWith('.schema.json'));
    const schemaTypes = new Set(
      schemaFiles.map(file => file.replace(/^c4a-/, '').replace(/\.schema\.json$/, '')),
    );

    for (const type of SCHEMA_TYPES) {
      expect(schemaTypes.has(type)).toBe(true);
    }
  });
});
