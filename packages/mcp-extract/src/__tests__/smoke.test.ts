import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { analyze } from "../tools/analyze.js";
import { extract } from "../tools/extract.js";
import { getAST } from "../tools/ast.js";
import { generateContract } from "../tools/contract.js";
import {
  AnalyzeInputSchema,
  ASTInputSchema,
  ContractInputSchema,
  ExtractInputSchema,
} from "../schemas/inputSchemas.js";
import { resetTreeSitterCache } from "../parsers/treeSitter.js";

const fixtureRoot = resolve(process.cwd(), ".tmp", "mcp-extract-tests");
const fixtureRel = join(".tmp", "mcp-extract-tests");
const tsFile = join(fixtureRoot, "sample.ts");
const tsRel = join(fixtureRel, "sample.ts");
const tsRelFromRoot = "sample.ts";
const goFile = join(fixtureRoot, "sample.go");
const goRel = join(fixtureRel, "sample.go");
const goRelFromRoot = "sample.go";
const outsideFile = resolve(fixtureRoot, "..", "outside.ts");
const outsideRelFromRoot = "../outside.ts";
const symlinkPath = join(fixtureRoot, "outside-link");
const symlinkRelFromRoot = join("outside-link", "outside.ts");

beforeAll(async () => {
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(
    tsFile,
    [
      "export interface User {",
      "  id: string;",
      "  name?: string;",
      "  getName(): string;",
      "}",
      "export type Config = { enabled: boolean };",
      "export class Service {",
      "  readonly url: string;",
      "  constructor(url: string) { this.url = url; }",
      "  async get(id: string): Promise<string> { return id; }",
      "}",
      "export function fetchUser(id: string): Promise<User> {",
      "  return Promise.resolve({ id });",
      "}",
      "",
    ].join("\n")
  );
  await writeFile(
    goFile,
    [
      "package main",
      "",
      "type Reader interface {",
      "  Read(p []byte) (n int, err error)",
      "}",
      "",
      "type User struct {",
      "  ID string",
      "}",
      "",
      "func FetchUser(id string) string {",
      "  return id",
      "}",
      "",
    ].join("\n")
  );
  await writeFile(outsideFile, "export const outside = true;\n");
  try {
    await symlink(resolve(fixtureRoot, ".."), symlinkPath);
  } catch {
    // ignore if symlink already exists
  }
});

afterAll(async () => {
  await rm(symlinkPath, { force: true });
  await rm(outsideFile, { force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("mcp-extract tools", () => {
  test("extract returns interfaces with properties and methods", async () => {
    const result = await extract({
      path: tsRel,
      language: "typescript",
      recursive: false,
    });
    expect(result.files).toBe(1);
    expect(result.errors.length).toBe(0);

    const names = result.interfaces.map((iface) => iface.name);
    expect(names).toContain("User");
    expect(names).toContain("Config");
    expect(names).toContain("Service");

    const user = result.interfaces.find((iface) => iface.name === "User");
    expect(user?.properties.some((p) => p.name === "id")).toBe(true);
    expect(user?.methods.some((m) => m.name === "getName")).toBe(true);
    expect(user?.exported).toBe(true);
  });

  test("extract supports go", async () => {
    const goResult = await extract({ path: goRel, language: "go", recursive: false });
    const goNames = goResult.interfaces.map((iface) => iface.name);
    expect(goNames).toContain("Reader");
    expect(goNames).toContain("User");
  });

  test("analyze supports summary_only and pagination", async () => {
    const summaryOnly = await analyze({
      path: fixtureRel,
      summary_only: true,
      includeDependencies: false,
      includeMetrics: true,
      limit: 100,
      offset: 0,
    });
    expect(summaryOnly.files).toBeUndefined();
    expect(summaryOnly.summary.totalFiles).toBe(2);
    expect(summaryOnly.summary.languages.typescript).toBe(1);
    expect(summaryOnly.summary.languages.go).toBe(1);

    const paged = await analyze({
      path: fixtureRel,
      summary_only: false,
      limit: 1,
      offset: 1,
      includeDependencies: false,
      includeMetrics: true,
    });
    expect(paged.files?.length).toBe(1);
    expect(paged.pagination?.total).toBe(2);
    expect(paged.pagination?.has_more).toBe(false);
  });

  test("ast returns filtered nodes", async () => {
    const result = await getAST({
      path: tsRel,
      nodeTypes: ["interface_declaration"],
      maxDepth: 2,
    });
    expect(result.language).toBe("typescript");
    expect(result.ast.type).toBe("program");
    const children = result.ast.children ?? [];
    expect(children.every((child) => child.type === "interface_declaration")).toBe(true);
    expect(
      children.some(
        (node) =>
          (node.endPosition?.row ?? 0) > (node.startPosition?.row ?? 0)
      )
    ).toBe(true);
  });

  test("contract returns schemas and endpoints", async () => {
    const result = await generateContract({
      path: tsRel,
      format: "openapi",
      version: "3.0.0",
    });
    expect(result.format).toBe("openapi");
    expect(result.schemas).toContain("User");
    expect(result.endpoints.length).toBeGreaterThan(0);
  });

  test("tool interfaces align with design doc", async () => {
    expect(Object.keys(ExtractInputSchema.shape).sort()).toEqual(
      ["exclude", "include", "language", "path", "recursive"].sort()
    );
    expect(Object.keys(AnalyzeInputSchema.shape).sort()).toEqual(
      [
        "includeDependencies",
        "includeMetrics",
        "language",
        "limit",
        "offset",
        "path",
        "summary_only",
      ].sort()
    );
    expect(Object.keys(ASTInputSchema.shape).sort()).toEqual(
      ["language", "maxDepth", "nodeTypes", "path"].sort()
    );
    expect(Object.keys(ContractInputSchema.shape).sort()).toEqual(
      ["baseUrl", "description", "format", "path", "title", "version"].sort()
    );

    const extractResult = await extract({
      path: tsRel,
      language: "typescript",
      recursive: false,
    });
    expect(Object.keys(extractResult).sort()).toEqual(
      ["errors", "files", "interfaces"].sort()
    );

    const analyzeResult = await analyze({
      path: tsRel,
      includeMetrics: true,
      includeDependencies: true,
      summary_only: false,
      limit: 100,
      offset: 0,
    });
    expect(analyzeResult.summary).toBeTruthy();
    expect(analyzeResult.errors).toBeTruthy();

    const astResult = await getAST({ path: tsRel, maxDepth: 10 });
    expect(Object.keys(astResult).sort()).toEqual(["ast", "file", "language"].sort());

    const contractResult = await generateContract({
      path: tsRel,
      format: "openapi",
      version: "3.0.0",
    });
    for (const key of ["content", "endpoints", "format", "schemas", "version"]) {
      expect(Object.keys(contractResult)).toContain(key);
    }
  });

  test("docker root guard restricts paths", async () => {
    const originalExtractRoot = process.env.C4A_EXTRACT_ROOT;
    const originalCodeRoot = process.env.C4A_CODE_ROOT;
    process.env.C4A_EXTRACT_ROOT = fixtureRoot;

    await expect(
      extract({ path: tsRelFromRoot, language: "typescript", recursive: false })
    ).resolves.toBeTruthy();

    const outsidePath = outsideRelFromRoot;
    await expect(
      extract({ path: outsidePath, language: "typescript", recursive: false })
    ).rejects.toThrow("不允许父目录引用");

    if (originalExtractRoot === undefined) {
      delete process.env.C4A_EXTRACT_ROOT;
    } else {
      process.env.C4A_EXTRACT_ROOT = originalExtractRoot;
    }

    if (originalCodeRoot === undefined) {
      delete process.env.C4A_CODE_ROOT;
    } else {
      process.env.C4A_CODE_ROOT = originalCodeRoot;
    }
  });

  test("path guard blocks symlink escapes", async () => {
    const originalExtractRoot = process.env.C4A_EXTRACT_ROOT;
    process.env.C4A_EXTRACT_ROOT = fixtureRoot;

    await expect(
      extract({
        path: symlinkRelFromRoot,
        language: "typescript",
        recursive: false,
      })
    ).rejects.toThrow("符号链接指向项目外");

    if (originalExtractRoot === undefined) {
      delete process.env.C4A_EXTRACT_ROOT;
    } else {
      process.env.C4A_EXTRACT_ROOT = originalExtractRoot;
    }
  });

  test("tree-sitter fallback emits warning", async () => {
    const originalGoWasm = process.env.C4A_TREE_SITTER_GO_WASM;
    resetTreeSitterCache();
    process.env.C4A_TREE_SITTER_GO_WASM = "/nonexistent/tree-sitter-go.wasm";

    const result = await analyze({
      path: goRel,
      language: "go",
      includeDependencies: false,
      includeMetrics: true,
      summary_only: false,
      limit: 10,
      offset: 0,
    });

    const errorHasWarning = result.errors.some((e) => e.error.includes("tree-sitter-go"));
    const fileWarnings =
      result.files?.flatMap((file) => file.warnings ?? []) ?? [];
    const fileHasWarning = fileWarnings.some((warning) => warning.includes("tree-sitter-go"));
    expect(errorHasWarning || fileHasWarning).toBe(true);

    if (originalGoWasm === undefined) {
      delete process.env.C4A_TREE_SITTER_GO_WASM;
    } else {
      process.env.C4A_TREE_SITTER_GO_WASM = originalGoWasm;
    }
  });
});
