/**
 * c4a_extract_analyze tool
 *
 * Analyze code structure and dependencies
 */
import { stat } from "node:fs/promises";
import fg from "fast-glob";

import { parseFile, detectLanguage } from "../parsers/index.js";
import { getDisplayPath, resolveCodePath } from "../utils/pathGuard.js";
import type { AnalyzeInput } from "../schemas/inputSchemas.js";
import type { CodeAnalysis, SupportedLanguage } from "../types/index.js";

export interface AnalyzeResult {
  files?: CodeAnalysis[];
  summary: {
    totalFiles: number;
    totalLines: number;
    totalLinesOfCode: number;
    totalFunctions: number;
    totalClasses: number;
    totalInterfaces: number;
    languages: Record<SupportedLanguage, number>;
    dependencies: DependencySummary[];
  };
  errors: Array<{ file: string; error: string }>;
  pagination?: { total: number; offset: number; limit: number; has_more: boolean };
}

export interface DependencySummary {
  source: string;
  usedBy: string[];
  count: number;
  isExternal: boolean;
}

/**
 * Analyze code structure and dependencies
 */
export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  const {
    path,
    language,
    includeMetrics = true,
    includeDependencies = true,
    summary_only: summaryOnly = false,
    limit = 100,
    offset = 0,
  } = input;

  const resolvedPath = resolveCodePath(path);

  const result: AnalyzeResult = {
    files: [],
    summary: {
      totalFiles: 0,
      totalLines: 0,
      totalLinesOfCode: 0,
      totalFunctions: 0,
      totalClasses: 0,
      totalInterfaces: 0,
      languages: {
        typescript: 0,
        go: 0,
        python: 0,
      },
      dependencies: [],
    },
    errors: [],
  };

  // Check if path is file or directory
  const pathStat = await stat(resolvedPath);

  if (pathStat.isFile()) {
    // Single file
    try {
      const analysis = await parseFile(resolvedPath, undefined, language);
      analysis.file = getDisplayPath(resolvedPath, resolvedPath, false);
      normalizeLocations(analysis, analysis.file);
      if (!includeMetrics && !includeDependencies) {
        analysis.details = undefined;
      }
      if (!summaryOnly) {
        result.files?.push(analysis);
      }
      updateSummary(result.summary, analysis);
      if (analysis.warnings) {
        result.errors.push(
          ...analysis.warnings.map((warning) => ({
            file: analysis.file,
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

    if (includeDependencies && result.files && result.files.length > 0) {
      const depMap = new Map<string, DependencySummary>();
      addDependencies(depMap, result.files[0]);
      result.summary.dependencies = Array.from(depMap.values());
    }

    if (summaryOnly) {
      result.files = undefined;
    }

    return result;
  }

  // Directory - find files
  const patterns = getPatterns(language);

  const stream = fg.stream(patterns, {
    cwd: resolvedPath,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    absolute: true,
    followSymbolicLinks: false,
  });

  let total = 0;
  const pageStart = Math.max(offset, 0);
  const pageEnd = Math.max(pageStart + limit, pageStart);

  const dependencyMap = includeDependencies ? new Map<string, DependencySummary>() : null;

  for await (const entry of stream) {
    const file = String(entry);
    const fileLang = language ?? detectLanguage(file);
    if (!fileLang) continue;
    const fileIndex = total;
    total++;
    try {
      const analysis = await parseFile(file, undefined, fileLang);
      analysis.file = getDisplayPath(file, resolvedPath, true);
      normalizeLocations(analysis, analysis.file);
      if (!includeMetrics && !includeDependencies) {
        analysis.details = undefined;
      }

      if (!summaryOnly && fileIndex >= pageStart && fileIndex < pageEnd) {
        result.files?.push(analysis);
      }

      updateSummary(result.summary, analysis);

      if (dependencyMap) {
        addDependencies(dependencyMap, analysis);
      }
      if (analysis.warnings) {
        result.errors.push(
          ...analysis.warnings.map((warning) => ({
            file: analysis.file,
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

  if (dependencyMap) {
    result.summary.dependencies = Array.from(dependencyMap.values()).sort(
      (a, b) => b.count - a.count
    );
  } else {
    result.summary.dependencies = [];
  }

  result.pagination = {
    total,
    offset,
    limit,
    has_more: pageEnd < total,
  };

  if (summaryOnly) {
    result.files = undefined;
  }

  return result;
}

function getPatterns(language?: SupportedLanguage): string[] {
  if (!language) {
    return ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.go", "**/*.py"];
  }

  switch (language) {
    case "typescript":
      return ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
    case "go":
      return ["**/*.go"];
    case "python":
      return ["**/*.py"];
    default:
      return ["**/*"];
  }
}

function updateSummary(
  summary: AnalyzeResult["summary"],
  analysis: CodeAnalysis
): void {
  summary.totalFiles++;
  summary.totalLines += analysis.lines;
  summary.totalLinesOfCode += analysis.linesOfCode;
  summary.totalFunctions += analysis.functions;
  summary.totalClasses += analysis.classes;
  summary.totalInterfaces += analysis.interfaces;
  summary.languages[analysis.language]++;
}

function normalizeLocations(analysis: CodeAnalysis, filePath: string): void {
  if (!analysis.details) {
    return;
  }
  for (const imp of analysis.details.imports) {
    imp.location.file = filePath;
  }
  for (const exp of analysis.details.exports) {
    exp.location.file = filePath;
  }
  for (const iface of analysis.details.interfaces) {
    iface.location.file = filePath;
    for (const prop of iface.properties) {
      prop.location.file = filePath;
    }
    for (const method of iface.methods) {
      method.location.file = filePath;
    }
  }
  for (const fn of analysis.details.functions) {
    fn.location.file = filePath;
  }
}

function addDependencies(
  depMap: Map<string, DependencySummary>,
  analysis: CodeAnalysis
): void {
  if (!analysis.details) {
    return;
  }
  for (const imp of analysis.details.imports) {
    const source = imp.source;
    const existing = depMap.get(source);

    if (existing) {
      existing.usedBy.push(analysis.file);
      existing.count++;
    } else {
      depMap.set(source, {
        source,
        usedBy: [analysis.file],
        count: 1,
        isExternal: isExternalDependency(source),
      });
    }
  }
}

function isExternalDependency(source: string): boolean {
  // Relative imports are not external
  if (source.startsWith(".") || source.startsWith("/")) {
    return false;
  }

  // Standard library or builtin modules
  if (
    source.startsWith("node:") ||
    source.startsWith("bun:") ||
    source === "fs" ||
    source === "path" ||
    source === "os" ||
    source === "typing" ||
    source === "dataclasses" ||
    source === "json"
  ) {
    return false;
  }

  return true;
}
