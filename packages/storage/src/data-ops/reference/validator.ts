import { DATA_ERROR_CODES, INPUT_ERROR_CODES } from '@c4a/core/types';
import { resolveReference } from './resolver.js';
import type { Entity, EntityStatus } from '../../adapter.js';
import { normalizeReferenceScope } from './types.js';
import type {
  ReferenceCandidate,
  ReferenceError,
  ResolvedReference,
  ValidationResult,
  ResolveContext,
} from './types.js';

interface ReferenceEntry {
  ref: string;
  resolved?: boolean;
}

type UnknownRecord = Record<string, unknown>;

/**
 * 引用校验：检测悬空引用（状态感知）并生成修复建议
 */
export function validateReferences(entity: Entity): ValidationResult {
  const errors: ReferenceError[] = [];
  const warnings: ReferenceError[] = [];
  const suggestions: string[] = [];

  const references = extractReferences(entity.data);
  if (references.length === 0) {
    return { valid: true, errors };
  }

  const status = resolveStatus(entity);
  const context = buildResolveContext(entity);

  for (const entry of references) {
    let resolved;
    try {
      resolved = resolveReference(entry.ref, context);
    } catch (error) {
      errors.push({
        code: INPUT_ERROR_CODES.INVALID_FIELD_FORMAT,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const isDangling = entry.resolved === false || resolved.resolved === false;
    if (isDangling) {
      const issue: ReferenceError = {
        code: DATA_ERROR_CODES.DANGLING_REFERENCE,
        message: `引用的实体 '${resolved.id}' 不存在`,
      };

      if (status === 'published') {
        errors.push(issue);
      } else {
        warnings.push(issue);
      }

      for (const suggestion of buildSuggestions(resolved, entry.ref)) {
        if (!suggestions.includes(suggestion)) {
          suggestions.push(suggestion);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

function resolveStatus(entity: Entity): EntityStatus | null {
  if (entity.metadata?.status) return entity.metadata.status;
  const raw = (entity.data as UnknownRecord).status;
  if (raw === 'draft' || raw === 'approved' || raw === 'published' || raw === 'deprecated' || raw === 'archived') {
    return raw;
  }
  return null;
}

function buildResolveContext(entity: Entity): ResolveContext {
  const data = entity.data as UnknownRecord;
  const { candidates, hasCandidateField } = parseCandidates(data);
  const override = parseContextOverride(data);

  return {
    projectId: override.projectId ?? entity.metadata.source_project,
    repoId: override.repoId ?? entity.metadata.source_repo ?? null,
    scope: override.scope ?? null,
    candidates: hasCandidateField ? candidates : candidates.length > 0 ? candidates : undefined,
  };
}

function parseCandidates(data: UnknownRecord): {
  candidates: ReferenceCandidate[];
  hasCandidateField: boolean;
} {
  const raw = (data.reference_candidates ?? data.referenceCandidates) as unknown;
  if (raw === undefined) {
    return { candidates: [], hasCandidateField: false };
  }
  if (!Array.isArray(raw)) {
    return { candidates: [], hasCandidateField: true };
  }
  const candidates: ReferenceCandidate[] = [];

  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const id = item.id;
    if (typeof id !== 'string' || !id) continue;
    candidates.push({
      id,
      sourceProject: (item.sourceProject ?? item.source_project) as string | null | undefined,
      sourceRepo: (item.sourceRepo ?? item.source_repo) as string | null | undefined,
      scope: typeof item.scope === 'string' ? normalizeReferenceScope(item.scope) : null,
    });
  }

  return { candidates, hasCandidateField: true };
}

function parseContextOverride(
  data: UnknownRecord
): { projectId?: string; repoId?: string; scope?: ResolveContext['scope'] } {
  const raw = data.reference_context ?? data.referenceContext;
  if (!isPlainObject(raw)) return {};
  const projectId = typeof raw.projectId === 'string' ? raw.projectId : undefined;
  const repoId = typeof raw.repoId === 'string' ? raw.repoId : undefined;
  const scope =
    typeof raw.scope === 'string' ? normalizeReferenceScope(raw.scope) ?? undefined : undefined;
  return { projectId, repoId, scope };
}

function extractReferences(data: UnknownRecord): ReferenceEntry[] {
  const collected: ReferenceEntry[] = [];
  const visited = new Set<object>();

  const visit = (value: unknown, inReferences: boolean): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      if (inReferences) {
        for (const item of value) {
          const entry = normalizeReferenceEntry(item);
          if (entry) collected.push(entry);
        }
      } else {
        for (const item of value) {
          visit(item, false);
        }
      }
      return;
    }

    if (!isPlainObject(value)) return;
    if (visited.has(value)) return;
    visited.add(value);

    for (const [key, entry] of Object.entries(value)) {
      visit(entry, key === 'references');
    }
  };

  visit(data, false);

  return collected;
}

function normalizeReferenceEntry(entry: unknown): ReferenceEntry | null {
  if (typeof entry === 'string') {
    return { ref: entry };
  }

  if (!isPlainObject(entry)) return null;
  const ref =
    (entry.ref as string | undefined) ??
    (entry.reference as string | undefined) ??
    (entry.id as string | undefined);
  if (!ref) return null;
  const resolved = typeof entry.resolved === 'boolean' ? entry.resolved : undefined;
  return { ref, resolved };
}

function buildSuggestions(
  resolved: Pick<ResolvedReference, 'id' | 'format' | 'scope'>,
  ref: string
): string[] {
  const suggestions: string[] = [`确认实体 "${resolved.id}" 已创建或同步到当前数据库`];

  if (resolved.format === 'simple') {
    suggestions.push(`为引用 "${ref}" 添加 project:/repo:/scope: 前缀以明确目标`);
  }

  if (resolved.format === 'scope' && resolved.scope) {
    suggestions.push(`确认 scope="${resolved.scope}" 的实体已发布`);
  }

  return suggestions;
}

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
