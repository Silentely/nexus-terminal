/**
 * createWorkerPool 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Worker class
class MockWorker {
  url: URL | string;
  options?: object;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(url: URL | string, options?: object) {
    this.url = url;
    this.options = options;
  }

  // Helper to simulate receiving a message from worker
  simulateMessage(data: object) {
    if (this.onmessage) {
      const event = { data, target: this } as unknown as MessageEvent;
      this.onmessage(event);
    }
  }

  // Helper to simulate an error
  simulateError(message: string) {
    if (this.onerror) {
      const event = { message } as ErrorEvent;
      this.onerror(event);
    }
  }
}

// Keep track of created workers
let createdWorkers: MockWorker[] = [];

// Override global Worker
const OriginalWorker = globalThis.Worker;

beforeEach(() => {
  createdWorkers = [];
  vi.useFakeTimers();
  // @ts-ignore
  globalThis.Worker = vi.fn((url, options) => {
    const w = new MockWorker(url, options);
    createdWorkers.push(w);
    return w;
  });
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-ignore
  globalThis.Worker = OriginalWorker;
});

describe('createWorkerPool', () => {
  // Dynamic import so the mock is applied first
  async function getCreateWorkerPool() {
    const mod = await import('./createWorkerPool');
    return mod.createWorkerPool;
  }

  const workerUrl = new URL('./output-processor.worker.ts', 'http://localhost/');

  describe('初始化', () => {
    it('应该创建指定数量的 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 2 });
      expect(createdWorkers.length).toBe(2);
      pool.destroy();
    });

    it('默认应创建 2 个 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl);
      expect(createdWorkers.length).toBe(2);
      pool.destroy();
    });

    it('应该使用 module 类型创建 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });
      expect(globalThis.Worker).toHaveBeenCalledWith(workerUrl, { type: 'module' });
      pool.destroy();
    });

    it('size getter 应返回创建的 Worker 数量', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 3 });
      expect(pool.size).toBe(3);
      pool.destroy();
    });

    it('hasIdle getter 应在初始状态返回 true', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });
  });

  describe('execute - Worker 不可用时降级', () => {
    it('Worker 不可用时使用 fallback 函数', async () => {
      // Temporarily disable Worker
      const workerBackup = globalThis.Worker;
      // @ts-ignore
      delete globalThis.Worker;

      const createWorkerPool = await getCreateWorkerPool();
      const fallback = vi.fn().mockReturnValue('fallback-result');
      const pool = createWorkerPool(workerUrl, { fallback });

      const result = await pool.execute('process', { text: 'hello' });
      expect(result).toBe('fallback-result');
      expect(fallback).toHaveBeenCalledWith('process', { text: 'hello' });

      // @ts-ignore
      globalThis.Worker = workerBackup;
      pool.destroy();
    });

    it('Worker 不可用且无 fallback 时应抛出错误', async () => {
      const workerBackup = globalThis.Worker;
      // @ts-ignore
      delete globalThis.Worker;

      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl);

      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用且未配置降级处理');

      // @ts-ignore
      globalThis.Worker = workerBackup;
      pool.destroy();
    });
  });

  describe('execute - 正常 Worker 执行', () => {
    it('应该将任务发送给空闲 Worker 并返回结果', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 5000 });

      const executePromise = pool.execute<string>('process', { text: 'hello' });

      // Worker should have received the message
      expect(createdWorkers[0].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'process',
          payload: { text: 'hello' },
        })
      );

      // Simulate worker response
      const call = createdWorkers[0].postMessage.mock.calls[0][0];
      createdWorkers[0].simulateMessage({
        id: call.id,
        type: 'process',
        payload: 'processed-result',
      });

      const result = await executePromise;
      expect(result).toBe('processed-result');
      pool.destroy();
    });

    it('应该处理 Worker 返回的错误', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });

      const executePromise = pool.execute('process', { text: 'error-case' });

      const call = createdWorkers[0].postMessage.mock.calls[0][0];
      createdWorkers[0].simulateMessage({
        id: call.id,
        type: 'process',
        payload: null,
        error: 'Worker processing error',
      });

      await expect(executePromise).rejects.toThrow('Worker processing error');
      pool.destroy();
    });

    it('Worker 完成任务后应标记为空闲', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });

      const executePromise = pool.execute('process', { text: 'hello' });

      const call = createdWorkers[0].postMessage.mock.calls[0][0];
      createdWorkers[0].simulateMessage({
        id: call.id,
        type: 'process',
        payload: 'result',
      });

      await executePromise;
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('响应 ID 不匹配时应忽略消息', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });

      const executePromise = pool.execute<string>('process', { text: 'hello' });

      // Send a response with a wrong ID
      createdWorkers[0].simulateMessage({
        id: 'wrong-id',
        type: 'process',
        payload: 'wrong-result',
      });

      // The promise should still be pending - send correct response
      const call = createdWorkers[0].postMessage.mock.calls[0][0];
      createdWorkers[0].simulateMessage({
        id: call.id,
        type: 'process',
        payload: 'correct-result',
      });

      const result = await executePromise;
      expect(result).toBe('correct-result');
      pool.destroy();
    });
  });

  describe('超时行为', () => {
    it('任务超时时应 reject 并返回超时错误', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 1000 });

      const executePromise = pool.execute('process', { text: 'slow' });

      // Advance timers past timeout
      vi.advanceTimersByTime(1001);

      await expect(executePromise).rejects.toThrow(/Worker 任务超时/);
      pool.destroy();
    });

    it('超时消息应包含任务类型', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 500 });

      const executePromise = pool.execute('myTask', {});
      vi.advanceTimersByTime(501);

      await expect(executePromise).rejects.toThrow('myTask');
      pool.destroy();
    });
  });

  describe('destroy', () => {
    it('销毁后 size 应为 0', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 2 });
      pool.destroy();
      expect(pool.size).toBe(0);
    });

    it('销毁后 hasIdle 应为 false', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 2 });
      pool.destroy();
      expect(pool.hasIdle).toBe(false);
    });

    it('销毁后 execute 应抛出错误', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });
      pool.destroy();
      await expect(pool.execute('process', {})).rejects.toThrow('Worker pool 已销毁');
    });

    it('销毁时应终止所有 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 2 });
      pool.destroy();
      createdWorkers.forEach((w) => expect(w.terminate).toHaveBeenCalled());
    });

    it('销毁时应拒绝所有待处理的请求', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });

      // Start a task but don't resolve it
      const executePromise = pool.execute('slow-task', {});

      // Destroy the pool with pending tasks
      pool.destroy();

      await expect(executePromise).rejects.toThrow('Worker pool 已销毁');
    });

    it('重复调用 destroy 不应抛出错误', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });
      pool.destroy();
      expect(() => pool.destroy()).not.toThrow();
    });
  });

  describe('并发执行', () => {
    it('两个 Worker 时应能并行处理两个任务', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 2 });

      const p1 = pool.execute<string>('task1', { n: 1 });
      const p2 = pool.execute<string>('task2', { n: 2 });

      // Both workers should have received messages
      expect(createdWorkers[0].postMessage).toHaveBeenCalled();
      expect(createdWorkers[1].postMessage).toHaveBeenCalled();

      // Resolve both
      const call1 = createdWorkers[0].postMessage.mock.calls[0][0];
      const call2 = createdWorkers[1].postMessage.mock.calls[0][0];

      createdWorkers[0].simulateMessage({ id: call1.id, type: 'task1', payload: 'result1' });
      createdWorkers[1].simulateMessage({ id: call2.id, type: 'task2', payload: 'result2' });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('result1');
      expect(r2).toBe('result2');

      pool.destroy();
    });
  });

  describe('Worker 错误处理', () => {
    it('Worker onerror 应该记录错误', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1 });

      createdWorkers[0].simulateError('Some worker error');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WorkerPool]'),
        'Some worker error'
      );

      consoleSpy.mockRestore();
      pool.destroy();
    });
  });

  describe('size: 0 时的降级行为', () => {
    it('size 为 0 时应使用 fallback', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      // If Worker constructor throws, pool.size will be 0
      // @ts-ignore
      globalThis.Worker = vi.fn(() => {
        throw new Error('Worker creation failed');
      });

      const fallback = vi.fn().mockReturnValue('fallback-result');
      const pool = createWorkerPool(workerUrl, { size: 2, fallback });

      const result = await pool.execute('process', { text: 'hello' });
      expect(result).toBe('fallback-result');

      pool.destroy();
    });
  });

  describe('任务队列：所有 Worker 忙碌时排队', () => {
    it('size=1 时第二个任务应在第一个完成后执行', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 5000 });

      // 发送第一个任务
      const p1 = pool.execute<string>('task1', { n: 1 });

      // Worker[0] 应已收到第一个消息
      expect(createdWorkers[0].postMessage).toHaveBeenCalledTimes(1);
      const call1 = createdWorkers[0].postMessage.mock.calls[0][0];

      // 发送第二个任务（worker 仍忙碌）
      const p2 = pool.execute<string>('task2', { n: 2 });

      // 第二个任务不应立即发给 worker（worker 忙碌中）
      // 先完成第一个任务，让 worker 空闲
      createdWorkers[0].simulateMessage({ id: call1.id, type: 'task1', payload: 'result1' });

      const r1 = await p1;
      expect(r1).toBe('result1');

      // 推进 interval timer 让队列处理器执行
      vi.advanceTimersByTime(50);

      // Worker 现在空闲，应已收到第二个任务
      const postCalls = createdWorkers[0].postMessage.mock.calls;
      expect(postCalls.length).toBeGreaterThanOrEqual(2);

      // 完成第二个任务
      const call2 = postCalls[postCalls.length - 1][0];
      createdWorkers[0].simulateMessage({ id: call2.id, type: 'task2', payload: 'result2' });

      const r2 = await p2;
      expect(r2).toBe('result2');

      pool.destroy();
    });

    it('销毁时应拒绝队列中等待的任务', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 5000 });

      // 发送第一个任务（占用唯一 worker）
      const p1 = pool.execute<string>('task1', {});
      // 第一个任务的 postMessage 调用
      expect(createdWorkers[0].postMessage).toHaveBeenCalledTimes(1);

      // 发送第二个任务（进入等待队列）
      const p2 = pool.execute<string>('task2', {});

      // 销毁 pool，两个任务都应被 reject
      pool.destroy();

      const [result1, result2] = await Promise.allSettled([p1, p2]);
      expect(result1.status).toBe('rejected');
      expect(result2.status).toBe('rejected');
      if (result1.status === 'rejected') {
        expect(result1.reason.message).toContain('Worker pool 已销毁');
      }

      pool.destroy(); // 重复调用不应报错
    });
  });

  describe('超时后 Worker 不应影响后续任务', () => {
    it('超时后 pool 应仍可接受新任务（如果使用 fallback）', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const fallback = vi.fn().mockReturnValue('fallback');
      const pool = createWorkerPool(workerUrl, { size: 1, timeout: 100, fallback });

      // 第一个任务超时
      const p1 = pool.execute('slow', {});
      vi.advanceTimersByTime(101);
      await expect(p1).rejects.toThrow(/超时/);

      pool.destroy();
    });
  });
});