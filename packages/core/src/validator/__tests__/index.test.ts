import { describe, it, expect } from "bun:test";
import { validateDSL, validateDSLAuto } from "../index.js";

describe("Validator", () => {
  describe("System DSL", () => {
    it("validates a correct system DSL", () => {
      const data = {
        schema: "c4a/v1",
        type: "software-system",
        system: {
          id: "sys-test",
          name: "Test System",
          description: "A test system",
          scope: "project",
          owner: {
            team: "Test Team"
          }
        }
      };
      const result = validateDSL(data, "system");
      expect(result.valid).toBe(true);
    });

    it("fails on missing required fields", () => {
      const data = {
        schema: "c4a/v1",
        type: "software-system",
        system: {
          id: "sys-test"
          // missing name, description, scope
        }
      };
      const result = validateDSL(data, "system");
      expect(result.valid).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe("Container DSL", () => {
    it("validates a correct container DSL", () => {
      const data = {
        schema: "c4a/v1",
        type: "container",
        container: {
          id: "con-api",
          name: "API Container",
          description: "API Service",
          scope: "project",
          system_id: "sys-test",
          technology: [{
            language: "TypeScript",
            protocol: "HTTP"
          }],
          repository: {
            url: "https://github.com/org/repo"
          }
        }
      };
      const result = validateDSL(data, "container");
      expect(result.valid).toBe(true);
    });

    it("fails on invalid URI format", () => {
      const data = {
        schema: "c4a/v1",
        type: "container",
        container: {
          id: "con-api",
          name: "API Container",
          description: "API Service",
          scope: "project",
          system_id: "sys-test",
          technology: [{
            language: "TypeScript",
            protocol: "HTTP"
          }],
          repository: {
            url: "not-a-valid-uri"
          }
        }
      };
      const result = validateDSL(data, "container");
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.keyword === "format")).toBe(true);
    });
  });

  describe("ADR DSL", () => {
    it("validates a correct ADR DSL", () => {
      const data = {
        schema: "c4a/v1",
        type: "adr",
        adr: {
          id: "adr-a001-init",
          title: "Initial Decision",
          status: "approved",
          date: "2024-01-01"
        },
        context: "Context here",
        decision: "Decision here",
        consequences: {
          positive: ["Good thing"],
          negative: ["Bad thing"]
        }
      };
      const result = validateDSL(data, "adr");
      expect(result.valid).toBe(true);
    });

    it("fails on invalid date format", () => {
      const data = {
        schema: "c4a/v1",
        type: "adr",
        adr: {
          id: "adr-a001-init",
          title: "Initial Decision",
          status: "approved",
          date: "not-a-date"
        },
        context: "Context here",
        decision: "Decision here"
      };
      const result = validateDSL(data, "adr");
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.keyword === "format")).toBe(true);
    });
  });

  describe("validateDSLAuto", () => {
    it("automatically detects system type", () => {
      const data = {
        schema: "c4a/v1",
        type: "software-system",
        system: {
          id: "sys-auto",
          name: "Auto System",
          description: "Auto desc",
          scope: "project"
        }
      };
      const result = validateDSLAuto(data);
      expect(result.valid).toBe(true);
    });

    it("returns error for unknown type", () => {
      const data = {
        type: "unknown-type"
      };
      const result = validateDSLAuto(data);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0].message).toContain("Invalid type");
    });
  });
});
