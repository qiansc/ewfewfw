/**
 * 配置验证器
 */
import { UnifiedConfigSchema } from "./schema.js";
import type { ValidationResult } from "./types.js";
import { parse as parseYaml } from "yaml";
import { fileExists, readFileContent } from "./utils/fileUtils.js";
import { logger } from "./utils/logger.js";

/**
 * 验证统一配置文件
 */
export async function validateConfig(configPath: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 1. 检查文件存在
    if (!(await fileExists(configPath))) {
      return {
        valid: false,
        errors: [`配置文件不存在: ${configPath}`],
      };
    }

    // 2. 读取并解析 YAML
    const content = await readFileContent(configPath);
    let data: unknown;
    try {
      data = parseYaml(content);
    } catch (err) {
      return {
        valid: false,
        errors: [`YAML 解析失败: ${(err as Error).message}`],
      };
    }

    // 3. Zod Schema 验证
    const result = UnifiedConfigSchema.safeParse(data);
    if (!result.success) {
      result.error.errors.forEach((err) => {
        errors.push(`${err.path.join(".")}: ${err.message}`);
      });
      return { valid: false, errors };
    }

    const config = result.data;

    // 4. 额外验证：检查引用的文件是否存在
    for (const instructionFile of config.instructions) {
      if (!(await fileExists(instructionFile))) {
        warnings.push(`说明文件不存在: ${instructionFile}`);
      }
    }

    for (const [name, agent] of Object.entries(config.agents)) {
      if (!(await fileExists(agent.promptFile))) {
        warnings.push(`Agent '${name}' 的 promptFile 不存在: ${agent.promptFile}`);
      }
    }

    logger.success("配置文件验证通过");
    if (warnings.length > 0) {
      logger.warn("存在警告:", warnings);
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    return {
      valid: false,
      errors: [`验证过程出错: ${(err as Error).message}`],
    };
  }
}
