import { describe, expect, test } from "bun:test";
import { loadSchema, formatSchemaOutput } from "../core/schema.js";

describe("schema helpers", () => {
  test("loads system schema", async () => {
    const schema = await loadSchema("system");
    expect(schema).toHaveProperty("$id");
  });

  test("formats schema as yaml", async () => {
    const schema = await loadSchema("container");
    const output = formatSchemaOutput(schema, "yaml");
    expect(output).toContain("$schema");
  });
});
