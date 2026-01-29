import { ParsedReference } from './types.js';

/**
 * Parse a reference string into its components
 * 
 * Formats:
 * - Simple ID: "entity-id"
 * - Project: "project:my-project/entity-id"
 * - Repo: "repo:my-org/my-repo/entity-id" (Note: simple repo format)
 *   or "repo:my-org/my-repo/project:my-project/entity-id" (Complex - future support)
 * - Scope: "scope:domain/entity-id"
 */
export function parseReference(ref: string): ParsedReference {
  if (!ref) {
    throw new Error('Reference string cannot be empty');
  }

  // Project reference: project:{project_id}/{id}
  const projectMatch = ref.match(/^project:([^\/]+)\/(.+)$/);
  if (projectMatch) {
    return {
      original: ref,
      format: 'project',
      projectId: projectMatch[1],
      id: projectMatch[2]
    };
  }

  // Repo reference: repo:{repo_id}/{id}
  // repo_id might contain slashes (e.g. company/repo), so we need to be careful.
  // We assume the ID is the last part after the last slash, but that's risky if ID has slashes?
  // IDs shouldn't have slashes usually (kebab-case).
  // However, the spec says "repo:{repo_id}/{id}". 
  // Let's assume repo_id is everything between "repo:" and the last slash.
  // Actually, standard repo IDs often have one slash (owner/name).
  // Let's look for "repo:" prefix.
  if (ref.startsWith('repo:')) {
    const parts = ref.slice(5).split('/');
    if (parts.length >= 2) {
      const id = parts.pop()!;
      const repoId = parts.join('/');
      return {
        original: ref,
        format: 'repo',
        repoId: repoId,
        id: id
      };
    }
  }

  // Scope reference: scope:{scope}/{id}
  const scopeMatch = ref.match(/^scope:([^\/]+)\/(.+)$/);
  if (scopeMatch) {
    return {
      original: ref,
      format: 'scope',
      scope: scopeMatch[1],
      id: scopeMatch[2]
    };
  }

  // Simple ID
  return {
    original: ref,
    format: 'simple',
    id: ref
  };
}
