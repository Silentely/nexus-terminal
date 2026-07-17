import crypto from 'crypto';
/**
 * 批量作业 Service 层
 * 处理批量命令执行的核心业务逻辑
 */

import { Client, ClientChannel } from 'ssh2';
import { getErrorMessage, ErrorFactory } from '../utils/AppError';
import {
  BatchTask,
  BatchSubTask,
  BatchTaskStatus,
  BatchSubTaskStatus,
  BatchExecPayload,
  BatchWsMessage,
} from './batch.types';
import * as BatchRepository from './batch.repository';
import * as SshService from '../services/ssh.service';
import { broadcastToUser } from '../websocket/state';
import * as ConnectionRepository from '../connections/connection.repository';
import { logger } from '../utils/logger';
import eventService, { AppEventType } from '../services/event.service';
import { sshPoolService, type PoolKey } from '../services/ssh-pool.service';
import { buildBatchCommand, sanitizeBatchCommand } from './batch.utils';

// 默认配置
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_SECONDS = 300; // 5 分钟
const CONNECT_TIMEOUT_MS = 20000; // 20 秒连接超时
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB 输出限制
const OUTPUT_THROTTLE_MS = 100; // 输出写入节流

// 子任务执行结果
type SubTaskResult = 'completed' | 'failed' | 'cancelled';

// 存储任务的 AbortController
const taskAbortControllers = new Map<string, AbortController>();

/**
 * 向用户发送批量作业 WebSocket 消息
 */
function sendBatchEvent(userId: number | string, message: BatchWsMessage): void {
  const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (Number.isNaN(numericUserId)) {
    logger.warn(`[BatchService] 无效的 userId: ${userId}，跳过广播。`);
    return;
  }
  broadcastToUser(numericUserId, message);
}

/**
 * 创建并执行批量命令任务
 */
export async function execCommandBatch(
  payload: BatchExecPayload,
  userId: number | string,
): Promise<BatchTask> {
  const taskId = crypto.randomUUID();
  const now = new Date();
  const concurrencyLimit = payload.concurrencyLimit ?? DEFAULT_CONCURRENCY;

  // 安全校验：拒绝包含 shell 注入风险的命令
  const sanitizedCommand = sanitizeBatchCommand(payload.command);
  if (!sanitizedCommand) {
    throw ErrorFactory.validationError('命令包含非法字符，请检查输入');
  }
  const safePayload = { ...payload, command: sanitizedCommand };

  // 并行获取连接名称用于显示
  const connectionNames = new Map<number, string>();
  const nameResults = await Promise.allSettled(
    safePayload.connectionIds.map(async (connId) => {
      const conn = await ConnectionRepository.findConnectionByIdWithTags(connId);
      return { connId, name: conn?.name || `连接 #${connId}` };
    }),
  );
  for (let i = 0; i < nameResults.length; i++) {
    const result = nameResults[i];
    const connId = safePayload.connectionIds[i];
    if (result.status === 'fulfilled') {
      connectionNames.set(connId, result.value.name);
    } else {
      connectionNames.set(connId, `连接 #${connId}`);
    }
  }

  // 创建子任务
  const subTasks: BatchSubTask[] = payload.connectionIds.map((connId) => ({
    subTaskId: crypto.randomUUID(),
    taskId,
    connectionId: connId,
    connectionName: connectionNames.get(connId),
    command: safePayload.command,
    status: 'queued' as BatchSubTaskStatus,
    progress: 0,
  }));

  // 创建主任务
  const task: BatchTask = {
    taskId,
    userId,
    status: 'queued',
    concurrencyLimit,
    overallProgress: 0,
    totalSubTasks: subTasks.length,
    completedSubTasks: 0,
    failedSubTasks: 0,
    cancelledSubTasks: 0,
    payload,
    subTasks,
    priority: payload.priority ?? 'normal',
    createdAt: now,
    updatedAt: now,
  };

  // 持久化到数据库
  await BatchRepository.createTask(task);
  const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (!Number.isNaN(numericUserId)) {
    eventService.emitEvent(AppEventType.BatchTaskCreated, {
      userId: numericUserId,
      details: {
        taskId: task.taskId,
        command: payload.command,
        targetCount: payload.connectionIds.length,
      },
    });
  }
  logger.info(`[BatchService] 批量任务已创建: ${taskId}，包含 ${subTasks.length} 个子任务。`);

  // 创建 AbortController
  const abortController = new AbortController();
  taskAbortControllers.set(taskId, abortController);

  // 异步执行任务（不阻塞返回）
  processTask(taskId, userId, payload, abortController.signal).catch(async (error: unknown) => {
    taskAbortControllers.delete(taskId);

    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }

    logger.error(`[BatchService] 任务 ${taskId} 后台处理出错:`, error);
    await updateTaskStatus(taskId, 'failed', {
      endedAt: new Date(),
      message: getErrorMessage(error),
    }).catch((statusError: unknown) => {
      logger.error(`[BatchService] 任务 ${taskId} 状态回写失败:`, statusError);
    });
  });

  return task;
}

/**
 * 处理批量任务的主逻辑
 */
async function processTask(
  taskId: string,
  userId: number | string,
  payload: BatchExecPayload,
  signal: AbortSignal,
): Promise<void> {
  const task = await BatchRepository.getTask(taskId);
  if (!task) {
    logger.error(`[BatchService] 任务 ${taskId} 未找到。`);
    return;
  }

  // 检查是否已取消（任务启动前就收到 abort 信号）
  if (signal.aborted) {
    await updateTaskStatus(taskId, 'cancelled', {
      message: '任务启动前已取消',
      endedAt: new Date(),
      overallProgress: 0,
      completedSubTasks: 0,
      failedSubTasks: 0,
      cancelledSubTasks: task.totalSubTasks,
    });
    // 发送终态事件，确保前端能收到 batch:cancelled
    sendBatchEvent(userId, {
      type: 'batch:cancelled',
      payload: { taskId, reason: '任务启动前已取消' },
    });
    taskAbortControllers.delete(taskId);
    return;
  }

  // 更新状态为执行中
  await updateTaskStatus(taskId, 'in-progress', { startedAt: new Date() });

  // 发送任务开始事件
  sendBatchEvent(userId, {
    type: 'batch:started',
    payload: {
      taskId,
      total: task.totalSubTasks,
      concurrency: task.concurrencyLimit,
    },
  });

  // 并发执行子任务
  const { concurrencyLimit, subTasks } = task;
  let currentIndex = 0;
  let activeCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;

  // 标记任务是否被取消
  let taskCancelled = false;

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      logger.debug(`[BatchService] 任务 ${taskId} 收到取消信号。`);
      taskCancelled = true;
      // 将所有 queued 状态的子任务标记为取消
      for (let i = currentIndex; i < subTasks.length; i++) {
        if (subTasks[i].status === 'queued') {
          cancelledCount++;
        }
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const handleSubTaskResult = (result: SubTaskResult) => {
      switch (result) {
        case 'completed':
          completedCount++;
          break;
        case 'failed':
          failedCount++;
          break;
        case 'cancelled':
          cancelledCount++;
          break;
      }
    };

    const handleSubTaskFailure = () => {
      failedCount++;
    };

    const handleSubTaskComplete = () => {
      activeCount--;
      updateOverallProgress(
        taskId,
        userId,
        completedCount,
        failedCount,
        cancelledCount,
        subTasks.length,
      );

      if (currentIndex < subTasks.length && !signal.aborted) {
        launchNext();
      } else if (activeCount === 0) {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }
    };

    const launchNext = () => {
      // 检查是否已取消
      if (signal.aborted) {
        if (activeCount === 0) {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }
        return;
      }

      // 并发控制
      while (activeCount < concurrencyLimit && currentIndex < subTasks.length) {
        const subTask = subTasks[currentIndex];
        currentIndex++;

        // 跳过已取消的子任务
        if (subTask.status === 'cancelled' || signal.aborted) {
          if (subTask.status !== 'cancelled') {
            cancelledCount++;
          }
          continue;
        }

        activeCount++;
        runSubTask(taskId, subTask, userId, payload, signal)
          .then(handleSubTaskResult)
          .catch(handleSubTaskFailure)
          .finally(handleSubTaskComplete);
      }

      // 如果没有更多任务且没有活动任务
      if (currentIndex >= subTasks.length && activeCount === 0) {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }
    };

    // 启动初始批次
    if (subTasks.length === 0) {
      resolve();
      return;
    }
    launchNext();
  });

  // 最终状态更新（如果任务被取消，强制使用 cancelled 状态）
  await finalizeTask(
    taskId,
    userId,
    completedCount,
    failedCount,
    cancelledCount,
    subTasks.length,
    taskCancelled,
  );
  taskAbortControllers.delete(taskId);
}

/**
 * 执行单个子任务
 */
async function runSubTask(
  taskId: string,
  subTask: BatchSubTask,
  userId: number | string,
  payload: BatchExecPayload,
  signal: AbortSignal,
): Promise<SubTaskResult> {
  const { subTaskId, connectionId, command, connectionName } = subTask;
  let sshClient: Client | null = null;
  let pooled = false;
  let poolKey: PoolKey | null = null;
  let shouldDiscard = false; // 标记是否应该丢弃连接（取消时）

  try {
    // 检查取消
    if (signal.aborted) {
      await updateSubTask(taskId, subTaskId, 'cancelled', 0, { message: '已取消' });
      sendSubTaskUpdate(userId, taskId, subTaskId, 'cancelled', 0, '已取消');
      return 'cancelled';
    }

    // 更新状态：连接中
    await updateSubTask(taskId, subTaskId, 'connecting', 0, { startedAt: new Date() });
    sendSubTaskUpdate(
      userId,
      taskId,
      subTaskId,
      'connecting',
      0,
      `正在连接到 ${connectionName || connectionId}...`,
    );

    // 获取连接详情
    const connDetails = await SshService.getConnectionDetails(connectionId);

    // 构建连接池键
    poolKey = {
      host: connDetails.host,
      port: connDetails.port,
      username: connDetails.username,
      authMethod: connDetails.auth_method,
      proxyId: connDetails.proxy?.id ?? null,
    };

    if (signal.aborted) {
      await updateSubTask(taskId, subTaskId, 'cancelled', 0, { message: '已取消' });
      sendSubTaskUpdate(userId, taskId, subTaskId, 'cancelled', 0, '已取消');
      return 'cancelled';
    }

    // 尝试从池中获取连接
    sshClient = sshPoolService.acquire(poolKey);

    if (sshClient) {
      // 从池中获取到连接
      pooled = true;
      logger.debug(`[BatchService] 复用 SSH 连接: ${connectionName || connectionId}`);
    } else {
      // 创建新连接并添加到池中
      sshClient = await SshService.establishSshConnection(connDetails, CONNECT_TIMEOUT_MS);
      sshPoolService.add(poolKey, sshClient);
      pooled = true; // 新连接已添加到池中，标记为 pooled
    }

    if (signal.aborted) {
      await updateSubTask(taskId, subTaskId, 'cancelled', 0, { message: '已取消' });
      sendSubTaskUpdate(userId, taskId, subTaskId, 'cancelled', 0, '已取消');
      return 'cancelled';
    }

    // 更新状态：运行中
    await updateSubTask(taskId, subTaskId, 'running', 10);
    sendSubTaskUpdate(userId, taskId, subTaskId, 'running', 10, '正在执行命令...');

    // 构建完整命令
    const fullCommand = buildBatchCommand(command, payload);

    // 获取超时配置
    const timeoutSeconds = payload.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

    // 执行命令
    const result = await executeCommand(
      sshClient,
      fullCommand,
      taskId,
      subTaskId,
      userId,
      signal,
      timeoutSeconds,
    );

    // 更新最终状态
    if (result.cancelled) {
      // 取消时丢弃连接而不是归还，因为远端会话可能处于半关闭状态
      shouldDiscard = true;
      await updateSubTask(taskId, subTaskId, 'cancelled', 100, {
        message: result.timedOut ? '执行超时' : '已取消',
        endedAt: new Date(),
      });
      sendSubTaskUpdate(
        userId,
        taskId,
        subTaskId,
        'cancelled',
        100,
        result.timedOut ? '执行超时' : '已取消',
      );
      return 'cancelled';
    }

    if (result.exitCode === 0) {
      await updateSubTask(taskId, subTaskId, 'completed', 100, {
        exitCode: result.exitCode,
        output: result.output,
        endedAt: new Date(),
      });
      sendSubTaskUpdate(
        userId,
        taskId,
        subTaskId,
        'completed',
        100,
        '执行成功',
        result.output,
        result.exitCode,
      );
      return 'completed';
    }
    await updateSubTask(taskId, subTaskId, 'failed', 100, {
      exitCode: result.exitCode,
      output: result.output,
      message: `退出码: ${result.exitCode}`,
      endedAt: new Date(),
    });
    sendSubTaskUpdate(
      userId,
      taskId,
      subTaskId,
      'failed',
      100,
      `执行失败 (退出码: ${result.exitCode})`,
      result.output,
      result.exitCode,
    );
    return 'failed';
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    logger.error(`[BatchService] 子任务 ${subTaskId} 执行失败:`, errorMsg);

    // 异常时丢弃池化连接
    if (pooled && poolKey && sshClient) {
      sshPoolService.discard(poolKey, sshClient);
      sshClient = null;
    }

    await updateSubTask(taskId, subTaskId, 'failed', 0, {
      message: errorMsg,
      endedAt: new Date(),
    });
    sendSubTaskUpdate(userId, taskId, subTaskId, 'failed', 0, errorMsg);
    return 'failed';
  } finally {
    if (sshClient) {
      if (pooled && poolKey) {
        // 取消或异常时丢弃连接，否则归还
        if (shouldDiscard) {
          sshPoolService.discard(poolKey, sshClient);
        } else {
          sshPoolService.release(poolKey, sshClient);
        }
      } else {
        // 关闭非池化连接
        try {
          sshClient.end();
        } catch (error: unknown) {
          // SSH 客户端关闭错误，不影响主流程
          logger.debug('[批量服务] SSH 客户端关闭失败:', error);
        }
      }
    }
  }
}

/**
 * 在 SSH 连接上执行命令
 */
function executeCommand(
  sshClient: Client,
  command: string,
  taskId: string,
  subTaskId: string,
  userId: number | string,
  signal: AbortSignal,
  timeoutSeconds: number,
): Promise<{ exitCode: number; output: string; cancelled: boolean; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let output = '';
    let outputSize = 0;
    let dbOutputSize = 0; // 跟踪写入数据库的大小
    let resolved = false;
    let stream: ClientChannel | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let lastDbWriteTime = 0;

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const terminateStream = () => {
      if (stream) {
        try {
          // 发送 SIGKILL 信号终止远端进程
          stream.signal('KILL');
        } catch (error: unknown) {
          // 信号发送可能在已断开的连接上失败
          logger.debug('[批量服务] 远端信号发送失败:', error);
        }
        try {
          stream.close();
        } catch (error: unknown) {
          // 流关闭错误，不影响主流程
          logger.debug('[批量服务] 流关闭失败:', error);
        }
      }
    };

    const onAbort = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        terminateStream();
        resolve({ exitCode: -1, output, cancelled: true, timedOut: false });
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });

    // 设置超时定时器
    timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        signal.removeEventListener('abort', onAbort);
        terminateStream();
        resolve({ exitCode: -1, output, cancelled: true, timedOut: true });
      }
    }, timeoutSeconds * 1000);

    sshClient.exec(command, (err: Error | undefined, execStream: ClientChannel) => {
      if (err) {
        cleanup();
        signal.removeEventListener('abort', onAbort);
        return reject(err);
      }

      stream = execStream;

      const handleData = (data: Buffer) => {
        if (signal.aborted || resolved) return;

        const chunk = data.toString();

        // 限制内存中的输出大小
        if (outputSize < MAX_OUTPUT_SIZE) {
          const allowedSize = Math.min(chunk.length, MAX_OUTPUT_SIZE - outputSize);
          output += chunk.substring(0, allowedSize);
          outputSize += allowedSize;
        }

        // 发送流式日志（总是发送，让前端决定显示策略）
        sendBatchEvent(userId, {
          type: 'batch:log',
          payload: { taskId, subTaskId, chunk },
        });

        // 节流写入数据库，同时限制数据库存储大小
        const now = Date.now();
        if (now - lastDbWriteTime > OUTPUT_THROTTLE_MS && dbOutputSize < MAX_OUTPUT_SIZE) {
          lastDbWriteTime = now;
          // 计算可以写入的大小
          const dbAllowedSize = Math.min(chunk.length, MAX_OUTPUT_SIZE - dbOutputSize);
          if (dbAllowedSize > 0) {
            const dbChunk = chunk.substring(0, dbAllowedSize);
            dbOutputSize += dbAllowedSize;
            BatchRepository.appendSubTaskOutput(subTaskId, dbChunk);
          }
        }
      };

      stream.on('data', handleData);
      stream.stderr.on('data', handleData);

      stream.on('close', (code: number | null) => {
        cleanup();
        signal.removeEventListener('abort', onAbort);
        if (!resolved) {
          resolved = true;
          resolve({ exitCode: code ?? -1, output, cancelled: false, timedOut: false });
        }
      });

      stream.on('error', (streamErr: Error) => {
        cleanup();
        signal.removeEventListener('abort', onAbort);
        if (!resolved) {
          resolved = true;
          reject(streamErr);
        }
      });
    });
  });
}

/**
 * 更新子任务状态（直接委托到 Repository）
 */
const updateSubTask = BatchRepository.updateSubTaskStatus;

/**
 * 发送子任务更新事件
 */
function sendSubTaskUpdate(
  userId: number | string,
  taskId: string,
  subTaskId: string,
  status: BatchSubTaskStatus,
  progress: number,
  message?: string,
  output?: string,
  exitCode?: number,
): void {
  sendBatchEvent(userId, {
    type: 'batch:subtask:update',
    payload: {
      taskId,
      subTaskId,
      status,
      progress,
      message,
      output,
      exitCode,
    },
  });
}

/**
 * 更新任务整体进度
 */
async function updateOverallProgress(
  taskId: string,
  userId: number | string,
  completed: number,
  failed: number,
  cancelled: number,
  total: number,
): Promise<void> {
  const overallProgress = total > 0 ? Math.round((completed / total) * 100) : 0;

  await BatchRepository.updateTaskStatus(taskId, 'in-progress', {
    overallProgress,
    completedSubTasks: completed,
    failedSubTasks: failed,
    cancelledSubTasks: cancelled,
  });

  sendBatchEvent(userId, {
    type: 'batch:overall',
    payload: {
      taskId,
      status: 'in-progress',
      overallProgress,
      completed,
      failed,
      cancelled,
    },
  });
}

/**
 * 更新任务状态（直接委托到 Repository）
 */
const updateTaskStatus = BatchRepository.updateTaskStatus;

/**
 * 完成任务处理
 */
async function finalizeTask(
  taskId: string,
  userId: number | string,
  completed: number,
  failed: number,
  cancelled: number,
  total: number,
  taskCancelled: boolean,
): Promise<void> {
  let finalStatus: BatchTaskStatus;

  // 如果任务被取消，强制使用 cancelled 状态（防止被覆盖）
  if (taskCancelled) {
    finalStatus = 'cancelled';
  } else if (cancelled === total) {
    finalStatus = 'cancelled';
  } else if (failed === total) {
    finalStatus = 'failed';
  } else if (completed === total) {
    finalStatus = 'completed';
  } else if (completed > 0 || failed > 0) {
    finalStatus = 'partially-completed';
  } else {
    finalStatus = 'cancelled';
  }

  await updateTaskStatus(taskId, finalStatus, {
    overallProgress: 100,
    completedSubTasks: completed,
    failedSubTasks: failed,
    cancelledSubTasks: cancelled,
    endedAt: new Date(),
  });

  // 发送完成事件
  let eventType: BatchWsMessage['type'] = 'batch:completed';
  if (finalStatus === 'failed') {
    eventType = 'batch:failed';
  } else if (finalStatus === 'cancelled') {
    eventType = 'batch:cancelled';
  }

  let reason: string | undefined;
  if (finalStatus === 'failed') {
    reason = '部分或全部子任务执行失败';
  } else if (finalStatus === 'cancelled') {
    reason = '任务已取消';
  }

  sendBatchEvent(userId, {
    type: eventType,
    payload: {
      taskId,
      status: finalStatus,
      overallProgress: 100,
      completed,
      failed,
      cancelled,
      reason,
    },
  });

  // 触发事件总线通知
  const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (Number.isNaN(numericUserId)) {
    logger.warn(`[BatchService] 无效的 userId '${userId}'，跳过事件发射`);
  } else if (failed === 0 && !taskCancelled && cancelled === 0) {
    eventService.emitEvent(AppEventType.BatchTaskCompleted, {
      userId: numericUserId,
      details: { taskId, completed, failed, cancelled, total },
    });
  } else if (taskCancelled || cancelled > 0) {
    eventService.emitEvent(AppEventType.BatchTaskCancelled, {
      userId: numericUserId,
      details: { taskId, completed, failed, cancelled, total },
    });
  } else if (failed > 0) {
    eventService.emitEvent(AppEventType.BatchTaskFailed, {
      userId: numericUserId,
      details: { taskId, completed, failed, cancelled, total },
    });
  }

  logger.info(
    `[BatchService] 任务 ${taskId} 已完成，最终状态: ${finalStatus}，成功: ${completed}，失败: ${failed}，取消: ${cancelled}`,
  );
}

/**
 * 获取任务状态
 */
export async function getTaskStatus(taskId: string): Promise<BatchTask | null> {
  return BatchRepository.getTask(taskId);
}

/**
 * 获取用户的任务列表
 */
export async function getTasksByUser(
  userId: number | string,
  limit: number = 20,
  offset: number = 0,
): Promise<BatchTask[]> {
  return BatchRepository.getTasksByUser(userId, limit, offset);
}

/**
 * 取消任务
 */
export async function cancelTask(taskId: string, reason: string = '用户取消'): Promise<boolean> {
  const task = await BatchRepository.getTask(taskId);
  if (!task) {
    logger.warn(`[BatchService] 尝试取消不存在的任务: ${taskId}`);
    return false;
  }

  // 检查任务是否可以取消
  if (['completed', 'failed', 'cancelled'].includes(task.status)) {
    logger.warn(`[BatchService] 任务 ${taskId} 状态为 ${task.status}，无法取消。`);
    return false;
  }

  // 触发 AbortController
  const abortController = taskAbortControllers.get(taskId);
  if (abortController) {
    abortController.abort();
  }

  // 取消排队中的子任务
  const cancelledCount = await BatchRepository.cancelSubTasks(taskId, reason);
  logger.info(`[BatchService] 已取消任务 ${taskId} 的 ${cancelledCount} 个排队子任务。`);

  // 不在这里发送 WS 事件或更新任务状态
  // 由 processTask 的 finalizeTask 在 DB 写入后统一发送终态事件
  // 避免竞态：前端收到 WS 事件后 fetch 可能读到旧的 DB 状态

  return true;
}

/**
 * 删除任务
 */
export async function deleteTask(taskId: string, userId: number | string): Promise<boolean> {
  const task = await BatchRepository.getTask(taskId);
  if (!task) {
    return false;
  }

  // 验证所有权
  if (task.userId !== userId && String(task.userId) !== String(userId)) {
    logger.warn(`[BatchService] 用户 ${userId} 尝试删除不属于自己的任务 ${taskId}。`);
    return false;
  }

  // 如果任务正在执行，先取消
  if (task.status === 'in-progress' || task.status === 'queued') {
    await cancelTask(taskId, '任务被删除');
  }

  await BatchRepository.deleteTask(taskId);
  taskAbortControllers.delete(taskId);
  logger.info(`[BatchService] 任务 ${taskId} 已删除。`);
  return true;
}

/**
 * 清理过期任务
 */
export async function cleanupOldTasks(daysOld: number = 7): Promise<number> {
  const count = await BatchRepository.cleanupOldTasks(daysOld);
  if (count > 0) {
    logger.info(`[BatchService] 已清理 ${count} 个过期任务。`);
  }
  return count;
}

// ========== 启动初始化 ==========

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 每小时清理一次

let cleanupTimer: NodeJS.Timeout | null = null;

// 记录进程启动时间戳（秒），用于孤儿恢复时排除本次启动期间的新任务
const PROCESS_STARTED_AT = Math.floor(Date.now() / 1000);

/**
 * 模块启动初始化：
 * 1. 恢复服务器重启后孤儿化的 in-progress 任务（基于进程启动边界）
 * 2. 启动定时清理过期任务
 *
 * 在应用启动时由 routes 注册处调用一次。
 */
export async function initialize(): Promise<void> {
  // 恢复孤儿任务：仅恢复 updated_at < 进程启动时间的任务（上次进程遗留）
  const recovered = await BatchRepository.recoverOrphanedTasks(PROCESS_STARTED_AT);
  if (recovered > 0) {
    logger.info(`[BatchService] 启动恢复：${recovered} 个孤儿任务已标记为 failed。`);
  }

  // 启动定时清理
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      cleanupOldTasks(7).catch((err: unknown) => {
        logger.error(`[BatchService] 定时清理失败:`, err);
      });
    }, CLEANUP_INTERVAL_MS);
    logger.debug('[BatchService] 定时清理已启动（每小时执行一次）。');
  }
}
