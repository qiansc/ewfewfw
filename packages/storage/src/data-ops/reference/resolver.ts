import { parseReference } from './parser.js';
import { normalizeReferenceScope } from './types.js';
import type { ReferenceCandidate, ResolvedReference, ResolveContext } from './types.js';

type ResolutionBucket =
  | 'current_root'
  | 'same_repo_infra'
  | 'other_roots'
  | 'enterprise'
  | 'domain';

const RESOLUTION_ORDER: ResolutionBucket[] = [
  'current_root',
  'same_repo_infra',
  'other_roots',
  'enterprise',
  'domain',
];

function normalizeRepoId(value?: string | null): string | null {
  if (!value) return null;
  return value.trim();
}

function normalizeRootId(value?: string | null): string | null {
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

  const currentRoot = normalizeRootId(context.rootId);
  const currentRepo = normalizeRepoId(context.repoId);

  for (const candidate of candidates) {
    const candidateRoot = normalizeRootId(candidate.rootId);
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
      if (candidateRoot && currentRoot && candidateRoot === currentRoot) {
        buckets.get('current_root')?.push(candidate);
      } else if (!candidateRoot) {
        buckets.get('same_repo_infra')?.push(candidate);
      } else {
        buckets.get('other_roots')?.push(candidate);
      }
      continue;
    }

    if (candidateRoot && currentRoot && candidateRoot === currentRoot) {
      if (!candidateRepo || !currentRepo || candidateRepo === currentRepo) {
        buckets.get('current_root')?.push(candidate);
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
  const rootId = normalizeRootId(candidate.rootId);

  if (repoId && rootId) {
    if (repoId === normalizeRepoId(context.repoId)) {
      return `root:${rootId}/${candidate.id}`;
    }
    return `repo:${repoId}/root:${rootId}/${candidate.id}`;
  }

  if (repoId) {
    return `repo:${repoId}/${candidate.id}`;
  }

  if (rootId) {
    return `root:${rootId}/${candidate.id}`;
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
  target: { id: string; rootId?: string | null; repoId?: string | null; scope?: string | null }
): boolean {
  if (candidate.id !== target.id) return false;
  const targetScope = normalizeScope(target.scope);
  if (targetScope) {
    return candidate.scope === targetScope;
  }

  const targetRepo = normalizeRepoId(target.repoId);
  const targetRootId = normalizeRootId(target.rootId);

  const candidateRepo = normalizeRepoId(candidate.sourceRepo);
  const candidateRoot = normalizeRootId(candidate.rootId);

  if (targetRepo && candidateRepo !== targetRepo) return false;
  if (targetRootId && candidateRoot !== targetRootId) return false;

  return true;
}

function resolveExplicitReference(
  ref: string,
  context: ResolveContext,
  target: { id: string; rootId?: string | null; repoId?: string | null; scope?: string | null }
): ResolvedReference {
  const candidates = resolveCandidates(target.id, context);
  const hasLookup = hasLookupContext(context);
  if (!hasLookup || candidates.length === 0) {
    return {
      original: ref,
      format: ref.startsWith('scope:') ? 'scope' : ref.startsWith('repo:') ? 'repo' : 'root',
      id: target.id,
      targetRootId: target.rootId ?? null,
      targetRepo: target.repoId ?? null,
      scope: normalizeScope(target.scope),
      resolved: !hasLookup,
      warning: hasLookup ? `Entity '${target.id}' not found` : undefined,
    };
  }

  const found = candidates.some((candidate) => candidateMatchesTarget(candidate, target));
  return {
    original: ref,
    format: ref.startsWith('scope:') ? 'scope' : ref.startsWith('repo:') ? 'repo' : 'root',
    id: target.id,
    targetRootId: target.rootId ?? null,
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

  if (parsed.format === 'root') {
    return resolveExplicitReference(ref, context, {
      id: parsed.id,
      rootId: parsed.rootId ?? null,
      repoId: context.repoId ?? null,
    });
  }

  if (parsed.format === 'repo') {
    let targetId = parsed.id;
    let targetRootId = null as string | null;
    const targetRepo = parsed.repoId ?? null;

    if (parsed.id.startsWith('root:')) {
      const nested = parseReference(parsed.id);
      if (nested.format === 'root') {
        targetRootId = nested.rootId ?? null;
        targetId = nested.id;
      }
    }

    return resolveExplicitReference(ref, context, {
      id: targetId,
      rootId: targetRootId,
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
      targetRootId: context.rootId ?? null,
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
      targetRootId: context.rootId ?? null,
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
    targetRootId: primary.rootId ?? null,
    targetRepo: primary.sourceRepo ?? null,
    scope: primary.scope ?? null,
    resolved: true,
    ambiguous,
    warning,
  };
}
