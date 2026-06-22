/**
 * 通用 Worker 池管理器
 *
 * 提供 Promise-based 的 Worker 任务执行 API，支持：
 * - 多 Worker 并行处理
 * - 请求/响应 ID 关联
 * - 主线程降级兜底（Worker 不可用时）
 * - 事件驱动的任务调度（无轮询）
 * - 超时后释放 Worker 槽位
 * - 资源清理
 */

import type { WorkerRequest, WorkerResponse } from './types';

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

  /** 检测 Worker 是否可用 */
  const isWorkerAvailable = typeof Worker !== 'undefined';

  /** 初始化 Worker 池 */
  function init() {
    if (!isWorkerAvailable) return;

    for (let i = 0; i < size; i++) {
      try {
        const worker = new Worker(workerUrl, { type: 'module' });
        worker.onmessage = handleMessage;
        worker.onerror = handleWorkerError;
        workers.push({ worker, busy: false, currentTaskId: null });
      } catch {
        // Worker 创建失败，静默忽略
      }
    }
  }

  /** 向指定 Worker 发送任务并标记为忙碌 */
  function dispatchToWorker(workerIndex: number, request: PendingRequest) {
    const id = crypto.randomUUID();
    workers[workerIndex].busy = true;
    workers[workerIndex].currentTaskId = id;
    pending.set(id, request);
    const message: WorkerRequest = { id, type: request.taskType, payload: request.payload };
    workers[workerIndex].worker.postMessage(message);
  }

  /** 释放指定 Worker 的槽位并从队列取下一个任务 */
  function releaseWorker(workerIndex: number) {
    workers[workerIndex].busy = false;
    workers[workerIndex].currentTaskId = null;
    drainQueue();
  }

  /** 处理 Worker 响应 */
  function handleMessage(event: MessageEvent<WorkerResponse>) {
    const { id, error } = event.data;
    const request = pending.get(id);
    if (!request) return;

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
    console.error('[WorkerPool] Worker 错误:', event.message);

    const workerIndex = workers.findIndex((w) => w.worker === event.target);
    if (workerIndex !== -1) {
      const poolWorker = workers[workerIndex];
      // 找到该 Worker 上的待处理请求并 reject
      if (poolWorker.currentTaskId) {
        const request = pending.get(poolWorker.currentTaskId);
        if (request) {
          clearTimeout(request.timeoutId);
          pending.delete(poolWorker.currentTaskId);
          request.reject(new Error(`Worker 错误: ${event.message}`));
        }
      }
      releaseWorker(workerIndex);
    }
  }

  /** 从队列中取任务分派给空闲 Worker */
  function drainQueue() {
    if (destroyed || taskQueue.length === 0) return;

    const idleIndex = workers.findIndex((w) => !w.busy);
    if (idleIndex === -1) return;

    const request = taskQueue.shift();
    if (request) {
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
    // Worker 不可用时降级到主线程
    if (!isWorkerAvailable || workers.length === 0) {
      if (fallback) {
        return Promise.resolve(fallback(taskType, payload) as T);
      }
      return Promise.reject(new Error('Worker 不可用且未配置降级处理'));
    }

    if (destroyed) {
      return Promise.reject(new Error('Worker pool 已销毁'));
    }

    return new Promise<T>((resolve, reject) => {
      const request: PendingRequest = {
        taskType,
        payload,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId: setTimeout(() => {
          // 超时：从队列或 pending 中移除，并释放对应的 Worker
          const idx = taskQueue.indexOf(request);
          if (idx !== -1) {
            taskQueue.splice(idx, 1);
          }
          for (const [id, req] of pending) {
            if (req === request) {
              // 找到该任务对应的 Worker 并释放
              const workerIndex = workers.findIndex((w) => w.currentTaskId === id);
              if (workerIndex !== -1) {
                releaseWorker(workerIndex);
              }
              pending.delete(id);
              break;
            }
          }
          reject(new Error(`Worker 任务超时: ${taskType} (${timeout}ms)`));
        }, timeout),
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
    destroyed = true;

    // 拒绝队列中所有待处理的请求
    for (const request of taskQueue) {
      clearTimeout(request.timeoutId);
      request.reject(new Error('Worker pool 已销毁'));
    }
    taskQueue.length = 0;

    // 拒绝已分派但未响应的请求
    for (const [, request] of pending) {
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
