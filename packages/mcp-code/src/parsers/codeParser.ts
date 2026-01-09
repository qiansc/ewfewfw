/**
 * Code Parser - Unified interface for parsing code files
 *
 * Provides extraction of interfaces, functions, imports, exports etc.
 * Uses Tree-sitter when available, with regex fallback.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type {
  ASTNode,
  CodeAnalysis,
  CodeMetrics,
  ExtractedExport,
  ExtractedImport,
  ExtractedInterface,
  ExtractedMethod,
  ExtractedProperty,
  SupportedLanguage,
} from "../types/index.js";

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "typescript";
    case ".go":
      return "go";
    case ".py":
    case ".pyi":
      return "python";
    default:
      return null;
  }
}

/**
 * Parse file content and extract code information
 */
export async function parseFile(
  filePath: string,
  content?: string,
  language?: SupportedLanguage
): Promise<CodeAnalysis> {
  const fileContent = content ?? (await readFile(filePath, "utf-8"));
  const lang = language ?? detectLanguage(filePath);

  if (!lang) {
    throw new Error(`Unsupported file type: ${filePath}`);
  }

  // Use language-specific parser
  switch (lang) {
    case "typescript":
      return parseTypeScript(filePath, fileContent);
    case "go":
      return parseGo(filePath, fileContent);
    case "python":
      return parsePython(filePath, fileContent);
    default:
      throw new Error(`Unsupported language: ${lang}`);
  }
}

/**
 * Extract AST from file
 */
export async function extractAST(
  filePath: string,
  content?: string,
  maxDepth: number = 10
): Promise<ASTNode> {
  const fileContent = content ?? (await readFile(filePath, "utf-8"));
  const lang = detectLanguage(filePath);

  if (!lang) {
    throw new Error(`Unsupported file type: ${filePath}`);
  }

  // Return simplified AST structure using regex parsing
  return buildSimplifiedAST(fileContent, lang, maxDepth);
}

// =============================================================================
// TypeScript Parser (Regex-based)
// =============================================================================

function parseTypeScript(filePath: string, content: string): CodeAnalysis {
  const lines = content.split("\n");
  const imports = extractTSImports(content);
  const exports = extractTSExports(content);
  const interfaces = extractTSInterfaces(content);
  const functions = extractTSFunctions(content);

  return {
    file: filePath,
    language: "typescript",
    imports,
    exports,
    interfaces,
    functions,
    dependencies: imports.map((i) => i.source),
    metrics: calculateMetrics(content, interfaces, functions, imports, exports),
  };
}

function extractTSImports(content: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];
  const lines = content.split("\n");

  // Match: import { x, y } from "module"
  // Match: import x from "module"
  // Match: import * as x from "module"
  // Match: import "module"
  const importRegex =
    /import\s+(?:(?:(\*\s+as\s+\w+)|(\{[^}]+\})|(\w+))?\s*(?:,\s*(?:(\{[^}]+\})|(\w+)))?\s*from\s+)?["']([^"']+)["']/g;

  let lineNum = 0;
  for (const line of lines) {
    lineNum++;
    const matches = [...line.matchAll(importRegex)];
    for (const match of matches) {
      const source = match[6];
      const isNamespace = !!match[1];
      const namedImports = match[2] || match[4];
      const defaultImport = match[3] || match[5];

      const names: string[] = [];

      if (defaultImport) {
        names.push(defaultImport);
      }

      if (namedImports) {
        const cleanNames = namedImports
          .replace(/[{}]/g, "")
          .split(",")
          .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean);
        names.push(...cleanNames);
      }

      if (isNamespace) {
        const nsName = match[1].replace(/\*\s+as\s+/, "").trim();
        names.push(nsName);
      }

      imports.push({
        source,
        names,
        isDefault: !!defaultImport && names.length === 1,
        isNamespace,
        location: {
          file: "",
          startLine: lineNum,
          endLine: lineNum,
        },
      });
    }
  }

  return imports;
}

function extractTSExports(content: string): ExtractedExport[] {
  const exports: ExtractedExport[] = [];
  const lines = content.split("\n");

  let lineNum = 0;
  for (const line of lines) {
    lineNum++;

    // export default
    if (/export\s+default/.test(line)) {
      const nameMatch = line.match(
        /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/
      );
      exports.push({
        name: nameMatch?.[1] || "default",
        kind: "variable",
        isDefault: true,
        location: { file: "", startLine: lineNum, endLine: lineNum },
      });
      continue;
    }

    // export const/let/var
    const varMatch = line.match(/export\s+(const|let|var)\s+(\w+)/);
    if (varMatch) {
      exports.push({
        name: varMatch[2],
        kind: varMatch[1] === "const" ? "const" : "variable",
        isDefault: false,
        location: { file: "", startLine: lineNum, endLine: lineNum },
      });
      continue;
    }

    // export function
    const funcMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      exports.push({
        name: funcMatch[1],
        kind: "function",
        isDefault: false,
        location: { file: "", startLine: lineNum, endLine: lineNum },
      });
      continue;
    }

    // export class
    const classMatch = line.match(/export\s+class\s+(\w+)/);
    if (classMatch) {
      exports.push({
        name: classMatch[1],
        kind: "class",
        isDefault: false,
        location: { file: "", startLine: lineNum, endLine: lineNum },
      });
      continue;
    }

    // export interface
    const ifaceMatch = line.match(/export\s+interface\s+(\w+)/);
    if (ifaceMatch) {
      exports.push({
        name: ifaceMatch[1],
        kind: "interface",
        isDefault: false,
        location: { file: "", startLine: lineNum, endLine: lineNum },
      });
      continue;
    }

    // export type
    const typeMatch = line.match(/export\s+type\s+(\w+)/);
    if (typeMatch) {
      exports.push({
        name: typeMatch[1],
        kind: "type",
        isDefault: false,
        location: { file: "", startLine: lineNum, endLine: lineNum },
      });
    }
  }

  return exports;
}

function extractTSInterfaces(content: string): ExtractedInterface[] {
  const interfaces: ExtractedInterface[] = [];

  // Match interface declarations
  const interfaceRegex =
    /(?:export\s+)?interface\s+(\w+)(?:<[^>]+>)?\s*(?:extends\s+[^{]+)?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;

  let match: RegExpExecArray | null = null;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    const properties = extractTSProperties(body);
    const methods = extractTSMethods(body);

    const startLine = content.substring(0, match.index).split("\n").length;

    interfaces.push({
      name,
      kind: "interface",
      language: "typescript",
      location: {
        file: "",
        startLine,
        endLine: startLine + match[0].split("\n").length - 1,
      },
      properties,
      methods,
      exported: match[0].startsWith("export"),
    });
  }

  // Match type declarations (simplified)
  const typeRegex = /(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=\s*\{([^}]+)\}/g;

  while ((match = typeRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    const properties = extractTSProperties(body);
    const startLine = content.substring(0, match.index).split("\n").length;

    interfaces.push({
      name,
      kind: "type",
      language: "typescript",
      location: {
        file: "",
        startLine,
        endLine: startLine + match[0].split("\n").length - 1,
      },
      properties,
      methods: [],
      exported: match[0].startsWith("export"),
    });
  }

  return interfaces;
}

function extractTSProperties(body: string): ExtractedProperty[] {
  const properties: ExtractedProperty[] = [];

  // Match property declarations: name?: type
  const propRegex = /(\w+)(\?)?:\s*([^;,\n]+)/g;

  let match: RegExpExecArray | null = null;
  while ((match = propRegex.exec(body)) !== null) {
    // Skip if it looks like a method
    if (match[3].includes("(") && match[3].includes(")")) {
      continue;
    }

    properties.push({
      name: match[1],
      type: match[3].trim(),
      optional: !!match[2],
      readonly: false,
    });
  }

  return properties;
}

function extractTSMethods(body: string): ExtractedMethod[] {
  const methods: ExtractedMethod[] = [];

  // Match method declarations: name(params): returnType
  const methodRegex = /(\w+)\s*\(([^)]*)\)\s*:\s*([^;]+)/g;

  let match: RegExpExecArray | null = null;
  while ((match = methodRegex.exec(body)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const returnType = match[3].trim();

    const parameters = paramsStr
      .split(",")
      .filter(Boolean)
      .map((p) => {
        const parts = p.trim().split(":");
        const nameWithOptional = parts[0].trim();
        const isOptional = nameWithOptional.endsWith("?");
        return {
          name: nameWithOptional.replace("?", ""),
          type: parts[1]?.trim() || "unknown",
          optional: isOptional,
        };
      });

    methods.push({
      name,
      parameters,
      returnType,
      async: returnType.includes("Promise"),
    });
  }

  return methods;
}

function extractTSFunctions(content: string): ExtractedMethod[] {
  const functions: ExtractedMethod[] = [];

  // Match function declarations
  const funcRegex =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g;

  let match: RegExpExecArray | null = null;
  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const returnType = match[3]?.trim() || "void";

    const parameters = paramsStr
      .split(",")
      .filter(Boolean)
      .map((p) => {
        const parts = p.trim().split(":");
        const nameWithOptional = parts[0].trim();
        const isOptional = nameWithOptional.endsWith("?");
        return {
          name: nameWithOptional.replace("?", ""),
          type: parts[1]?.trim() || "unknown",
          optional: isOptional,
        };
      });

    functions.push({
      name,
      parameters,
      returnType,
      async: match[0].includes("async"),
    });
  }

  return functions;
}

// =============================================================================
// Go Parser (Regex-based)
// =============================================================================

function parseGo(filePath: string, content: string): CodeAnalysis {
  const imports = extractGoImports(content);
  const interfaces = extractGoInterfaces(content);
  const functions = extractGoFunctions(content);

  return {
    file: filePath,
    language: "go",
    imports,
    exports: [], // Go uses capitalization for exports
    interfaces,
    functions,
    dependencies: imports.map((i) => i.source),
    metrics: calculateMetrics(content, interfaces, functions, imports, []),
  };
}

function extractGoImports(content: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

  // Single import
  const singleImportRegex = /import\s+"([^"]+)"/g;
  let match: RegExpExecArray | null = null;
  while ((match = singleImportRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      names: [match[1].split("/").pop() || match[1]],
      isDefault: false,
      isNamespace: false,
      location: {
        file: "",
        startLine: content.substring(0, match.index).split("\n").length,
        endLine: content.substring(0, match.index).split("\n").length,
      },
    });
  }

  // Multi-line import block
  const blockImportRegex = /import\s*\(\s*([\s\S]*?)\)/g;
  while ((match = blockImportRegex.exec(content)) !== null) {
    const block = match[1];
    const lineRegex = /(?:(\w+)\s+)?"([^"]+)"/g;
    let lineMatch: RegExpExecArray | null = null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      imports.push({
        source: lineMatch[2],
        names: [
          lineMatch[1] || lineMatch[2].split("/").pop() || lineMatch[2],
        ],
        isDefault: false,
        isNamespace: !!lineMatch[1],
        location: {
          file: "",
          startLine: content.substring(0, match.index).split("\n").length,
          endLine: content.substring(0, match.index).split("\n").length,
        },
      });
    }
  }

  return imports;
}

function extractGoInterfaces(content: string): ExtractedInterface[] {
  const interfaces: ExtractedInterface[] = [];

  // Match interface declarations
  const interfaceRegex = /type\s+(\w+)\s+interface\s*\{([^}]*)\}/g;

  let match: RegExpExecArray | null = null;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    const methods = body
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("//"))
      .map((line) => {
        const methodMatch = line
          .trim()
          .match(/(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|(\w+))?/);
        if (!methodMatch) return null;

        return {
          name: methodMatch[1],
          parameters: methodMatch[2]
            ? methodMatch[2].split(",").map((p) => {
                const parts = p.trim().split(/\s+/);
                return {
                  name: parts[0],
                  type: parts.slice(1).join(" ") || "unknown",
                  optional: false,
                };
              })
            : [],
          returnType: methodMatch[3] || methodMatch[4] || "void",
          async: false,
        };
      })
      .filter((m): m is ExtractedMethod => m !== null);

    interfaces.push({
      name,
      kind: "interface",
      language: "go",
      location: {
        file: "",
        startLine: content.substring(0, match.index).split("\n").length,
        endLine:
          content.substring(0, match.index).split("\n").length +
          match[0].split("\n").length -
          1,
      },
      properties: [],
      methods,
      exported: name[0] === name[0].toUpperCase(),
    });
  }

  // Match struct declarations
  const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/g;

  while ((match = structRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    const properties = body
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("//"))
      .map((line) => {
        const propMatch = line.trim().match(/(\w+)\s+(\S+)/);
        if (!propMatch) return null;
        return {
          name: propMatch[1],
          type: propMatch[2],
          optional: false,
          readonly: false,
        };
      })
      .filter((p): p is ExtractedProperty => p !== null);

    interfaces.push({
      name,
      kind: "struct",
      language: "go",
      location: {
        file: "",
        startLine: content.substring(0, match.index).split("\n").length,
        endLine:
          content.substring(0, match.index).split("\n").length +
          match[0].split("\n").length -
          1,
      },
      properties,
      methods: [],
      exported: name[0] === name[0].toUpperCase(),
    });
  }

  return interfaces;
}

function extractGoFunctions(content: string): ExtractedMethod[] {
  const functions: ExtractedMethod[] = [];

  // Match function declarations
  const funcRegex =
    /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|(\w+))?\s*\{/g;

  let match: RegExpExecArray | null = null;
  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const returnType = match[3] || match[4] || "void";

    const parameters = paramsStr
      .split(",")
      .filter(Boolean)
      .map((p) => {
        const parts = p.trim().split(/\s+/);
        return {
          name: parts[0],
          type: parts.slice(1).join(" ") || "unknown",
          optional: false,
        };
      });

    functions.push({
      name,
      parameters,
      returnType,
      async: false,
    });
  }

  return functions;
}

// =============================================================================
// Python Parser (Regex-based)
// =============================================================================

function parsePython(filePath: string, content: string): CodeAnalysis {
  const imports = extractPythonImports(content);
  const interfaces = extractPythonClasses(content);
  const functions = extractPythonFunctions(content);

  return {
    file: filePath,
    language: "python",
    imports,
    exports: [], // Python uses __all__ for explicit exports
    interfaces,
    functions,
    dependencies: imports.map((i) => i.source),
    metrics: calculateMetrics(content, interfaces, functions, imports, []),
  };
}

function extractPythonImports(content: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

  // Match: from x import y, z
  const fromImportRegex = /from\s+([\w.]+)\s+import\s+(.+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = fromImportRegex.exec(content)) !== null) {
    const names = match[2]
      .split(",")
      .map((n) => n.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);

    imports.push({
      source: match[1],
      names,
      isDefault: false,
      isNamespace: false,
      location: {
        file: "",
        startLine: content.substring(0, match.index).split("\n").length,
        endLine: content.substring(0, match.index).split("\n").length,
      },
    });
  }

  // Match: import x, y
  const importRegex = /^import\s+(.+)/gm;
  while ((match = importRegex.exec(content)) !== null) {
    const modules = match[1].split(",").map((m) => m.trim().split(/\s+as\s+/)[0]);

    for (const mod of modules) {
      imports.push({
        source: mod,
        names: [mod.split(".").pop() || mod],
        isDefault: false,
        isNamespace: true,
        location: {
          file: "",
          startLine: content.substring(0, match.index).split("\n").length,
          endLine: content.substring(0, match.index).split("\n").length,
        },
      });
    }
  }

  return imports;
}

function extractPythonClasses(content: string): ExtractedInterface[] {
  const classes: ExtractedInterface[] = [];

  // Match class declarations
  const classRegex = /class\s+(\w+)(?:\([^)]*\))?\s*:/g;

  let match: RegExpExecArray | null = null;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    const startLine = content.substring(0, match.index).split("\n").length;

    // Find class body (indented block)
    const afterClass = content.substring(match.index + match[0].length);
    const bodyLines: string[] = [];
    let endLine = startLine;

    for (const line of afterClass.split("\n")) {
      if (line.match(/^\s/) || line.trim() === "") {
        bodyLines.push(line);
        endLine++;
      } else if (bodyLines.length > 0) {
        break;
      }
    }

    const body = bodyLines.join("\n");
    const methods = extractPythonMethods(body);
    const properties = extractPythonProperties(body);

    classes.push({
      name,
      kind: "class",
      language: "python",
      location: {
        file: "",
        startLine,
        endLine,
      },
      properties,
      methods,
      exported: !name.startsWith("_"),
    });
  }

  return classes;
}

function extractPythonMethods(body: string): ExtractedMethod[] {
  const methods: ExtractedMethod[] = [];

  // Match method declarations
  const methodRegex =
    /def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/g;

  let match: RegExpExecArray | null = null;
  while ((match = methodRegex.exec(body)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const returnType = match[3]?.trim() || "None";

    const parameters = paramsStr
      .split(",")
      .filter((p) => p.trim() && p.trim() !== "self" && p.trim() !== "cls")
      .map((p) => {
        const parts = p.trim().split(":");
        const nameWithDefault = parts[0].trim();
        const hasDefault = nameWithDefault.includes("=");
        const paramName = nameWithDefault.split("=")[0].trim();

        return {
          name: paramName,
          type: parts[1]?.split("=")[0].trim() || "Any",
          optional: hasDefault,
          defaultValue: hasDefault ? nameWithDefault.split("=")[1]?.trim() : undefined,
        };
      });

    methods.push({
      name,
      parameters,
      returnType,
      async: body.substring(0, match.index).includes("async"),
    });
  }

  return methods;
}

function extractPythonProperties(body: string): ExtractedProperty[] {
  const properties: ExtractedProperty[] = [];

  // Match class attribute type hints
  const propRegex = /^\s+(\w+)\s*:\s*([^=\n]+)(?:\s*=\s*(.+))?/gm;

  let match: RegExpExecArray | null = null;
  while ((match = propRegex.exec(body)) !== null) {
    // Skip if it's inside a method (def)
    if (body.substring(0, match.index).match(/def\s+\w+[^:]*:\s*$/)) {
      continue;
    }

    properties.push({
      name: match[1],
      type: match[2].trim(),
      optional: !!match[3],
      readonly: false,
    });
  }

  return properties;
}

function extractPythonFunctions(content: string): ExtractedMethod[] {
  const functions: ExtractedMethod[] = [];

  // Match top-level function declarations (not indented)
  const funcRegex =
    /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/gm;

  let match: RegExpExecArray | null = null;
  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const returnType = match[3]?.trim() || "None";

    const parameters = paramsStr
      .split(",")
      .filter(Boolean)
      .map((p) => {
        const parts = p.trim().split(":");
        const nameWithDefault = parts[0].trim();
        const hasDefault = nameWithDefault.includes("=");
        const paramName = nameWithDefault.split("=")[0].trim();

        return {
          name: paramName,
          type: parts[1]?.split("=")[0].trim() || "Any",
          optional: hasDefault,
        };
      });

    functions.push({
      name,
      parameters,
      returnType,
      async: match[0].startsWith("async"),
    });
  }

  return functions;
}

// =============================================================================
// Utility Functions
// =============================================================================

function calculateMetrics(
  content: string,
  interfaces: ExtractedInterface[],
  functions: ExtractedMethod[],
  imports: ExtractedImport[],
  exports: ExtractedExport[]
): CodeMetrics {
  const lines = content.split("\n");
  const linesOfCode = lines.filter(
    (l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("#")
  ).length;

  return {
    lines: lines.length,
    linesOfCode,
    functions: functions.length,
    classes: interfaces.filter((i) => i.kind === "class").length,
    interfaces: interfaces.filter(
      (i) => i.kind === "interface" || i.kind === "type"
    ).length,
    imports: imports.length,
    exports: exports.length,
  };
}

function buildSimplifiedAST(
  content: string,
  language: SupportedLanguage,
  maxDepth: number
): ASTNode {
  const lines = content.split("\n");

  // Build a simplified AST based on structure
  const root: ASTNode = {
    type: "program",
    startPosition: { row: 0, column: 0 },
    endPosition: { row: lines.length - 1, column: lines[lines.length - 1]?.length || 0 },
    children: [],
  };

  // Parse based on language
  const analysis =
    language === "typescript"
      ? parseTypeScript("", content)
      : language === "go"
        ? parseGo("", content)
        : parsePython("", content);

  // Convert imports to AST nodes
  for (const imp of analysis.imports) {
    root.children?.push({
      type: "import_statement",
      text: imp.source,
      startPosition: { row: imp.location.startLine - 1, column: 0 },
      endPosition: { row: imp.location.endLine - 1, column: 0 },
    });
  }

  // Convert interfaces/classes to AST nodes
  for (const iface of analysis.interfaces) {
    const node: ASTNode = {
      type: `${iface.kind}_declaration`,
      text: iface.name,
      startPosition: { row: iface.location.startLine - 1, column: 0 },
      endPosition: { row: iface.location.endLine - 1, column: 0 },
      children: [],
    };

    if (maxDepth > 1) {
      // Add properties
      for (const prop of iface.properties) {
        node.children?.push({
          type: "property_declaration",
          text: `${prop.name}: ${prop.type}`,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 0 },
        });
      }

      // Add methods
      for (const method of iface.methods) {
        node.children?.push({
          type: "method_declaration",
          text: `${method.name}(${method.parameters.map((p) => p.name).join(", ")}): ${method.returnType}`,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 0 },
        });
      }
    }

    root.children?.push(node);
  }

  // Convert functions to AST nodes
  for (const func of analysis.functions) {
    root.children?.push({
      type: "function_declaration",
      text: `${func.name}(${func.parameters.map((p) => p.name).join(", ")}): ${func.returnType}`,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
    });
  }

  return root;
}
