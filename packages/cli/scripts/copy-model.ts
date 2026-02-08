import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const MODEL_SEGMENTS = MODEL_ID.split('/');

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_MODELS_ROOT = resolve(CLI_ROOT, 'dist', 'models');
const DIST_MODEL_DIR = resolve(DIST_MODELS_ROOT, ...MODEL_SEGMENTS);

export const MODEL_FILE_CANDIDATES = [
  join('onnx', 'model.onnx'),
  join('onnx', 'model_quantized.onnx'),
  'model.onnx',
  'model_quantized.onnx',
];

export async function main(): Promise<void> {
  await mkdir(DIST_MODEL_DIR, { recursive: true });

  const sourceDir = await findSourceModelDir();
  if (sourceDir) {
    if (resolve(sourceDir) === DIST_MODEL_DIR) {
      console.log(`[copy-model] Model already present at ${DIST_MODEL_DIR}`);
      return;
    }
    await copyModelDir(sourceDir, DIST_MODEL_DIR);
    console.log(`[copy-model] Copied model from ${sourceDir} -> ${DIST_MODEL_DIR}`);
    return;
  }

  console.log('[copy-model] Local model not found, downloading from Hugging Face...');
  await downloadModelFromHub(DIST_MODEL_DIR);
  console.log(`[copy-model] Downloaded model to ${DIST_MODEL_DIR}`);
}

export async function findSourceModelDir(): Promise<string | null> {
  const envSource = process.env.C4A_MODEL_SOURCE_DIR;
  if (envSource) {
    const resolved = resolveModelDirFromBase(resolve(envSource));
    if (resolved) return resolved;
  }

  const packageRoot = resolvePackageRoot('@xenova/transformers');
  if (packageRoot) {
    const candidates = [
      join(packageRoot, 'models'),
      join(packageRoot, 'dist', 'models'),
    ];
    for (const base of candidates) {
      const resolved = resolveModelDirFromBase(base);
      if (resolved) return resolved;
    }
  }

  const cacheRoots = [
    join(homedir(), '.cache', 'huggingface', 'hub'),
    join(homedir(), '.cache', 'huggingface', 'transformers'),
    join(homedir(), '.cache', 'transformers'),
    join(homedir(), '.cache', 'xenova'),
  ];

  for (const root of cacheRoots) {
    const found = await findModelDirBySearch(root, 4);
    if (found) return found;
  }

  return null;
}

export function resolvePackageRoot(packageName: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    return dirname(packageJsonPath);
  } catch {
    return null;
  }
}

export function resolveModelDirFromBase(baseDir: string): string | null {
  if (!existsSync(baseDir)) return null;
  if (isModelDir(baseDir)) return baseDir;
  const nested = resolve(baseDir, ...MODEL_SEGMENTS);
  if (isModelDir(nested)) return nested;
  return null;
}

export function isModelDir(dirPath: string): boolean {
  return MODEL_FILE_CANDIDATES.some((file) => existsSync(resolve(dirPath, file)));
}

export async function findModelDirBySearch(root: string, maxDepth: number): Promise<string | null> {
  if (!existsSync(root)) return null;

  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    if (current.path.endsWith(MODEL_SEGMENTS[MODEL_SEGMENTS.length - 1])) {
      if (isModelDir(current.path)) return current.path;
    }

    if (current.depth >= maxDepth) continue;

    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
    }
  }

  return null;
}

export async function copyModelDir(sourceDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, { recursive: true });
}

export async function downloadModelFromHub(destDir: string): Promise<void> {
  const apiUrl = `https://huggingface.co/api/models/${MODEL_ID}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`[copy-model] Failed to fetch model metadata: ${response.status}`);
  }
  const data = (await response.json()) as { siblings?: Array<{ rfilename?: string }> };
  const files = (data.siblings ?? [])
    .map((item) => item.rfilename)
    .filter((name): name is string => Boolean(name));

  if (files.length === 0) {
    throw new Error('[copy-model] Model metadata returned no files');
  }

  for (const relativePath of files) {
    const encodedPath = encodePath(relativePath);
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${encodedPath}`;
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) {
      throw new Error(`[copy-model] Failed to download ${relativePath}: ${fileResponse.status}`);
    }
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const targetPath = resolve(destDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, buffer);
  }
}

export function encodePath(pathValue: string): string {
  return pathValue
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
