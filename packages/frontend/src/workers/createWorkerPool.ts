/**
 * 通用 Worker 池管理器
 *
 * 提供 Promise-based 的 Worker 任务执行 API，支持：
 * - 多 Worker 并行处理
 * - 请求/响应 ID 关联
 * - 主线程降级兜底（Worker 不可用时）
 * - 事件驱动的任务调度（无轮询）
 * - 超时后终止并替换失效 Worker
 * - 资源清理
 */

import type { WorkerRequest, WorkerResponse } from './types';
import { log } from '../utils/log';

/** 池中每个 Worker 的状态 */
interface PoolWorker {
  worker: Worker;
  busy: boolean;
  /** 当前正在处理的任务 ID（用于超时后释放） */
  currentTaskId: string | null;
}

/** 待处理的请求队列项 */
interface PendingRequest {
  taskType: string;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  settled: boolean;
  workerRequestId?: string;
}

/**
 * 创建一个 Worker 池
 *
 * @param workerUrl - Worker 脚本的 URL（使用 Vite 的 `new URL(..., import.meta.url)` 模式）
 * @param options - 池配置
 * @returns 池控制对象
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
  } = {},
) {
  const { size = 2, timeout = 30000, fallback } = options;

  const workers: PoolWorker[] = [];
  /** FIFO 任务队列，所有 Worker 忙碌时任务在此排队 */
  const taskQueue: PendingRequest[] = [];
  const pending = new Map<string, PendingRequest>();
  let destroyed = false;
  let workerInitWarningLogged = false;

  /** 检测 Worker 是否可用 */
  const isWorkerAvailable = typeof Worker !== 'undefined';

  /** 创建一个带事件处理器的 Worker 实例 */
  function createPoolWorker(): PoolWorker | null {
    if (destroyed || !isWorkerAvailable) return null;

    try {
      const worker = new Worker(workerUrl, { type: 'module' });
      worker.onmessage = handleMessage;
      worker.onerror = handleWorkerError;
      return { worker, busy: false, currentTaskId: null };
    } catch (error: unknown) {
      if (!workerInitWarningLogged) {
        workerInitWarningLogged = true;
        log.warn(
          {
            component: 'WorkerPool',
            action: 'worker-init-fallback',
            error: error instanceof Error ? error.message : String(error),
          },
          'Worker 创建失败，已降级到主线程',
        );
      }
      // Worker 创建失败时交给调用方决定是否降级或继续使用剩余 Worker。
      return null;
    }
  }

  /** 初始化 Worker 池 */
  function init() {
    if (!isWorkerAvailable) return;

    for (let i = 0; i < size; i++) {
      const poolWorker = createPoolWorker();
      if (poolWorker) workers.push(poolWorker);
    }
  }

  /** 终止 Worker 并解除事件引用，避免旧实例的迟到事件继续进入池逻辑。 */
  function terminateWorker(poolWorker: PoolWorker): void {
    const worker = poolWorker.worker;
    worker.onmessage = null;
    worker.onerror = null;
    try {
      worker.terminate();
    } catch {
      // terminate 失败不应阻断其余 Worker 的资源回收。
    }
  }

  /** 用新实例替换失效 Worker，避免超时后的旧线程继续处理任务。 */
  function replaceWorker(workerIndex: number): void {
    const previous = workers[workerIndex];
    if (!previous) return;

    terminateWorker(previous);
    if (destroyed) {
      workers.splice(workerIndex, 1);
      return;
    }

    const replacement = createPoolWorker();
    if (replacement) {
      workers[workerIndex] = replacement;
    } else {
      workers.splice(workerIndex, 1);
    }
    drainQueue();
  }

  /** 向指定 Worker 发送任务并标记为忙碌 */
  function dispatchToWorker(workerIndex: number, request: PendingRequest) {
    const id = crypto.randomUUID();
    const poolWorker = workers[workerIndex];
    poolWorker.busy = true;
    poolWorker.currentTaskId = id;
    request.workerRequestId = id;
    pending.set(id, request);
    const message: WorkerRequest = { id, type: request.taskType, payload: request.payload };
    try {
      poolWorker.worker.postMessage(message);
    } catch (error: unknown) {
      pending.delete(id);
      request.settled = true;
      clearTimeout(request.timeoutId);
      request.reject(error instanceof Error ? error : new Error(String(error)));
      replaceWorker(workerIndex);
    }
  }

  /** 释放指定 Worker 的槽位并从队列取下一个任务 */
  function releaseWorker(workerIndex: number) {
    const poolWorker = workers[workerIndex];
    if (!poolWorker) return;
    poolWorker.busy = false;
    poolWorker.currentTaskId = null;
    drainQueue();
  }

  /** 处理 Worker 响应 */
  function handleMessage(event: MessageEvent<WorkerResponse>) {
    const { id, error } = event.data;
    const request = pending.get(id);
    if (!request || request.settled) return;

    request.settled = true;
    pending.delete(id);
    clearTimeout(request.timeoutId);

    // 找到对应的 Worker 并释放
    const workerIndex = workers.findIndex((w) => w.worker === event.target);
    if (workerIndex !== -1) {
      releaseWorker(workerIndex);
    }

    if (error) {
      request.reject(new Error(error));
    } else {
      request.resolve(event.data.payload);
    }
  }

  /** 处理 Worker 错误：释放槽位并 reject 关联请求 */
  function handleWorkerError(event: ErrorEvent) {
    log.error({ component: 'WorkerPool', message: event.message }, 'Worker 错误');

    const workerIndex = workers.findIndex((w) => w.worker === event.target);
    if (workerIndex !== -1) {
      const poolWorker = workers[workerIndex];
      // 找到该 Worker 上的待处理请求并 reject
      if (poolWorker.currentTaskId) {
        const request = pending.get(poolWorker.currentTaskId);
        if (request && !request.settled) {
          request.settled = true;
          clearTimeout(request.timeoutId);
          pending.delete(poolWorker.currentTaskId);
          request.reject(new Error(`Worker 错误: ${event.message}`));
        }
      }
      // Worker error 后不复用原实例；它可能已经处于不可预测的执行状态。
      replaceWorker(workerIndex);
    }
  }

  /** 从队列中取任务分派给空闲 Worker */
  function drainQueue() {
    if (destroyed || taskQueue.length === 0) return;

    while (taskQueue.length > 0 && !destroyed) {
      const idleIndex = workers.findIndex((w) => !w.busy);
      if (idleIndex === -1) return;

      const request = taskQueue.shift();
      if (!request || request.settled) continue;
      dispatchToWorker(idleIndex, request);
    }
  }

  /**
   * 执行 Worker 任务
   *
   * @param taskType - 任务类型标识
   * @param payload - 任务载荷
   * @returns Promise<unknown> - 处理结果
   */
  function execute<T>(taskType: string, payload: unknown): Promise<T> {
    if (destroyed) {
      return Promise.reject(new Error('Worker pool 已销毁'));
    }

    // Worker 不可用时降级到主线程
    if (!isWorkerAvailable || workers.length === 0) {
      if (fallback) {
        return Promise.resolve(fallback(taskType, payload) as T);
      }
      return Promise.reject(new Error('Worker 不可用且未配置降级处理'));
    }

    return new Promise<T>((resolve, reject) => {
      const request: PendingRequest = {
        taskType,
        payload,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId: setTimeout(() => {
          if (request.settled) return;
          request.settled = true;

          // 超时：从队列或 pending 中移除，并释放对应的 Worker
          const idx = taskQueue.indexOf(request);
          if (idx !== -1) {
            taskQueue.splice(idx, 1);
          }
          for (const [id, req] of pending) {
            if (req === request) {
              // 找到该任务对应的 Worker，终止并替换旧实例，防止迟到响应污染后续任务。
              const workerIndex = workers.findIndex((w) => w.currentTaskId === id);
              pending.delete(id);
              if (workerIndex !== -1) replaceWorker(workerIndex);
              break;
            }
          }
          reject(new Error(`Worker 任务超时: ${taskType} (${timeout}ms)`));
        }, timeout),
        settled: false,
      };

      // 尝试立即分派，否则入队等待
      const idleIndex = workers.findIndex((w) => !w.busy);
      if (idleIndex !== -1) {
        dispatchToWorker(idleIndex, request);
      } else {
        taskQueue.push(request);
      }
    });
  }

  /** 销毁 Worker 池，释放所有资源 */
  function destroy() {
    if (destroyed) return;
    destroyed = true;

    // 拒绝队列中所有待处理的请求
    for (const request of taskQueue) {
      request.settled = true;
      clearTimeout(request.timeoutId);
      request.reject(new Error('Worker pool 已销毁'));
    }
    taskQueue.length = 0;

    // 拒绝已分派但未响应的请求
    for (const [, request] of pending) {
      request.settled = true;
      clearTimeout(request.timeoutId);
      request.reject(new Error('Worker pool 已销毁'));
    }
    pending.clear();

    // 终止所有 Worker
    for (const poolWorker of workers) {
      terminateWorker(poolWorker);
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
