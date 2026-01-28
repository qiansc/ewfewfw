/**
 * Write Queue Module for Local Mode
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/vector-search.md §3.3
 *
 * 核心特性:
 * - 写操作串行化，避免 SQLITE_BUSY
 * - 背压机制，防止队列过载
 * - 超时处理，保证系统响应性
 */

export interface WriteQueueConfig {
  /**
   * 队列最大长度
   * 默认: 100
   */
  maxQueueSize?: number;

  /**
   * 单个操作超时时间 (毫秒)
   * 默认: 30000 (30秒)
   */
  operationTimeout?: number;

  /**
   * 队列等待超时时间 (毫秒)
   * 默认: 60000 (60秒)
   */
  queueTimeout?: number;
}

interface QueueItem<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

export interface WriteQueueStatus {
  queueLength: number;
  maxSize: number;
  isProcessing: boolean;
}

/**
 * 写队列管理器
 *
 * 设计文档: vector-search.md L339-417
 *
 * 设计要点:
 * - 写操作通过队列串行化，避免 SQLITE_BUSY
 * - 读操作直接执行，WAL 模式支持并发读
 * - 事务保护：所有写操作都在事务中执行
 */
export class WriteQueue {
  private queue: QueueItem<unknown>[] = [];
  private processing = false;

  private readonly maxQueueSize: number;
  private readonly operationTimeout: number;
  private readonly queueTimeout: number;

  constructor(config: WriteQueueConfig = {}) {
    this.maxQueueSize = config.maxQueueSize ?? 100;
    this.operationTimeout = config.operationTimeout ?? 30000;
    this.queueTimeout = config.queueTimeout ?? 60000;
  }

  /**
   * 将写操作加入队列
   *
   * @param operation - 要执行的写操作
   * @returns 操作结果
   * @throws C4A-SYS-002 队列已满
   * @throws C4A-SYS-003 队列等待超时
   * @throws C4A-SYS-004 操作执行超时
   */
  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    // 背压检查：队列已满时拒绝新请求
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(
        `C4A-SYS-002: 写队列已满（${this.queue.length}/${this.maxQueueSize}），请稍后重试`
      );
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        operation: operation as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
      });

      this.process();
    });
  }

  /**
   * 处理队列中的操作
   */
  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // 检查队列等待超时
      const waitTime = Date.now() - item.enqueuedAt;
      if (waitTime > this.queueTimeout) {
        item.reject(
          new Error(
            `C4A-SYS-003: 队列等待超时（${waitTime}ms > ${this.queueTimeout}ms）`
          )
        );
        continue;
      }

      // 执行操作（带超时）
      try {
        const result = await Promise.race([
          item.operation(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `C4A-SYS-004: 操作执行超时（${this.operationTimeout}ms）`
                  )
                ),
              this.operationTimeout
            )
          ),
        ]);
        item.resolve(result);
      } catch (err) {
        item.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.processing = false;
  }

  /**
   * 获取队列状态（用于监控）
   */
  getStatus(): WriteQueueStatus {
    return {
      queueLength: this.queue.length,
      maxSize: this.maxQueueSize,
      isProcessing: this.processing,
    };
  }

  /**
   * 清空队列（用于关闭时）
   *
   * @param reason - 清空原因
   */
  clear(reason: string = 'Queue cleared'): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.reject(new Error(reason));
    }
  }
}

// 全局写队列实例
let globalWriteQueue: WriteQueue | null = null;

/**
 * 获取全局写队列实例
 */
export function getWriteQueue(): WriteQueue {
  if (!globalWriteQueue) {
    globalWriteQueue = new WriteQueue();
  }
  return globalWriteQueue;
}

/**
 * 重置全局写队列（用于测试）
 */
export function resetWriteQueue(): void {
  if (globalWriteQueue) {
    globalWriteQueue.clear('Queue reset');
    globalWriteQueue = null;
  }
}
