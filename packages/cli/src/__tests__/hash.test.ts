import { describe, expect, test } from "bun:test";
import { calculateHash } from "../utils/hash.js";

describe("calculateHash", () => {
  test("normalizes YAML key order", () => {
    const a = "type: container\ncontainer:\n  id: demo\n  name: Demo\n";
    const b = "container:\n  name: Demo\n  id: demo\ntype: container\n";
    expect(calculateHash(a)).toBe(calculateHash(b));
  });

  test("normalizes line endings", () => {
    const lf = "type: container\ncontainer:\n  id: demo\n";
    const crlf = "type: container\r\ncontainer:\r\n  id: demo\r\n";
    expect(calculateHash(lf)).toBe(calculateHash(crlf));
  });

  test("normalizes trailing newlines", () => {
    const one = "type: container\ncontainer:\n  id: demo\n";
    const many = "type: container\ncontainer:\n  id: demo\n\n\n";
    expect(calculateHash(one)).toBe(calculateHash(many));
  });
});
