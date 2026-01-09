/**
 * 配置生成器主类
 */
import type { UnifiedConfig } from "./schema.js";
import type { GenerateOptions, GenerateResult, ConfigAdapter, TargetPlatform } from "./types.js";
import { validateConfig } from "./validator.js";
import { OpencodeAdapter } from "./adapters/opencode.js";
import { ClaudeSdkAdapter } from "./adapters/claudeSdk.js";
import { CursorAdapter } from "./adapters/cursor.js";
import { readFileContent } from "./utils/fileUtils.js";
import { logger, LogLevel } from "./utils/logger.js";
import { parse as parseYaml } from "yaml";
import { UnifiedConfigSchema } from "./schema.js";

/**
 * 配置生成器
 */
export class ConfigGenerator {
  private adapters: Map<TargetPlatform, ConfigAdapter>;

  constructor() {
    this.adapters = new Map();
    this.registerAdapter(new OpencodeAdapter());
    this.registerAdapter(new ClaudeSdkAdapter());
    this.registerAdapter(new CursorAdapter());
  }

  /**
   * 注册适配器
   */
  private registerAdapter(adapter: ConfigAdapter) {
    this.adapters.set(adapter.platform, adapter);
  }

  /**
   * 加载统一配置
   */
  async loadConfig(configPath: string): Promise<UnifiedConfig> {
    // 先验证
    const validation = await validateConfig(configPath);
    if (!validation.valid) {
      throw new Error(`配置验证失败:\n${validation.errors?.join("\n")}`);
    }

    // 读取并解析
    const content = await readFileContent(configPath);
    const data = parseYaml(content);
    const result = UnifiedConfigSchema.parse(data);

    return result;
  }

  /**
   * 生成配置文件
   */
  async generate(options: GenerateOptions): Promise<GenerateResult[]> {
    const configPath = options.configPath || "c4a.config.yaml";

    // 设置日志级别
    if (options.verbose) {
      logger.setLevel(LogLevel.DEBUG);
    }

    logger.info(`正在加载配置文件: ${configPath}`);

    // 加载配置
    let config: UnifiedConfig;
    try {
      config = await this.loadConfig(configPath);
    } catch (err) {
      logger.error("加载配置失败:", err);
      return [
        {
          success: false,
          platform: "all",
          outputFiles: [],
          errors: [(err as Error).message],
        },
      ];
    }

    // 确定目标平台
    const targets = this.resolveTargets(options.target);
    logger.info(`目标平台: ${targets.join(", ")}`);

    // 生成配置
    const results: GenerateResult[] = [];
    for (const target of targets) {
      const adapter = this.adapters.get(target);
      if (!adapter) {
        logger.error(`不支持的平台: ${target}`);
        continue;
      }

      logger.info(`正在生成 ${target} 配置...`);
      const result = await adapter.generate(config, options);
      results.push(result);

      if (result.success) {
        logger.success(`${target} 配置生成成功`);
      } else {
        logger.error(`${target} 配置生成失败:`, result.errors);
      }
    }

    return results;
  }

  /**
   * 解析目标平台列表
   */
  private resolveTargets(target?: TargetPlatform): TargetPlatform[] {
    if (!target || target === "all") {
      return ["opencode", "claude-sdk", "cursor"];
    }
    return [target];
  }

  /**
   * 验证配置文件
   */
  async validate(configPath: string): Promise<boolean> {
    const result = await validateConfig(configPath);

    if (result.valid) {
      logger.success("配置文件验证通过");
      if (result.warnings) {
        result.warnings.forEach((w) => logger.warn(w));
      }
      return true;
    } else {
      logger.error("配置文件验证失败:");
      result.errors?.forEach((e) => logger.error(`  - ${e}`));
      return false;
    }
  }
}
