export const EXCLUDED_TYPES = new Set<string>(['contract', 'checklist']);

export function isExcludedType(type: string | null | undefined): boolean {
  if (!type) {
    return false;
  }
  return EXCLUDED_TYPES.has(type);
}

export function pickString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

export function safeParseJson(data: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function extractEntityMeta(data: Record<string, unknown>): {
  kind: string | null;
  scope: string | null;
  perspective: string | null;
} {
  return {
    kind: pickString(data.kind),
    scope: pickString(data.scope),
    perspective: pickString(data.perspective),
  };
}
