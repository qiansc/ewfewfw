import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { VectorStore } from '../packages/storage/src/usearch-store.js';
import { generateVectorKey, getEmbeddingDimension } from '../packages/storage/src/vector-search.js';

type VectorRow = {
  vector_key?: string;
  entity_id: string;
  source_project: string | null;
  proposal_id: string | null;
  embedding: unknown;
};

function toFloat32Array(value: unknown): Float32Array {
  if (value instanceof Float32Array) {
    return value;
  }
  if (value instanceof Uint8Array) {
    const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return new Float32Array(buffer);
  }
  if (Array.isArray(value)) {
    return new Float32Array(value as number[]);
  }
  if (typeof value === 'string') {
    return new Float32Array(JSON.parse(value) as number[]);
  }
  throw new Error('Unsupported embedding format');
}

function getVectorsColumns(db: Database): string[] {
  const columns = db.prepare('PRAGMA table_info(vectors);').all() as Array<{ name: string }>;
  return columns.map((column) => column.name);
}

function main(): void {
  const dbPath = process.argv[2];
  if (!dbPath) {
    // eslint-disable-next-line no-console
    console.error('Usage: bun run scripts/migrate-vectors.ts <path-to-db>');
    process.exit(1);
  }

  const resolvedDbPath = resolve(dbPath);
  if (!existsSync(resolvedDbPath)) {
    // eslint-disable-next-line no-console
    console.error(`Database not found: ${resolvedDbPath}`);
    process.exit(1);
  }

  const db = new Database(resolvedDbPath, { readonly: false, fileMustExist: true });
  const columns = getVectorsColumns(db);
  if (columns.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('vectors 表不存在，跳过迁移');
    return;
  }

  const hasVectorKey = columns.includes('vector_key');
  const selectColumns = hasVectorKey
    ? 'vector_key, entity_id, source_project, proposal_id, embedding'
    : 'entity_id, source_project, proposal_id, embedding';

  const rows = db.prepare(`SELECT ${selectColumns} FROM vectors`).all() as VectorRow[];

  const baseDir = dirname(resolvedDbPath);
  const vectorStore = new VectorStore({
    dimensions: getEmbeddingDimension(),
    indexPath: resolve(baseDir, 'c4a.usearch'),
    keyMapPath: resolve(baseDir, 'c4a.keymap.json'),
  });

  for (const row of rows) {
    const sourceProject = row.source_project ?? '';
    const proposalId = row.proposal_id ?? '';
    const vectorKey = row.vector_key ?? generateVectorKey(sourceProject, row.entity_id, proposalId);
    const embedding = toFloat32Array(row.embedding);
    vectorStore.add(vectorKey, embedding);
  }

  vectorStore.save();
  db.exec('DROP TABLE IF EXISTS vectors;');
  db.close();

  // eslint-disable-next-line no-console
  console.log(`Migrated ${rows.length} vectors → c4a.usearch`);
}

main();
