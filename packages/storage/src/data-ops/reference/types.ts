/**
 * Reference 解析类型
 */

export type ReferenceFormat = 'simple' | 'root' | 'repo' | 'scope';

export type ReferenceScope = 'domain' | 'enterprise' | 'project';

export const REFERENCE_SCOPES: ReadonlyArray<ReferenceScope> = [
  'domain',
  'enterprise',
  'project',
];

export function isReferenceScope(value: string): value is ReferenceScope {
  return REFERENCE_SCOPES.includes(value as ReferenceScope);
}

export function normalizeReferenceScope(value?: string | null): ReferenceScope | null {
  if (!value) return null;
  return isReferenceScope(value) ? value : null;
}

export interface ReferenceCandidate {
  id: string;
  rootId?: string | null;
  sourceRepo?: string | null;
  scope?: ReferenceScope | null;
}

export interface ParsedReference {
  original: string;
  format: ReferenceFormat;
  id: string;
  rootId?: string;
  repoId?: string;
  scope?: ReferenceScope;
}

export interface ResolveContext {
  rootId: string;
  repoId?: string | null;
  scope?: ReferenceScope | null;
  candidates?: ReferenceCandidate[];
  lookup?: (id: string) => ReferenceCandidate[];
}

export interface ResolvedReference {
  original: string;
  format: ReferenceFormat;
  id: string;
  targetRootId?: string | null;
  targetRepo?: string | null;
  scope?: ReferenceScope | null;
  resolved: boolean;
  ambiguous?: boolean;
  warning?: string;
}

export interface ReferenceError {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ReferenceError[];
  warnings?: ReferenceError[];
  suggestions?: string[];
}

export type ReferenceValidationResult = ValidationResult;
