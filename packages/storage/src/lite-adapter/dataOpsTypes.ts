import type { SQLiteStore } from '../sqlite-store.js';
import type { FeatRecord } from '../data-ops/types.js';

export type Database = ReturnType<SQLiteStore['getDatabase']>;
export type GetFeat = (featId: string) => FeatRecord | null;
