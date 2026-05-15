import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Worker Mock Setup ====================

/** Track all mock worker instances created during tests */
let mockWorkerInstances: MockWorker[] = [];

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(
    public url: URL,
    public options?: { type?: string }
  ) {
    mockWorkerInstances.push(this);
  }

  /** Helper: simulate a response from the worker */
  simulateMessage(data: Record<string, unknown>) {
    const event = { data, target: this } as unknown as MessageEvent;
    this.onmessage?.(event);
  }

  /** Helper: simulate a worker error */
  simulateError(message: string) {
    const event = { message } as ErrorEvent;
    this.onerror?.(event);
  }
}

// Store original Worker if exists
const OriginalWorker = (globalThis as Record<string, unknown>).Worker;

beforeEach(() => {
  mockWorkerInstances = [];
  (globalThis as Record<string, unknown>).Worker = MockWorker;
});

afterEach(() => {
  if (OriginalWorker) {
    (globalThis as Record<string, unknown>).Worker = OriginalWorker;
  } else {
    delete (globalThis as Record<string, unknown>).Worker;
  }
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ==================== Tests ====================

describe('createWorkerPool', () => {
  let createWorkerPool: typeof import('./createWorkerPool').createWorkerPool;

  beforeEach(async () => {
    // Re-import to get fresh module state
    const mod = await import('./createWorkerPool');
    createWorkerPool = mod.createWorkerPool;
  });

  describe('初始化', () => {
    it('应该创建默认 2 个 Worker', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url));
      expect(mockWorkerInstances.length).toBe(2);
      pool.destroy();
    });

    it('应该按照 size 选项创建指定数量的 Worker', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 3 });
      expect(mockWorkerInstances.length).toBe(3);
      pool.destroy();
    });

    it('创建单个 Worker 时 size 属性应为 1', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      expect(pool.size).toBe(1);
      pool.destroy();
    });

    it('初始时所有 Worker 应为空闲（hasIdle = true）', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('使用 module 类型创建 Worker', () => {
      createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      expect(mockWorkerInstances[0].options?.type).toBe('module');
    });
  });

  describe('size 和 hasIdle 属性', () => {
    it('size 应反映当前 Worker 数量', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 2 });
      expect(pool.size).toBe(2);
      pool.destroy();
    });

    it('destroy 后 size 应为 0', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 2 });
      pool.destroy();
      expect(pool.size).toBe(0);
    });

    it('destroy 后 hasIdle 应为 false', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 2 });
      pool.destroy();
      expect(pool.hasIdle).toBe(false);
    });
  });

  describe('Worker 不可用时的降级处理', () => {
    it('Worker 不可用时有 fallback 应调用 fallback', async () => {
      delete (globalThis as Record<string, unknown>).Worker;

      const fallback = vi.fn().mockReturnValue({ type: 'text', content: 'fallback result' });
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { fallback });

      const result = await pool.execute('process', { text: 'hello' });
      expect(fallback).toHaveBeenCalledWith('process', { text: 'hello' });
      expect(result).toEqual({ type: 'text', content: 'fallback result' });
    });

    it('Worker 不可用时没有 fallback 应抛出错误', async () => {
      delete (globalThis as Record<string, unknown>).Worker;

      const pool = createWorkerPool(new URL('worker.ts', import.meta.url));
      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用且未配置降级处理');
    });

    it('Worker 构建失败时有 fallback 应调用 fallback', async () => {
      // Make Worker constructor throw
      (globalThis as Record<string, unknown>).Worker = class {
        constructor() {
          throw new Error('Worker not supported');
        }
      };

      const fallback = vi.fn().mockReturnValue('fallback');
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 2, fallback });

      // All workers failed to create, size should be 0
      expect(pool.size).toBe(0);
      const result = await pool.execute('process', {});
      expect(fallback).toHaveBeenCalled();
      expect(result).toBe('fallback');
    });
  });

  describe('execute - 成功场景', () => {
    it('应该向空闲 Worker 发送消息', async () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      const executePromise = pool.execute('process', { text: 'hello world' });

      // Verify message was posted
      expect(mockWorkerInstances[0].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'process',
          payload: { text: 'hello world' },
        })
      );

      // Simulate worker response
      const postedMessage = mockWorkerInstances[0].postMessage.mock.calls[0][0];
      mockWorkerInstances[0].simulateMessage({
        id: postedMessage.id,
        type: 'process',
        payload: { type: 'text', content: 'processed' },
      });

      const result = await executePromise;
      expect(result).toEqual({ type: 'text', content: 'processed' });
      pool.destroy();
    });

    it('消息应包含唯一 id 字段', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      pool.execute('process', {});
      pool.execute('process', {});

      const ids = mockWorkerInstances[0].postMessage.mock.calls.map((call) => call[0].id);
      expect(ids[0]).not.toBe(ids[1]);
      pool.destroy();
    });

    it('Worker 响应 error 时应该 reject promise', async () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      const executePromise = pool.execute('process', {});

      const postedMessage = mockWorkerInstances[0].postMessage.mock.calls[0][0];
      mockWorkerInstances[0].simulateMessage({
        id: postedMessage.id,
        type: 'process',
        payload: null,
        error: 'Worker processing failed',
      });

      await expect(executePromise).rejects.toThrow('Worker processing failed');
      pool.destroy();
    });

    it('未知 id 的响应应被忽略', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      pool.execute('process', {});

      // Should not throw when receiving message with unknown id
      expect(() => {
        mockWorkerInstances[0].simulateMessage({
          id: 'unknown-id-xyz',
          type: 'process',
          payload: null,
        });
      }).not.toThrow();

      pool.destroy();
    });
  });

  describe('execute - 超时场景', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('任务超时时应 reject 并包含超时信息', async () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), {
        size: 1,
        timeout: 100,
      });

      const executePromise = pool.execute('process', {});

      vi.advanceTimersByTime(200);

      await expect(executePromise).rejects.toThrow(/Worker 任务超时: process/);
      pool.destroy();
    });

    it('超时信息应包含超时毫秒数', async () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), {
        size: 1,
        timeout: 500,
      });

      const executePromise = pool.execute('task', {});
      vi.advanceTimersByTime(600);

      await expect(executePromise).rejects.toThrow('500ms');
      pool.destroy();
    });
  });

  describe('execute - 销毁后调用', () => {
    it('pool 销毁后调用 execute 应抛出 "Worker pool 已销毁"', async () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      pool.destroy();

      await expect(pool.execute('process', {})).rejects.toThrow('Worker pool 已销毁');
    });
  });

  describe('destroy', () => {
    it('应该终止所有 Worker', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 2 });
      pool.destroy();

      expect(mockWorkerInstances[0].terminate).toHaveBeenCalled();
      expect(mockWorkerInstances[1].terminate).toHaveBeenCalled();
    });

    it('应该拒绝所有待处理的请求', async () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      const pendingPromise = pool.execute('process', {});

      pool.destroy();

      await expect(pendingPromise).rejects.toThrow('Worker pool 已销毁');
    });

    it('多次调用 destroy 不应抛出错误', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      pool.destroy();
      expect(() => pool.destroy()).not.toThrow();
    });

    it('destroy 后 size 为 0', () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 3 });
      pool.destroy();
      expect(pool.size).toBe(0);
    });
  });

  describe('错误处理', () => {
    it('Worker onerror 被调用时应打印错误日志', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });

      mockWorkerInstances[0].simulateError('Some worker error');

      expect(consoleSpy).toHaveBeenCalledWith('[WorkerPool] Worker 错误:', 'Some worker error');
      consoleSpy.mockRestore();
    });
  });

  describe('Worker 消息响应后标记为空闲', () => {
    it('Worker 响应后 hasIdle 应变为 true', async () => {
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { size: 1 });
      const executePromise = pool.execute('process', {});

      // Worker is now busy
      const postedMessage = mockWorkerInstances[0].postMessage.mock.calls[0][0];
      mockWorkerInstances[0].simulateMessage({
        id: postedMessage.id,
        type: 'process',
        payload: 'done',
      });

      await executePromise;
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });
  });

  describe('fallback 函数', () => {
    it('fallback 应接收 taskType 和 payload 参数', async () => {
      delete (globalThis as Record<string, unknown>).Worker;

      const fallback = vi.fn().mockReturnValue('result');
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { fallback });

      await pool.execute('myTask', { data: 'value' });

      expect(fallback).toHaveBeenCalledWith('myTask', { data: 'value' });
    });

    it('fallback 返回值应作为 execute 的结果', async () => {
      delete (globalThis as Record<string, unknown>).Worker;

      const fallback = vi.fn().mockReturnValue({ processed: true });
      const pool = createWorkerPool(new URL('worker.ts', import.meta.url), { fallback });

      const result = await pool.execute<{ processed: boolean }>('task', {});
      expect(result).toEqual({ processed: true });
    });
  });
});