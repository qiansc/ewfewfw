export const EXCLUDED_TYPES = new Set<string>(['contract', 'checklist']);
export const TIMESTAMP_EPSILON_MS = 1000;

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

export function decideDirection(
  dbUpdatedAt?: string,
  fileMtime?: string
): 'db' | 'file' | 'conflict' {
  if (!dbUpdatedAt || !fileMtime) {
    return 'conflict';
  }
  const dbTime = Date.parse(dbUpdatedAt);
  const fileTime = Date.parse(fileMtime);
  if (Number.isNaN(dbTime) || Number.isNaN(fileTime)) {
    return 'conflict';
  }
  if (Math.abs(dbTime - fileTime) <= TIMESTAMP_EPSILON_MS) {
    return 'conflict';
  }
  return dbTime > fileTime ? 'db' : 'file';
}
