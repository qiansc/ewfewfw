/**
 * c4a_local_read_file 工具实现
 * 读取 DSL 文件，返回解析后的内容
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateDSLAuto } from "@c4a/core";
import type { ReadInput } from "../../schemas/storageSchemas.js";
import { listHandler } from "./list.js";

export interface ReadResult {
  success: boolean;
  content?: Record<string, unknown>;
  raw?: string;
  path?: string;
  valid?: boolean;
  errors?: Array<{ path: string; message: string }>;
  message?: string;
}

export async function readHandler(input: ReadInput): Promise<ReadResult> {
  const projectPath = input.project_path || ".";

  // 确定文件路径
  let filePath: string;

  if (input.path) {
    // 直接使用提供的路径
    filePath = input.path.startsWith(".c4a/")
      ? join(projectPath, input.path)
      : join(projectPath, ".c4a", input.path);
  } else if (input.id && input.type) {
    // 通过 ID + type 查找文件
    const listResult = await listHandler({
      type: input.type,
      status: "all",
      project_path: projectPath,
    });

    const found = listResult.files.find((f) => f.id === input.id);
    if (!found) {
      return {
        success: false,
        message: `未找到 ${input.type} 类型的 DSL: ${input.id}`,
      };
    }
    filePath = join(projectPath, found.path);
  } else {
    return {
      success: false,
      message: "必须提供 path 或 (id + type)",
    };
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const content = parseYaml(raw) as Record<string, unknown>;

    // 使用 validateDSLAuto 自动识别类型并验证（内部处理 software-system 映射）
    const validationResult = validateDSLAuto(content);
    const valid = validationResult.valid;
    const errors = (validationResult.errors || []).map((e) => ({
      path: e.path,
      message: e.message,
    }));

    // 计算相对路径
    const relativePath = filePath.includes(".c4a/")
      ? `.c4a/${filePath.split(".c4a/")[1]}`
      : filePath;

    return {
      success: true,
      content,
      raw,
      path: relativePath,
      valid,
      errors,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {
        success: false,
        message: `文件不存在: ${filePath}`,
      };
    }
    return {
      success: false,
      message: `读取失败: ${err.message}`,
    };
  }
}
