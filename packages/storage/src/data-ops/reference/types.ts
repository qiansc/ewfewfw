/**
 * Reference 解析类型
 */

export type ReferenceFormat = 'simple' | 'project' | 'repo' | 'scope';

export type ReferenceScope = 'domain' | 'enterprise' | 'project';

export interface ReferenceCandidate {
  id: string;
  sourceProject?: string | null;
  sourceRepo?: string | null;
  scope?: ReferenceScope | null;
}

export interface ParsedReference {
  original: string;
  format: ReferenceFormat;
  id: string;
  projectId?: string;
  repoId?: string;
  scope?: ReferenceScope;
}

export interface ResolveContext {
  projectId: string;
  repoId?: string | null;
  scope?: ReferenceScope | null;
  candidates?: ReferenceCandidate[];
  lookup?: (id: string) => ReferenceCandidate[];
}

export interface ResolvedReference {
  original: string;
  format: ReferenceFormat;
  id: string;
  targetProject?: string | null;
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
