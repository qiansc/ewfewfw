/**
 * c4a_code_ast tool
 *
 * Get AST structure of code files
 */
import { readFile } from "node:fs/promises";

import { extractAST, detectLanguage } from "../parsers/index.js";
import type { ASTInput } from "../schemas/inputSchemas.js";
import type { ASTNode } from "../types/index.js";

export interface ASTResult {
  file: string;
  language: string;
  ast: ASTNode;
}

/**
 * Extract AST from code file
 */
export async function getAST(input: ASTInput): Promise<ASTResult> {
  const { path, language, maxDepth = 10, nodeTypes } = input;

  const content = await readFile(path, "utf-8");
  const detectedLang = language ?? detectLanguage(path);

  if (!detectedLang) {
    throw new Error(`Cannot detect language for file: ${path}`);
  }

  let ast = await extractAST(path, content, maxDepth);

  // Filter by node types if specified
  if (nodeTypes && nodeTypes.length > 0) {
    ast = filterASTByTypes(ast, nodeTypes);
  }

  // Trim depth
  ast = trimASTDepth(ast, maxDepth);

  return {
    file: path,
    language: detectedLang,
    ast,
  };
}

/**
 * Filter AST to only include specific node types
 */
function filterASTByTypes(node: ASTNode, types: string[]): ASTNode {
  const typeSet = new Set(types);

  function filter(n: ASTNode): ASTNode | null {
    // Always include root
    if (n.type === "program") {
      return {
        ...n,
        children: n.children
          ?.map((c) => filter(c))
          .filter((c): c is ASTNode => c !== null),
      };
    }

    // Check if this node type is included
    if (!typeSet.has(n.type)) {
      // Still check children
      const filteredChildren = n.children
        ?.map((c) => filter(c))
        .filter((c): c is ASTNode => c !== null);

      if (filteredChildren && filteredChildren.length > 0) {
        return {
          ...n,
          children: filteredChildren,
        };
      }
      return null;
    }

    return {
      ...n,
      children: n.children
        ?.map((c) => filter(c))
        .filter((c): c is ASTNode => c !== null),
    };
  }

  return filter(node) || node;
}

/**
 * Trim AST to maximum depth
 */
function trimASTDepth(node: ASTNode, maxDepth: number, currentDepth = 0): ASTNode {
  if (currentDepth >= maxDepth) {
    // Remove children beyond max depth
    const { children: _, ...rest } = node;
    return {
      ...rest,
      children: node.children?.length
        ? [
            {
              type: "...",
              text: `${node.children.length} children omitted`,
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 0 },
            },
          ]
        : undefined,
    };
  }

  return {
    ...node,
    children: node.children?.map((c) =>
      trimASTDepth(c, maxDepth, currentDepth + 1)
    ),
  };
}
