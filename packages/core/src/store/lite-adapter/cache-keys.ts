export function normalizeProject(project: string | null | undefined): string | null {
  if (project === '' || project === undefined || project === null) return null;
  return project;
}

export function toEntityCacheKey(project: string | null | undefined, id: string): string {
  const normalizedProject = normalizeProject(project);
  return `${normalizedProject ?? 'null'}:${id}`;
}

export function expandEntityCacheKeys(project: string | null | undefined, id: string): string[] {
  return [toEntityCacheKey(project, id), id];
}
