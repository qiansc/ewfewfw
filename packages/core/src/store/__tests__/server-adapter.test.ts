import { describe, expect, test } from 'bun:test';
import { ServerAdapter } from '../server-adapter.js';

describe('ServerAdapter placeholder', () => {
  test('throws clear error when not implemented', async () => {
    const adapter = new ServerAdapter({ url: 'http://localhost:8050' });
    await expect(adapter.initialize()).rejects.toThrow(/Server mode not implemented/);
  });
});
