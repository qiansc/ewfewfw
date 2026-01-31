import { describe, expect, test } from 'bun:test';
import { detectConflicts } from '../conflictDetector.js';
import type { DbEntityInfo, FileEntityInfo } from '../types.js';

describe('sync conflict detector', () => {
  test('detects content, delete, and type conflicts', () => {
    const dbEntities: DbEntityInfo[] = [
      {
        id: 'content-1',
        type: 'system',
        content_hash: 'hash-db',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'delete-1',
        type: 'system',
        content_hash: 'hash-delete',
      },
      {
        id: 'type-1',
        type: 'system',
        content_hash: 'hash-type',
      },
    ];

    const fileEntities: FileEntityInfo[] = [
      {
        id: 'content-1',
        type: 'system',
        content_hash: 'hash-file',
        path: 'technical/systems/content-1.c4a.yaml',
        mtime: '2026-01-02T00:00:00Z',
      },
      {
        id: 'type-1',
        type: 'container',
        content_hash: 'hash-type-file',
        path: 'technical/containers/type-1.c4a.yaml',
      },
    ];

    const conflicts = detectConflicts(dbEntities, fileEntities);

    expect(conflicts.some((c) => c.entity_id === 'content-1' && c.conflict_type === 'content'))
      .toBe(true);
    expect(conflicts.some((c) => c.entity_id === 'delete-1' && c.conflict_type === 'deleted'))
      .toBe(true);
    expect(conflicts.some((c) => c.entity_id === 'type-1' && c.conflict_type === 'type'))
      .toBe(true);
  });
});
