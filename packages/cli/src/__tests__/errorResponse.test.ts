import { describe, expect, test } from "bun:test";
import { buildErrorResponse, printErrorResponse } from "../utils/errorResponse.js";

describe("errorResponse helpers", () => {
  test("buildErrorResponse includes timestamp and details", () => {
    const response = buildErrorResponse(
      "C4A-INPUT-001",
      "Something went wrong",
      { field: "mode", expected: "local", actual: "remote" },
      [{ action: "retry", label: "Retry" }],
    );

    expect(response.code).toBe("C4A-INPUT-001");
    expect(response.details?.field).toBe("mode");
    expect(response.recoverable_actions?.[0].action).toBe("retry");
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  });

  test("printErrorResponse outputs json", () => {
    const output: string[] = [];
    const previous = console.error;
    console.error = (message?: unknown) => {
      output.push(String(message));
    };

    try {
      printErrorResponse(
        buildErrorResponse("C4A-INPUT-002", "boom", { suggestion: "retry" }),
      );
    } finally {
      console.error = previous;
    }

    const parsed = JSON.parse(output.join("\n"));
    expect(parsed.code).toBe("C4A-INPUT-002");
    expect(parsed.details.suggestion).toBe("retry");
  });
});
