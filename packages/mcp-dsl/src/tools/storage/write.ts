/**
 * c4a_local_write_file 工具实现
 * 写入 DSL 文件，自动验证并创建目录
 */
import { writeFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { validateDSLAuto } from "@c4a/core";
import type { WriteInput } from "../../schemas/storageSchemas.js";

export interface WriteResult {
  success: boolean;
  path?: string;
  valid?: boolean;
  errors?: Array<{ path: string; message: string }>;
  message: string;
}

export async function writeHandler(input: WriteInput): Promise<WriteResult> {
  const projectPath = input.project_path || ".";
  const shouldValidate = input.validate !== false;
  const allowOverwrite = input.overwrite === true;

  // 构建完整路径
  const filePath = input.path.startsWith(".c4a/")
    ? join(projectPath, input.path)
    : join(projectPath, ".c4a", input.path);

  // 解析内容
  let content: Record<string, unknown>;
  let yamlContent: string;

  if (typeof input.content === "string") {
    try {
      content = parseYaml(input.content) as Record<string, unknown>;
      yamlContent = input.content;
    } catch (error) {
      return {
        success: false,
        message: `YAML 解析失败: ${(error as Error).message}`,
      };
    }
  } else {
    content = input.content as Record<string, unknown>;
    yamlContent = stringifyYaml(content);
  }

  // 验证
  let valid = true;
  let errors: Array<{ path: string; message: string }> = [];

  if (shouldValidate) {
    // 使用 validateDSLAuto 自动检测类型并验证
    const validationResult = validateDSLAuto(content);
    valid = validationResult.valid;
    errors = (validationResult.errors || []).map((e: { path: string; message: string }) => ({
      path: e.path,
      message: e.message,
    }));

    if (!valid) {
      return {
        success: false,
        path: input.path.startsWith(".c4a/") ? input.path : `.c4a/${input.path}`,
        valid: false,
        errors,
        message: `验证失败: ${errors.length} 个错误`,
      };
    }
  }

  // 检查文件是否存在
  if (!allowOverwrite) {
    try {
      await access(filePath);
      return {
        success: false,
        path: input.path.startsWith(".c4a/") ? input.path : `.c4a/${input.path}`,
        message: "文件已存在，设置 overwrite: true 以覆盖",
      };
    } catch {
      // 文件不存在，继续
    }
  }

  // 创建目录
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  // 写入文件
  try {
    await writeFile(filePath, yamlContent, "utf-8");

    const relativePath = input.path.startsWith(".c4a/") ? input.path : `.c4a/${input.path}`;

    return {
      success: true,
      path: relativePath,
      valid: shouldValidate ? valid : undefined,
      errors: shouldValidate ? errors : undefined,
      message: "DSL 文件写入成功",
    };
  } catch (error) {
    return {
      success: false,
      message: `写入失败: ${(error as Error).message}`,
    };
  }
}
