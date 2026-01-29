/**
 * Code Parser - Unified interface for parsing code files
 *
 * Uses language-specific parsers and provides a simplified AST view.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { ASTNode, CodeAnalysis, SupportedLanguage } from "../types/index.js";
import { buildSimplifiedAST } from "./astBuilder.js";
import { parseGo } from "./goParser.js";
import { parsePython } from "./pythonParser.js";
import { parseTypeScript } from "./typescriptParser.js";

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

  switch (lang) {
    case "typescript":
      return parseTypeScript(filePath, fileContent);
    case "go":
      return await parseGo(filePath, fileContent);
    case "python":
      return await parsePython(filePath, fileContent);
    default:
      throw new Error(`Unsupported language: ${lang}`);
  }
}

export async function extractAST(
  filePath: string,
  content?: string,
  maxDepth: number = 10,
  language?: SupportedLanguage
): Promise<ASTNode> {
  const fileContent = content ?? (await readFile(filePath, "utf-8"));
  const lang = language ?? detectLanguage(filePath);

  if (!lang) {
    throw new Error(`Unsupported file type: ${filePath}`);
  }

  const analysis = await parseFile(filePath, fileContent, lang);
  return buildSimplifiedAST(fileContent, analysis, maxDepth);
}
