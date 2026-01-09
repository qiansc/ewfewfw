/**
 * 配置适配器基类
 */
import type { ConfigAdapter, GenerateOptions, GenerateResult, ValidationResult, TargetPlatform } from "../types.js";
import type { UnifiedConfig } from "../schema.js";

/**
 * 适配器抽象基类
 */
export abstract class BaseAdapter implements ConfigAdapter {
  abstract readonly platform: TargetPlatform;

  abstract generate(config: UnifiedConfig, options: GenerateOptions): Promise<GenerateResult>;

  abstract validate(outputDir: string): Promise<ValidationResult>;

  /**
   * 创建成功结果
   */
  protected createSuccessResult(outputFiles: string[]): GenerateResult {
    return {
      success: true,
      platform: this.platform,
      outputFiles,
    };
  }

  /**
   * 创建失败结果
   */
  protected createErrorResult(errors: string[]): GenerateResult {
    return {
      success: false,
      platform: this.platform,
      outputFiles: [],
      errors,
    };
  }
}
