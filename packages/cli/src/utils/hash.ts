import { createHash } from "node:crypto";
import { parse } from "yaml";
import { computeContentHash } from "@c4a/core/utils";

type HashFormat = "yaml" | "json";

export function calculateHash(content: string, format: HashFormat = "yaml"): string {
  const parsed = format === "yaml" ? parseSafe(content) : parseJsonSafe(content);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return computeContentHash(parsed as Record<string, unknown>);
  }
  const normalized = normalizeText(content);
  return createHash("sha256").update(normalized, "utf-8").digest("hex");
}

export function hashString(value: string): string {
  return calculateHash(value, "json");
}

function parseSafe(content: string): unknown {
  try {
    return parse(content) as unknown;
  } catch (error) {
    return null;
  }
}

function parseJsonSafe(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    return null;
  }
}

function normalizeText(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.replace(/\n+$/, "\n");
}
