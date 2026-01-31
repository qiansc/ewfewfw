import { describe, expect, test } from "bun:test";
import { parseArgs } from "../utils/args.js";

describe("parseArgs", () => {
  test("parses positionals and options", () => {
    const result = parseArgs(["install", "local", "--mode", "server", "--flag", "--name=demo"]);
    expect(result.positionals).toEqual(["install", "local"]);
    expect(result.options).toEqual({
      mode: "server",
      flag: true,
      name: "demo",
    });
  });

  test("treats non-flag as positional", () => {
    const result = parseArgs(["--format", "json", "extra"]);
    expect(result.positionals).toEqual(["extra"]);
    expect(result.options.format).toBe("json");
  });
});
