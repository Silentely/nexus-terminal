/**
 * createWorkerPool 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Worker Mock ====================

/** 模拟 Worker 实例 */
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  /** 模拟接收 Worker 内部响应（主线程→测试触发） */
  simulateMessage(data: object) {
    if (this.onmessage) {
      const event = new MessageEvent('message', { data });
      Object.defineProperty(event, 'target', { value: this });
      this.onmessage(event as MessageEvent);
    }
  }

  simulateError(message: string) {
    if (this.onerror) {
      this.onerror(new ErrorEvent('error', { message }));
    }
  }
}

let mockWorkerInstances: MockWorker[] = [];

// 保存原始 Worker
const OriginalWorker = globalThis.Worker;

beforeEach(() => {
  mockWorkerInstances = [];
  // @ts-expect-error -- 替换全局 Worker
  globalThis.Worker = vi.fn().mockImplementation(() => {
    const instance = new MockWorker();
    mockWorkerInstances.push(instance);
    return instance;
  });
});

afterEach(() => {
  globalThis.Worker = OriginalWorker;
  vi.clearAllMocks();
});

describe('createWorkerPool', () => {
  describe('初始化', () => {
    it('应该创建默认数量（2）的 Worker', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url));

      expect(mockWorkerInstances).toHaveLength(2);
      pool.destroy();
    });

    it('应该根据 size 参数创建指定数量的 Worker', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 3 });

      expect(mockWorkerInstances).toHaveLength(3);
      pool.destroy();
    });

    it('size 为 1 时应只创建 1 个 Worker', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      expect(mockWorkerInstances).toHaveLength(1);
      pool.destroy();
    });

    it('Worker 创建失败时应静默忽略', async () => {
      // @ts-expect-error -- 替换全局 Worker，第一次抛出
      globalThis.Worker = vi.fn()
        .mockImplementationOnce(() => { throw new Error('Worker not available'); })
        .mockImplementation(() => {
          const instance = new MockWorker();
          mockWorkerInstances.push(instance);
          return instance;
        });

      const { createWorkerPool } = await import('./createWorkerPool');
      // 应该不会抛出错误
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 2 });

      // 只成功创建了 1 个
      expect(pool.size).toBe(1);
      pool.destroy();
    });
  });

  describe('size getter', () => {
    it('初始 size 应等于成功创建的 Worker 数量', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 2 });

      expect(pool.size).toBe(2);
      pool.destroy();
    });

    it('destroy 后 size 应为 0', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 2 });

      pool.destroy();
      expect(pool.size).toBe(0);
    });
  });

  describe('hasIdle getter', () => {
    it('初始状态应有空闲 Worker', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 2 });

      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('destroy 后 hasIdle 应为 false', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url));

      pool.destroy();
      expect(pool.hasIdle).toBe(false);
    });
  });

  describe('execute - 降级（Worker 不可用）', () => {
    it('无 Worker 且有 fallback 时应调用 fallback', async () => {
      // 模拟无 Worker 环境
      // @ts-expect-error
      globalThis.Worker = vi.fn().mockImplementation(() => { throw new Error(); });

      const fallback = vi.fn().mockReturnValue({ type: 'text', content: 'fallback result' });
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), {
        size: 1,
        fallback,
      });

      expect(pool.size).toBe(0);
      const result = await pool.execute('process', { text: 'hello' });

      expect(fallback).toHaveBeenCalledWith('process', { text: 'hello' });
      expect(result).toEqual({ type: 'text', content: 'fallback result' });
      pool.destroy();
    });

    it('无 Worker 且无 fallback 时应抛出错误', async () => {
      // @ts-expect-error
      globalThis.Worker = vi.fn().mockImplementation(() => { throw new Error(); });

      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用且未配置降级处理');
      pool.destroy();
    });
  });

  describe('execute - Worker 可用', () => {
    it('应该向空闲 Worker 发送消息', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      const executePromise = pool.execute('process', { text: 'hello world' });

      expect(mockWorkerInstances[0].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'process',
          payload: { text: 'hello world' },
        })
      );

      // 模拟 Worker 响应
      const callArgs = mockWorkerInstances[0].postMessage.mock.calls[0][0];
      mockWorkerInstances[0].simulateMessage({
        id: callArgs.id,
        type: 'process',
        payload: { type: 'text', content: 'processed' },
      });

      const result = await executePromise;
      expect(result).toEqual({ type: 'text', content: 'processed' });
      pool.destroy();
    });

    it('Worker 响应错误时应 reject', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      const executePromise = pool.execute('process', {});

      const callArgs = mockWorkerInstances[0].postMessage.mock.calls[0][0];
      mockWorkerInstances[0].simulateMessage({
        id: callArgs.id,
        type: 'process',
        payload: null,
        error: '处理失败',
      });

      await expect(executePromise).rejects.toThrow('处理失败');
      pool.destroy();
    });

    it('Worker 响应包含 id 时应正确匹配请求', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 2 });

      const p1 = pool.execute<string>('task1', { data: 'first' });
      const p2 = pool.execute<string>('task2', { data: 'second' });

      // 获取两次 postMessage 调用的 id
      const args1 = mockWorkerInstances[0].postMessage.mock.calls[0][0];
      const args2 = mockWorkerInstances[1].postMessage.mock.calls[0][0];

      // 乱序响应
      mockWorkerInstances[1].simulateMessage({ id: args2.id, type: 'task2', payload: 'result2' });
      mockWorkerInstances[0].simulateMessage({ id: args1.id, type: 'task1', payload: 'result1' });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('result1');
      expect(r2).toBe('result2');
      pool.destroy();
    });

    it('未知消息 id 应被忽略', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      // 触发一个真实请求以确保 postMessage 被调用
      const executePromise = pool.execute<string>('test', {});
      const callArgs = mockWorkerInstances[0].postMessage.mock.calls[0][0];

      // 先发送一个不存在的 id 响应
      mockWorkerInstances[0].simulateMessage({ id: 'nonexistent-id', type: 'test', payload: 'x' });

      // 再发真实响应
      mockWorkerInstances[0].simulateMessage({
        id: callArgs.id,
        type: 'test',
        payload: 'real result',
      });

      const result = await executePromise;
      expect(result).toBe('real result');
      pool.destroy();
    });
  });

  describe('execute - 超时', () => {
    it('超时时应 reject 并包含任务类型信息', async () => {
      vi.useFakeTimers();
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), {
        size: 1,
        timeout: 100,
      });

      const executePromise = pool.execute('slowTask', {});

      // 不响应，触发超时
      vi.advanceTimersByTime(200);

      await expect(executePromise).rejects.toThrow('Worker 任务超时: slowTask');
      pool.destroy();
      vi.useRealTimers();
    });
  });

  describe('execute - 已销毁', () => {
    it('池销毁后 execute 应抛出错误', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      pool.destroy();

      await expect(pool.execute('process', {})).rejects.toThrow('Worker pool 已销毁');
    });
  });

  describe('destroy', () => {
    it('应该终止所有 Worker', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 2 });

      pool.destroy();

      expect(mockWorkerInstances[0].terminate).toHaveBeenCalled();
      expect(mockWorkerInstances[1].terminate).toHaveBeenCalled();
    });

    it('应该拒绝所有待处理的请求', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      // 发起一个请求但不响应
      const executePromise = pool.execute('pending', {});

      // 销毁时应 reject
      pool.destroy();

      await expect(executePromise).rejects.toThrow('Worker pool 已销毁');
    });

    it('多次 destroy 不应抛出错误', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      pool.destroy();
      // 第二次 destroy 不应报错（workers.length 已为 0）
      expect(() => pool.destroy()).not.toThrow();
    });

    it('destroy 后 size 应为 0', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 3 });

      expect(pool.size).toBe(3);
      pool.destroy();
      expect(pool.size).toBe(0);
    });
  });

  describe('Worker 错误处理', () => {
    it('Worker onerror 应输出错误日志', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), { size: 1 });

      mockWorkerInstances[0].simulateError('Worker 内部错误');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WorkerPool]'),
        expect.stringContaining('Worker 内部错误')
      );

      consoleSpy.mockRestore();
      pool.destroy();
    });
  });

  describe('fallback 函数', () => {
    it('fallback 应接收正确的 taskType 和 payload', async () => {
      // @ts-expect-error
      globalThis.Worker = vi.fn().mockImplementation(() => { throw new Error(); });

      const fallback = vi.fn().mockReturnValue('fallback output');
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), {
        size: 1,
        fallback,
      });

      const payload = { text: 'test', options: { enableHighlight: false } };
      await pool.execute('process', payload);

      expect(fallback).toHaveBeenCalledWith('process', payload);
      pool.destroy();
    });

    it('fallback 返回值应作为 execute 结果', async () => {
      // @ts-expect-error
      globalThis.Worker = vi.fn().mockImplementation(() => { throw new Error(); });

      const expectedResult = { type: 'json', content: '{}', metadata: {} };
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('test-worker.js', import.meta.url), {
        size: 1,
        fallback: () => expectedResult,
      });

      const result = await pool.execute('process', {});
      expect(result).toEqual(expectedResult);
      pool.destroy();
    });
  });
});