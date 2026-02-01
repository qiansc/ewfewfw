import { describe, expect, test } from 'bun:test';
import { WriteQueue } from '../write-queue.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('WriteQueue', () => {
  test('serializes operations (max concurrency = 1)', async () => {
    const queue = new WriteQueue({ maxQueueSize: 10, operationTimeout: 1000, queueTimeout: 1000 });
    let running = 0;
    let maxRunning = 0;

    const op = async (wait: number) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await delay(wait);
      running -= 1;
      return wait;
    };

    const results = await Promise.all([
      queue.enqueue(() => op(30)),
      queue.enqueue(() => op(10)),
      queue.enqueue(() => op(5)),
    ]);

    expect(results).toEqual([30, 10, 5]);
    expect(maxRunning).toBe(1);
  });

  test('rejects when queue wait exceeds timeout', async () => {
    const queue = new WriteQueue({ maxQueueSize: 10, operationTimeout: 1000, queueTimeout: 10 });
    const first = queue.enqueue(async () => {
      await delay(30);
      return 'first';
    });
    const second = queue.enqueue(async () => 'second');

    const results = await Promise.allSettled([first, second]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect(String(results[1].reason)).toContain('C4A-SYS-003');
    }
  });

  test('rejects when operation exceeds timeout', async () => {
    const queue = new WriteQueue({ maxQueueSize: 10, operationTimeout: 10, queueTimeout: 1000 });
    await expect(
      queue.enqueue(async () => {
        await delay(30);
        return 'late';
      })
    ).rejects.toThrow('C4A-SYS-004');
  });
});
