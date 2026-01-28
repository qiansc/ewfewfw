import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { VectorStore } from '../usearch-store.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'vector-store-tests');
const INDEX_PATH = join(TMP_ROOT, 'test.usearch');
const KEYMAP_PATH = join(TMP_ROOT, 'test.keymap.json');

function makeVector(values: number[], dimensions = 3): Float32Array {
  const vector = new Float32Array(dimensions);
  values.forEach((value, index) => {
    vector[index] = value;
  });
  return vector;
}

function cleanup() {
  if (existsSync(TMP_ROOT)) {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  }
}

afterAll(() => {
  cleanup();
});

describe('VectorStore', () => {
  test('add and search vectors', () => {
    cleanup();
    const store = new VectorStore({
      dimensions: 3,
      indexPath: INDEX_PATH,
      keyMapPath: KEYMAP_PATH,
    });

    store.add('entity-a', makeVector([1, 0, 0]));
    store.add('entity-b', makeVector([0, 1, 0]));

    const hits = store.search(makeVector([1, 0, 0]), 2);
    const keys = hits.map(hit => hit.key);

    expect(keys).toContain('entity-a');
    expect(store.size()).toBe(2);
  });

  test('remove vector by entity id', () => {
    cleanup();
    const store = new VectorStore({
      dimensions: 3,
      indexPath: INDEX_PATH,
      keyMapPath: KEYMAP_PATH,
    });

    store.add('entity-a', makeVector([1, 0, 0]));
    store.add('entity-b', makeVector([0, 1, 0]));
    store.remove('entity-a');

    const hits = store.search(makeVector([1, 0, 0]), 2);
    const keys = hits.map(hit => hit.key);

    expect(keys).not.toContain('entity-a');
    expect(store.size()).toBe(1);
  });

  test('persist and reload index', () => {
    cleanup();
    const store = new VectorStore({
      dimensions: 3,
      indexPath: INDEX_PATH,
      keyMapPath: KEYMAP_PATH,
    });

    store.add('entity-a', makeVector([1, 0, 0]));
    store.save();

    const reloaded = new VectorStore({
      dimensions: 3,
      indexPath: INDEX_PATH,
      keyMapPath: KEYMAP_PATH,
    });

    const hits = reloaded.search(makeVector([1, 0, 0]), 1);
    expect(hits.map(hit => hit.key)).toContain('entity-a');
  });

  test('rebuild index from entities', () => {
    cleanup();
    const store = new VectorStore({
      dimensions: 3,
      indexPath: INDEX_PATH,
      keyMapPath: KEYMAP_PATH,
    });

    store.rebuild([
      { key: 'entity-a', embedding: makeVector([1, 0, 0]) },
      { key: 'entity-b', embedding: makeVector([0, 1, 0]) },
    ]);

    const hits = store.search(makeVector([0, 1, 0]), 1);
    expect(hits.map(hit => hit.key)).toContain('entity-b');
  });

  test('handle duplicate entity ids', () => {
    cleanup();
    const store = new VectorStore({
      dimensions: 3,
      indexPath: INDEX_PATH,
      keyMapPath: KEYMAP_PATH,
    });

    store.add('entity-a', makeVector([1, 0, 0]));
    store.add('entity-a', makeVector([1, 0, 0]));

    expect(store.size()).toBe(1);
  });
});
