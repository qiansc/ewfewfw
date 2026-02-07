import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

const TMP_DIR = join(process.cwd(), '.tmp');

export function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

export function createTempPath(prefix: string, ext: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return join(TMP_DIR, `${prefix}-${suffix}.${ext}`);
}

export function cleanupTmpFiles(tmpFiles: string[]): void {
  for (const file of tmpFiles) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  }
}

interface EntityRow {
  id: string;
  root_id: string;
  requirement_id: string | null;
  type: string;
  kind: string | null;
  scope: string | null;
  perspective: string | null;
  data: string;
}

interface MetadataRow {
  entity_id: string;
  root_id: string;
  requirement_id: string | null;
  source_repo: string | null;
  status: string;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: string;
  requirement_id: string | null;
  from_root_id: string | null;
  from_id: string;
  to_root_id: string | null;
  to_id: string;
  rel_type: string;
  status: string | null;
  properties: string | null;
}

interface FeatRow {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  created_by: string | null;
  checklist: string | null;
  created_at: string;
  updated_at: string;
}

export class FakeDatabase {
  entities: EntityRow[] = [];
  metadata: MetadataRow[] = [];
  relations: RelationRow[] = [];
  feats: FeatRow[] = [];

  prepare(sql: string): any {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.includes('FROM entities e') && normalized.includes('JOIN metadata')) {
      return {
        all: () => {
          return this.entities
            .map((entity) => {
              const meta = this.metadata.find(
                (m) =>
                  m.root_id === entity.root_id &&
                  m.entity_id === entity.id &&
                  m.requirement_id === entity.requirement_id
              );
              if (!meta) return null;
              return {
                id: entity.id,
                type: entity.type,
                kind: entity.kind,
                scope: entity.scope,
                perspective: entity.perspective,
                root_id: entity.root_id,
                requirement_id: entity.requirement_id,
                data: entity.data,
                source_repo: meta.source_repo,
                status: meta.status,
                content_hash: meta.content_hash ?? '',
                created_at: meta.created_at,
                updated_at: meta.updated_at,
              };
            })
            .filter(Boolean) as unknown[];
        },
      };
    }

    if (normalized.startsWith('SELECT id, requirement_id') && normalized.includes('FROM relations')) {
      return {
        all: () => this.relations.map((relation) => ({ ...relation })),
      };
    }

    if (normalized.startsWith('SELECT id, status') && normalized.includes('FROM feats')) {
      return {
        all: () => this.feats.map((feat) => ({ ...feat })),
      };
    }

    if (normalized.startsWith('SELECT updated_at FROM feats WHERE id = ?')) {
      return {
        get: (id: string) => {
          const row = this.feats.find((feat) => feat.id === id);
          return row ? { updated_at: row.updated_at } : undefined;
        },
      };
    }

    if (normalized.startsWith('SELECT content_hash, updated_at FROM metadata')) {
      return {
        get: (rootId: string, entityId: string, requirementId?: string | null) => {
          const row = this.metadata.find(
            (item) =>
              item.root_id === rootId &&
              item.entity_id === entityId &&
              (requirementId === undefined
                ? item.requirement_id === '' || item.requirement_id === null
                : item.requirement_id === requirementId)
          );
          return row
            ? {
                content_hash: row.content_hash ?? '',
                updated_at: row.updated_at,
              }
            : undefined;
        },
      };
    }

    if (normalized.startsWith('INSERT INTO feats')) {
      return {
        run: (
          id: string,
          status: string,
          title: string | null,
          description: string | null,
          createdBy: string | null,
          checklist: string | null,
          createdAt: string,
          updatedAt: string
        ) => {
          this.feats.push({
            id,
            status,
            title,
            description,
            created_by: createdBy,
            checklist,
            created_at: createdAt,
            updated_at: updatedAt,
          });
        },
      };
    }

    if (normalized.startsWith('INSERT INTO entities')) {
      return {
        run: (
          id: string,
          rootId: string,
          requirementId: string | null,
          type: string,
          kind: string | null,
          scope: string | null,
          perspective: string | null,
          data: string
        ) => {
          this.entities.push({
            id,
            root_id: rootId,
            requirement_id: requirementId,
            type,
            kind,
            scope,
            perspective,
            data,
          });
        },
      };
    }

    if (normalized.startsWith('UPDATE entities SET')) {
      return {
        run: (
          type: string,
          kind: string | null,
          scope: string | null,
          perspective: string | null,
          data: string,
          rootId: string,
          id: string,
          requirementId?: string | null
        ) => {
          const row = this.entities.find(
            (item) =>
              item.root_id === rootId &&
              item.id === id &&
              (requirementId === undefined
                ? item.requirement_id === '' || item.requirement_id === null
                : item.requirement_id === requirementId)
          );
          if (row) {
            row.type = type;
            row.kind = kind;
            row.scope = scope;
            row.perspective = perspective;
            row.data = data;
          }
        },
      };
    }

    if (normalized.startsWith('INSERT INTO metadata')) {
      return {
        run: (
          entityId: string,
          rootId: string,
          requirementId: string | null,
          sourceRepo: string | null,
          status: string,
          contentHash: string | null,
          createdAt: string,
          updatedAt: string
        ) => {
          this.metadata.push({
            entity_id: entityId,
            root_id: rootId,
            requirement_id: requirementId,
            source_repo: sourceRepo,
            status,
            content_hash: contentHash,
            created_at: createdAt,
            updated_at: updatedAt,
          });
        },
      };
    }

    if (normalized.startsWith('UPDATE metadata SET source_repo')) {
      return {
        run: (
          sourceRepo: string | null,
          status: string,
          contentHash: string | null,
          updatedAt: string,
          rootId: string,
          entityId: string,
          requirementId?: string | null
        ) => {
          const row = this.metadata.find(
            (item) =>
              item.entity_id === entityId &&
              item.root_id === rootId &&
              (requirementId === undefined
                ? item.requirement_id === '' || item.requirement_id === null
                : item.requirement_id === requirementId)
          );
          if (row) {
            row.source_repo = sourceRepo;
            row.status = status;
            row.content_hash = contentHash;
            row.updated_at = updatedAt;
          }
        },
      };
    }

    if (normalized.startsWith('UPDATE metadata')) {
      return {
        run: (updatedAt: string, entityId: string, rootId: string) => {
          const row = this.metadata.find(
            (item) => item.entity_id === entityId && item.root_id === rootId
          );
          if (row) {
            row.updated_at = updatedAt;
          }
        },
      };
    }

    if (normalized.startsWith('UPDATE feats')) {
      return {
        run: (
          status: string,
          title: string,
          description: string,
          createdBy: string | null,
          checklist: string | null,
          updatedAt: string,
          id: string
        ) => {
          const row = this.feats.find((item) => item.id === id);
          if (row) {
            row.status = status;
            row.title = title;
            row.description = description;
            row.created_by = createdBy;
            row.checklist = checklist;
            row.updated_at = updatedAt;
          }
        },
      };
    }

    if (normalized.startsWith('DELETE FROM feats')) {
      return {
        run: (id: string) => {
          this.feats = this.feats.filter((item) => item.id !== id);
        },
      };
    }

    if (normalized.startsWith('DELETE FROM relations')) {
      return {
        run: () => {
          this.relations = [];
        },
      };
    }

    if (normalized.startsWith('INSERT OR REPLACE INTO relations')) {
      return {
        run: (
          id: string,
          requirementId: string | null,
          fromRootId: string | null,
          fromId: string,
          toRootId: string | null,
          toId: string,
          relType: string,
          status: string | null,
          properties: string | null
        ) => {
          const index = this.relations.findIndex((item) => item.id === id);
          const record: RelationRow = {
            id,
            requirement_id: requirementId,
            from_root_id: fromRootId,
            from_id: fromId,
            to_root_id: toRootId,
            to_id: toId,
            rel_type: relType,
            status,
            properties,
          };
          if (index >= 0) {
            this.relations[index] = record;
          } else {
            this.relations.push(record);
          }
        },
      };
    }

    throw new Error(`Unsupported SQL: ${normalized}`);
  }
}

export class FakeStore {
  constructor(private db: FakeDatabase) {}

  getDatabase(): FakeDatabase {
    return this.db;
  }

  isVectorSearchEnabled(): boolean {
    return false;
  }

  async rebuildVectorIndex(): Promise<{ total: number; indexed: number; skipped: number }> {
    return { total: 0, indexed: 0, skipped: 0 };
  }
}
