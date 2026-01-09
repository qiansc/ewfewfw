#!/usr/bin/env bun
/**
 * C4A 配置生成器 CLI
 *
 * 使用方式:
 *   bun run config:generate [--target <platform>] [--config <path>] [--dry-run] [-v]
 *   bun run config:validate [--config <path>]
 */

import { ConfigGenerator } from "./generator.js";
import type { GenerateOptions, TargetPlatform } from "./types.js";
import { logger } from "./utils/logger.js";

/**
 * 解析命令行参数
 */
function parseArgs(): { command: string; options: GenerateOptions } {
  const args = process.argv.slice(2);

  const options: GenerateOptions = {
    target: "all",
    configPath: "c4a.config.yaml",
    verbose: false,
    dryRun: false,
  };

  let command = "generate";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "generate":
        command = "generate";
        break;
      case "validate":
        command = "validate";
        break;
      case "--target":
      case "-t":
        options.target = args[++i] as TargetPlatform;
        break;
      case "--config":
      case "-c":
        options.configPath = args[++i];
        break;
      case "--output":
      case "-o":
        options.outputDir = args[++i];
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
    }
  }

  return { command, options };
}

/**
 * 打印帮助信息
 */
function printHelp() {
  console.log(`
C4A 配置生成器

使用方式:
  c4a-config generate [选项]    生成配置文件
  c4a-config validate [选项]    验证配置文件

选项:
  -t, --target <platform>       目标平台 (opencode, claude-sdk, cursor, all)
  -c, --config <path>           配置文件路径 (默认: c4a.config.yaml)
  -o, --output <dir>            输出目录 (默认: 当前目录)
  --dry-run                     仅显示将要生成的文件，不实际写入
  -v, --verbose                 显示详细日志
  -h, --help                    显示帮助信息

示例:
  # 生成所有平台配置
  bun run config:generate

  # 仅生成 OpenCode 配置
  bun run config:generate --target opencode

  # 验证配置文件
  bun run config:validate

  # 预览生成内容（不写入文件）
  bun run config:generate --dry-run
  `);
}

/**
 * 主函数
 */
async function main() {
  const { command, options } = parseArgs();
  const generator = new ConfigGenerator();

  try {
    if (command === "validate") {
      const valid = await generator.validate(options.configPath!);
      process.exit(valid ? 0 : 1);
    } else if (command === "generate") {
      const results = await generator.generate(options);

      // 统计结果
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      console.log("\n生成结果:");
      console.log(`  成功: ${successCount}`);
      console.log(`  失败: ${failCount}`);

      if (failCount > 0) {
        process.exit(1);
      }
    } else {
      logger.error(`未知命令: ${command}`);
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    logger.error("执行失败:", err);
    process.exit(1);
  }
}

// 执行
main();
