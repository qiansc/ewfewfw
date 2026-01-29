import { realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep, relative } from "node:path";

export function resolveCodePath(inputPath: string): string {
  const root = getCodeRoot();
  if (!root) {
    return inputPath;
  }

  const resolvedRoot = realpathSync(root);
  const resolvedPath = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(resolvedRoot, inputPath);

  if (!isWithinRoot(resolvedPath, resolvedRoot)) {
    throw new Error(`Path is outside allowed root: ${resolvedRoot}`);
  }

  try {
    const realTarget = realpathSync(resolvedPath);
    if (!isWithinRoot(realTarget, resolvedRoot)) {
      throw new Error(`Path is outside allowed root: ${resolvedRoot}`);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const realParent = realpathSync(dirname(resolvedPath));
      if (!isWithinRoot(realParent, resolvedRoot)) {
        throw new Error(`Path is outside allowed root: ${resolvedRoot}`);
      }
    } else {
      throw error;
    }
  }

  return resolvedPath;
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

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) {
    return true;
  }
  return targetPath.startsWith(rootPath + sep);
}
