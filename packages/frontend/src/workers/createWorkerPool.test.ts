import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Worker mock ----
// We need to simulate postMessage/onmessage communication between pool and workers.

interface MockWorkerInstance {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  /** Helper: simulate a response message arriving from the worker */
  simulateMessage(data: unknown): void;
  /** Helper: simulate an error arriving from the worker */
  simulateError(message: string): void;
}

let workerInstances: MockWorkerInstance[] = [];

class MockWorker implements MockWorkerInstance {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(_url: URL | string, _options?: { type?: string }) {
    workerInstances.push(this);
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      const event = new MessageEvent('message', { data });
      Object.defineProperty(event, 'target', { value: this, writable: false });
      this.onmessage(event as MessageEvent);
    }
  }

  simulateError(message: string) {
    if (this.onerror) {
      this.onerror(new ErrorEvent('error', { message }) as ErrorEvent);
    }
  }
}

// Install the mock globally
const originalWorker = globalThis.Worker;
beforeEach(() => {
  workerInstances = [];
  // @ts-expect-error replacing global Worker with mock
  globalThis.Worker = MockWorker;
});

afterEach(() => {
  globalThis.Worker = originalWorker;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('createWorkerPool', () => {
  describe('initialization', () => {
    it('should create the specified number of workers (default 2)', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      expect(pool.size).toBe(2);
      pool.destroy();
    });

    it('should create 1 worker when size = 1', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url), { size: 1 });
      expect(pool.size).toBe(1);
      pool.destroy();
    });

    it('should create 4 workers when size = 4', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url), { size: 4 });
      expect(pool.size).toBe(4);
      pool.destroy();
    });

    it('should report hasIdle = true when newly created', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('should wire onmessage and onerror handlers on each created worker', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      createWorkerPool(new URL('mock-worker.js', import.meta.url));
      expect(workerInstances.length).toBe(2);
      for (const w of workerInstances) {
        expect(w.onmessage).toBeTypeOf('function');
        expect(w.onerror).toBeTypeOf('function');
      }
    });
  });

  describe('execute – fallback path (no Workers)', () => {
    it('should invoke fallback and return its result when Worker unavailable', async () => {
      // Temporarily remove Worker global
      const { createWorkerPool } = await import('./createWorkerPool');
      // @ts-expect-error removing global Worker
      delete globalThis.Worker;

      const fallback = vi.fn().mockReturnValue({ result: 'fallback' });
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url), { fallback });

      const result = await pool.execute('process', { text: 'hello' });
      expect(fallback).toHaveBeenCalledWith('process', { text: 'hello' });
      expect(result).toEqual({ result: 'fallback' });

      // Restore Worker for other tests
      // @ts-expect-error restoring global Worker
      globalThis.Worker = MockWorker;
    });

    it('should throw when no Workers and no fallback configured', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      // @ts-expect-error removing global Worker
      delete globalThis.Worker;

      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));

      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用且未配置降级处理');

      // @ts-expect-error restoring global Worker
      globalThis.Worker = MockWorker;
    });
  });

  describe('execute – happy path', () => {
    it('should send a WorkerRequest message to an idle worker', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      const worker = workerInstances[0];

      // Start execute but don't await yet — we need to check the postMessage call
      const executePromise = pool.execute<string>('process', { text: 'hello world' });

      // Worker should have received a message
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      const [msg] = worker.postMessage.mock.calls[0];
      expect(msg.type).toBe('process');
      expect(msg.payload).toEqual({ text: 'hello world' });
      expect(msg.id).toBeTypeOf('string');

      // Simulate the worker responding
      worker.simulateMessage({ id: msg.id, type: 'process', payload: 'processed' });

      const result = await executePromise;
      expect(result).toBe('processed');

      pool.destroy();
    });

    it('should resolve with the worker response payload', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      const worker = workerInstances[0];

      const executePromise = pool.execute<{ type: string }>('process', { text: 'test' });
      const [msg] = worker.postMessage.mock.calls[0];

      const expectedPayload = { type: 'json', content: '{}' };
      worker.simulateMessage({ id: msg.id, type: 'process', payload: expectedPayload });

      const result = await executePromise;
      expect(result).toEqual(expectedPayload);

      pool.destroy();
    });

    it('should reject when the worker returns an error', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      const worker = workerInstances[0];

      const executePromise = pool.execute('process', {});
      const [msg] = worker.postMessage.mock.calls[0];

      worker.simulateMessage({ id: msg.id, type: 'process', payload: null, error: 'Worker failed' });

      await expect(executePromise).rejects.toThrow('Worker failed');

      pool.destroy();
    });

    it('should mark the worker as busy while processing, idle after response', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url), { size: 1 });
      const worker = workerInstances[0];

      expect(pool.hasIdle).toBe(true);

      const executePromise = pool.execute('process', {});
      // After posting, the worker should be busy
      expect(pool.hasIdle).toBe(false);

      const [msg] = worker.postMessage.mock.calls[0];
      worker.simulateMessage({ id: msg.id, type: 'process', payload: 'done' });
      await executePromise;

      expect(pool.hasIdle).toBe(true);

      pool.destroy();
    });

    it('should ignore messages with unknown IDs', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      const worker = workerInstances[0];

      // Should not throw
      expect(() => {
        worker.simulateMessage({ id: 'nonexistent-id', type: 'process', payload: 'data' });
      }).not.toThrow();

      pool.destroy();
    });
  });

  describe('timeout', () => {
    it('should reject with timeout error when task exceeds timeout', async () => {
      vi.useFakeTimers();
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url), { timeout: 100 });

      const executePromise = pool.execute('process', { text: 'slow' });

      // Advance fake timers past timeout
      vi.advanceTimersByTime(200);

      await expect(executePromise).rejects.toThrow('Worker 任务超时: process (100ms)');

      pool.destroy();
    });
  });

  describe('destroy', () => {
    it('should terminate all workers on destroy', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      const workers = [...workerInstances];

      pool.destroy();

      for (const w of workers) {
        expect(w.terminate).toHaveBeenCalledTimes(1);
      }
    });

    it('should report size = 0 after destroy', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      pool.destroy();
      expect(pool.size).toBe(0);
    });

    it('should reject pending requests on destroy', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      // Do NOT respond to the worker message, so request stays pending
      const executePromise = pool.execute('process', {});

      pool.destroy();

      await expect(executePromise).rejects.toThrow('Worker pool 已销毁');
    });

    it('should throw "Worker pool 已销毁" when executing after destroy', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url));
      pool.destroy();

      await expect(pool.execute('process', {})).rejects.toThrow('Worker pool 已销毁');
    });
  });

  describe('worker error logging', () => {
    it('should log worker errors via console.error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { createWorkerPool } = await import('./createWorkerPool');
      createWorkerPool(new URL('mock-worker.js', import.meta.url));
      const worker = workerInstances[0];

      worker.simulateError('Script error');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WorkerPool]'),
        'Script error'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('size and hasIdle getters', () => {
    it('should reflect the correct number of workers', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url), { size: 3 });
      expect(pool.size).toBe(3);
      pool.destroy();
    });

    it('should return hasIdle = false when all workers busy', async () => {
      const { createWorkerPool } = await import('./createWorkerPool');
      // Use size=1 so we can exhaust idle workers easily
      const pool = createWorkerPool(new URL('mock-worker.js', import.meta.url), { size: 1 });

      // Start a task without resolving it to keep the worker busy
      void pool.execute('process', {});

      expect(pool.hasIdle).toBe(false);

      pool.destroy();
    });
  });
});