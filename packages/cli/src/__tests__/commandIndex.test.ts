import { describe, expect, test } from "bun:test";
import { runCommand } from "../commands/index.js";

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const previousLog = console.log;
  const previousError = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((item) => String(item)).join(" "));
  };
  return {
    logs,
    errors,
    restore: () => {
      console.log = previousLog;
      console.error = previousError;
    },
  };
}

describe("runCommand", () => {
  test("prints help on empty args", async () => {
    const { logs, restore } = captureConsole();
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    try {
      await runCommand([]);
    } finally {
      restore();
      process.exitCode = previousExit;
    }
    expect(logs.join("\n")).toContain("C4A CLI (user)");
  });

  test("prints version", async () => {
    const { logs, restore } = captureConsole();
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    try {
      await runCommand(["--version"]);
    } finally {
      restore();
      process.exitCode = previousExit;
    }
    expect(logs.join("\n")).toContain("0.3.1");
  });

  test("unknown command sets exitCode and prints error", async () => {
    const { logs, errors, restore } = captureConsole();
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    let exitCode = 0;
    try {
      await runCommand(["nope"]);
      exitCode = process.exitCode ?? 0;
    } finally {
      restore();
      process.exitCode = previousExit;
    }
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("未知命令");
    expect(logs.join("\n")).toContain("可用命令");
  });
});
