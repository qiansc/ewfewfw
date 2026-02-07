/**
 * c4a_extract_interfaces tool
 *
 * Extract interfaces, types, classes from code files
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";

import { parseFile, detectLanguage } from "../parsers/index.js";
import { getDisplayPath, resolveCodePath } from "../utils/pathGuard.js";
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

  const resolvedPath = await resolveCodePath(path);

  const result: ExtractResult = {
    files: 0,
    interfaces: [],
    errors: [],
  };

  // Check if path is file or directory
  const pathStat = await stat(resolvedPath);

  if (pathStat.isFile()) {
    // Single file
    try {
      const analysis = await parseFile(resolvedPath, undefined, language);
      const displayPath = getDisplayPath(resolvedPath, resolvedPath, false);
      result.files = 1;
      if (analysis.details) {
        result.interfaces = analysis.details.interfaces.map((i) => ({
          ...i,
          location: { ...i.location, file: displayPath },
          properties: i.properties.map((p) => ({
            ...p,
            location: { ...p.location, file: displayPath },
          })),
          methods: i.methods.map((m) => ({
            ...m,
            location: { ...m.location, file: displayPath },
          })),
        }));
      }
      if (analysis.warnings) {
        result.errors.push(
          ...analysis.warnings.map((warning) => ({
            file: displayPath,
            error: `warning: ${warning}`,
          }))
        );
      }
    } catch (error) {
      result.errors.push({
        file: getDisplayPath(resolvedPath, resolvedPath, false),
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
    cwd: resolvedPath,
    ignore: exclude,
    absolute: true,
    followSymbolicLinks: false,
  });

  if (files.length > 1000) {
    result.errors.push({
      file: path,
      error: `warning: matched ${files.length} files (soft limit: 1000)`,
    });
  }

  for (const file of files) {
    try {
      const fileLang = language ?? detectLanguage(file);
      if (!fileLang) continue;

      const analysis = await parseFile(file, undefined, fileLang);
      result.files++;

      const displayPath = getDisplayPath(file, resolvedPath, true);
      if (analysis.details) {
        for (const iface of analysis.details.interfaces) {
          result.interfaces.push({
            ...iface,
            location: { ...iface.location, file: displayPath },
            properties: iface.properties.map((p) => ({
              ...p,
              location: { ...p.location, file: displayPath },
            })),
            methods: iface.methods.map((m) => ({
              ...m,
              location: { ...m.location, file: displayPath },
            })),
          });
        }
      }
      if (analysis.warnings) {
        result.errors.push(
          ...analysis.warnings.map((warning) => ({
            file: displayPath,
            error: `warning: ${warning}`,
          }))
        );
      }
    } catch (error) {
      result.errors.push({
        file: getDisplayPath(file, resolvedPath, true),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function getDefaultPatterns(language?: SupportedLanguage): string[] {
  if (!language) {
    return ["*.ts", "*.tsx", "*.js", "*.jsx", "*.go"];
  }

  switch (language) {
    case "typescript":
      return ["*.ts", "*.tsx", "*.js", "*.jsx"];
    case "go":
      return ["*.go"];
    default:
      return ["*"];
  }
}
