import type {
  CodeAnalysis,
  ExtractedImport,
  ExtractedInterface,
  ExtractedMethod,
  ExtractedProperty,
} from "../types/index.js";
import { calculateMetrics } from "./metrics.js";
import { parseWithTreeSitter } from "./treeSitter.js";

export async function parsePython(
  filePath: string,
  content: string
): Promise<CodeAnalysis> {
  try {
    return await parsePythonWithTreeSitter(filePath, content);
  } catch (error) {
    const analysis = parsePythonWithRegex(filePath, content);
    analysis.warnings = [
      `tree-sitter-python 不可用，已回退到正则解析: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
    return analysis;
  }
}

async function parsePythonWithTreeSitter(
  filePath: string,
  content: string
): Promise<CodeAnalysis> {
  const tree = await parseWithTreeSitter(
    "python",
    "tree-sitter-python.wasm",
    content
  );
  const root = tree.rootNode;
  const imports = extractPythonImports(content);
  const interfaces = extractPythonClassesFromTree(root, content);
  const functions = extractPythonFunctionsFromTree(root, content);
  const metrics = calculateMetrics(content, interfaces, functions, imports, []);

  return {
    file: filePath,
    language: "python",
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

function parsePythonWithRegex(filePath: string, content: string): CodeAnalysis {
  const imports = extractPythonImports(content);
  const interfaces = extractPythonClasses(content);
  const functions = extractPythonFunctions(content);
  const metrics = calculateMetrics(content, interfaces, functions, imports, []);

  return {
    file: filePath,
    language: "python",
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

function extractPythonImports(content: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

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
  const classRegex = /class\s+(\w+)(?:\([^)]*\))?\s*:/g;

  let match: RegExpExecArray | null = null;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1];
    const startLine = content.substring(0, match.index).split("\n").length;

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
    const bodyStartLine = startLine + 1;
    const methods = extractPythonMethods(body, bodyStartLine);
    const properties = extractPythonProperties(body, bodyStartLine);

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

function extractPythonMethods(body: string, baseLine: number): ExtractedMethod[] {
  const methods: ExtractedMethod[] = [];
  const methodRegex = /def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/g;

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
      location: locationFromIndex(body, match.index, baseLine),
    });
  }

  return methods;
}

function extractPythonProperties(body: string, baseLine: number): ExtractedProperty[] {
  const properties: ExtractedProperty[] = [];
  const propRegex = /^\s+(\w+)\s*:\s*([^=\n]+)(?:\s*=\s*(.+))?/gm;

  let match: RegExpExecArray | null = null;
  while ((match = propRegex.exec(body)) !== null) {
    if (body.substring(0, match.index).match(/def\s+\w+[^:]*:\s*$/)) {
      continue;
    }

    properties.push({
      name: match[1],
      type: match[2].trim(),
      optional: !!match[3],
      readonly: false,
      location: locationFromIndex(body, match.index, baseLine),
    });
  }

  return properties;
}

function extractPythonFunctions(content: string): ExtractedMethod[] {
  const functions: ExtractedMethod[] = [];
  const funcRegex = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/gm;

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
      location: locationFromIndex(content, match.index, 1),
    });
  }

  return functions;
}

function extractPythonClassesFromTree(
  root: TreeNode,
  content: string
): ExtractedInterface[] {
  const classes: ExtractedInterface[] = [];
  const classNodes = root.descendantsOfType("class_definition");

  for (const node of classNodes) {
    const nameNode = node.childForFieldName("name");
    const bodyNode = node.childForFieldName("body");
    if (!nameNode || !bodyNode) continue;
    const name = getNodeText(nameNode, content);
    const bodyText = getNodeText(bodyNode, content);
    const bodyStartLine = bodyNode.startPosition.row + 1;
    const methods = extractPythonMethods(bodyText, bodyStartLine);
    const properties = extractPythonProperties(bodyText, bodyStartLine);

    classes.push({
      name,
      kind: "class",
      language: "python",
      location: {
        file: "",
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
      properties,
      methods,
      exported: !name.startsWith("_"),
    });
  }

  return classes;
}

function extractPythonFunctionsFromTree(
  root: TreeNode,
  content: string
): ExtractedMethod[] {
  const functions: ExtractedMethod[] = [];
  const funcNodes = [
    ...root.descendantsOfType("function_definition"),
    ...root.descendantsOfType("async_function_definition"),
  ];

  for (const node of funcNodes) {
    if (hasAncestorType(node, "class_definition")) {
      continue;
    }

    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    const returnNode = node.childForFieldName("return_type");
    if (!nameNode || !paramsNode) continue;

    const name = getNodeText(nameNode, content);
    const paramText = getNodeText(paramsNode, content);
    const parameters = parsePythonParameters(paramText);
    const returnType = returnNode ? getNodeText(returnNode, content) : "None";
    const async = node.type === "async_function_definition";

    functions.push({
      name,
      parameters,
      returnType,
      async,
      location: toLocation(node),
    });
  }

  return functions;
}

function parsePythonParameters(paramText: string): ExtractedMethod["parameters"] {
  const cleaned = paramText.replace(/^\(/, "").replace(/\)$/, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "self" && segment !== "cls")
    .map((segment) => {
      const parts = segment.split(":");
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
}

function locationFromIndex(
  content: string,
  index: number,
  baseLine: number
): { file: string; startLine: number; endLine: number; startColumn: number } {
  const before = content.slice(0, index);
  const lines = before.split("\n");
  const lineNumber = baseLine + lines.length - 1;
  const columnNumber = lines[lines.length - 1]?.length ?? 0;
  return {
    file: "",
    startLine: lineNumber,
    endLine: lineNumber,
    startColumn: columnNumber + 1,
  };
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

type TreeNode = {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  children: TreeNode[];
  parent: TreeNode | null;
  childForFieldName(name: string): TreeNode | null;
  descendantsOfType(type: string | string[]): TreeNode[];
};

function getNodeText(node: TreeNode, content: string): string {
  return content.slice(node.startIndex, node.endIndex);
}

function hasAncestorType(node: TreeNode, type: string): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === type) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
