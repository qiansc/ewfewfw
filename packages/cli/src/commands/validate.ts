import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { INPUT_ERROR_CODES, DATA_ERROR_CODES } from "@c4a/core/types";
import { parseDSL } from "@c4a/core/utils";
import { validateDSLAuto } from "@c4a/core/validator";
import { parseReference } from "@c4a/storage";
import { loadProjectConfig } from "../core/config.js";

type OutputFormat = "human" | "json" | "github";

interface ValidateArgs {
  targetPath: string;
  quiet: boolean;
  format: OutputFormat;
  strict: boolean;
  scope?: "published";
}

interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  line?: number;
}

interface FileValidationResult {
  file: string;
  status: "ok" | "error" | "warning";
  issues: ValidationIssue[];
}

type ValidateCommandDeps = {
  loadProjectConfig: typeof loadProjectConfig;
  log: (message: string) => void;
  error: (message: string) => void;
};

const DEFAULT_DEPS: ValidateCommandDeps = {
  loadProjectConfig,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

export async function validateCommand(
  args: string[],
  deps: ValidateCommandDeps = DEFAULT_DEPS,
): Promise<void> {
  const parsed = parseValidateArgs(args);
  if (parsed instanceof Error) {
    deps.error(parsed.message);
    process.exitCode = 3;
    return;
  }

  const targetPath = resolve(process.cwd(), parsed.targetPath);
  if (!existsSync(targetPath)) {
    deps.error(`路径不存在: ${parsed.targetPath}`);
    process.exitCode = 3;
    return;
  }

  const projectConfig = await deps.loadProjectConfig();
  const projectId = projectConfig?.project_id;
  const repoId = projectConfig?.repo_id;

  const files = await collectDslFiles(targetPath);
  if (parsed.format === "human" && !parsed.quiet) {
    deps.log("\n  验证 DSL 文件\n");
    printScanSummary(files, deps.log);
  }

  const context = {
    projectId,
    repoId,
  };

  const results = await validateFiles(files, context, parsed.scope);
  const summary = buildSummary(results);

  outputResults(results, summary, parsed, deps);

  if (summary.errors > 0) {
    process.exitCode = 1;
    return;
  }

  if (summary.warnings > 0 && parsed.strict) {
    process.exitCode = 2;
    return;
  }

  process.exitCode = 0;
}

export function parseValidateArgs(args: string[]): ValidateArgs | Error {
  let targetPath = ".context";
  let quiet = false;
  let format: OutputFormat = "human";
  let strict = false;
  let scope: "published" | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const [rawKey, rawValue] = arg.includes("=") ? arg.split("=") : [arg, undefined];
      const key = rawKey.replace(/^--/, "");
      const value = rawValue ?? args[i + 1];
      if (!rawValue && value && !value.startsWith("--")) {
        i += 1;
      }

      switch (key) {
        case "quiet":
          quiet = true;
          break;
        case "format":
          if (value === "json" || value === "github") {
            format = value;
          } else {
            return new Error("format 仅支持 json/github");
          }
          break;
        case "strict":
          strict = true;
          break;
        case "scope":
          if (value === "published") {
            scope = "published";
          } else {
            return new Error("scope 仅支持 published");
          }
          break;
        default:
          return new Error(`未知参数: --${key}`);
      }
    } else if (arg && !arg.startsWith("-")) {
      targetPath = arg;
    }
  }

  return { targetPath, quiet, format, strict, scope };
}

async function collectDslFiles(targetPath: string): Promise<string[]> {
  const stats = await stat(targetPath);
  if (stats.isFile()) {
    return shouldIgnorePath(targetPath) ? [] : [targetPath];
  }
  const entries: string[] = [];
  const items = await readdir(targetPath, { withFileTypes: true });
  for (const item of items) {
    const fullPath = join(targetPath, item.name);
    if (item.isDirectory()) {
      const nested = await collectDslFiles(fullPath);
      entries.push(...nested);
    } else if (item.isFile()) {
      if (!isYamlFile(item.name)) continue;
      if (shouldIgnorePath(fullPath)) continue;
      entries.push(fullPath);
    }
  }
  return entries;
}

function isYamlFile(fileName: string): boolean {
  return fileName.endsWith(".yaml") || fileName.endsWith(".c4a.yaml");
}

function shouldIgnorePath(filePath: string): boolean {
  const base = basename(filePath);
  if (base === ".c4a.yaml") return true;
  if (base === ".sync-state.json") return true;
  if (base === "checklist.md") return true;
  return false;
}

async function validateFiles(
  files: string[],
  context: { projectId?: string; repoId?: string },
  scope?: "published",
): Promise<FileValidationResult[]> {
  const parsedEntries: Array<{
    file: string;
    data?: Record<string, unknown>;
    error?: string;
    id?: string;
    type?: string;
    status?: string | null;
  }> = [];
  const idMap = new Set<string>();

  for (const file of files) {
    try {
      const content = await readFile(file, "utf-8");
      const data = parseDSL<Record<string, unknown>>(content);
      const info = extractEntityInfo(data, file);
      parsedEntries.push({
        file,
        data,
        id: info?.id,
        type: info?.type,
        status: info?.status ?? null,
      });
      if (info?.id) {
        idMap.add(info.id);
      }
    } catch (error) {
      parsedEntries.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const results: FileValidationResult[] = [];
  for (const entry of parsedEntries) {
    const issues: ValidationIssue[] = [];
    const displayFile = normalizePath(relative(process.cwd(), entry.file));
    if (entry.error) {
      issues.push({
        level: "error",
        code: INPUT_ERROR_CODES.INVALID_FIELD_FORMAT,
        message: `YAML 解析失败: ${entry.error}`,
        line: 1,
      });
      results.push({
        file: displayFile,
        status: "error",
        issues,
      });
      continue;
    }

    if (!entry.data || !entry.type) {
      issues.push({
        level: "error",
        code: INPUT_ERROR_CODES.INVALID_ENTITY_TYPE,
        message: "缺少或无效的 type 字段",
        line: 1,
      });
      results.push({
        file: displayFile,
        status: "error",
        issues,
      });
      continue;
    }

    if (scope === "published" && entry.status && entry.status !== "published") {
      continue;
    }

    const schemaResult = validateDSLAuto(entry.data);
    if (!schemaResult.valid && schemaResult.errors) {
      for (const err of schemaResult.errors) {
        issues.push({
          level: "error",
          code: mapSchemaErrorCode(err.keyword),
          message: err.message ?? "Schema 校验失败",
          line: 1,
        });
      }
    }

    if (entry.id && entry.type && !isValidEntityIdLocal(entry.id, normalizeIdType(entry.type))) {
      issues.push({
        level: "error",
        code: INPUT_ERROR_CODES.INVALID_ID_FORMAT,
        message: `无效的 ID 格式: ${entry.id}`,
        line: 1,
      });
    }

    if (entry.data) {
      const descriptionIssue = checkDescription(entry.data, entry.type);
      if (descriptionIssue) {
        issues.push(descriptionIssue);
      }

      const references = collectReferenceIds(entry.data);
      for (const ref of references) {
        if (shouldSkipReference(ref, context)) continue;
        if (!idMap.has(ref.id)) {
          issues.push({
            level: isPublished(entry.status, scope) ? "error" : "warning",
            code: DATA_ERROR_CODES.ENTITY_NOT_FOUND,
            message: `${ref.field} '${ref.id}' 不存在`,
            line: 1,
          });
        }
      }
    }

    const status = issues.some((issue) => issue.level === "error")
      ? "error"
      : issues.some((issue) => issue.level === "warning")
        ? "warning"
        : "ok";

    results.push({
      file: displayFile,
      status,
      issues,
    });
  }

  return results;
}

function extractEntityInfo(
  data: Record<string, unknown>,
  filePath: string,
): { id?: string; type?: string; status?: string | null } {
  const rawType = data.type;
  if (typeof rawType !== "string") return {};
  const type = normalizeDslType(rawType);
  const status = extractStatus(data, type);
  if (type === "feat" || type === "checklist") {
    return {
      id: typeof data.id === "string" ? data.id : undefined,
      type,
      status,
    };
  }
  const key = type === "system" ? "system" : type;
  const section = data[key] as Record<string, unknown> | undefined;
  const id =
    (section && typeof section.id === "string" ? section.id : undefined) ?? deriveIdFromPath(filePath);
  return { id, type, status };
}

function normalizeDslType(rawType: string): string {
  if (rawType === "software-system") return "system";
  return rawType;
}

function deriveIdFromPath(filePath: string): string {
  const name = basename(filePath);
  return name.replace(/\.c4a\.yaml$/i, "").replace(/\.yaml$/i, "");
}

function normalizeIdType(type: string) {
  if (type === "software-system") return "system";
  if (type === "checklist") return undefined;
  return type;
}

function extractStatus(data: Record<string, unknown>, type: string): string | null {
  if (typeof data.metadata === "object" && data.metadata) {
    const status = (data.metadata as Record<string, unknown>).status;
    if (typeof status === "string") return status;
  }
  const rootStatus = data.status;
  if (typeof rootStatus === "string") return rootStatus;
  const key = type === "system" ? "system" : type;
  const section = data[key] as Record<string, unknown> | undefined;
  if (section && typeof section.status === "string") return section.status;
  return null;
}

function mapSchemaErrorCode(keyword?: string): string {
  if (keyword === "required") {
    return INPUT_ERROR_CODES.MISSING_REQUIRED_FIELD;
  }
  return INPUT_ERROR_CODES.INVALID_FIELD_FORMAT;
}

function isPublished(status: string | null | undefined, scope?: "published"): boolean {
  if (scope === "published") return true;
  if (!status) return true;
  return status === "published";
}

function checkDescription(data: Record<string, unknown>, type: string): ValidationIssue | null {
  if (type === "feat" || type === "checklist") {
    return null;
  }
  const key = type === "system" ? "system" : type;
  const section = data[key] as Record<string, unknown> | undefined;
  if (!section || typeof section.description !== "string" || section.description.trim() === "") {
    return {
      level: "warning",
      code: INPUT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      message: `缺少描述字段: ${key}.description`,
      line: 1,
    };
  }
  return null;
}

function collectReferenceIds(data: Record<string, unknown>): Array<{ id: string; field: string }> {
  const refs: Array<{ id: string; field: string }> = [];
  const visit = (value: unknown, keyPath: string): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, keyPath);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      const path = keyPath ? `${keyPath}.${key}` : key;
      if (key === "references" && Array.isArray(entry)) {
        for (const item of entry) {
          const ref = normalizeReference(item);
          if (ref) refs.push({ id: ref, field: path });
        }
        continue;
      }
      if (key.endsWith("_id") && typeof entry === "string") {
        refs.push({ id: entry, field: path });
        continue;
      }
      if (key === "relationships" && typeof entry === "object" && entry) {
        visitRelationships(entry as Record<string, unknown>, path, refs);
        continue;
      }
      if (key === "related_adrs" && Array.isArray(entry)) {
        for (const item of entry) {
          if (typeof item === "string") refs.push({ id: item, field: path });
        }
        continue;
      }
      visit(entry, path);
    }
  };
  visit(data, "");
  return refs;
}

function normalizeReference(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const ref = record.ref ?? record.reference ?? record.id;
  return typeof ref === "string" ? ref : null;
}

function visitRelationships(
  value: Record<string, unknown>,
  basePath: string,
  refs: Array<{ id: string; field: string }>,
): void {
  for (const [key, entry] of Object.entries(value)) {
    if (!Array.isArray(entry)) continue;
    for (const item of entry) {
      if (!item || typeof item !== "object") continue;
      const id = (item as Record<string, unknown>).id;
      if (typeof id === "string") {
        refs.push({ id, field: `${basePath}.${key}.id` });
      }
    }
  }
}

function shouldSkipReference(
  reference: { id: string; field: string },
  context: { projectId?: string; repoId?: string },
): boolean {
  try {
    const parsed = parseReference(reference.id);
    if (parsed.format === "project" && parsed.projectId && context.projectId) {
      return parsed.projectId !== context.projectId;
    }
    if (parsed.format === "repo" && parsed.repoId && context.repoId) {
      return parsed.repoId !== context.repoId;
    }
    if (parsed.format === "scope" && parsed.scope && parsed.scope !== "project") {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function buildSummary(results: FileValidationResult[]): {
  total: number;
  passed: number;
  errors: number;
  warnings: number;
} {
  let passed = 0;
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    if (result.status === "ok") passed += 1;
    if (result.status === "error") errors += 1;
    if (result.status === "warning") warnings += 1;
  }
  return {
    total: results.length,
    passed,
    errors,
    warnings,
  };
}

function outputResults(
  results: FileValidationResult[],
  summary: { total: number; passed: number; errors: number; warnings: number },
  args: ValidateArgs,
  deps: ValidateCommandDeps,
): void {
  if (args.format === "json") {
    deps.log(
      JSON.stringify(
        {
          success: summary.errors === 0,
          summary,
          results,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.format === "github") {
    for (const result of results) {
      for (const issue of result.issues) {
        const level = issue.level === "error" ? "error" : "warning";
        deps.log(
          `::${level} file=${normalizePath(result.file)},line=${issue.line ?? 1}::${issue.message}`,
        );
      }
    }
    return;
  }

  if (!args.quiet) {
    deps.log("正在验证...");
  }
  for (const result of results) {
    if (args.quiet && result.status === "ok") continue;
    const statusLabel =
      result.status === "ok" ? "✅" : result.status === "error" ? "❌" : "⚠️";
    deps.log(`  ${statusLabel} ${normalizePath(result.file)}`);
    for (const issue of result.issues) {
      if (args.quiet && issue.level !== "error") continue;
      const tag = issue.level === "error" ? "Error" : "Warning";
      deps.log(`     - [${tag}] ${issue.message}`);
    }
  }

  if (!args.quiet) {
    deps.log("\n验证完成");
    deps.log(`  - 总计: ${summary.total} 个文件`);
    deps.log(`  - 通过: ${summary.passed} 个`);
    deps.log(`  - 错误: ${summary.errors} 个`);
    deps.log(`  - 警告: ${summary.warnings} 个`);
  }
}

function printScanSummary(files: string[], log: (message: string) => void): void {
  const groups = new Map<string, number>();
  for (const file of files) {
    const relativePath = normalizePath(relative(process.cwd(), file));
    const topLevel = relativePath.split("/").slice(0, 2).join("/") || relativePath;
    groups.set(topLevel, (groups.get(topLevel) ?? 0) + 1);
  }
  log("扫描文件...");
  for (const [group, count] of groups.entries()) {
    log(`  📁 ${group}: ${count} 个文件`);
  }
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function isValidEntityIdLocal(id: string, type?: string): boolean {
  if (!id || typeof id !== "string") return false;

  if (type === "feat") {
    return /^feat-[a-z]\d{3}(-[a-z0-9]+)*$/.test(id);
  }
  if (type === "adr") {
    return /^adr-[a-z]\d{3}(-[a-z0-9]+)*$/.test(id);
  }
  if (type === "process") {
    return /^prc-[bt]-[a-z]\d{3}$/.test(id);
  }
  if (type === "sor") {
    return /^sor-[bt]-[a-z]\d{3}$/.test(id);
  }

  return (
    KEBAB_CASE_PATTERN.test(id) ||
    /^(feat|adr)-[a-z]\d{3}(-[a-z0-9]+)*$/.test(id) ||
    /^(prc|sor)-[bt]-[a-z]\d{3}$/.test(id)
  );
}
