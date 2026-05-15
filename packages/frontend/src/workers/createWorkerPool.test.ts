import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mock Worker ====================
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  /** 模拟 Worker 向主线程发送消息 */
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      const event = { data, target: this } as unknown as MessageEvent;
      this.onmessage(event);
    }
  }

  /** 模拟 Worker 发生错误 */
  simulateError(message: string) {
    if (this.onerror) {
      const event = { message } as ErrorEvent;
      this.onerror(event);
    }
  }
}

const mockWorkerInstances: MockWorker[] = [];

vi.stubGlobal(
  'Worker',
  class MockWorkerConstructor extends MockWorker {
    constructor(_url: URL, _options?: { type?: string }) {
      super();
      mockWorkerInstances.push(this);
    }
  }
);

// Stub crypto.randomUUID
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

import { createWorkerPool } from './createWorkerPool';

describe('createWorkerPool', () => {
  beforeEach(() => {
    mockWorkerInstances.length = 0;
    uuidCounter = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('初始化', () => {
    it('默认应创建 2 个 Worker', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'));
      expect(pool.size).toBe(2);
      expect(mockWorkerInstances.length).toBe(2);
      pool.destroy();
    });

    it('应根据 size 选项创建指定数量的 Worker', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 4 });
      expect(pool.size).toBe(4);
      expect(mockWorkerInstances.length).toBe(4);
      pool.destroy();
    });

    it('size=1 时应创建 1 个 Worker', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      expect(pool.size).toBe(1);
      pool.destroy();
    });

    it('初始时所有 Worker 应为空闲', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });
  });

  describe('execute - 使用 fallback（无 Worker 环境）', () => {
    it('当 Worker 不可用时应使用 fallback', async () => {
      // 模拟 Worker 不可用 - Worker constructor throws
      const workerUrl = new URL('worker.js', 'http://localhost');
      const fallback = vi.fn().mockReturnValue({ result: 'fallback result' });

      // Create pool with no workers by making Worker creation fail
      vi.stubGlobal('Worker', function () {
        throw new Error('Worker not available');
      });

      const pool = createWorkerPool(workerUrl, { fallback });
      expect(pool.size).toBe(0);

      const result = await pool.execute('process', { text: 'hello' });
      expect(fallback).toHaveBeenCalledWith('process', { text: 'hello' });
      expect(result).toEqual({ result: 'fallback result' });

      // Restore Worker mock
      vi.stubGlobal(
        'Worker',
        class extends MockWorker {
          constructor(_url: URL, _options?: { type?: string }) {
            super();
            mockWorkerInstances.push(this);
          }
        }
      );

      pool.destroy();
    });

    it('当无 Worker 且无 fallback 时应抛出错误', async () => {
      vi.stubGlobal('Worker', function () {
        throw new Error('Worker not available');
      });

      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'));
      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用且未配置降级处理');

      vi.stubGlobal(
        'Worker',
        class extends MockWorker {
          constructor(_url: URL, _options?: { type?: string }) {
            super();
            mockWorkerInstances.push(this);
          }
        }
      );
      pool.destroy();
    });
  });

  describe('execute - 与 Worker 通信', () => {
    it('应向空闲 Worker 发送消息并解析响应', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      const worker = mockWorkerInstances[0];

      const executePromise = pool.execute<string>('process', { text: 'hello' });

      // 验证消息被发送
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      const sentMessage = worker.postMessage.mock.calls[0][0];
      expect(sentMessage.type).toBe('process');
      expect(sentMessage.payload).toEqual({ text: 'hello' });
      expect(sentMessage.id).toBeDefined();

      // 模拟 Worker 响应
      worker.simulateMessage({ id: sentMessage.id, type: 'process', payload: 'result' });

      const result = await executePromise;
      expect(result).toBe('result');
      pool.destroy();
    });

    it('Worker 返回 error 时应 reject', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      const worker = mockWorkerInstances[0];

      const executePromise = pool.execute<string>('process', {});

      const sentMessage = worker.postMessage.mock.calls[0][0];
      worker.simulateMessage({ id: sentMessage.id, type: 'process', payload: null, error: '处理失败' });

      await expect(executePromise).rejects.toThrow('处理失败');
      pool.destroy();
    });

    it('未知消息 ID 应被忽略', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      const worker = mockWorkerInstances[0];

      const executePromise = pool.execute<string>('process', {});
      const sentMessage = worker.postMessage.mock.calls[0][0];

      // 发送未知 ID 的消息
      worker.simulateMessage({ id: 'unknown-id', type: 'process', payload: 'ignored' });

      // 发送正确 ID 的消息
      worker.simulateMessage({ id: sentMessage.id, type: 'process', payload: 'correct' });

      const result = await executePromise;
      expect(result).toBe('correct');
      pool.destroy();
    });
  });

  describe('超时', () => {
    it('任务超时时应 reject 并附带超时信息', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), {
        size: 1,
        timeout: 100,
      });

      const executePromise = pool.execute<string>('process', {});

      // 推进时间超过超时
      vi.advanceTimersByTime(150);

      await expect(executePromise).rejects.toThrow('Worker 任务超时: process (100ms)');
      pool.destroy();
    });

    it('任务在超时前完成时应正常解析', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), {
        size: 1,
        timeout: 5000,
      });
      const worker = mockWorkerInstances[0];

      const executePromise = pool.execute<string>('process', {});
      const sentMessage = worker.postMessage.mock.calls[0][0];

      vi.advanceTimersByTime(100);
      worker.simulateMessage({ id: sentMessage.id, type: 'process', payload: 'ok' });

      const result = await executePromise;
      expect(result).toBe('ok');
      pool.destroy();
    });
  });

  describe('destroy', () => {
    it('destroy 后所有 Worker 应被终止', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 2 });
      pool.destroy();

      for (const worker of mockWorkerInstances) {
        expect(worker.terminate).toHaveBeenCalledTimes(1);
      }
    });

    it('destroy 后 size 应为 0', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 2 });
      pool.destroy();
      expect(pool.size).toBe(0);
    });

    it('destroy 时应 reject 所有待处理请求', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      // 不响应消息，让请求处于 pending 状态
      mockWorkerInstances[0].postMessage = vi.fn(); // prevent any auto-response

      const executePromise = pool.execute<string>('process', {});
      pool.destroy();

      await expect(executePromise).rejects.toThrow('Worker pool 已销毁');
    });

    it('destroy 后调用 execute 应抛出错误', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      pool.destroy();

      // After destroy, workers.length is 0, so it tries fallback first
      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用且未配置降级处理');
    });
  });

  describe('size 和 hasIdle 属性', () => {
    it('hasIdle 在有空闲 Worker 时应为 true', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('size 应反映当前 Worker 数量', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 3 });
      expect(pool.size).toBe(3);
      pool.destroy();
    });

    it('execute 期间 hasIdle 在单 Worker 池中应为 false', () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });

      // Start an execute but don't respond
      pool.execute('process', {});
      expect(pool.hasIdle).toBe(false);
      pool.destroy();
    });

    it('execute 完成后 Worker 应重新变为空闲', async () => {
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      const worker = mockWorkerInstances[0];

      const executePromise = pool.execute<string>('process', {});
      expect(pool.hasIdle).toBe(false);

      const sentMessage = worker.postMessage.mock.calls[0][0];
      worker.simulateMessage({ id: sentMessage.id, type: 'process', payload: 'done' });

      await executePromise;
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });
  });

  describe('Worker 错误日志', () => {
    it('Worker onerror 应记录错误信息', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { size: 1 });
      const worker = mockWorkerInstances[0];

      worker.simulateError('Worker crashed');

      expect(consoleSpy).toHaveBeenCalledWith('[WorkerPool] Worker 错误:', 'Worker crashed');
      consoleSpy.mockRestore();
      pool.destroy();
    });
  });

  describe('fallback 函数', () => {
    it('fallback 应接收 taskType 和 payload', async () => {
      vi.stubGlobal('Worker', function () {
        throw new Error('not available');
      });

      const fallback = vi.fn().mockReturnValue({ processed: true });
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { fallback });

      await pool.execute('myTask', { key: 'value' });

      expect(fallback).toHaveBeenCalledWith('myTask', { key: 'value' });

      vi.stubGlobal(
        'Worker',
        class extends MockWorker {
          constructor(_url: URL, _options?: { type?: string }) {
            super();
            mockWorkerInstances.push(this);
          }
        }
      );
      pool.destroy();
    });

    it('fallback 返回值应成为 execute 的结果', async () => {
      vi.stubGlobal('Worker', function () {
        throw new Error('not available');
      });

      const expectedResult = { type: 'json', content: '{}' };
      const fallback = vi.fn().mockReturnValue(expectedResult);
      const pool = createWorkerPool(new URL('worker.js', 'http://localhost'), { fallback });

      const result = await pool.execute('process', {});
      expect(result).toEqual(expectedResult);

      vi.stubGlobal(
        'Worker',
        class extends MockWorker {
          constructor(_url: URL, _options?: { type?: string }) {
            super();
            mockWorkerInstances.push(this);
          }
        }
      );
      pool.destroy();
    });
  });
});