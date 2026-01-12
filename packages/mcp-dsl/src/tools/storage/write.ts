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
  errors?: Array<{ path: string; message: string; hint?: string }>;
  warnings?: Array<{ path: string; message: string; hint?: string; suggested_path?: string }>;
  message: string;
}

/**
 * 目录-类型映射规则
 * 检查文件路径与 DSL type 是否一致
 */
const DIRECTORY_TYPE_MAP: Record<string, string[]> = {
  containers: ["container"],
  components: ["component"],
  adr: ["adr"],
  systems: ["software-system"],
  contracts: ["contract"],
};

/**
 * 类型-目录映射（反向映射，用于建议正确路径）
 */
const TYPE_DIRECTORY_MAP: Record<string, string> = {
  container: "containers",
  component: "components",
  adr: "adr",
  "software-system": "systems",
  contract: "contracts",
};

/**
 * 检查目录-类型一致性，并提供建议路径
 */
function checkDirectoryTypeConsistency(
  path: string,
  type: string
): { consistent: boolean; warning?: string; hint?: string; suggested_path?: string } {
  // 从路径中提取目录名
  const pathParts = path.split("/");

  for (const [dirName, allowedTypes] of Object.entries(DIRECTORY_TYPE_MAP)) {
    // 检查路径中是否包含此目录
    const dirIndex = pathParts.indexOf(dirName);
    if (dirIndex !== -1) {
      if (!allowedTypes.includes(type)) {
        const expectedType = allowedTypes[0];
        const correctDir = TYPE_DIRECTORY_MAP[type] || "unknown";

        // 生成建议路径：替换错误的目录名
        const suggestedParts = [...pathParts];
        suggestedParts[dirIndex] = correctDir;
        const suggestedPath = suggestedParts.join("/");

        return {
          consistent: false,
          warning: `目录 "${dirName}/" 下不应放置 type: ${type} 的文件`,
          hint: `${dirName}/ 目录只能放 type: ${expectedType} 的文件。请将此文件放到 ${correctDir}/ 目录。`,
          suggested_path: suggestedPath,
        };
      }
    }
  }

  return { consistent: true };
}

export async function writeHandler(input: WriteInput): Promise<WriteResult> {
  const projectPath = input.project_path || ".";
  const shouldValidate = input.validate !== false;
  const strictMode = input.strict === true;
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
  let errors: Array<{ path: string; message: string; hint?: string }> = [];
  const warnings: Array<{ path: string; message: string; hint?: string; suggested_path?: string }> = [];

  if (shouldValidate) {
    // 使用 validateDSLAuto 自动检测类型并验证
    const validationResult = validateDSLAuto(content);
    valid = validationResult.valid;
    errors = (validationResult.errors || []).map(
      (e: { path: string; message: string; hint?: string }) => ({
        path: e.path,
        message: e.message,
        hint: e.hint,
      })
    );

    if (!valid) {
      return {
        success: false,
        path: input.path.startsWith(".c4a/") ? input.path : `.c4a/${input.path}`,
        valid: false,
        errors,
        message: `验证失败: ${errors.length} 个错误`,
      };
    }

    // 检查目录-类型一致性
    const dslType = content.type as string;
    const consistencyCheck = checkDirectoryTypeConsistency(input.path, dslType);
    if (!consistencyCheck.consistent) {
      warnings.push({
        path: "",
        message: consistencyCheck.warning!,
        hint: consistencyCheck.hint,
        suggested_path: consistencyCheck.suggested_path,
      });

      // 严格模式下，有警告也返回失败
      if (strictMode) {
        return {
          success: false,
          path: input.path.startsWith(".c4a/") ? input.path : `.c4a/${input.path}`,
          valid: true,
          warnings,
          message: `严格模式：目录-类型不一致。建议路径: ${consistencyCheck.suggested_path}`,
        };
      }
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

    // 构建消息
    let message = "DSL 文件写入成功";
    if (warnings.length > 0) {
      message += `（警告: ${warnings.map((w) => w.message).join("; ")}）`;
    }

    return {
      success: true,
      path: relativePath,
      valid: shouldValidate ? valid : undefined,
      errors: shouldValidate && errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      message,
    };
  } catch (error) {
    return {
      success: false,
      message: `写入失败: ${(error as Error).message}`,
    };
  }
}
