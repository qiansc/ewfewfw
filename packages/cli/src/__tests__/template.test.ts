import { describe, expect, test } from "bun:test";
import { generateTemplate } from "../core/templates.js";

describe("generateTemplate", () => {
  test("generates container template", () => {
    const content = generateTemplate("container", {
      id: "user-service",
      name: "用户服务",
      related: "ecommerce-system",
      now: new Date("2026-01-01T00:00:00Z"),
    });

    expect(content).toContain("type: container");
    expect(content).toContain("id: user-service");
    expect(content).toContain("name: \"用户服务\"");
    expect(content).toContain("system_id: \"ecommerce-system\"");
    expect(content).toContain("metadata:");
    expect(content).toContain("created_at: \"2026-01-01T00:00:00.000Z\"");
  });

  test("adds TODO comment when name missing", () => {
    const content = generateTemplate("system", {
      id: "core-platform",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(content).toContain("name: \"\"  # TODO: 补充名称");
  });
});
