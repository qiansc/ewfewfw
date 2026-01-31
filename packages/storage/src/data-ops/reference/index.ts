/**
 * Reference 模块入口
 */

export type {
  ParsedReference,
  ReferenceFormat,
  ReferenceCandidate,
  ReferenceScope,
  ResolvedReference,
  ReferenceError,
  ValidationResult,
} from './types.js';
export { parseReference } from './parser.js';
export { resolveReference } from './resolver.js';
export { copyOnWrite } from './resolver.js';
export { validateReferences } from './validator.js';
