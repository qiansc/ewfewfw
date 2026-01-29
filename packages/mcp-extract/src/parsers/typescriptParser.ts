import { extname } from "node:path";
import ts from "typescript";

import type {
  CodeAnalysis,
  CodeLocation,
  ExtractedExport,
  ExtractedImport,
  ExtractedInterface,
  ExtractedMethod,
  ExtractedParameter,
  ExtractedProperty,
} from "../types/index.js";
import { calculateMetrics } from "./metrics.js";

export function parseTypeScript(filePath: string, content: string): CodeAnalysis {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );

  const imports: ExtractedImport[] = [];
  const exports: ExtractedExport[] = [];
  const interfaces: ExtractedInterface[] = [];
  const functions: ExtractedMethod[] = [];

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      imports.push(extractImport(node, sourceFile));
      return;
    }

    if (ts.isExportDeclaration(node)) {
      exports.push(...extractExportDeclaration(node, sourceFile));
      return;
    }

    if (ts.isExportAssignment(node)) {
      exports.push({
        name: "default",
        kind: "variable",
        isDefault: true,
        location: getLocation(node, sourceFile),
      });
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      const extracted = extractInterface(node, sourceFile);
      interfaces.push(extracted);
      if (extracted.exported) {
        exports.push({
          name: extracted.name,
          kind: "interface",
          isDefault: false,
          location: extracted.location,
        });
      }
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const extracted = extractTypeAlias(node, sourceFile);
      interfaces.push(extracted);
      if (extracted.exported) {
        exports.push({
          name: extracted.name,
          kind: "type",
          isDefault: false,
          location: extracted.location,
        });
      }
      return;
    }

    if (ts.isClassDeclaration(node)) {
      const extracted = extractClass(node, sourceFile);
      interfaces.push(extracted);
      if (extracted.exported) {
        exports.push({
          name: extracted.name,
          kind: "class",
          isDefault: hasDefaultModifier(node),
          location: extracted.location,
        });
      }
      return;
    }

    if (ts.isFunctionDeclaration(node)) {
      const extracted = extractFunction(node, sourceFile);
      if (extracted) {
        functions.push(extracted);
        if (hasExportModifier(node)) {
          exports.push({
            name: extracted.name,
            kind: "function",
            isDefault: hasDefaultModifier(node),
            location: getLocation(node, sourceFile),
          });
        }
      }
      return;
    }

    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        exports.push({
          name: declaration.name.text,
          kind: isConst ? "const" : "variable",
          isDefault: false,
          location: getLocation(declaration, sourceFile),
        });
      }
    }
  });

  const metrics = calculateMetrics(content, interfaces, functions, imports, exports);

  return {
    file: filePath,
    language: "typescript",
    lines: metrics.lines,
    linesOfCode: metrics.linesOfCode,
    functions: metrics.functions,
    classes: metrics.classes,
    interfaces: metrics.interfaces,
    imports: metrics.imports,
    exports: metrics.exports,
    dependencies: imports.map((imp) => imp.source),
    details: {
      imports,
      exports,
      interfaces,
      functions,
    },
  };
}

function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function extractImport(
  node: ts.ImportDeclaration,
  sourceFile: ts.SourceFile
): ExtractedImport {
  const source = (node.moduleSpecifier as ts.StringLiteral).text;
  const importClause = node.importClause;
  const names: string[] = [];
  let isDefault = false;
  let isNamespace = false;

  if (importClause?.name) {
    isDefault = true;
    names.push(importClause.name.text);
  }

  if (importClause?.namedBindings) {
    if (ts.isNamespaceImport(importClause.namedBindings)) {
      isNamespace = true;
      names.push(importClause.namedBindings.name.text);
    } else if (ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        names.push(element.name.text);
      }
    }
  }

  return {
    source,
    names,
    isDefault,
    isNamespace,
    location: getLocation(node, sourceFile),
  };
}

function extractExportDeclaration(
  node: ts.ExportDeclaration,
  sourceFile: ts.SourceFile
): ExtractedExport[] {
  const results: ExtractedExport[] = [];

  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return results;
  }

  for (const element of node.exportClause.elements) {
    results.push({
      name: element.name.text,
      kind: "variable",
      isDefault: false,
      location: getLocation(element, sourceFile),
    });
  }

  return results;
}

function extractInterface(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile
): ExtractedInterface {
  const { properties, methods } = extractMembers(node.members, sourceFile);

  return {
    name: node.name.text,
    kind: "interface",
    language: "typescript",
    location: getLocation(node, sourceFile),
    properties,
    methods,
    exported: hasExportModifier(node),
  };
}

function extractTypeAlias(
  node: ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile
): ExtractedInterface {
  let properties: ExtractedProperty[] = [];
  let methods: ExtractedMethod[] = [];

  if (ts.isTypeLiteralNode(node.type)) {
    const extracted = extractMembers(node.type.members, sourceFile);
    properties = extracted.properties;
    methods = extracted.methods;
  }

  return {
    name: node.name.text,
    kind: "type",
    language: "typescript",
    location: getLocation(node, sourceFile),
    properties,
    methods,
    exported: hasExportModifier(node),
  };
}

function extractClass(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile
): ExtractedInterface {
  const properties: ExtractedProperty[] = [];
  const methods: ExtractedMethod[] = [];

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      properties.push(extractClassProperty(member, sourceFile));
    } else if (ts.isMethodDeclaration(member)) {
      methods.push(extractClassMethod(member, sourceFile));
    }
  }

  return {
    name: node.name?.text || "default",
    kind: "class",
    language: "typescript",
    location: getLocation(node, sourceFile),
    properties,
    methods,
    exported: hasExportModifier(node),
  };
}

function extractFunction(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile
): ExtractedMethod | null {
  if (!node.name) {
    return null;
  }

  return {
    name: node.name.text,
    parameters: node.parameters.map((param) => extractParameter(param, sourceFile)),
    returnType: node.type ? node.type.getText(sourceFile) : "void",
    async: hasAsyncModifier(node),
    location: getLocation(node, sourceFile),
  };
}

function extractMembers(
  members: ts.NodeArray<ts.TypeElement>,
  sourceFile: ts.SourceFile
): { properties: ExtractedProperty[]; methods: ExtractedMethod[] } {
  const properties: ExtractedProperty[] = [];
  const methods: ExtractedMethod[] = [];

  for (const member of members) {
    if (ts.isPropertySignature(member)) {
      properties.push(extractPropertySignature(member, sourceFile));
    } else if (ts.isMethodSignature(member)) {
      methods.push(extractMethodSignature(member, sourceFile));
    }
  }

  return { properties, methods };
}

function extractPropertySignature(
  member: ts.PropertySignature,
  sourceFile: ts.SourceFile
): ExtractedProperty {
  return {
    name: member.name.getText(sourceFile),
    type: member.type ? member.type.getText(sourceFile) : "any",
    optional: !!member.questionToken,
    readonly: hasReadonlyModifier(member),
    location: getLocation(member, sourceFile),
  };
}

function extractMethodSignature(
  member: ts.MethodSignature,
  sourceFile: ts.SourceFile
): ExtractedMethod {
  return {
    name: member.name.getText(sourceFile),
    parameters: member.parameters.map((param) => extractParameter(param, sourceFile)),
    returnType: member.type ? member.type.getText(sourceFile) : "void",
    async: false,
    location: getLocation(member, sourceFile),
  };
}

function extractClassProperty(
  member: ts.PropertyDeclaration,
  sourceFile: ts.SourceFile
): ExtractedProperty {
  return {
    name: member.name.getText(sourceFile),
    type: member.type ? member.type.getText(sourceFile) : "any",
    optional: !!member.questionToken,
    readonly: hasReadonlyModifier(member),
    location: getLocation(member, sourceFile),
  };
}

function extractClassMethod(
  member: ts.MethodDeclaration,
  sourceFile: ts.SourceFile
): ExtractedMethod {
  return {
    name: member.name.getText(sourceFile),
    parameters: member.parameters.map((param) => extractParameter(param, sourceFile)),
    returnType: member.type ? member.type.getText(sourceFile) : "void",
    async: hasAsyncModifier(member),
    location: getLocation(member, sourceFile),
  };
}

function extractParameter(
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile
): ExtractedParameter {
  return {
    name: parameter.name.getText(sourceFile),
    type: parameter.type ? parameter.type.getText(sourceFile) : "any",
    optional: !!parameter.questionToken || !!parameter.initializer,
    defaultValue: parameter.initializer ? parameter.initializer.getText(sourceFile) : undefined,
  };
}

function getLocation(node: ts.Node, sourceFile: ts.SourceFile): CodeLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

  return {
    file: sourceFile.fileName,
    startLine: start.line + 1,
    endLine: end.line + 1,
    startColumn: start.character + 1,
    endColumn: end.character + 1,
  };
}

function hasExportModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function hasReadonlyModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ReadonlyKeyword);
}

function hasAsyncModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.AsyncKeyword);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return modifiers ? modifiers.some((modifier) => modifier.kind === kind) : false;
}
