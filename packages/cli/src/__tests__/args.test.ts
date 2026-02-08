import { describe, expect, test } from "bun:test";
import { parseArgs } from "../utils/args.js";

describe("parseArgs", () => {
  test("parses positionals and options", () => {
    const result = parseArgs(["version", "create", "1.0.0", "--flag", "--name=demo"]);
    expect(result.positionals).toEqual(["version", "create", "1.0.0"]);
    expect(result.options).toEqual({
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
