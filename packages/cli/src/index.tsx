#!/usr/bin/env node
/**
 * C4A CLI - 用户命令行入口
 */
import { render } from "ink";
import React from "react";
import { App, type AppSelection } from "./App.js";
import { runCommand } from "./commands/index.js";
import { promptInput } from "./utils/prompt.js";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`
C4A CLI - Context For AI

用法:
  c4a                    启动交互式菜单 (需要 TTY 终端)
  c4a <command> [args]   直接执行命令

常用命令:
  init                   初始化项目配置
  install <mode>         安装存储模式 (local/server/remote)
  sync                   同步到知识库
  status                 查看状态
  validate [path]        验证 DSL 文件

  server <subcommand>    服务模式命令 (需先安装 server 模式)
  local <subcommand>     本地模式命令 (需先安装 local 模式)

更多信息: https://github.com/your-org/c4a
`);
}

async function runInteractiveMenu(): Promise<AppSelection | null> {
  // 检查是否为 TTY 环境
  if (!process.stdin.isTTY) {
    console.error("错误: 交互式菜单需要在 TTY 终端中运行");
    console.error("请使用 'c4a <command>' 直接执行命令，或在真实终端中运行");
    console.error("");
    printHelp();
    process.exit(1);
  }

  let selection: AppSelection | null = null;
  let app: ReturnType<typeof render> | null = null;
  app = render(
    React.createElement(App, {
      onSelect: (next) => {
        selection = next;
        app?.unmount();
      },
    }),
  );
  await app.waitUntilExit();
  return selection;
}

async function handleSelection(selection: AppSelection | null): Promise<void> {
  if (!selection || selection.kind === "exit") {
    return;
  }
  if (selection.kind === "command") {
    await runCommand(selection.command);
    return;
  }
  if (selection.action === "template") {
    const type = await promptInput(
      "模板类型 (system/container/component/adr/process/sor)",
    );
    if (!type) return;
    const allowed = new Set(["system", "container", "component", "adr", "process", "sor"]);
    if (!allowed.has(type)) {
      console.error(`未知模板类型: ${type}`);
      return;
    }
    await runCommand(["template", type]);
    return;
  }
  if (selection.action === "schema") {
    const type = await promptInput(
      "Schema 类型 (system/container/component/adr/process/sor/feat/checklist/all)",
    );
    if (!type) return;
    const allowed = new Set([
      "system",
      "container",
      "component",
      "adr",
      "process",
      "sor",
      "feat",
      "checklist",
      "all",
    ]);
    if (!allowed.has(type)) {
      console.error(`未知 Schema 类型: ${type}`);
      return;
    }
    await runCommand(["schema", type]);
    return;
  }
  if (selection.action === "feat-render") {
    const featId = await promptInput("Feat ID");
    if (!featId) return;
    await runCommand(["feat", "render", featId]);
  }
}

async function waitForAnyKey(message: string): Promise<void> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return;
  }
  process.stdout.write(message);
  await new Promise<void>((resolve) => {
    const onData = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once("data", onData);
  });
}

// 主逻辑
if (args.length > 0) {
  // 有参数：直接执行命令
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printHelp();
  } else {
    await runCommand(args);
  }
} else {
  // 无参数：启动交互式菜单（会自动检查 TTY）
  while (true) {
    const selection = await runInteractiveMenu();
    if (!selection || selection.kind === "exit") {
      break;
    }
    if (selection.kind === "command" && selection.command[0] === "help") {
      await runCommand(selection.command);
      await waitForAnyKey("按任意键返回菜单...");
      continue;
    }
    await handleSelection(selection);
    break;
  }
}
