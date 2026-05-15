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
 * Create and manage a pool of Web Workers to execute tasks.
 *
 * @param workerUrl - Worker script URL (use Vite-style `new URL(..., import.meta.url)`)
 * @param options - Optional pool settings:
 *   - `size`: number of workers in the pool (default 2)
 *   - `timeout`: per-task timeout in milliseconds (default 30000)
 *   - `fallback`: function invoked when Workers are unavailable; receives `(type, payload)`
 * @returns An object exposing:
 *   - `execute(taskType, payload)`: run a task and obtain its result
 *   - `destroy()`: terminate the pool and reject pending tasks
 *   - `size` (getter): current number of workers in the pool
 *   - `hasIdle` (getter): whether any worker is currently idle
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
   * Create the configured number of Web Workers and register their message and error handlers.
   *
   * If the platform does not support Worker, the function returns without side effects.
   * Worker construction failures are ignored so available workers are created opportunistically.
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
   * Handle an incoming Worker message by completing the matching pending request and freeing the worker.
   *
   * Deletes the pending entry for the response `id`, clears its timeout, marks the originating pool worker as idle, and either resolves with the response `payload` or rejects with the `error`. After completion, attempts to schedule the next queued task.
   *
   * @param event - The message event from a Worker containing `{ id, payload, error }`
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
   * Logs an error emitted by a Worker to console.error.
   *
   * @param event - The ErrorEvent from the Worker containing the error message
   */
  function handleWorkerError(event: ErrorEvent) {
    console.error('[WorkerPool] Worker 错误:', event.message);
  }

  /**
   * Schedules the next pending request to an available worker.
   *
   * Finds an idle worker and, if a pending request exists, marks that worker as busy
   * and constructs the corresponding WorkerRequest payload for dispatch. The function
   * returns immediately if the pool is destroyed, no idle worker is available, or
   * there are no pending requests. It does not remove the pending entry, post the
   * message to the worker, or handle timeouts — it only performs queue-to-worker allocation.
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
   * Schedule a task of the given type to run in the worker pool and produce its result.
   *
   * @param taskType - Identifier for the task handler inside the worker
   * @param payload - Data to pass to the worker for the task
   * @returns The value produced by the task when it completes
   * @throws Error if workers are unavailable and no fallback is configured
   * @throws Error if the worker pool has been destroyed
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
   * Destroys the worker pool and releases all associated resources.
   *
   * Marks the pool as destroyed, rejects all pending requests with `Error('Worker pool 已销毁')`,
   * clears their timeouts, and terminates all workers.
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
