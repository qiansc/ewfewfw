import { initCommand } from "./init.js";
import { installCommand } from "./install.js";
import { syncCommand } from "./sync.js";
import { statusCommand } from "./status.js";
import { validateCommand } from "./validate.js";
import { featCommand } from "./feat.js";
import { templateCommand } from "./template.js";
import { schemaCommand } from "./schema.js";
import { serverCommand } from "./server.js";
import { localCommand } from "./local.js";
import { versionCommand } from "./version.js";

export type CommandHandler = (args: string[]) => Promise<void>;

const COMMANDS: Record<string, CommandHandler> = {
  init: initCommand,
  install: installCommand,
  sync: syncCommand,
  status: statusCommand,
  validate: validateCommand,
  feat: featCommand,
  template: templateCommand,
  schema: schemaCommand,
  server: serverCommand,
  local: localCommand,
  version: versionCommand,
};

export async function runCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log("0.3.1");
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`未知命令: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  await handler(rest);
}

function printHelp(): void {
  console.log("C4A CLI (user)");
  console.log("用法: c4a <command>");
  console.log("可用命令:");
  console.log("  init                 初始化项目");
  console.log("  install [local|server|remote|skip]");
  console.log("  sync                 同步知识");
  console.log("  status               查看状态");
  console.log("  validate             验证 DSL 文件");
  console.log("  feat render <id>     渲染 Checklist");
  console.log("  template <type>      生成模板");
  console.log("  schema <type|all>    输出 Schema");
  console.log("  server <subcommand>  服务管理");
  console.log("  local <subcommand>   本地管理");
  console.log("  version <subcommand> 版本管理");
  console.log("  --version            查看版本");
}
