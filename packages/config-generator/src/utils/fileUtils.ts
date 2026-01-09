/**
 * 文件操作工具
 *
 * 使用 Node.js 标准 API，保持 Bun 兼容性
 */
import { readFile, writeFile, mkdir, access, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { constants } from "node:fs";

/**
 * 读取文件内容
 */
export async function readFileContent(filePath: string): Promise<string> {
  return await readFile(filePath, "utf-8");
}

/**
 * 写入文件内容（自动创建目录）
 */
export async function writeFileContent(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

/**
 * 检查文件是否存在
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保目录存在
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * 读取目录下所有文件
 */
export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

/**
 * 删除文件或目录
 */
export async function removeFile(filePath: string): Promise<void> {
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) {
      await rm(filePath, { recursive: true, force: true });
    } else {
      await rm(filePath, { force: true });
    }
  } catch {
    // 文件不存在，忽略
  }
}

/**
 * 清理目录中匹配前缀的文件/子目录
 */
export async function cleanByPrefix(dirPath: string, prefix: string): Promise<string[]> {
  const removed: string[] = [];
  try {
    const files = await readdir(dirPath);
    for (const file of files) {
      if (file.startsWith(prefix)) {
        const fullPath = join(dirPath, file);
        await removeFile(fullPath);
        removed.push(fullPath);
      }
    }
  } catch {
    // 目录不存在，忽略
  }
  return removed;
}

/**
 * 解析绝对路径
 */
export function resolvePath(basePath: string, relativePath: string): string {
  return resolve(basePath, relativePath);
}

/**
 * 拼接路径
 */
export function joinPath(...paths: string[]): string {
  return join(...paths);
}
