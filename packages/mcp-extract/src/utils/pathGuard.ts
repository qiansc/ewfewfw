import { resolve, relative } from "node:path";
import { validatePath } from "@c4a/core/utils";

function normalizeInputPath(inputPath: string): string {
  let normalized = inputPath.replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

export async function resolveCodePath(inputPath: string): Promise<string> {
  const root = getCodeRoot() ?? process.cwd();
  const normalized = normalizeInputPath(inputPath);

  const validation = await validatePath(normalized, root);
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid path");
  }

  return resolve(root, normalized);
}

export function getCodeRoot(): string | null {
  const root = process.env.C4A_EXTRACT_ROOT ?? process.env.C4A_CODE_ROOT;
  if (!root) {
    return null;
  }
  return resolve(root);
}

export function getDisplayPath(
  targetPath: string,
  inputPath: string,
  inputIsDir: boolean
): string {
  const root = getCodeRoot();
  if (root) {
    return relative(root, targetPath);
  }
  if (inputIsDir) {
    return relative(inputPath, targetPath);
  }
  return targetPath;
}
