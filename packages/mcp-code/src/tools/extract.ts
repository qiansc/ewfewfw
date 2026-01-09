/**
 * c4a_code_extract tool
 *
 * Extract interfaces, types, classes from code files
 */
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import fg from "fast-glob";

import { parseFile, detectLanguage } from "../parsers/index.js";
import type { ExtractInput } from "../schemas/inputSchemas.js";
import type { ExtractedInterface, SupportedLanguage } from "../types/index.js";

export interface ExtractResult {
  files: number;
  interfaces: ExtractedInterface[];
  errors: Array<{ file: string; error: string }>;
}

/**
 * Extract interfaces and types from code files
 */
export async function extract(input: ExtractInput): Promise<ExtractResult> {
  const {
    path,
    language,
    recursive = false,
    include = [],
    exclude = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
  } = input;

  const result: ExtractResult = {
    files: 0,
    interfaces: [],
    errors: [],
  };

  // Check if path is file or directory
  const pathStat = await stat(path);

  if (pathStat.isFile()) {
    // Single file
    try {
      const analysis = await parseFile(path, undefined, language);
      result.files = 1;
      result.interfaces = analysis.interfaces.map((i) => ({
        ...i,
        location: { ...i.location, file: path },
      }));
    } catch (error) {
      result.errors.push({
        file: path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return result;
  }

  // Directory - find files
  const defaultPatterns = getDefaultPatterns(language);
  const patterns =
    include.length > 0
      ? include
      : recursive
        ? defaultPatterns.map((p) => `**/${p}`)
        : defaultPatterns;

  const files = await fg(patterns, {
    cwd: path,
    ignore: exclude,
    absolute: true,
  });

  for (const file of files) {
    try {
      const fileLang = language ?? detectLanguage(file);
      if (!fileLang) continue;

      const analysis = await parseFile(file, undefined, fileLang);
      result.files++;

      for (const iface of analysis.interfaces) {
        result.interfaces.push({
          ...iface,
          location: { ...iface.location, file: relative(path, file) },
        });
      }
    } catch (error) {
      result.errors.push({
        file: relative(path, file),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function getDefaultPatterns(language?: SupportedLanguage): string[] {
  if (!language) {
    return ["*.ts", "*.tsx", "*.js", "*.jsx", "*.go", "*.py"];
  }

  switch (language) {
    case "typescript":
      return ["*.ts", "*.tsx", "*.js", "*.jsx"];
    case "go":
      return ["*.go"];
    case "python":
      return ["*.py"];
    default:
      return ["*"];
  }
}
