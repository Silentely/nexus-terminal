/**
 * createWorkerPool 单元测试
 *
 * 测试通用 Worker 池管理器的核心行为：
 * - Worker 不可用时降级到 fallback
 * - execute 发送消息并解析响应
 * - destroy 终止所有 Worker 并拒绝待处理请求
 * - size / hasIdle getter
 * - 超时处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ======== Worker 模拟 ========

/** 创建一个可控的 Worker mock */
function createMockWorker() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    /** 向 Worker 注入响应消息（模拟 Worker 线程 postMessage） */
    respondWith(data: object) {
      if (this.onmessage) {
        const event = { data, target: worker } as unknown as MessageEvent;
        this.onmessage(event);
      }
    },
    /** 模拟 Worker 错误 */
    triggerError(message: string) {
      if (this.onerror) {
        const event = { message } as ErrorEvent;
        this.onerror(event);
      }
    },
  };
  return worker;
}

type MockWorker = ReturnType<typeof createMockWorker>;

// 收集所有被创建的 Worker 实例
let createdWorkers: MockWorker[] = [];

const MockWorkerConstructor = vi.fn().mockImplementation(() => {
  const w = createMockWorker();
  createdWorkers.push(w);
  return w;
});

// 替换全局 Worker
const originalWorker = globalThis.Worker;
beforeEach(() => {
  createdWorkers = [];
  vi.clearAllMocks();
  // 重置 MockWorkerConstructor call history
  MockWorkerConstructor.mockClear();
  (globalThis as unknown as Record<string, unknown>).Worker = MockWorkerConstructor;
});

afterEach(() => {
  if (originalWorker !== undefined) {
    (globalThis as unknown as Record<string, unknown>).Worker = originalWorker;
  }
});

// 动态导入以确保每次 mock 都生效
async function importCreateWorkerPool() {
  // 使用 vi.resetModules() 确保每次获取新实例
  return (await import('./createWorkerPool')).createWorkerPool;
}

describe('createWorkerPool', () => {
  describe('初始化', () => {
    it('默认应创建 2 个 Worker', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url));

      expect(MockWorkerConstructor).toHaveBeenCalledTimes(2);
      expect(pool.size).toBe(2);
      pool.destroy();
    });

    it('可以指定 size 创建 N 个 Worker', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 4 });

      expect(MockWorkerConstructor).toHaveBeenCalledTimes(4);
      expect(pool.size).toBe(4);
      pool.destroy();
    });

    it('创建后所有 Worker 应处于空闲状态', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 3 });

      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });
  });

  describe('fallback 降级', () => {
    it('Worker 不可用时（全局无 Worker）应调用 fallback', async () => {
      // 临时移除 Worker 全局
      delete (globalThis as unknown as Record<string, unknown>).Worker;

      const { createWorkerPool } = await import('./createWorkerPool');
      const fallback = vi.fn().mockReturnValue({ type: 'text', content: 'fallback' });

      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { fallback });
      const result = await pool.execute('process', { text: 'hello' });

      expect(fallback).toHaveBeenCalledWith('process', { text: 'hello' });
      expect(result).toEqual({ type: 'text', content: 'fallback' });
      pool.destroy();

      // 恢复 Worker
      (globalThis as unknown as Record<string, unknown>).Worker = MockWorkerConstructor;
    });

    it('Worker 不可用且无 fallback 时应抛出错误', async () => {
      delete (globalThis as unknown as Record<string, unknown>).Worker;

      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('worker.js', import.meta.url));

      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用');
      pool.destroy();

      (globalThis as unknown as Record<string, unknown>).Worker = MockWorkerConstructor;
    });

    it('Worker 创建成功但池为空时应调用 fallback', async () => {
      // Worker 构造函数抛出错误，导致池为空
      MockWorkerConstructor.mockImplementationOnce(() => {
        throw new Error('Worker creation failed');
      });
      MockWorkerConstructor.mockImplementationOnce(() => {
        throw new Error('Worker creation failed');
      });

      const { createWorkerPool } = await import('./createWorkerPool');
      const fallback = vi.fn().mockReturnValue('fallback result');

      const pool = createWorkerPool(new URL('worker.js', import.meta.url), {
        size: 2,
        fallback,
      });

      expect(pool.size).toBe(0);
      const result = await pool.execute('process', { text: 'test' });
      expect(fallback).toHaveBeenCalledOnce();
      expect(result).toBe('fallback result');
      pool.destroy();
    });
  });

  describe('execute — 正常响应', () => {
    it('应该向 Worker 发送请求并解析成功响应', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });

      const executePromise = pool.execute<string>('process', { text: 'hello' });

      // Worker 应收到消息
      expect(createdWorkers[0].postMessage).toHaveBeenCalledTimes(1);
      const sentMsg = createdWorkers[0].postMessage.mock.calls[0][0];
      expect(sentMsg).toMatchObject({ type: 'process', payload: { text: 'hello' } });
      expect(sentMsg.id).toBeDefined();

      // 模拟 Worker 响应
      createdWorkers[0].respondWith({ id: sentMsg.id, type: 'process', payload: 'result' });

      const result = await executePromise;
      expect(result).toBe('result');
      pool.destroy();
    });

    it('应该在收到错误响应时 reject promise', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });

      const executePromise = pool.execute<string>('process', {});
      const sentMsg = createdWorkers[0].postMessage.mock.calls[0][0];

      // 模拟 Worker 返回错误
      createdWorkers[0].respondWith({
        id: sentMsg.id,
        type: 'process',
        payload: null,
        error: 'Worker 处理失败',
      });

      await expect(executePromise).rejects.toThrow('Worker 处理失败');
      pool.destroy();
    });

    it('收到未知 id 的响应应被忽略', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });

      const executePromise = pool.execute<string>('process', {});
      const sentMsg = createdWorkers[0].postMessage.mock.calls[0][0];

      // 注入无关响应
      createdWorkers[0].respondWith({ id: 'unknown-id', type: 'process', payload: 'ignored' });
      // 注入正确响应
      createdWorkers[0].respondWith({ id: sentMsg.id, type: 'process', payload: 'correct' });

      const result = await executePromise;
      expect(result).toBe('correct');
      pool.destroy();
    });
  });

  describe('execute — 超时', () => {
    it('超时后应 reject 并包含任务类型信息', async () => {
      vi.useFakeTimers();
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), {
        size: 1,
        timeout: 100,
      });

      const executePromise = pool.execute<string>('heavy-task', {});

      // 不发送响应，等待超时
      vi.advanceTimersByTime(200);

      await expect(executePromise).rejects.toThrow('heavy-task');
      pool.destroy();
      vi.useRealTimers();
    });
  });

  describe('destroy', () => {
    it('销毁后 size 应为 0', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 2 });

      pool.destroy();

      expect(pool.size).toBe(0);
    });

    it('销毁后应终止所有 Worker', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 2 });

      const workersBeforeDestroy = [...createdWorkers];
      pool.destroy();

      workersBeforeDestroy.forEach((w) => {
        expect(w.terminate).toHaveBeenCalledTimes(1);
      });
    });

    it('销毁后调用 execute 应 reject', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });
      pool.destroy();

      await expect(pool.execute('process', {})).rejects.toThrow('已销毁');
    });

    it('销毁时应拒绝所有待处理的请求', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });

      // 发送请求但不响应
      const executePromise = pool.execute<string>('process', {});

      pool.destroy();

      await expect(executePromise).rejects.toThrow('已销毁');
    });
  });

  describe('hasIdle getter', () => {
    it('池初始化后应有空闲 Worker', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });

      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('销毁后 hasIdle 应为 false', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });
      pool.destroy();

      expect(pool.hasIdle).toBe(false);
    });
  });

  describe('Worker 错误处理', () => {
    it('Worker 错误事件应打印错误日志', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const createWorkerPool = await importCreateWorkerPool();
      createWorkerPool(new URL('worker.js', import.meta.url), { size: 1 });

      // 触发 Worker 错误
      createdWorkers[0].triggerError('test error');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('WorkerPool'),
        'test error'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('多 Worker 并行', () => {
    it('size=2 时两个任务应并行使用不同 Worker', async () => {
      const createWorkerPool = await importCreateWorkerPool();
      const pool = createWorkerPool(new URL('worker.js', import.meta.url), { size: 2 });

      const p1 = pool.execute<string>('process', { id: 1 });
      const p2 = pool.execute<string>('process', { id: 2 });

      // 两个 Worker 都应各收到一条消息
      expect(createdWorkers[0].postMessage).toHaveBeenCalledTimes(1);
      expect(createdWorkers[1].postMessage).toHaveBeenCalledTimes(1);

      const msg1 = createdWorkers[0].postMessage.mock.calls[0][0];
      const msg2 = createdWorkers[1].postMessage.mock.calls[0][0];

      createdWorkers[0].respondWith({ id: msg1.id, type: 'process', payload: 'result1' });
      createdWorkers[1].respondWith({ id: msg2.id, type: 'process', payload: 'result2' });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('result1');
      expect(r2).toBe('result2');
      pool.destroy();
    });
  });
});