#!/usr/bin/env bun
/**
 * C4A CLI - 交互式开发者工具
 *
 * 用法:
 *   ./start.sh              # 交互式菜单
 *   ./start.sh dev          # 直接执行命令
 *   ./start.sh debug:store  # 执行子命令
 */
import { render } from "ink";
import React from "react";
import { App } from "./App.js";
import { runCommand } from "./commands/index.js";

const args = process.argv.slice(2);

if (args.length > 0) {
  // 直接执行命令模式: ./start.sh dev
  await runCommand(args[0], args.slice(1));
} else {
  // 交互式菜单模式: ./start.sh
  render(React.createElement(App));
}
