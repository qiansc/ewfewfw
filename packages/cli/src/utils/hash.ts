import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";

type HashFormat = "yaml" | "json";

export function calculateHash(content: string, format: HashFormat = "yaml"): string {
  let normalized = "";

  if (format === "yaml") {
    normalized = normalizeYaml(content);
  } else {
    normalized = normalizeJson(content);
  }

  normalized = normalizeText(normalized);
  return createHash("sha256").update(normalized, "utf-8").digest("hex");
}

export function hashString(value: string): string {
  return calculateHash(value, "json");
}

function normalizeYaml(content: string): string {
  try {
    const parsed = parse(content) as unknown;
    const sorted = sortKeysDeep(parsed);
    return stringify(sorted, {
      lineWidth: -1,
      indent: 2,
    });
  } catch (error) {
    return normalizeText(content);
  }
}

function normalizeJson(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    const sorted = sortKeysDeep(parsed);
    return JSON.stringify(sorted);
  } catch (error) {
    return normalizeText(content);
  }
}

function normalizeText(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.replace(/\n+$/, "\n");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = sortKeysDeep(record[key]);
  }
  return result;
}
