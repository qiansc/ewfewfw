/**
 * c4a_code_analyze tool
 *
 * Analyze code structure and dependencies
 */
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import fg from "fast-glob";

import { parseFile, detectLanguage } from "../parsers/index.js";
import type { AnalyzeInput } from "../schemas/inputSchemas.js";
import type { CodeAnalysis, CodeMetrics, SupportedLanguage } from "../types/index.js";

export interface AnalyzeResult {
  files: CodeAnalysis[];
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
  } = input;

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
  const pathStat = await stat(path);

  if (pathStat.isFile()) {
    // Single file
    try {
      const analysis = await parseFile(path, undefined, language);
      analysis.file = path;
      result.files.push(analysis);
      updateSummary(result.summary, analysis);
    } catch (error) {
      result.errors.push({
        file: path,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (includeDependencies) {
      aggregateDependencies(result);
    }

    return result;
  }

  // Directory - find files
  const patterns = getPatterns(language);

  const files = await fg(patterns, {
    cwd: path,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    absolute: true,
  });

  for (const file of files) {
    try {
      const fileLang = language ?? detectLanguage(file);
      if (!fileLang) continue;

      const analysis = await parseFile(file, undefined, fileLang);
      analysis.file = relative(path, file);
      result.files.push(analysis);
      updateSummary(result.summary, analysis);
    } catch (error) {
      result.errors.push({
        file: relative(path, file),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (includeDependencies) {
    aggregateDependencies(result);
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
  summary.totalLines += analysis.metrics.lines;
  summary.totalLinesOfCode += analysis.metrics.linesOfCode;
  summary.totalFunctions += analysis.metrics.functions;
  summary.totalClasses += analysis.metrics.classes;
  summary.totalInterfaces += analysis.metrics.interfaces;
  summary.languages[analysis.language]++;
}

function aggregateDependencies(result: AnalyzeResult): void {
  const depMap = new Map<string, DependencySummary>();

  for (const file of result.files) {
    for (const imp of file.imports) {
      const source = imp.source;
      const existing = depMap.get(source);

      if (existing) {
        existing.usedBy.push(file.file);
        existing.count++;
      } else {
        depMap.set(source, {
          source,
          usedBy: [file.file],
          count: 1,
          isExternal: isExternalDependency(source),
        });
      }
    }
  }

  result.summary.dependencies = Array.from(depMap.values()).sort(
    (a, b) => b.count - a.count
  );
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
