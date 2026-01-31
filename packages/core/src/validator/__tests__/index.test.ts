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
          },
          references: ["product-a", "scope:domain/order-flow"]
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
          },
          references: ["project:frontend-app/auth-component", "repo:company/shared-lib/jwt-utils"]
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
          date: "2024-01-01",
          references: ["sys-test", "project:alpha/auth-service"]
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

  describe("References coverage", () => {
    it("validates product references", () => {
      const data = {
        schema: "c4a/v1",
        type: "product",
        product: {
          id: "product-a",
          name: "Product A",
          description: "Product description",
          scope: "domain",
          references: ["scope:enterprise/platform"]
        }
      };
      const result = validateDSL(data, "product");
      expect(result.valid).toBe(true);
    });

    it("validates process references", () => {
      const data = {
        schema: "c4a/v1",
        type: "process",
        process: {
          id: "prc-b-a001",
          name: "Process A",
          description: "Process description",
          process_type: "business",
          scope: "domain",
          references: ["product-a", "project:alpha/sys-test"]
        },
        steps: [
          { id: "step-1", name: "Step 1" }
        ]
      };
      const result = validateDSL(data, "process");
      expect(result.valid).toBe(true);
    });

    it("validates sor references", () => {
      const data = {
        schema: "c4a/v1",
        type: "sor",
        sor: {
          id: "sor-b-a001",
          name: "Requirement A",
          description: "Requirement description",
          scope: "project",
          sor_type: "business_rule",
          entity_type: "system",
          entity_id: "sys-test",
          references: ["prc-b-a001", "scope:domain/product-a"]
        }
      };
      const result = validateDSL(data, "sor");
      expect(result.valid).toBe(true);
    });

    it("validates component references", () => {
      const data = {
        schema: "c4a/v1",
        type: "component",
        component: {
          id: "comp-auth",
          name: "Auth Component",
          description: "Handles auth",
          scope: "project",
          container_id: "con-api",
          references: ["repo:company/shared-lib/jwt-utils"]
        }
      };
      const result = validateDSL(data, "component");
      expect(result.valid).toBe(true);
    });

    it("validates contract references", () => {
      const data = {
        schema: "c4a/v1",
        type: "contract",
        contract: {
          id: "api-auth",
          name: "Auth API",
          contract_type: "openapi",
          status: "draft",
          references: ["sor-b-a001"]
        }
      };
      const result = validateDSL(data, "contract");
      expect(result.valid).toBe(true);
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
