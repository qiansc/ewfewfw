import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";

const require = createRequire(import.meta.url);
let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Parser.Language>();

export async function parseWithTreeSitter(
  languageKey: string,
  wasmFileName: string,
  content: string
): Promise<Parser.Tree> {
  const language = await loadLanguage(languageKey, wasmFileName);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser.parse(content);
}

export function resetTreeSitterCache(): void {
  languageCache.clear();
  initPromise = null;
}

async function loadLanguage(
  languageKey: string,
  wasmFileName: string
): Promise<Parser.Language> {
  const cacheKey = `${languageKey}:${wasmFileName}`;
  const cached = languageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  await ensureInitialized();

  const wasmPath = await resolveLanguageWasm(languageKey, wasmFileName);
  const language = await Parser.Language.load(wasmPath);
  languageCache.set(cacheKey, language);
  return language;
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    const coreWasm = resolveCoreWasm();
    initPromise = Parser.init({
      locateFile: () => coreWasm,
    });
  }
  return initPromise;
}

function resolveCoreWasm(): string {
  const localWasm = join(resolveLocalWasmDir(), "tree-sitter.wasm");
  if (existsSync(localWasm)) {
    return localWasm;
  }
  return require.resolve("web-tree-sitter/tree-sitter.wasm");
}

async function resolveLanguageWasm(
  languageKey: string,
  wasmFileName: string
): Promise<string> {
  const envKey = `C4A_TREE_SITTER_${languageKey.toUpperCase()}_WASM`;
  const envPath = process.env[envKey];
  if (envPath) {
    try {
      await stat(envPath);
      return envPath;
    } catch {
      throw new Error(`WASM not found at ${envPath} (from ${envKey})`);
    }
  }

  const candidates: string[] = [];
  const envDir = process.env.C4A_TREE_SITTER_WASM_DIR;
  if (envDir) {
    candidates.push(join(envDir, wasmFileName));
  }

  candidates.push(join(resolveLocalWasmDir(), wasmFileName));

  for (const packageName of getPackageCandidates(languageKey)) {
    try {
      const pkgRoot = dirname(require.resolve(`${packageName}/package.json`));
      candidates.push(
        join(pkgRoot, wasmFileName),
        join(pkgRoot, "wasm", wasmFileName),
        join(pkgRoot, "dist", wasmFileName),
        join(pkgRoot, "lib", wasmFileName)
      );
    } catch {
      // ignore missing packages
    }
  }

  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error(
    `WASM not found for ${languageKey}. 请提供 ${envKey} 或 C4A_TREE_SITTER_WASM_DIR`
  );
}

function resolveLocalWasmDir(): string {
  return fileURLToPath(new URL("../../wasm", import.meta.url));
}

function getPackageCandidates(languageKey: string): string[] {
  return [`tree-sitter-${languageKey}`, `@tree-sitter/${languageKey}`];
}
