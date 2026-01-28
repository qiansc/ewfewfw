/**
 * Local Restore 流式解析
 */

import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type {
  ConflictPolicy,
  ExportEntity,
  ExportFeat,
  ExportRelation,
  RestoreProgress,
  RestoreResult,
} from './modeSwitchTypes.js';
import type { SQLiteStore } from './sqlite-store.js';

type ConflictEntry = NonNullable<RestoreResult['conflicts']>[number];
type RestoreEntityResult = { action: 'created' | 'updated' | 'skipped'; conflict?: ConflictEntry };
type RestoreFeatResult = { action: 'created' | 'updated' | 'skipped'; conflict?: ConflictEntry };

export type StreamRestoreHandlers = {
  validateEntity: (entity: unknown) => void;
  normalizeEntity: (entity: ExportEntity) => ExportEntity;
  restoreEntity: (
    db: ReturnType<SQLiteStore['getDatabase']>,
    entity: ExportEntity,
    policy: ConflictPolicy
  ) => Promise<RestoreEntityResult>;
  validateRelation: (relation: unknown) => void;
  normalizeRelation: (relation: ExportRelation) => ExportRelation;
  restoreRelation: (
    db: ReturnType<SQLiteStore['getDatabase']>,
    relation: ExportRelation,
    defaultProject: string
  ) => void;
  validateFeat: (feat: unknown) => void;
  restoreFeat: (
    db: ReturnType<SQLiteStore['getDatabase']>,
    feat: ExportFeat,
    policy: ConflictPolicy
  ) => RestoreFeatResult;
  isCompatibleVersion: (version: string) => boolean;
};

class JsonArrayStreamParser {
  private buffer = '';
  private inObject = false;
  private objectDepth = 0;
  private objectStart = 0;
  private inString = false;
  private escape = false;

  reset(): void {
    this.buffer = '';
    this.inObject = false;
    this.objectDepth = 0;
    this.objectStart = 0;
    this.inString = false;
    this.escape = false;
  }

  async feed(
    chunk: string,
    onItem: (item: unknown) => Promise<void> | void
  ): Promise<{ done: boolean; rest: string }> {
    this.buffer += chunk;
    let i = 0;
    while (i < this.buffer.length) {
      const ch = this.buffer[i];
      if (this.inObject) {
        if (this.inString) {
          if (this.escape) {
            this.escape = false;
          } else if (ch === '\\') {
            this.escape = true;
          } else if (ch === '"') {
            this.inString = false;
          }
        } else {
          if (ch === '"') {
            this.inString = true;
          } else if (ch === '{') {
            this.objectDepth += 1;
          } else if (ch === '}') {
            this.objectDepth -= 1;
            if (this.objectDepth === 0) {
              const raw = this.buffer.slice(this.objectStart, i + 1);
              const parsed = JSON.parse(raw) as unknown;
              await onItem(parsed);
              this.buffer = this.buffer.slice(i + 1);
              i = 0;
              this.inObject = false;
              continue;
            }
          }
        }
        i += 1;
        continue;
      }

      if (ch === '{') {
        this.inObject = true;
        this.objectDepth = 1;
        this.objectStart = i;
        this.inString = false;
        this.escape = false;
        i += 1;
        continue;
      }

      if (ch === ']') {
        const rest = this.buffer.slice(i + 1);
        this.buffer = '';
        return { done: true, rest };
      }

      i += 1;
    }

    return { done: false, rest: '' };
  }
}

function extractStringValue(source: string, key: string): string | null {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = source.match(pattern);
  if (!match) return null;
  return JSON.parse(`"${match[1]}"`) as string;
}

function findArrayStart(source: string, key: string): number | null {
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return null;
  const bracketIndex = source.indexOf('[', keyIndex);
  if (bracketIndex < 0) return null;
  return bracketIndex + 1;
}

export async function restoreFromStream(
  input: string,
  policy: ConflictPolicy,
  db: ReturnType<SQLiteStore['getDatabase']>,
  reportProgress: (phase: RestoreProgress['phase'], current: number, total: number, message?: string) => void,
  stats: RestoreResult['stats'],
  conflicts: RestoreResult['conflicts'],
  handlers: StreamRestoreHandlers
): Promise<void> {
  const stream = input.endsWith('.gz')
    ? createReadStream(input).pipe(createGunzip())
    : createReadStream(input);

  const parser = new JsonArrayStreamParser();
  let buffer = '';
  let version: string | null = null;
  let exportedAt: string | null = null;
  let state: 'header' | 'entities' | 'awaitRelations' | 'relations' | 'awaitFeats' | 'feats' | 'done' = 'header';
  let defaultProject = 'default';
  let hasDefaultProject = false;
  let entityIndex = 0;
  let relationIndex = 0;
  let featIndex = 0;

  const ensureHeader = (): void => {
    if (!version) throw new Error('Invalid export data: missing version');
    if (!exportedAt) throw new Error('Invalid export data: missing exported_at');
    if (!handlers.isCompatibleVersion(version)) {
      throw new Error(`Unsupported export version: ${version}`);
    }
  };

  for await (const chunk of stream) {
    buffer += chunk.toString('utf-8');
    let progressed = true;
    while (progressed) {
      progressed = false;

      if (state === 'header') {
        version = version ?? extractStringValue(buffer, 'version');
        exportedAt = exportedAt ?? extractStringValue(buffer, 'exported_at');
        const startIndex = findArrayStart(buffer, 'entities');
        if (startIndex !== null) {
          ensureHeader();
          buffer = buffer.slice(startIndex);
          state = 'entities';
          progressed = true;
        }
      }

      if (state === 'entities') {
        const result = await parser.feed(buffer, async (item) => {
          handlers.validateEntity(item);
          const normalized = handlers.normalizeEntity(item as ExportEntity);
          const restoreResult = await handlers.restoreEntity(db, normalized, policy);
          if (restoreResult.action === 'created') stats.entities.created++;
          else if (restoreResult.action === 'updated') stats.entities.updated++;
          else if (restoreResult.action === 'skipped') stats.entities.skipped++;
          if (restoreResult.conflict) {
            conflicts?.push(restoreResult.conflict);
          }
          entityIndex += 1;
          if (!hasDefaultProject) {
            defaultProject = normalized.metadata.source_project || 'default';
            hasDefaultProject = true;
          }
          reportProgress('entities', entityIndex, 0);
        });
        if (result.done) {
          buffer = result.rest;
          parser.reset();
          state = 'awaitRelations';
          progressed = true;
        } else {
          buffer = '';
        }
      }

      if (state === 'awaitRelations') {
        const startIndex = findArrayStart(buffer, 'relations');
        if (startIndex !== null) {
          buffer = buffer.slice(startIndex);
          state = 'relations';
          progressed = true;
        }
      }

      if (state === 'relations') {
        const result = await parser.feed(buffer, async (item) => {
          handlers.validateRelation(item);
          const normalized = handlers.normalizeRelation(item as ExportRelation);
          handlers.restoreRelation(db, normalized, defaultProject);
          stats.relations += 1;
          relationIndex += 1;
          reportProgress('relations', relationIndex, 0);
        });
        if (result.done) {
          buffer = result.rest;
          parser.reset();
          state = 'awaitFeats';
          progressed = true;
        } else {
          buffer = '';
        }
      }

      if (state === 'awaitFeats') {
        const startIndex = findArrayStart(buffer, 'feats');
        if (startIndex !== null) {
          buffer = buffer.slice(startIndex);
          state = 'feats';
          progressed = true;
        }
      }

      if (state === 'feats') {
        const result = await parser.feed(buffer, async (item) => {
          handlers.validateFeat(item);
          const feat = item as ExportFeat;
          const restoreResult = handlers.restoreFeat(db, feat, policy);
          if (restoreResult.action === 'created') stats.feats.created++;
          else if (restoreResult.action === 'updated') stats.feats.updated++;
          else if (restoreResult.action === 'skipped') stats.feats.skipped++;
          if (restoreResult.conflict) {
            conflicts?.push(restoreResult.conflict);
          }
          featIndex += 1;
          reportProgress('feats', featIndex, 0);
        });
        if (result.done) {
          buffer = result.rest;
          parser.reset();
          state = 'done';
          progressed = true;
        } else {
          buffer = '';
        }
      }
    }
  }

  if (state !== 'done') {
    throw new Error('Invalid export data: unexpected end of file');
  }
}
