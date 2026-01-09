/**
 * c4a_local_init_repo 工具实现
 * 初始化项目的 .c4a/ 目录结构
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { InitInput } from "../../schemas/storageSchemas.js";

export interface InitResult {
  success: boolean;
  created_dirs: string[];
  message: string;
}

// C4A 标准目录结构
const C4A_DIRS = [
  "drafts",
  "approved",
  "published/system",
  "published/container",
  "published/component",
  "published/adr",
  "archive",
];

export async function initHandler(input: InitInput): Promise<InitResult> {
  const projectPath = input.project_path || ".";
  const c4aRoot = join(projectPath, ".c4a");
  const createdDirs: string[] = [];

  try {
    for (const dir of C4A_DIRS) {
      const fullPath = join(c4aRoot, dir);
      await mkdir(fullPath, { recursive: true });
      createdDirs.push(`.c4a/${dir}`);
    }

    return {
      success: true,
      created_dirs: createdDirs,
      message: "C4A 目录结构初始化完成",
    };
  } catch (error) {
    return {
      success: false,
      created_dirs: createdDirs,
      message: `初始化失败: ${(error as Error).message}`,
    };
  }
}
