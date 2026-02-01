import { parseReference } from './parser.js';
import { normalizeReferenceScope } from './types.js';
import type { ReferenceCandidate, ResolvedReference, ResolveContext } from './types.js';
import type { Entity } from '../../adapter.js';
import type { StorageOperations } from '../types.js';

type ResolutionBucket =
  | 'current_project'
  | 'same_repo_infra'
  | 'other_projects'
  | 'enterprise'
  | 'domain';

const RESOLUTION_ORDER: ResolutionBucket[] = [
  'current_project',
  'same_repo_infra',
  'other_projects',
  'enterprise',
  'domain',
];

function normalizeRepoId(value?: string | null): string | null {
  if (!value) return null;
  return value.trim();
}

function normalizeProjectId(value?: string | null): string | null {
  if (!value) return null;
  return value.trim();
}

function normalizeScope(value?: string | null): ResolvedReference['scope'] | null {
  return normalizeReferenceScope(value);
}

function hasLookupContext(context: ResolveContext): boolean {
  return Boolean(context.lookup || context.candidates);
}

function resolveCandidates(id: string, context: ResolveContext): ReferenceCandidate[] {
  if (context.lookup) {
    return context.lookup(id) ?? [];
  }
  if (!context.candidates) return [];
  return context.candidates.filter((candidate) => candidate.id === id);
}

function bucketizeCandidates(
  candidates: ReferenceCandidate[],
  context: ResolveContext
): Map<ResolutionBucket, ReferenceCandidate[]> {
  const buckets = new Map<ResolutionBucket, ReferenceCandidate[]>();
  for (const bucket of RESOLUTION_ORDER) {
    buckets.set(bucket, []);
  }

  const currentProject = normalizeProjectId(context.projectId);
  const currentRepo = normalizeRepoId(context.repoId);

  for (const candidate of candidates) {
    const candidateProject = normalizeProjectId(candidate.sourceProject);
    const candidateRepo = normalizeRepoId(candidate.sourceRepo);
    const candidateScope = normalizeScope(candidate.scope);

    if (candidateScope === 'enterprise') {
      buckets.get('enterprise')?.push(candidate);
      continue;
    }
    if (candidateScope === 'domain') {
      buckets.get('domain')?.push(candidate);
      continue;
    }

    if (candidateRepo && currentRepo && candidateRepo === currentRepo) {
      if (candidateProject && currentProject && candidateProject === currentProject) {
        buckets.get('current_project')?.push(candidate);
      } else if (!candidateProject) {
        buckets.get('same_repo_infra')?.push(candidate);
      } else {
        buckets.get('other_projects')?.push(candidate);
      }
      continue;
    }

    if (candidateProject && currentProject && candidateProject === currentProject) {
      if (!candidateRepo || !currentRepo || candidateRepo === currentRepo) {
        buckets.get('current_project')?.push(candidate);
      }
    }
  }

  return buckets;
}

function buildExplicitRef(
  candidate: ReferenceCandidate,
  context: ResolveContext
): string {
  if (candidate.scope) {
    return `scope:${candidate.scope}/${candidate.id}`;
  }

  const repoId = normalizeRepoId(candidate.sourceRepo);
  const projectId = normalizeProjectId(candidate.sourceProject);

  if (repoId && projectId) {
    if (repoId === normalizeRepoId(context.repoId)) {
      return `project:${projectId}/${candidate.id}`;
    }
    return `repo:${repoId}/project:${projectId}/${candidate.id}`;
  }

  if (repoId) {
    return `repo:${repoId}/${candidate.id}`;
  }

  if (projectId) {
    return `project:${projectId}/${candidate.id}`;
  }

  return candidate.id;
}

function buildAmbiguousWarning(
  id: string,
  candidates: ReferenceCandidate[],
  context: ResolveContext
): string {
  const lines = candidates.map((candidate) => `  - ${buildExplicitRef(candidate, context)}`);
  return `Found multiple matches for '${id}', please use explicit reference:\n${lines.join('\n')}`;
}

function pickPrimaryCandidate(
  buckets: Map<ResolutionBucket, ReferenceCandidate[]>
): ReferenceCandidate | null {
  for (const bucket of RESOLUTION_ORDER) {
    const matches = buckets.get(bucket) ?? [];
    if (matches.length > 0) {
      return matches[0];
    }
  }
  return null;
}

function candidateMatchesTarget(
  candidate: ReferenceCandidate,
  target: { id: string; projectId?: string | null; repoId?: string | null; scope?: string | null }
): boolean {
  if (candidate.id !== target.id) return false;
  const targetScope = normalizeScope(target.scope);
  if (targetScope) {
    return candidate.scope === targetScope;
  }

  const targetRepo = normalizeRepoId(target.repoId);
  const targetProject = normalizeProjectId(target.projectId);

  const candidateRepo = normalizeRepoId(candidate.sourceRepo);
  const candidateProject = normalizeProjectId(candidate.sourceProject);

  if (targetRepo && candidateRepo !== targetRepo) return false;
  if (targetProject && candidateProject !== targetProject) return false;

  return true;
}

function resolveExplicitReference(
  ref: string,
  context: ResolveContext,
  target: { id: string; projectId?: string | null; repoId?: string | null; scope?: string | null }
): ResolvedReference {
  const candidates = resolveCandidates(target.id, context);
  const hasLookup = hasLookupContext(context);
  if (!hasLookup || candidates.length === 0) {
    return {
      original: ref,
      format: ref.startsWith('scope:') ? 'scope' : ref.startsWith('repo:') ? 'repo' : 'project',
      id: target.id,
      targetProject: target.projectId ?? null,
      targetRepo: target.repoId ?? null,
      scope: normalizeScope(target.scope),
      resolved: !hasLookup,
      warning: hasLookup ? `Entity '${target.id}' not found` : undefined,
    };
  }

  const found = candidates.some((candidate) => candidateMatchesTarget(candidate, target));
  return {
    original: ref,
    format: ref.startsWith('scope:') ? 'scope' : ref.startsWith('repo:') ? 'repo' : 'project',
    id: target.id,
    targetProject: target.projectId ?? null,
    targetRepo: target.repoId ?? null,
    scope: normalizeScope(target.scope),
    resolved: found,
    warning: found ? undefined : `Entity '${target.id}' not found`,
  };
}

/**
 * 解析引用并按照优先级选择目标实体。
 */
export function resolveReference(ref: string, context: ResolveContext): ResolvedReference {
  const parsed = parseReference(ref);

  if (parsed.format === 'project') {
    return resolveExplicitReference(ref, context, {
      id: parsed.id,
      projectId: parsed.projectId ?? null,
      repoId: context.repoId ?? null,
    });
  }

  if (parsed.format === 'repo') {
    let targetId = parsed.id;
    let targetProject = null as string | null;
    const targetRepo = parsed.repoId ?? null;

    if (parsed.id.startsWith('project:')) {
      const nested = parseReference(parsed.id);
      if (nested.format === 'project') {
        targetProject = nested.projectId ?? null;
        targetId = nested.id;
      }
    }

    return resolveExplicitReference(ref, context, {
      id: targetId,
      projectId: targetProject,
      repoId: targetRepo,
    });
  }

  if (parsed.format === 'scope') {
    return resolveExplicitReference(ref, context, {
      id: parsed.id,
      scope: parsed.scope ?? null,
    });
  }

  const candidates = resolveCandidates(parsed.id, context);
  const hasLookup = hasLookupContext(context);
  if (candidates.length === 0) {
    return {
      original: ref,
      format: parsed.format,
      id: parsed.id,
      targetProject: context.projectId ?? null,
      targetRepo: context.repoId ?? null,
      scope: context.scope ?? null,
      resolved: !hasLookup,
      warning: hasLookup ? `Entity '${parsed.id}' not found` : undefined,
    };
  }

  const buckets = bucketizeCandidates(candidates, context);
  const primary = pickPrimaryCandidate(buckets);
  if (!primary) {
    return {
      original: ref,
      format: parsed.format,
      id: parsed.id,
      targetProject: context.projectId ?? null,
      targetRepo: context.repoId ?? null,
      scope: context.scope ?? null,
      resolved: false,
      warning: `Entity '${parsed.id}' not found`,
    };
  }

  const ambiguous = candidates.length > 1;
  const warning = ambiguous ? buildAmbiguousWarning(parsed.id, candidates, context) : undefined;

  return {
    original: ref,
    format: parsed.format,
    id: parsed.id,
    targetProject: primary.sourceProject ?? null,
    targetRepo: primary.sourceRepo ?? null,
    scope: primary.scope ?? null,
    resolved: true,
    ambiguous,
    warning,
  };
}

/**
 * Copy-on-Write: 从主分支复制实体到目标 feat 分支
 */
export function copyOnWrite(
  storage: StorageOperations,
  entityId: string,
  targetFeatId: string,
  sourceProject?: string | null
): Entity {
  if (!entityId) {
    throw new Error('entityId is required');
  }
  if (!targetFeatId) {
    throw new Error('targetFeatId is required');
  }

  const existing = storage.getEntityInFeat({ entityId, featId: targetFeatId });
  if (existing) {
    return existing;
  }

  const mainRows = storage.listMainEntities(entityId);
  const scopedProject = sourceProject ?? null;
  const scopedRows = scopedProject === null
    ? mainRows
    : mainRows.filter((row) => row.metadata.source_project === scopedProject);

  if (scopedRows.length === 0) {
    if (scopedProject) {
      throw new Error(`Entity '${entityId}' not found in main branch for project '${scopedProject}'`);
    }
    throw new Error(`Entity '${entityId}' not found in main branch`);
  }
  if (scopedRows.length > 1) {
    throw new Error(`Ambiguous entity '${entityId}' across multiple projects`);
  }

  const main = scopedRows[0];
  const now = new Date().toISOString();

  storage.insertEntityWithMetadata({
    entity: main,
    proposalId: targetFeatId,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });

  return {
    ...main,
    proposal_id: targetFeatId,
    metadata: {
      ...main.metadata,
      status: 'draft',
      created_at: now,
      updated_at: now,
    },
  };
}
