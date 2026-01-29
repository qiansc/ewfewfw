import type {
  ASTNode,
  CodeAnalysis,
  CodeLocation,
  ExtractedMethod,
  ExtractedProperty,
} from "../types/index.js";

export function buildSimplifiedAST(
  content: string,
  analysis: CodeAnalysis,
  maxDepth: number
): ASTNode {
  const lines = content.split("\n");
  const filePath = analysis.file;
  const root: ASTNode = {
    type: "program",
    location: {
      file: filePath,
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 1,
      endColumn: lines[lines.length - 1]?.length ? lines[lines.length - 1].length + 1 : 1,
    },
    startPosition: { row: 0, column: 0 },
    endPosition: {
      row: Math.max(lines.length - 1, 0),
      column: lines[lines.length - 1]?.length || 0,
    },
    children: [],
  };

  if (maxDepth <= 0) {
    return root;
  }

  const details = analysis.details;
  if (!details) {
    return root;
  }

  for (const imp of details.imports) {
    const location = imp.location;
    root.children?.push({
      type: "import_statement",
      name: imp.source,
      text: imp.source,
      location,
      startPosition: toStartPosition(location),
      endPosition: toEndPosition(location),
    });
  }

  for (const iface of details.interfaces) {
    const node: ASTNode = {
      type: `${iface.kind}_declaration`,
      name: iface.name,
      text: iface.name,
      location: iface.location,
      startPosition: toStartPosition(iface.location),
      endPosition: toEndPosition(iface.location),
      children: [],
    };

    if (maxDepth > 1) {
      node.children?.push(...buildPropertyNodes(iface.properties));
      node.children?.push(...buildMethodNodes(iface.methods));
    }

    root.children?.push(node);
  }

  for (const fn of details.functions) {
    root.children?.push({
      type: "function_declaration",
      name: fn.name,
      text: fn.name,
      location: fn.location,
      startPosition: toStartPosition(fn.location),
      endPosition: toEndPosition(fn.location),
    });
  }

  return root;
}

function buildPropertyNodes(properties: ExtractedProperty[]): ASTNode[] {
  return properties.map((prop) => ({
    type: "property_declaration",
    name: prop.name,
    text: `${prop.name}: ${prop.type}`,
    location: prop.location,
    startPosition: toStartPosition(prop.location),
    endPosition: toEndPosition(prop.location),
  }));
}

function buildMethodNodes(methods: ExtractedMethod[]): ASTNode[] {
  return methods.map((method) => ({
    type: "method_declaration",
    name: method.name,
    text: method.name,
    location: method.location,
    startPosition: toStartPosition(method.location),
    endPosition: toEndPosition(method.location),
  }));
}

function toStartPosition(location: CodeLocation): { row: number; column: number } {
  const startColumn = location.startColumn ?? 1;
  return { row: location.startLine - 1, column: Math.max(startColumn - 1, 0) };
}

function toEndPosition(location: CodeLocation): { row: number; column: number } {
  const endColumn = location.endColumn ?? (location.startColumn ?? 1);
  return { row: location.endLine - 1, column: Math.max(endColumn - 1, 0) };
}
