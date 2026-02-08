import type { SQLiteStore } from '../sqlite-store.js';

export type Database = ReturnType<SQLiteStore['getDatabase']>;
