import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAjv, clearCache } from '../ajvInstance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_DIR = join(__dirname, '../../schemas');

describe('ajvInstance schema loading', () => {
  test('loads all schema files in schemas directory', () => {
    clearCache();
    const ajv = getAjv();
    const schemaFiles = readdirSync(SCHEMA_DIR)
      .filter(file => file.endsWith('.schema.json'))
      .sort();

    for (const file of schemaFiles) {
      const schemaPath = join(SCHEMA_DIR, file);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as { $id?: string };
      expect(schema.$id).toBeTruthy();
      const validator = ajv.getSchema(schema.$id!);
      expect(validator).toBeTruthy();
    }
  });
});
