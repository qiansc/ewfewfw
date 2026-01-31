import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  CONFIG_FILENAME,
  CONTEXT_ROOT_DIR,
  DSL_EXTENSION,
  getEntityPath,
  getPerspectiveFromId,
  parseEntityPath,
  parseYAML,
  stringifyYAML,
} from '@c4a/core';
import type { EntityType } from '../../adapter.js';
import type { DbEntityInfo, ExportFormat, FileEntityInfo, SyncDetail } from './types.js';
import { isExcludedType, pickString } from './syncUtils.js';

const DSL_EXTENSIONS = ['.c4a.yaml', '.c4a.yml', '.c4a.json', '.yaml', '.yml', '.json'];
const JSON_EXTENSIONS = new Set(['.json', '.c4a.json']);
const EXCLUDED_DIRS = new Set(['assets', 'contracts']);

export function resolveContextRoot(path?: string): string {
  const base = path ?? CONTEXT_ROOT_DIR;
  if (base.endsWith(CONTEXT_ROOT_DIR)) {
    return base;
  }
  return join(base, CONTEXT_ROOT_DIR);
}

export function loadFileEntities(
  contextRoot: string,
  options: { featId: string | null }
): { entities: FileEntityInfo[]; failed: number; details: SyncDetail[] } {
  const entities: FileEntityInfo[] = [];
  const details: SyncDetail[] = [];
  let failed = 0;

  const files = scanDslFiles(contextRoot);
  for (const filePath of files) {
    const pathInfo = parseEntityPathInfo(filePath);
    if (options.featId) {
      if (pathInfo.featId !== options.featId) {
        continue;
      }
    } else if (pathInfo.featId) {
      continue;
    }

    const format = getFileFormat(filePath);
    const content = readFileSync(filePath, 'utf-8');
    let data: Record<string, unknown>;
    try {
      data = parseContent(content, format);
    } catch (error) {
      failed++;
      details.push({
        entity_id: pathInfo.id ?? 'unknown',
        action: 'failed',
        path: filePath,
        error: `解析失败: ${String(error)}`,
      });
      continue;
    }

    const idFromContent = pickString(data.id);
    const typeFromContent = pickString(data.type);
    const entityId = idFromContent ?? pathInfo.id ?? null;
    const entityType = (typeFromContent as EntityType | null) ?? pathInfo.type ?? null;

    if (!entityId || !entityType) {
      failed++;
      details.push({
        entity_id: pathInfo.id ?? 'unknown',
        action: 'failed',
        path: filePath,
        error: '缺少 id 或 type',
      });
      continue;
    }

    if (pathInfo.id && idFromContent && pathInfo.id !== idFromContent) {
      failed++;
      details.push({
        entity_id: idFromContent,
        action: 'failed',
        path: filePath,
        error: '文件路径与内容 id 不一致',
      });
      continue;
    }

    if (isExcludedType(entityType)) {
      continue;
    }

    const hash = computeEntityHash(data);
    let mtime: string | undefined;
    try {
      const stat = statSync(filePath);
      mtime = stat.mtime.toISOString();
    } catch {
      mtime = undefined;
    }

    entities.push({
      id: entityId,
      type: entityType,
      content_hash: hash,
      path: filePath,
      mtime,
      feat_id: pathInfo.featId,
      perspective: pathInfo.perspective,
      path_type: pathInfo.type,
      declared_type: typeFromContent as EntityType | null,
    });
  }

  return { entities, failed, details };
}

export function buildEntityFilePath(
  entity: DbEntityInfo,
  contextRoot: string,
  format: ExportFormat,
  featId: string | null
): string | null {
  const data = entity.data ?? {};
  let perspective = pickString((data as Record<string, unknown>).perspective) as
    | 'business'
    | 'technical'
    | null;
  if (!perspective && (entity.type === 'process' || entity.type === 'sor')) {
    perspective = getPerspectiveFromId(entity.id);
  }

  let entityPath: string;
  try {
    entityPath = getEntityPath(entity.id, entity.type, {
      featId: featId ?? undefined,
      perspective: perspective ?? undefined,
    });
  } catch {
    return null;
  }

  const relative = stripContextRoot(entityPath);
  const normalized = replaceDslExtension(relative, format);
  return join(contextRoot, normalized);
}

export function stringifyEntity(data: Record<string, unknown>, format: ExportFormat): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  return stringifyYAML(data);
}

export function readFileEntityData(path: string): Record<string, unknown> | null {
  try {
    const format = getFileFormat(path);
    const content = readFileSync(path, 'utf-8');
    return parseContent(content, format);
  } catch {
    return null;
  }
}

export function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function removeOrphanFiles(
  fileEntities: FileEntityInfo[],
  dbMap: Map<string, DbEntityInfo>
): string[] {
  const removed: string[] = [];
  for (const file of fileEntities) {
    if (dbMap.has(file.id)) {
      continue;
    }
    if (isExcludedType(file.type)) {
      continue;
    }
    try {
      rmSync(file.path, { force: true });
      removed.push(file.path);
    } catch {
      // ignore
    }
  }
  return removed;
}

function scanDslFiles(basePath: string): string[] {
  const files: string[] = [];
  if (!existsSync(basePath)) {
    return files;
  }

  const scanDir = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) {
          continue;
        }
        scanDir(fullPath);
        continue;
      }

      if (entry.isFile() && isDslFile(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  scanDir(basePath);
  return files;
}

function isDslFile(filename: string): boolean {
  if (filename === CONFIG_FILENAME) {
    return false;
  }
  return DSL_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function shouldSkipDir(name: string): boolean {
  return EXCLUDED_DIRS.has(name);
}

function parseEntityPathInfo(path: string): {
  id: string | null;
  type: EntityType | null;
  featId: string | null;
  perspective: 'business' | 'technical' | null;
} {
  const normalized = path.replace(/\\/g, '/');
  let parsed = parseEntityPath(normalized);

  if (!parsed.valid && normalized.endsWith('.c4a.json')) {
    const alt = normalized.replace(/\.c4a\.json$/, DSL_EXTENSION);
    parsed = parseEntityPath(alt);
  }
  if (!parsed.valid && normalized.endsWith('.c4a.yml')) {
    const alt = normalized.replace(/\.c4a\.yml$/, DSL_EXTENSION);
    parsed = parseEntityPath(alt);
  }

  if (parsed.valid) {
    return {
      id: parsed.id,
      type: parsed.type as EntityType,
      featId: parsed.featId,
      perspective: parsed.perspective,
    };
  }

  return parseLegacyEntityPath(normalized);
}

function parseLegacyEntityPath(path: string): {
  id: string | null;
  type: EntityType | null;
  featId: string | null;
  perspective: 'business' | 'technical' | null;
} {
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const filename = segments[segments.length - 1];
  const id = filename.replace(/\.(c4a\.)?(ya?ml|json)$/i, '');

  let type: EntityType | null = null;
  const dir = segments[segments.length - 2];
  switch (dir) {
    case 'systems':
      type = 'system';
      break;
    case 'containers':
      type = 'container';
      break;
    case 'components':
      type = 'component';
      break;
    case 'products':
      type = 'product';
      break;
    case 'processes':
      type = 'process';
      break;
    case 'sors':
      type = 'sor';
      break;
    case 'adrs':
      type = 'adr';
      break;
    case 'contracts':
      type = 'contract';
      break;
    default:
      type = null;
  }

  let featId: string | null = null;
  const featIndex = segments.indexOf('feat');
  if (featIndex >= 0 && segments[featIndex + 1]) {
    featId = segments[featIndex + 1];
  }

  let perspective: 'business' | 'technical' | null = null;
  if (segments.includes('business')) {
    perspective = 'business';
  } else if (segments.includes('technical')) {
    perspective = 'technical';
  }

  return { id, type, featId, perspective };
}

function replaceDslExtension(path: string, format: ExportFormat): string {
  const base = path.replace(/\.(c4a\.)?(ya?ml|json)$/i, '');
  if (format === 'json') {
    return `${base}.c4a.json`;
  }
  return `${base}.c4a.yaml`;
}

function stripContextRoot(path: string): string {
  if (path.startsWith(`${CONTEXT_ROOT_DIR}/`)) {
    return path.slice(CONTEXT_ROOT_DIR.length + 1);
  }
  return path;
}

function parseContent(content: string, format: ExportFormat): Record<string, unknown> {
  if (format === 'json') {
    return JSON.parse(content) as Record<string, unknown>;
  }
  return parseYAML(content) as Record<string, unknown>;
}

function getFileFormat(path: string): ExportFormat {
  if (JSON_EXTENSIONS.has(extname(path))) {
    return 'json';
  }
  return 'yaml';
}

function computeEntityHash(data: Record<string, unknown>): string {
  const content = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
