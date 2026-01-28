import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Index } from 'usearch';

export type VectorStoreConfig = {
  dimensions: number;
  indexPath: string;
  keyMapPath: string;
  metric?: 'cos' | 'l2' | 'ip';
  readonly?: boolean;
};

export type VectorSearchHit = {
  key: string;
  distance: number;
};

type KeyMapFile = {
  version: 1;
  nextKey: string;
  entries: Array<[string, string]>;
};

export class VectorStore {
  private index: Index;
  private keyMap: Map<bigint, string> = new Map();
  private reverseMap: Map<string, bigint> = new Map();
  private nextKey: bigint = 1n;
  private readonly: boolean;
  private indexPath: string;
  private keyMapPath: string;
  private config: { dimensions: number; metric: 'cos' | 'l2' | 'ip' };

  constructor(config: VectorStoreConfig) {
    this.config = {
      dimensions: config.dimensions,
      metric: config.metric ?? 'cos',
    };
    this.index = new Index(this.config);
    this.indexPath = config.indexPath;
    this.keyMapPath = config.keyMapPath;
    this.readonly = config.readonly ?? false;

    this.ensureDir(this.indexPath);
    this.ensureDir(this.keyMapPath);
    this.load();
  }

  size(): number {
    return this.keyMap.size;
  }

  has(entityKey: string): boolean {
    return this.reverseMap.has(entityKey);
  }

  add(entityKey: string, embedding: Float32Array): void {
    const existing = this.reverseMap.get(entityKey);
    const key = existing ?? this.allocateKey();

    if (existing) {
      try {
        this.index.remove(key);
      } catch {
        // 忽略移除失败
      }
    }

    this.index.add(key, embedding);

    if (!existing) {
      this.keyMap.set(key, entityKey);
      this.reverseMap.set(entityKey, key);
    }
  }

  remove(entityKey: string): void {
    const key = this.reverseMap.get(entityKey);
    if (!key) return;

    try {
      this.index.remove(key);
    } catch {
      // 忽略移除失败
    }

    this.reverseMap.delete(entityKey);
    this.keyMap.delete(key);
  }

  search(queryVector: Float32Array, limit: number): VectorSearchHit[] {
    let raw: unknown;
    try {
      raw = this.index.search(queryVector, limit) as unknown;
    } catch {
      return [];
    }
    const { keys, distances } = this.normalizeSearchResult(raw);

    const size = Math.min(keys.length, distances.length);
    const hits: VectorSearchHit[] = [];
    for (let i = 0; i < size; i += 1) {
      const key = this.toBigInt(keys[i]);
      const entityKey = this.keyMap.get(key);
      if (!entityKey) continue;
      hits.push({ key: entityKey, distance: Number(distances[i]) });
    }
    return hits;
  }

  save(): void {
    if (this.readonly) return;
    this.index.save(this.indexPath);
    this.saveKeyMap();
  }

  load(): void {
    if (existsSync(this.indexPath)) {
      this.index.load(this.indexPath);
    }
    if (existsSync(this.keyMapPath)) {
      this.loadKeyMap();
    }
  }

  rebuild(entities: Array<{ key: string; embedding: Float32Array }>): void {
    this.index = new Index(this.config);
    this.keyMap.clear();
    this.reverseMap.clear();
    this.nextKey = 1n;

    for (const entity of entities) {
      this.add(entity.key, entity.embedding);
    }

    this.save();
  }

  private allocateKey(): bigint {
    const key = this.nextKey;
    this.nextKey += 1n;
    return key;
  }

  private ensureDir(path: string): void {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private saveKeyMap(): void {
    const entries = Array.from(this.keyMap.entries()).map(([key, value]) => [
      key.toString(),
      value,
    ]) as Array<[string, string]>;
    const data: KeyMapFile = {
      version: 1,
      nextKey: this.nextKey.toString(),
      entries,
    };
    writeFileSync(this.keyMapPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private loadKeyMap(): void {
    try {
      const raw = readFileSync(this.keyMapPath, 'utf-8');
      const parsed = JSON.parse(raw) as KeyMapFile;
      this.keyMap.clear();
      this.reverseMap.clear();
      for (const [keyString, value] of parsed.entries) {
        const key = BigInt(keyString);
        this.keyMap.set(key, value);
        this.reverseMap.set(value, key);
      }
      this.nextKey = parsed.nextKey ? BigInt(parsed.nextKey) : 1n;
    } catch {
      // 映射文件损坏则降级为空索引
      this.keyMap.clear();
      this.reverseMap.clear();
      this.nextKey = 1n;
    }
  }

  private normalizeSearchResult(raw: unknown): { keys: Array<unknown>; distances: Array<unknown> } {
    if (Array.isArray(raw)) {
      return {
        keys: Array.from(raw[0] ?? []),
        distances: Array.from(raw[1] ?? []),
      };
    }

    if (raw && typeof raw === 'object') {
      const record = raw as { keys?: Iterable<unknown>; distances?: Iterable<unknown> };
      return {
        keys: Array.from(record.keys ?? []),
        distances: Array.from(record.distances ?? []),
      };
    }

    return { keys: [], distances: [] };
  }

  private toBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.trunc(value));
    if (typeof value === 'string') return BigInt(value);
    return BigInt(0);
  }
}
