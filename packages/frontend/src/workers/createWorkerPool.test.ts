import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkerPool } from './createWorkerPool';
import type { WorkerResponse } from './types';

// Mock Worker class
class MockWorker {
  url: URL;
  options: unknown;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(url: URL, options?: unknown) {
    this.url = url;
    this.options = options;
  }

  // Helper to simulate a response from the worker
  simulateResponse(response: WorkerResponse) {
    const event = new MessageEvent('message', { data: response });
    Object.defineProperty(event, 'target', { value: this });
    if (this.onmessage) {
      this.onmessage(event);
    }
  }

  // Helper to simulate an error
  simulateError(message: string) {
    const event = new ErrorEvent('error', { message });
    if (this.onerror) {
      this.onerror(event);
    }
  }
}

// Store references to created workers
let createdWorkers: MockWorker[] = [];

// Replace the global Worker with our mock
const originalWorker = globalThis.Worker;

beforeEach(() => {
  createdWorkers = [];
  vi.clearAllMocks();
  // Mock Worker globally
  globalThis.Worker = vi.fn().mockImplementation((url: URL, options?: unknown) => {
    const worker = new MockWorker(url, options);
    createdWorkers.push(worker);
    return worker;
  }) as unknown as typeof Worker;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.Worker = originalWorker;
});

const workerUrl = new URL('some-worker.ts', 'http://localhost/');

describe('createWorkerPool', () => {
  describe('初始化', () => {
    it('应该创建指定数量的 Worker', () => {
      const pool = createWorkerPool(workerUrl, { size: 3 });
      expect(pool.size).toBe(3);
      expect(globalThis.Worker).toHaveBeenCalledTimes(3);
      pool.destroy();
    });

    it('默认池大小应为 2', () => {
      const pool = createWorkerPool(workerUrl);
      expect(pool.size).toBe(2);
      pool.destroy();
    });

    it('应该使用 module 类型创建 Worker', () => {
      createWorkerPool(workerUrl, { size: 1 });
      expect(globalThis.Worker).toHaveBeenCalledWith(workerUrl, { type: 'module' });
    });

    it('所有 Worker 初始应为空闲状态', () => {
      const pool = createWorkerPool(workerUrl, { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });
  });

  describe('execute - 基本执行', () => {
    it('应该向空闲 Worker 发送任务', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      const executePromise = pool.execute<string>('testTask', { data: 'payload' });

      // Verify postMessage was called
      expect(worker.postMessage).toHaveBeenCalledOnce();
      const sentMessage = worker.postMessage.mock.calls[0][0];
      expect(sentMessage.type).toBe('testTask');
      expect(sentMessage.payload).toEqual({ data: 'payload' });
      expect(sentMessage.id).toBeTruthy();

      // Simulate worker response
      worker.simulateResponse({ id: sentMessage.id, type: 'testTask', payload: 'result' });

      const result = await executePromise;
      expect(result).toBe('result');

      pool.destroy();
    });

    it('应该返回 Worker 响应的 payload', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      const executePromise = pool.execute<{ value: number }>('compute', { input: 42 });
      const sentMessage = worker.postMessage.mock.calls[0][0];
      worker.simulateResponse({ id: sentMessage.id, type: 'compute', payload: { value: 84 } });

      const result = await executePromise;
      expect(result).toEqual({ value: 84 });

      pool.destroy();
    });

    it('Worker 返回错误时应 reject Promise', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      const executePromise = pool.execute<string>('failTask', {});
      const sentMessage = worker.postMessage.mock.calls[0][0];
      worker.simulateResponse({
        id: sentMessage.id,
        type: 'failTask',
        payload: null,
        error: '处理失败',
      });

      await expect(executePromise).rejects.toThrow('处理失败');

      pool.destroy();
    });

    it('响应后 Worker 应恢复为空闲状态', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      const executePromise = pool.execute<string>('task', {});
      expect(pool.hasIdle).toBe(false);

      const sentMessage = worker.postMessage.mock.calls[0][0];
      worker.simulateResponse({ id: sentMessage.id, type: 'task', payload: 'done' });
      await executePromise;

      expect(pool.hasIdle).toBe(true);

      pool.destroy();
    });

    it('未知 id 的响应应被忽略', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      // Send a response with unknown id - should not crash
      worker.simulateResponse({ id: 'unknown-id', type: 'task', payload: 'ignored' });
      // Pool should still be functional
      expect(pool.size).toBe(1);

      pool.destroy();
    });
  });

  describe('降级处理', () => {
    it('Worker 不可用时应调用 fallback 函数', async () => {
      // Temporarily remove Worker
      const savedWorker = globalThis.Worker;
      (globalThis as unknown as Record<string, unknown>).Worker = undefined;

      const fallback = vi.fn().mockReturnValue('fallback-result');
      const pool = createWorkerPool(workerUrl, { size: 1, fallback });

      const result = await pool.execute<string>('task', { data: 'test' });

      expect(fallback).toHaveBeenCalledWith('task', { data: 'test' });
      expect(result).toBe('fallback-result');

      globalThis.Worker = savedWorker;
      pool.destroy();
    });

    it('Worker 不可用且没有 fallback 时应抛出错误', async () => {
      const savedWorker = globalThis.Worker;
      (globalThis as unknown as Record<string, unknown>).Worker = undefined;

      const pool = createWorkerPool(workerUrl, { size: 1 });

      await expect(pool.execute<string>('task', {})).rejects.toThrow(
        'Worker 不可用且未配置降级处理'
      );

      globalThis.Worker = savedWorker;
      pool.destroy();
    });

    it('Worker 创建失败时应用 fallback', async () => {
      // Make Worker throw on creation
      globalThis.Worker = vi.fn().mockImplementation(() => {
        throw new Error('Worker 创建失败');
      }) as unknown as typeof Worker;

      const fallback = vi.fn().mockReturnValue('fallback');
      const pool = createWorkerPool(workerUrl, { size: 1, fallback });

      // Workers failed to create, size should be 0
      expect(pool.size).toBe(0);

      const result = await pool.execute<string>('task', {});
      expect(fallback).toHaveBeenCalled();
      expect(result).toBe('fallback');

      pool.destroy();
    });
  });

  describe('超时处理', () => {
    it('任务超时时应 reject Promise', async () => {
      vi.useFakeTimers();

      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 1000 });

      const executePromise = pool.execute<string>('slowTask', {});

      // Advance time past timeout
      vi.advanceTimersByTime(1001);

      await expect(executePromise).rejects.toThrow('Worker 任务超时: slowTask (1000ms)');

      pool.destroy();
    });

    it('超时后 pending map 应清空对应任务', async () => {
      vi.useFakeTimers();

      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 500 });

      const executePromise = pool.execute<string>('task', {}).catch(() => {});
      vi.advanceTimersByTime(600);

      await executePromise;
      // After timeout, the worker should be free for new tasks
      // (we can verify by checking that a new execute works)
      expect(pool.size).toBe(1);

      pool.destroy();
    });
  });

  describe('destroy', () => {
    it('销毁后应终止所有 Worker', () => {
      const pool = createWorkerPool(workerUrl, { size: 2 });
      pool.destroy();

      for (const worker of createdWorkers) {
        expect(worker.terminate).toHaveBeenCalledOnce();
      }
      expect(pool.size).toBe(0);
    });

    it('销毁时应 reject 所有待处理的请求', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });

      const executePromise = pool.execute<string>('task', {});
      pool.destroy();

      await expect(executePromise).rejects.toThrow('Worker pool 已销毁');
    });

    it('销毁后调用 execute 应抛出错误', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      pool.destroy();

      await expect(pool.execute<string>('task', {})).rejects.toThrow('Worker pool 已销毁');
    });

    it('多次调用 destroy 应不抛出错误', () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      expect(() => {
        pool.destroy();
        pool.destroy();
      }).not.toThrow();
    });
  });

  describe('size 属性', () => {
    it('未销毁时 size 应反映 Worker 数量', () => {
      const pool = createWorkerPool(workerUrl, { size: 3 });
      expect(pool.size).toBe(3);
      pool.destroy();
    });

    it('销毁后 size 应为 0', () => {
      const pool = createWorkerPool(workerUrl, { size: 2 });
      pool.destroy();
      expect(pool.size).toBe(0);
    });
  });

  describe('hasIdle 属性', () => {
    it('有空闲 Worker 时应返回 true', () => {
      const pool = createWorkerPool(workerUrl, { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('所有 Worker 忙碌时应返回 false', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });

      // Start a task but don't resolve it
      pool.execute<string>('task1', {});
      expect(pool.hasIdle).toBe(false);

      pool.destroy();
    });

    it('任务完成后应恢复 true', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      const executePromise = pool.execute<string>('task', {});
      expect(pool.hasIdle).toBe(false);

      const sentMessage = worker.postMessage.mock.calls[0][0];
      worker.simulateResponse({ id: sentMessage.id, type: 'task', payload: 'done' });
      await executePromise;

      expect(pool.hasIdle).toBe(true);

      pool.destroy();
    });
  });

  describe('并发处理', () => {
    it('多个 Worker 可以并行处理任务', async () => {
      const pool = createWorkerPool(workerUrl, { size: 2 });
      const worker1 = createdWorkers[0];
      const worker2 = createdWorkers[1];

      const promise1 = pool.execute<string>('task1', { n: 1 });
      const promise2 = pool.execute<string>('task2', { n: 2 });

      // Both workers should have received a task
      expect(worker1.postMessage).toHaveBeenCalledOnce();
      expect(worker2.postMessage).toHaveBeenCalledOnce();

      const msg1 = worker1.postMessage.mock.calls[0][0];
      const msg2 = worker2.postMessage.mock.calls[0][0];

      worker1.simulateResponse({ id: msg1.id, type: 'task1', payload: 'result1' });
      worker2.simulateResponse({ id: msg2.id, type: 'task2', payload: 'result2' });

      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toBe('result1');
      expect(result2).toBe('result2');

      pool.destroy();
    });

    it('超过 Worker 数量的任务应等待空闲 Worker', async () => {
      vi.useFakeTimers();

      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      // First task - takes the only worker
      const promise1 = pool.execute<string>('task1', {});
      // Second task - has to wait
      const promise2 = pool.execute<string>('task2', {});

      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      const msg1 = worker.postMessage.mock.calls[0][0];

      // Complete first task
      worker.simulateResponse({ id: msg1.id, type: 'task1', payload: 'result1' });
      await promise1;

      // Advance time to trigger interval polling
      vi.advanceTimersByTime(50);

      // Second task should now be sent
      expect(worker.postMessage).toHaveBeenCalledTimes(2);
      const msg2 = worker.postMessage.mock.calls[1][0];
      worker.simulateResponse({ id: msg2.id, type: 'task2', payload: 'result2' });
      await promise2;

      pool.destroy();
    });
  });

  describe('Worker 错误处理', () => {
    it('Worker onerror 触发时应记录错误', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      worker.simulateError('Worker crashed');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkerPool] Worker 错误:',
        'Worker crashed'
      );

      consoleSpy.mockRestore();
      pool.destroy();
    });
  });

  describe('size=0 边界情况', () => {
    it('size=0 时应无 Worker 可用，执行 fallback', async () => {
      const fallback = vi.fn().mockReturnValue('fallback');
      const pool = createWorkerPool(workerUrl, { size: 0, fallback });

      expect(pool.size).toBe(0);
      const result = await pool.execute<string>('task', {});
      expect(fallback).toHaveBeenCalled();
      expect(result).toBe('fallback');

      pool.destroy();
    });
  });

  describe('异步 fallback', () => {
    it('fallback 返回 Promise 时应正确等待结果', async () => {
      const savedWorker = globalThis.Worker;
      (globalThis as unknown as Record<string, unknown>).Worker = undefined;

      const asyncFallback = vi.fn().mockResolvedValue('async-fallback-result');
      const pool = createWorkerPool(workerUrl, { size: 1, fallback: asyncFallback });

      const result = await pool.execute<string>('asyncTask', { value: 42 });

      expect(asyncFallback).toHaveBeenCalledWith('asyncTask', { value: 42 });
      expect(result).toBe('async-fallback-result');

      globalThis.Worker = savedWorker;
      pool.destroy();
    });

    it('fallback 抛出异常时 execute 应 reject', async () => {
      const savedWorker = globalThis.Worker;
      (globalThis as unknown as Record<string, unknown>).Worker = undefined;

      const throwingFallback = vi.fn().mockImplementation(() => {
        throw new Error('fallback error');
      });
      const pool = createWorkerPool(workerUrl, { size: 1, fallback: throwingFallback });

      await expect(pool.execute<string>('task', {})).rejects.toThrow('fallback error');

      globalThis.Worker = savedWorker;
      pool.destroy();
    });
  });

  describe('销毁时拒绝所有待处理请求', () => {
    it('多个并发请求在 destroy 时全部应被拒绝', async () => {
      const pool = createWorkerPool(workerUrl, { size: 2 });

      const p1 = pool.execute<string>('task1', {});
      const p2 = pool.execute<string>('task2', {});
      const p3 = pool.execute<string>('task3', {});

      pool.destroy();

      const results = await Promise.allSettled([p1, p2, p3]);
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason.message).toContain('Worker pool 已销毁');
        }
      }
    });
  });

  describe('Worker 响应后恢复空闲（错误路径）', () => {
    it('错误响应后 Worker 应恢复为空闲状态', async () => {
      const pool = createWorkerPool(workerUrl, { size: 1 });
      const worker = createdWorkers[0];

      const executePromise = pool.execute<string>('failTask', {}).catch(() => {});
      expect(pool.hasIdle).toBe(false);

      const sentMessage = worker.postMessage.mock.calls[0][0];
      worker.simulateResponse({
        id: sentMessage.id,
        type: 'failTask',
        payload: null,
        error: 'processing error',
      });
      await executePromise;

      expect(pool.hasIdle).toBe(true);

      pool.destroy();
    });
  });
});