import type { QueryContext } from "./types.js";

export type SyncStatusChecker = (entityIds: string[]) => Promise<QueryContext>;

export async function checkSyncStatus(
  entityIds: string[],
  checker?: SyncStatusChecker
): Promise<QueryContext> {
  if (!checker) {
    return { degraded: false };
  }
  return checker(entityIds);
}
