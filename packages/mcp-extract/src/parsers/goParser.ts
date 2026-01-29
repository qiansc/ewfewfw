import type {
  CodeAnalysis,
  ExtractedImport,
  ExtractedInterface,
  ExtractedMethod,
  ExtractedProperty,
} from "../types/index.js";
import { calculateMetrics } from "./metrics.js";
import { parseWithTreeSitter } from "./treeSitter.js";

export async function parseGo(filePath: string, content: string): Promise<CodeAnalysis> {
  try {
    return await parseGoWithTreeSitter(filePath, content);
  } catch (error) {
    const analysis = parseGoWithRegex(filePath, content);
    analysis.warnings = [
      `tree-sitter-go 不可用，已回退到正则解析: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
    return analysis;
  }
}

async function parseGoWithTreeSitter(
  filePath: string,
  content: string
): Promise<CodeAnalysis> {
  const tree = await parseWithTreeSitter("go", "tree-sitter-go.wasm", content);
  const root = tree.rootNode;
  const imports = extractGoImportsFromTree(root, content);
  const interfaces = extractGoInterfacesFromTree(root, content);
  const functions = extractGoFunctionsFromTree(root, content);
  const metrics = calculateMetrics(content, interfaces, functions, imports, []);

  return {
    file: filePath,
    language: "go",
    lines: metrics.lines,
    linesOfCode: metrics.linesOfCode,
    functions: metrics.functions,
    classes: metrics.classes,
    interfaces: metrics.interfaces,
    imports: metrics.imports,
    exports: metrics.exports,
    dependencies: imports.map((i) => i.source),
    details: {
      imports,
      exports: [],
      interfaces,
      functions,
    },
  };
}

function parseGoWithRegex(filePath: string, content: string): CodeAnalysis {
  const imports = extractGoImports(content);
  const interfaces = extractGoInterfaces(content);
  const functions = extractGoFunctions(content);
  const metrics = calculateMetrics(content, interfaces, functions, imports, []);

  return {
    file: filePath,
    language: "go",
    lines: metrics.lines,
    linesOfCode: metrics.linesOfCode,
    functions: metrics.functions,
    classes: metrics.classes,
    interfaces: metrics.interfaces,
    imports: metrics.imports,
    exports: metrics.exports,
    dependencies: imports.map((i) => i.source),
    details: {
      imports,
      exports: [],
      interfaces,
      functions,
    },
  };
}

function extractGoImports(content: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

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

  const blockImportRegex = /import\s*\(\s*([\s\S]*?)\)/g;
  while ((match = blockImportRegex.exec(content)) !== null) {
    const block = match[1];
    const lineRegex = /(?:(\w+)\s+)?"([^"]+)"/g;
    let lineMatch: RegExpExecArray | null = null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      imports.push({
        source: lineMatch[2],
        names: [lineMatch[1] || lineMatch[2].split("/").pop() || lineMatch[2]],
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

  const interfaceRegex = /type\s+(\w+)\s+interface\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];
    const startLine = content.substring(0, match.index).split("\n").length;
    const bodyLines = body.split("\n");

    const methods: ExtractedMethod[] = [];
    for (const [index, line] of bodyLines.entries()) {
      if (!line.trim() || line.trim().startsWith("//")) continue;
      const methodMatch = line
        .trim()
        .match(/(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|(\w+))?/);
      if (!methodMatch) continue;

      const lineNumber = startLine + index + 1;
      methods.push({
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
        location: {
          file: "",
          startLine: lineNumber,
          endLine: lineNumber,
        },
      });
    }

    interfaces.push({
      name,
      kind: "interface",
      language: "go",
      location: {
        file: "",
        startLine,
        endLine: startLine + match[0].split("\n").length - 1,
      },
      properties: [],
      methods,
      exported: name[0] === name[0].toUpperCase(),
    });
  }

  const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/g;
  while ((match = structRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];
    const startLine = content.substring(0, match.index).split("\n").length;
    const bodyLines = body.split("\n");

    const properties: ExtractedProperty[] = [];
    for (const [index, line] of bodyLines.entries()) {
      if (!line.trim() || line.trim().startsWith("//")) continue;
      const propMatch = line.trim().match(/(\w+)\s+(\S+)/);
      if (!propMatch) continue;
      const lineNumber = startLine + index + 1;
      properties.push({
        name: propMatch[1],
        type: propMatch[2],
        optional: false,
        readonly: false,
        location: {
          file: "",
          startLine: lineNumber,
          endLine: lineNumber,
        },
      });
    }

    interfaces.push({
      name,
      kind: "struct",
      language: "go",
      location: {
        file: "",
        startLine,
        endLine: startLine + match[0].split("\n").length - 1,
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
      location: locationFromIndex(content, match.index),
    });
  }

  return functions;
}

function extractGoImportsFromTree(
  root: { children: Array<{ type: string }> },
  content: string
): ExtractedImport[] {
  const imports: ExtractedImport[] = [];
  walk(root as unknown as TreeNode, (node) => {
    if (node.type !== "import_spec") return;
    const pathNode = node.childForFieldName("path");
    if (!pathNode) return;
    const rawPath = getNodeText(pathNode, content);
    const source = rawPath.replace(/^"/, "").replace(/"$/, "");
    const nameNode = node.childForFieldName("name");
    const alias = nameNode ? getNodeText(nameNode, content) : undefined;
    const name = alias || source.split("/").pop() || source;
    imports.push({
      source,
      names: [name],
      isDefault: false,
      isNamespace: !!alias,
      location: {
        file: "",
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
    });
  });
  return imports;
}

function extractGoInterfacesFromTree(
  root: { children: Array<{ type: string }> },
  content: string
): ExtractedInterface[] {
  const interfaces: ExtractedInterface[] = [];
  walk(root as unknown as TreeNode, (node) => {
    if (node.type !== "type_spec") return;
    const nameNode = node.childForFieldName("name");
    const typeNode = node.childForFieldName("type");
    if (!nameNode || !typeNode) return;
    const name = getNodeText(nameNode, content);

    if (typeNode.type === "interface_type") {
      const methods = extractGoInterfaceMethods(typeNode, content);
      interfaces.push({
        name,
        kind: "interface",
        language: "go",
        location: {
          file: "",
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        },
        properties: [],
        methods,
        exported: name[0] === name[0].toUpperCase(),
      });
    } else if (typeNode.type === "struct_type") {
      const properties = extractGoStructFields(typeNode, content);
      interfaces.push({
        name,
        kind: "struct",
        language: "go",
        location: {
          file: "",
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        },
        properties,
        methods: [],
        exported: name[0] === name[0].toUpperCase(),
      });
    }
  });
  return interfaces;
}

function extractGoInterfaceMethods(
  interfaceNode: TreeNode,
  content: string
): ExtractedMethod[] {
  const methods: ExtractedMethod[] = [];
  const methodSpecs = interfaceNode.descendantsOfType("method_spec");
  for (const methodNode of methodSpecs) {
    const nameNode = methodNode.childForFieldName("name");
    if (!nameNode) continue;
    const name = getNodeText(nameNode, content);
    const paramsNode = methodNode.childForFieldName("parameters");
    const resultNode = methodNode.childForFieldName("result");
    const parameters = parseGoParameters(paramsNode ? getNodeText(paramsNode, content) : "");
    const returnType = resultNode ? getNodeText(resultNode, content) : "void";
    methods.push({
      name,
      parameters,
      returnType,
      async: false,
      location: toLocation(methodNode),
    });
  }
  return methods;
}

function extractGoStructFields(
  structNode: TreeNode,
  content: string
): ExtractedProperty[] {
  const properties: ExtractedProperty[] = [];
  const fieldDecls = structNode.descendantsOfType("field_declaration");
  for (const field of fieldDecls) {
    const text = getNodeText(field, content).trim();
    const match = text.match(/^(\w+)\s+(\S+)/);
    if (!match) continue;
    properties.push({
      name: match[1],
      type: match[2],
      optional: false,
      readonly: false,
      location: toLocation(field),
    });
  }
  return properties;
}

function extractGoFunctionsFromTree(
  root: { children: Array<{ type: string }> },
  content: string
): ExtractedMethod[] {
  const functions: ExtractedMethod[] = [];
  walk(root as unknown as TreeNode, (node) => {
    if (node.type !== "function_declaration" && node.type !== "method_declaration") {
      return;
    }
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = getNodeText(nameNode, content);
    const paramsNode = node.childForFieldName("parameters");
    const resultNode = node.childForFieldName("result");
    const parameters = parseGoParameters(paramsNode ? getNodeText(paramsNode, content) : "");
    const returnType = resultNode ? getNodeText(resultNode, content) : "void";
    functions.push({
      name,
      parameters,
      returnType,
      async: false,
      location: toLocation(node),
    });
  });
  return functions;
}

function parseGoParameters(paramText: string): Array<{ name: string; type: string; optional: false }> {
  const cleaned = paramText.replace(/^\(/, "").replace(/\)$/, "").trim();
  if (!cleaned) return [];
  return cleaned.split(",").map((segment) => {
    const parts = segment.trim().split(/\s+/);
    return {
      name: parts[0] || "param",
      type: parts.slice(1).join(" ") || "unknown",
      optional: false,
    };
  });
}

type TreeNode = {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  children: TreeNode[];
  childForFieldName(name: string): TreeNode | null;
  descendantsOfType(type: string): TreeNode[];
};

function getNodeText(node: TreeNode, content: string): string {
  return content.slice(node.startIndex, node.endIndex);
}

function toLocation(node: TreeNode): { file: string; startLine: number; endLine: number; startColumn: number; endColumn: number } {
  return {
    file: "",
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endColumn: node.endPosition.column + 1,
  };
}

function locationFromIndex(content: string, index: number): { file: string; startLine: number; endLine: number; startColumn: number } {
  const before = content.slice(0, index);
  const lines = before.split("\n");
  const lineNumber = lines.length;
  const columnNumber = lines[lines.length - 1]?.length ?? 0;
  return {
    file: "",
    startLine: lineNumber,
    endLine: lineNumber,
    startColumn: columnNumber + 1,
  };
}

function walk(node: TreeNode, visit: (node: TreeNode) => void): void {
  visit(node);
  for (const child of node.children || []) {
    walk(child, visit);
  }
}
