import { describe, expect, test } from 'bun:test';
import {
  DEGRADED_MODE_MAX_DEPTH,
  buildServerMergeResult,
  createDegradedModeError,
  createPartialSyncWarning,
  createPendingSyncRecord,
  isDegradedMode,
  isDepthAllowedInDegradedMode,
  updatePendingSyncStatus,
} from '../multi-store-sync.js';

describe('multi-store sync helpers', () => {
  test('degraded mode detection and depth rules', () => {
    expect(isDegradedMode({ mongodb: true, neo4j: true, milvus: true })).toBe(false);
    expect(isDegradedMode({ mongodb: true, neo4j: false, milvus: true })).toBe(true);
    expect(isDepthAllowedInDegradedMode(DEGRADED_MODE_MAX_DEPTH)).toBe(true);
    expect(isDepthAllowedInDegradedMode(DEGRADED_MODE_MAX_DEPTH + 1)).toBe(false);
  });

  test('degraded mode error includes allowed depth', () => {
    const result = createDegradedModeError(DEGRADED_MODE_MAX_DEPTH + 2);
    expect(result.success).toBe(false);
    expect(result.allowed_depth).toBe(DEGRADED_MODE_MAX_DEPTH);
    expect(result.message).toContain('depth');
  });

  test('partial sync warning contains repair command', () => {
    const warning = createPartialSyncWarning('neo4j', ['svc-1', 'svc-2']);
    expect(warning.code).toBe('PARTIAL_SYNC');
    expect(warning.details?.failed_entities).toEqual(['svc-1', 'svc-2']);
    expect(warning.details?.repair_command).toContain('c4a_store_repair');
    expect(warning.details?.repair_command).toContain('neo4j');
  });

  test('pending sync record lifecycle updates status', () => {
    const record = createPendingSyncRecord('feat-1', ['a', 'b']);
    expect(record.status).toBe('pending');
    expect(record.neo4j_synced).toBe(false);
    expect(record.milvus_synced).toBe(false);
    expect(Date.parse(record.created_at)).not.toBeNaN();
    expect(Date.parse(record.updated_at)).not.toBeNaN();

    const partial = updatePendingSyncStatus(record, true, false);
    expect(partial.status).toBe('partial');
    expect(partial.neo4j_synced).toBe(true);
    expect(partial.milvus_synced).toBe(false);
    expect(Date.parse(partial.updated_at)).toBeGreaterThanOrEqual(Date.parse(record.updated_at));

    const completed = updatePendingSyncStatus(record, true, true);
    expect(completed.status).toBe('completed');
    expect(completed.neo4j_synced).toBe(true);
    expect(completed.milvus_synced).toBe(true);
  });

  test('buildServerMergeResult sets warnings and sync status', () => {
    const full = buildServerMergeResult(['e1'], true, true);
    expect(full.success).toBe(true);
    expect(full.sync_status.neo4j).toBe(true);
    expect(full.sync_status.milvus).toBe(true);
    expect(full.repair_scheduled).toBe(false);
    expect(full.warnings).toBeUndefined();

    const partial = buildServerMergeResult(['e1', 'e2'], false, true);
    expect(partial.sync_status.neo4j).toBe(false);
    expect(partial.repair_scheduled).toBe(true);
    expect(partial.warnings?.length).toBe(1);

    const bothFail = buildServerMergeResult(['e3'], false, false);
    expect(bothFail.warnings?.length).toBe(2);
  });
});
