/**
 * 读取并归一化模式切换备份文件
 */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { ExportData, ExportEntity, ExportRelation, ExportFeat } from './modeSwitchTypes.js';
import { EXPORT_VERSION } from './modeSwitchTypes.js';
import { MigrationError } from './modeSwitchErrors.js';
import { normalizeExportData, validateExportData } from './modeSwitchRestoreNormalize.js';
import { computeChecksum } from './lite-adapter/utilsCommon.js';

type StoreBackupEntity = {
  id: string;
  type: string;
  root_id?: string;
  status?: string;
  data?: Record<string, unknown>;
  metadata?: {
    content_hash?: string;
    created_at?: string;
    updated_at?: string;
  };
};

type StoreBackupRelation = {
  id?: string | null;
  requirement_id?: string | null;
  from_root_id?: string | null;
  from_id: string;
  to_root_id?: string | null;
  to_id: string;
  rel_type: string;
  status?: 'active' | 'deleted';
  properties?: Record<string, unknown> | null;
};

type StoreBackupData = {
  version?: string;
  format_version?: string;
  exported_at?: string;
  source?: { repo_id?: string };
  entities?: StoreBackupEntity[];
  relations?: StoreBackupRelation[];
  feats?: ExportFeat[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGzip(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function extractTarPayload(buffer: Buffer): string | null {
  if (buffer.length < 512) return null;
  const magic = buffer.subarray(257, 262).toString('utf-8');
  if (magic !== 'ustar') return null;
  const sizeText = buffer.subarray(124, 136).toString('utf-8').replace(/\0/g, '').trim();
  const size = parseInt(sizeText || '0', 8);
  const start = 512;
  const end = start + size;
  if (!Number.isFinite(size) || end > buffer.length) return null;
  return buffer.subarray(start, end).toString('utf-8');
}

function isCompatibleVersion(version: string): boolean {
  return version === EXPORT_VERSION || version.startsWith('0.3.');
}

function normalizeStoreBackup(data: StoreBackupData): ExportData {
  const exportedAt = data.exported_at ?? new Date().toISOString();
  const sourceRepo = data.source?.repo_id;
  const entities: ExportEntity[] = (data.entities ?? []).map((entity) => {
    const metadata = entity.metadata ?? {};
    const contentHash = metadata.content_hash ?? computeChecksum(JSON.stringify(entity.data ?? {}));
    const createdAt = metadata.created_at ?? exportedAt;
    const updatedAt = metadata.updated_at ?? createdAt;

    return {
      id: entity.id,
      type: entity.type as ExportEntity['type'],
      data: entity.data ?? {},
      metadata: {
        root_id: entity.root_id ?? '',
        source_repo: sourceRepo,
        status: (entity.status ?? 'published') as ExportEntity['metadata']['status'],
        content_hash: contentHash,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      requirement_id: null,
    };
  });

  const relations: ExportRelation[] = (data.relations ?? []).map((relation) => ({
    id: relation.id ?? undefined,
    requirement_id: relation.requirement_id ?? null,
    from_root_id: relation.from_root_id ?? null,
    from_id: relation.from_id,
    to_root_id: relation.to_root_id ?? null,
    to_id: relation.to_id,
    rel_type: relation.rel_type,
    status: relation.status ?? 'active',
    properties: relation.properties ?? null,
  }));

  return {
    version: data.version ?? EXPORT_VERSION,
    exported_at: exportedAt,
    entities,
    relations,
    feats: Array.isArray(data.feats) ? data.feats : [],
  };
}

function normalizeBackupData(raw: unknown): ExportData {
  if (!isPlainObject(raw)) {
    throw new MigrationError('C4A-MIGRATE-002', '备份数据格式错误');
  }

  const maybeFormatVersion = raw.format_version;
  const isStoreBackup = typeof maybeFormatVersion === 'string';

  if (isStoreBackup) {
    return normalizeStoreBackup(raw as StoreBackupData);
  }

  const rawVersion = raw.version;
  const rawExportedAt = raw.exported_at;
  const entities = Array.isArray(raw.entities) ? (raw.entities as ExportEntity[]) : [];
  const relations = Array.isArray(raw.relations) ? (raw.relations as ExportRelation[]) : [];
  const feats = Array.isArray(raw.feats) ? (raw.feats as ExportFeat[]) : [];

  return {
    version: typeof rawVersion === 'string' ? rawVersion : EXPORT_VERSION,
    exported_at: typeof rawExportedAt === 'string' ? rawExportedAt : new Date().toISOString(),
    entities,
    relations,
    feats,
  };
}

export async function readBackupData(input: string): Promise<ExportData> {
  try {
    const rawFile = await readFile(input);
    const buffer = isGzip(rawFile) ? gunzipSync(rawFile) : rawFile;
    const tarPayload = extractTarPayload(buffer);
    const jsonText = tarPayload ?? buffer.toString('utf-8');
    const parsed = JSON.parse(jsonText) as unknown;
    const normalized = normalizeBackupData(parsed);

    const validated = validateExportData(normalized, (version) => {
      if (!isCompatibleVersion(version)) {
        throw new MigrationError('C4A-MIGRATE-001', '版本不兼容', { backup_version: version });
      }
      return true;
    });

    return normalizeExportData(validated);
  } catch (error) {
    if (error instanceof MigrationError) {
      throw error;
    }
    throw new MigrationError('C4A-MIGRATE-002', '备份数据格式错误', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
