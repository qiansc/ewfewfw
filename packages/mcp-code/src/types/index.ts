/**
 * Type definitions for c4a-code-mcp
 */

/**
 * Supported programming languages
 */
export type SupportedLanguage = "typescript" | "go" | "python";

/**
 * Code location information
 */
export interface CodeLocation {
  file: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * Extracted interface/type definition
 */
export interface ExtractedInterface {
  name: string;
  kind: "interface" | "type" | "class" | "struct" | "protocol";
  language: SupportedLanguage;
  location: CodeLocation;
  properties: ExtractedProperty[];
  methods: ExtractedMethod[];
  exported: boolean;
  documentation?: string;
}

/**
 * Extracted property/field
 */
export interface ExtractedProperty {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  documentation?: string;
}

/**
 * Extracted method/function
 */
export interface ExtractedMethod {
  name: string;
  parameters: ExtractedParameter[];
  returnType: string;
  async: boolean;
  documentation?: string;
}

/**
 * Extracted function parameter
 */
export interface ExtractedParameter {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

/**
 * Extracted import/dependency
 */
export interface ExtractedImport {
  source: string;
  names: string[];
  isDefault: boolean;
  isNamespace: boolean;
  location: CodeLocation;
}

/**
 * Extracted export
 */
export interface ExtractedExport {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "const";
  isDefault: boolean;
  location: CodeLocation;
}

/**
 * Code analysis result
 */
export interface CodeAnalysis {
  file: string;
  language: SupportedLanguage;
  imports: ExtractedImport[];
  exports: ExtractedExport[];
  interfaces: ExtractedInterface[];
  functions: ExtractedMethod[];
  dependencies: string[];
  metrics: CodeMetrics;
}

/**
 * Code complexity metrics
 */
export interface CodeMetrics {
  lines: number;
  linesOfCode: number;
  functions: number;
  classes: number;
  interfaces: number;
  imports: number;
  exports: number;
}

/**
 * AST node representation
 */
export interface ASTNode {
  type: string;
  text?: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children?: ASTNode[];
  fields?: Record<string, ASTNode | ASTNode[]>;
}

/**
 * Contract generation options
 */
export interface ContractOptions {
  format: "openapi" | "asyncapi" | "proto";
  version?: string;
  baseUrl?: string;
  title?: string;
  description?: string;
}

/**
 * Generated contract
 */
export interface GeneratedContract {
  format: ContractOptions["format"];
  version: string;
  content: string;
  endpoints: ContractEndpoint[];
}

/**
 * Contract endpoint
 */
export interface ContractEndpoint {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}
