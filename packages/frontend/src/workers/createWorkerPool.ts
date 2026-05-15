/**
 * 通用 Worker 池管理器
 *
 * 提供 Promise-based 的 Worker 任务执行 API，支持：
 * - 多 Worker 并行处理
 * - 请求/响应 ID 关联
 * - 主线程降级兜底（Worker 不可用时）
 * - 资源清理
 */

import type { WorkerRequest, WorkerResponse } from './types';

/** 池中每个 Worker 的状态 */
interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

/** 待处理的请求队列项 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Create a pool of Web Workers that executes tasks via promise-based requests.
 *
 * The returned control object provides `execute` to run tasks, `destroy` to
 * terminate the pool and reject pending tasks, and read-only `size` and
 * `hasIdle` getters to inspect pool state.
 *
 * @param workerUrl - URL of the worker script (e.g. created with Vite's `new URL(..., import.meta.url)`)
 * @param options - Pool configuration
 * @param options.size - Number of workers to create (default: 2)
 * @param options.timeout - Per-task timeout in milliseconds (default: 30000)
 * @param options.fallback - Optional fallback handler invoked as `fallback(type, payload)` when workers are unavailable
 * @returns An object with methods `{ execute, destroy }` and getters `{ size, hasIdle }`
 */
export function createWorkerPool(
  workerUrl: URL,
  options: {
    /** 池大小，默认 2 */
    size?: number;
    /** 单个任务超时时间（毫秒），默认 30000 */
    timeout?: number;
    /** Worker 不可用时的降级处理函数 */
    fallback?: (type: string, payload: unknown) => unknown;
  } = {}
) {
  const { size = 2, timeout = 30000, fallback } = options;

  const workers: PoolWorker[] = [];
  const pending = new Map<string, PendingRequest>();
  let destroyed = false;

  /** 检测 Worker 是否可用 */
  const isWorkerAvailable = typeof Worker !== 'undefined';

  /**
   * Initialize the worker pool by creating the configured number of Worker instances and wiring their handlers.
   *
   * If the environment does not support Worker, this function returns without creating workers. It attempts to create up to the configured `size` workers, attaches `onmessage` and `onerror` handlers for each successfully created worker, and records them as idle. Worker construction failures are ignored so initialization continues for remaining workers.
   */
  function init() {
    if (!isWorkerAvailable) return;

    for (let i = 0; i < size; i++) {
      try {
        const worker = new Worker(workerUrl, { type: 'module' });
        worker.onmessage = handleMessage;
        worker.onerror = handleWorkerError;
        workers.push({ worker, busy: false });
      } catch {
        // Worker 创建失败，静默忽略
      }
    }
  }

  /**
   * Handle an inbound worker message and settle the matching pending request.
   *
   * Finds a pending request by `event.data.id`; if a matching request exists, clears its timeout,
   * removes it from the pending map, marks the originating worker as idle, resolves with the
   * payload or rejects with an Error when `event.data.error` is present, and then triggers queue processing.
   * If no matching pending request is found, the message is ignored.
   *
   * @param event - The MessageEvent from a worker containing `{ id, error?, payload? }`
   */
  function handleMessage(event: MessageEvent<WorkerResponse>) {
    const { id, error } = event.data;
    const request = pending.get(id);
    if (!request) return;

    pending.delete(id);
    clearTimeout(request.timeoutId);

    // 找到对应的 Worker 并标记为空闲
    const poolWorker = workers.find((w) => w.worker === event.target);
    if (poolWorker) poolWorker.busy = false;

    if (error) {
      request.reject(new Error(error));
    } else {
      request.resolve(event.data.payload);
    }

    // 尝试处理队列中的下一个请求
    processQueue();
  }

  /**
   * Log a worker runtime error to the console with a WorkerPool prefix.
   *
   * @param event - The ErrorEvent emitted by the Worker containing the error message
   */
  function handleWorkerError(event: ErrorEvent) {
    console.error('[WorkerPool] Worker 错误:', event.message);
  }

  /**
   * Selects an idle worker and prepares the oldest pending request for dispatch.
   *
   * If the pool is destroyed or no idle worker exists, no action is taken.
   * When an oldest pending entry is found, the chosen worker is marked busy and a `WorkerRequest`
   * for that entry is constructed but not sent; actual message posting is performed elsewhere.
   */
  function processQueue() {
    if (destroyed) return;

    // 找到空闲的 Worker
    const idleWorker = workers.find((w) => !w.busy);
    if (!idleWorker) return;

    // 从 pending 中找到等待最久的请求
    for (const [id, request] of pending) {
      // 跳过已超时的请求
      if (pending.has(id)) {
        idleWorker.busy = true;
        const message: WorkerRequest = {
          id,
          type: 'execute',
          payload: { requestType: id, data: request },
        };
        // 实际发送需要知道任务类型，这里通过 payload 传递
        // 由 execute 函数直接发送，此处仅处理队列调度
        break;
      }
    }
  }

  /**
   * Execute a task on the worker pool identified by `taskType` using the provided `payload`.
   *
   * @param taskType - Identifier for the task to run inside a worker
   * @param payload - Data to pass to the task
   * @returns The value produced by the task execution (from a worker or the configured `fallback`) typed as `T`
   * @throws Error when workers are unavailable and no `fallback` is configured
   * @throws Error when the worker pool has been destroyed
   */
  async function execute<T>(taskType: string, payload: unknown): Promise<T> {
    // Worker 不可用时降级到主线程
    if (!isWorkerAvailable || workers.length === 0) {
      if (fallback) {
        return fallback(taskType, payload) as T;
      }
      throw new Error('Worker 不可用且未配置降级处理');
    }

    if (destroyed) {
      throw new Error('Worker pool 已销毁');
    }

    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();

      // 设置超时
      const timeoutId = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Worker 任务超时: ${taskType} (${timeout}ms)`));
      }, timeout);

      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      // 找到空闲 Worker 发送任务
      const idleWorker = workers.find((w) => !w.busy);
      if (idleWorker) {
        idleWorker.busy = true;
        const message: WorkerRequest = { id, type: taskType, payload };
        idleWorker.worker.postMessage(message);
      } else {
        // 所有 Worker 忙碌，等待空闲后自动发送
        // 通过轮询检查（简单实现，生产环境可用事件队列）
        const checkIdle = setInterval(() => {
          const worker = workers.find((w) => !w.busy);
          if (worker && pending.has(id)) {
            clearInterval(checkIdle);
            worker.busy = true;
            const message: WorkerRequest = { id, type: taskType, payload };
            worker.worker.postMessage(message);
          }
        }, 10);

        // 清理轮询（超时时自动清理）
        const origReject = reject;
        const origResolve = resolve;
        pending.set(id, {
          resolve: origResolve as (value: unknown) => void,
          reject: (err: Error) => {
            clearInterval(checkIdle);
            origReject(err);
          },
          timeoutId,
        });
      }
    });
  }

  /**
   * Destroy the worker pool and release all associated resources.
   *
   * Marks the pool as destroyed, rejects every pending request with an Error('Worker pool 已销毁') while clearing its timeout, terminates all workers, and clears the internal worker list and pending map.
   */
  function destroy() {
    destroyed = true;

    // 拒绝所有待处理的请求
    for (const [id, request] of pending) {
      clearTimeout(request.timeoutId);
      request.reject(new Error('Worker pool 已销毁'));
    }
    pending.clear();

    // 终止所有 Worker
    for (const { worker } of workers) {
      worker.terminate();
    }
    workers.length = 0;
  }

  // 初始化
  init();

  return {
    /** 执行 Worker 任务 */
    execute,
    /** 销毁 Worker 池 */
    destroy,
    /** 当前池中 Worker 数量 */
    get size() {
      return workers.length;
    },
    /** 是否有空闲 Worker */
    get hasIdle() {
      return workers.some((w) => !w.busy);
    },
  };
}
