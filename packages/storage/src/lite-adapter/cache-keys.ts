export function normalizeRootId(rootId: string | null | undefined): string | null {
  if (rootId === '' || rootId === undefined || rootId === null) return null;
  return rootId;
}

export function toEntityCacheKey(rootId: string | null | undefined, id: string): string {
  const normalizedRootId = normalizeRootId(rootId);
  return `${normalizedRootId ?? 'null'}:${id}`;
}

export function expandEntityCacheKeys(rootId: string | null | undefined, id: string): string[] {
  return [toEntityCacheKey(rootId, id), id];
}
