import { isReferenceScope } from './types.js';
import type { ParsedReference } from './types.js';

/**
 * Parse a reference string into its components
 * 
 * Formats:
 * - Simple ID: "entity-id"
 * - Root: "root:my-project/entity-id"
 * - Repo: "repo:my-org/my-repo/entity-id" (Note: simple repo format)
 *   or "repo:my-org/my-repo/root:my-project/entity-id" (Complex - future support)
 * - Scope: "scope:domain/entity-id"
 */
export function parseReference(ref: string): ParsedReference {
  const value = ref.trim();

  if (!value) {
    throw new Error('Reference string cannot be empty');
  }

  // Root reference: root:{root_id}/{id}
  const rootMatch = value.match(/^root:([^\/]+)\/(.+)$/);
  if (rootMatch) {
    return {
      original: ref,
      format: 'root',
      rootId: rootMatch[1],
      id: rootMatch[2]
    };
  }

  // Repo reference: repo:{repo_id}/{id}
  // repo_id 通常是 "owner/repo"，其后为实体 ID（可包含斜杠）
  if (value.startsWith('repo:')) {
    const rest = value.slice('repo:'.length);
    const parts = rest.split('/');
    if (parts.length >= 3) {
      const repoId = `${parts[0]}/${parts[1]}`;
      const id = parts.slice(2).join('/');
      if (!id) {
        throw new Error('Repo reference must include an id');
      }
      return {
        original: ref,
        format: 'repo',
        repoId,
        id
      };
    }
    throw new Error('Invalid repo reference format');
  }

  // Scope reference: scope:{scope}/{id}
  const scopeMatch = value.match(/^scope:([^\/]+)\/(.+)$/);
  if (scopeMatch) {
    if (!isReferenceScope(scopeMatch[1])) {
      throw new Error(`Invalid scope: ${scopeMatch[1]}`);
    }
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
    id: value
  };
}
