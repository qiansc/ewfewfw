import { parseReference } from './parser.js';
import type { ReferenceCandidate, ResolvedReference, ResolveContext } from './types.js';
import type { Entity } from '../../adapter.js';
import type { EntityRow } from '../../lite-adapter/types.js';
import { rowToEntity } from '../../lite-adapter/helpers.js';
import { SQLiteStore } from '../../sqlite-store.js';

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
  if (!value) return null;
  return value;
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
      buckets.get('current_project')?.push(candidate);
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
  if (target.scope) {
    return candidate.scope === target.scope;
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
      scope: target.scope ?? null,
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
    scope: target.scope ?? null,
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
export function copyOnWrite(entityId: string, targetFeatId: string): Entity {
  if (!entityId) {
    throw new Error('entityId is required');
  }
  if (!targetFeatId) {
    throw new Error('targetFeatId is required');
  }

  const store = SQLiteStore.getInstance();
  const db = store.getDatabase();

  const selectSql = `
    SELECT e.id, e.source_project, e.proposal_id, e.type, e.kind, e.scope, e.perspective, e.data,
           m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
           m.created_by, m.updated_by
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.id = ? AND e.proposal_id = ?
  `;

  const existing = db.prepare(selectSql).get(entityId, targetFeatId) as EntityRow | undefined;
  if (existing) {
    return rowToEntity(existing);
  }

  const mainRows = db.prepare(`
    SELECT e.id, e.source_project, e.proposal_id, e.type, e.kind, e.scope, e.perspective, e.data,
           m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
           m.created_by, m.updated_by
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.id = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
  `).all(entityId) as EntityRow[];

  if (mainRows.length === 0) {
    throw new Error(`Entity '${entityId}' not found in main branch`);
  }
  if (mainRows.length > 1) {
    throw new Error(`Ambiguous entity '${entityId}' across multiple projects`);
  }

  const main = mainRows[0];
  const now = new Date().toISOString();

  const insertEntity = db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMetadata = db.prepare(`
    INSERT INTO metadata (
      entity_id,
      source_project,
      proposal_id,
      source_repo,
      external_url,
      status,
      content_hash,
      created_at,
      updated_at,
      created_by,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertEntity.run(
      main.id,
      main.source_project,
      targetFeatId,
      main.type,
      main.kind,
      main.scope,
      main.perspective,
      main.data
    );
    insertMetadata.run(
      main.id,
      main.source_project,
      targetFeatId,
      main.source_repo,
      main.external_url,
      'draft',
      main.content_hash,
      now,
      now,
      main.created_by,
      main.updated_by
    );
  })();

  return rowToEntity({
    ...main,
    proposal_id: targetFeatId,
    status: 'draft',
    created_at: now,
    updated_at: now,
  });
}
