import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerPool } from './createWorkerPool';

const { workerWarningMock } = vi.hoisted(() => ({
  workerWarningMock: vi.fn(),
}));

vi.mock('../utils/log', () => ({
  log: {
    warn: workerWarningMock,
    error: vi.fn(),
  },
}));

interface WorkerMessage {
  id: string;
  type: string;
  payload: unknown;
}

class MockWorker {
  static instances: MockWorker[] = [];

  readonly messages: WorkerMessage[] = [];
  readonly terminate = vi.fn();
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(message: WorkerMessage): void {
    this.messages.push(message);
  }

  emitMessage(data: WorkerMessage): void {
    this.onmessage?.({ data, target: this } as unknown as MessageEvent<WorkerMessage>);
  }

  emitError(message: string): void {
    this.onerror?.({ message, target: this } as unknown as ErrorEvent);
  }
}

describe('createWorkerPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('执行中的任务超时后应终止旧 Worker 并创建替代 Worker', async () => {
    const pool = createWorkerPool(new URL('worker.js', 'http://localhost/'), {
      size: 1,
      timeout: 10,
    });
    const firstRequest = pool.execute('process', { value: 1 });

    vi.advanceTimersByTime(10);

    await expect(firstRequest).rejects.toThrow('超时');
    expect(MockWorker.instances[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances).toHaveLength(2);

    const secondRequest = pool.execute('process', { value: 2 });
    const replacement = MockWorker.instances[1];
    const secondMessage = replacement?.messages[0];

    replacement?.emitMessage({
      id: secondMessage?.id ?? '',
      type: 'process',
      payload: '完成',
    });

    await expect(secondRequest).resolves.toBe('完成');
    pool.destroy();
  });

  it('Worker 出错后应拒绝当前任务、替换实例并继续处理后续任务', async () => {
    const pool = createWorkerPool(new URL('worker.js', 'http://localhost/'), {
      size: 1,
      timeout: 100,
    });
    const firstRequest = pool.execute('process', { value: 1 });
    const failedWorker = MockWorker.instances[0];

    failedWorker?.emitError('崩溃');

    await expect(firstRequest).rejects.toThrow('Worker 错误: 崩溃');
    expect(failedWorker?.terminate).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances).toHaveLength(2);

    const secondRequest = pool.execute('process', { value: 2 });
    const replacement = MockWorker.instances[1];
    const secondMessage = replacement?.messages[0];
    replacement?.emitMessage({
      id: secondMessage?.id ?? '',
      type: 'process',
      payload: '恢复',
    });

    await expect(secondRequest).resolves.toBe('恢复');
    pool.destroy();
  });

  it('销毁 Worker 池时应拒绝队列与执行中的任务，且不能再回退执行', async () => {
    const pool = createWorkerPool(new URL('worker.js', 'http://localhost/'), {
      size: 1,
      timeout: 100,
      fallback: () => '不应执行',
    });
    const firstRequest = pool.execute('process', { value: 1 });
    const secondRequest = pool.execute('process', { value: 2 });
    const worker = MockWorker.instances[0];

    pool.destroy();

    await expect(firstRequest).rejects.toThrow('Worker pool 已销毁');
    await expect(secondRequest).rejects.toThrow('Worker pool 已销毁');
    await expect(pool.execute('process', { value: 3 })).rejects.toThrow('Worker pool 已销毁');
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });

  it('Worker 初始化失败时应回退并记录一次结构化 warning', async () => {
    class FailingWorker {
      constructor() {
        throw new Error('CSP blocked');
      }
    }

    vi.stubGlobal('Worker', FailingWorker);
    workerWarningMock.mockReset();
    const fallback = vi.fn(() => '同步结果');
    const pool = createWorkerPool(new URL('worker.js', 'http://localhost/'), {
      size: 1,
      fallback,
    });

    await expect(pool.execute('process', { value: 1 })).resolves.toBe('同步结果');
    expect(fallback).toHaveBeenCalledWith('process', { value: 1 });
    expect(workerWarningMock).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'WorkerPool',
        action: 'worker-init-fallback',
        error: 'CSP blocked',
      }),
      'Worker 创建失败，已降级到主线程',
    );
    pool.destroy();
  });
});
