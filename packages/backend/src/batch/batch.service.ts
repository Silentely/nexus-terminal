/**
 * 批量作业 Service 层
 * 处理批量命令执行的核心业务逻辑
 */

import { v4 as uuidv4 } from 'uuid';
import { Client, ClientChannel } from 'ssh2';
import {
    BatchTask,
    BatchSubTask,
    BatchTaskStatus,
    BatchSubTaskStatus,
    BatchExecPayload,
    BatchWsMessage
} from './batch.types';
import * as BatchRepository from './batch.repository';
import * as SshService from '../services/ssh.service';
import { broadcastToUser } from '../websocket/state';
import * as ConnectionRepository from '../connections/connection.repository';

// 默认配置
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_SECONDS = 300; // 5 分钟
const CONNECT_TIMEOUT_MS = 20000;    // 20 秒连接超时
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB 输出限制
const OUTPUT_THROTTLE_MS = 100;      // 输出写入节流

// 子任务执行结果
type SubTaskResult = 'completed' | 'failed' | 'cancelled';

// 存储任务的 AbortController
const taskAbortControllers = new Map<string, AbortController>();

/**
 * 向用户发送批量作业 WebSocket 消息
 */
function sendBatchEvent(userId: number | string, message: BatchWsMessage): void {
    const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    if (isNaN(numericUserId)) {
        console.warn(`[BatchService] 无效的 userId: ${userId}，跳过广播。`);
        return;
    }
    broadcastToUser(numericUserId, message);
}

/**
 * 创建并执行批量命令任务
 */
export async function execCommandBatch(
    payload: BatchExecPayload,
    userId: number | string
): Promise<BatchTask> {
    const taskId = uuidv4();
    const now = new Date();
    const concurrencyLimit = payload.concurrencyLimit ?? DEFAULT_CONCURRENCY;

    // 获取连接名称用于显示
    const connectionNames = new Map<number, string>();
    for (const connId of payload.connectionIds) {
        try {
            const conn = await ConnectionRepository.findConnectionByIdWithTags(connId);
            if (conn) {
                connectionNames.set(connId, conn.name || `连接 #${connId}`);
            }
        } catch (e) {
            connectionNames.set(connId, `连接 #${connId}`);
        }
    }

    // 创建子任务
    const subTasks: BatchSubTask[] = payload.connectionIds.map(connId => ({
        subTaskId: uuidv4(),
        taskId,
        connectionId: connId,
        connectionName: connectionNames.get(connId),
        command: payload.command,
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
        createdAt: now,
        updatedAt: now,
    };

    // 持久化到数据库
    await BatchRepository.createTask(task);
    console.info(`[BatchService] 批量任务已创建: ${taskId}，包含 ${subTasks.length} 个子任务。`);

    // 创建 AbortController
    const abortController = new AbortController();
    taskAbortControllers.set(taskId, abortController);

    // 异步执行任务（不阻塞返回）
    processTask(taskId, userId, payload, abortController.signal).catch(error => {
        if (error.name !== 'AbortError') {
            console.error(`[BatchService] 任务 ${taskId} 后台处理出错:`, error);
        }
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
    signal: AbortSignal
): Promise<void> {
    const task = await BatchRepository.getTask(taskId);
    if (!task) {
        console.error(`[BatchService] 任务 ${taskId} 未找到。`);
        return;
    }

    // 检查是否已取消
    if (signal.aborted) {
        await updateTaskStatus(taskId, 'cancelled', { message: '任务启动前已取消' });
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
        }
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
            console.info(`[BatchService] 任务 ${taskId} 收到取消信号。`);
            taskCancelled = true;
            // 将所有 queued 状态的子任务标记为取消
            for (let i = currentIndex; i < subTasks.length; i++) {
                if (subTasks[i].status === 'queued') {
                    cancelledCount++;
                }
            }
        };
        signal.addEventListener('abort', onAbort, { once: true });

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
                    .then(result => {
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
                    })
                    .catch(() => {
                        failedCount++;
                    })
                    .finally(() => {
                        activeCount--;
                        updateOverallProgress(taskId, userId, completedCount, failedCount, cancelledCount, subTasks.length);

                        if (currentIndex < subTasks.length && !signal.aborted) {
                            launchNext();
                        } else if (activeCount === 0) {
                            signal.removeEventListener('abort', onAbort);
                            resolve();
                        }
                    });
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
    await finalizeTask(taskId, userId, completedCount, failedCount, cancelledCount, subTasks.length, taskCancelled);
    taskAbortControllers.delete(taskId);
}

/**
 * 构建完整的执行命令
 *
 * 命令构建顺序（由内到外）：
 * 1. 原始命令
 * 2. 环境变量（使用 env 命令包裹）
 * 3. sudo（包裹整个带环境变量的命令）
 * 4. cd 工作目录（作为最外层前缀）
 *
 * 最终格式：cd workdir && sudo -n env VAR=... cmd
 */
function buildCommand(command: string, payload: BatchExecPayload): string {
    let fullCommand = command;

    // 1. 先处理环境变量（作为命令前缀）
    if (payload.env && Object.keys(payload.env).length > 0) {
        const envPrefix = Object.entries(payload.env)
            .map(([key, value]) => `${key}=${escapeShellArg(value)}`)
            .join(' ');
        fullCommand = `env ${envPrefix} ${fullCommand}`;
    }

    // 2. 然后处理 sudo（包裹整个带环境变量的命令）
    if (payload.sudo) {
        fullCommand = `sudo -n ${fullCommand}`;
    }

    // 3. 最后处理工作目录（作为最外层）
    if (payload.workdir) {
        fullCommand = `cd ${escapeShellArg(payload.workdir)} && ${fullCommand}`;
    }

    return fullCommand;
}

/**
 * Shell 参数转义
 */
function escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * 执行单个子任务
 */
async function runSubTask(
    taskId: string,
    subTask: BatchSubTask,
    userId: number | string,
    payload: BatchExecPayload,
    signal: AbortSignal
): Promise<SubTaskResult> {
    const { subTaskId, connectionId, command, connectionName } = subTask;
    let sshClient: Client | null = null;

    try {
        // 检查取消
        if (signal.aborted) {
            await updateSubTask(taskId, subTaskId, 'cancelled', 0, { message: '已取消' });
            sendSubTaskUpdate(userId, taskId, subTaskId, 'cancelled', 0, '已取消');
            return 'cancelled';
        }

        // 更新状态：连接中
        await updateSubTask(taskId, subTaskId, 'connecting', 0, { startedAt: new Date() });
        sendSubTaskUpdate(userId, taskId, subTaskId, 'connecting', 0, `正在连接到 ${connectionName || connectionId}...`);

        // 获取连接详情
        const connDetails = await SshService.getConnectionDetails(connectionId);

        if (signal.aborted) {
            await updateSubTask(taskId, subTaskId, 'cancelled', 0, { message: '已取消' });
            sendSubTaskUpdate(userId, taskId, subTaskId, 'cancelled', 0, '已取消');
            return 'cancelled';
        }

        // 建立 SSH 连接
        sshClient = await SshService.establishSshConnection(connDetails, CONNECT_TIMEOUT_MS);

        if (signal.aborted) {
            sshClient.end();
            await updateSubTask(taskId, subTaskId, 'cancelled', 0, { message: '已取消' });
            sendSubTaskUpdate(userId, taskId, subTaskId, 'cancelled', 0, '已取消');
            return 'cancelled';
        }

        // 更新状态：运行中
        await updateSubTask(taskId, subTaskId, 'running', 10);
        sendSubTaskUpdate(userId, taskId, subTaskId, 'running', 10, '正在执行命令...');

        // 构建完整命令
        const fullCommand = buildCommand(command, payload);

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
            timeoutSeconds
        );

        // 更新最终状态
        if (result.cancelled) {
            await updateSubTask(taskId, subTaskId, 'cancelled', 100, {
                message: result.timedOut ? '执行超时' : '已取消',
                endedAt: new Date()
            });
            sendSubTaskUpdate(userId, taskId, subTaskId, 'cancelled', 100, result.timedOut ? '执行超时' : '已取消');
            return 'cancelled';
        }

        if (result.exitCode === 0) {
            await updateSubTask(taskId, subTaskId, 'completed', 100, {
                exitCode: result.exitCode,
                output: result.output,
                endedAt: new Date()
            });
            sendSubTaskUpdate(userId, taskId, subTaskId, 'completed', 100, '执行成功', result.output, result.exitCode);
            return 'completed';
        } else {
            await updateSubTask(taskId, subTaskId, 'failed', 100, {
                exitCode: result.exitCode,
                output: result.output,
                message: `退出码: ${result.exitCode}`,
                endedAt: new Date()
            });
            sendSubTaskUpdate(userId, taskId, subTaskId, 'failed', 100, `执行失败 (退出码: ${result.exitCode})`, result.output, result.exitCode);
            return 'failed';
        }

    } catch (error: any) {
        const errorMsg = error.message || '未知错误';
        console.error(`[BatchService] 子任务 ${subTaskId} 执行失败:`, errorMsg);

        await updateSubTask(taskId, subTaskId, 'failed', 0, {
            message: errorMsg,
            endedAt: new Date()
        });
        sendSubTaskUpdate(userId, taskId, subTaskId, 'failed', 0, errorMsg);
        return 'failed';

    } finally {
        if (sshClient) {
            try {
                sshClient.end();
            } catch (e) {
                // 忽略关闭错误
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
    timeoutSeconds: number
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

        const terminateStream = (reason: string) => {
            if (stream) {
                try {
                    // 发送 SIGKILL 信号终止远端进程
                    stream.signal('KILL');
                } catch (e) {
                    // 某些情况下信号发送可能失败
                }
                try {
                    stream.close();
                } catch (e) {
                    // 忽略关闭错误
                }
            }
        };

        const onAbort = () => {
            if (!resolved) {
                resolved = true;
                cleanup();
                terminateStream('abort');
                resolve({ exitCode: -1, output, cancelled: true, timedOut: false });
            }
        };
        signal.addEventListener('abort', onAbort, { once: true });

        // 设置超时定时器
        timeoutTimer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                signal.removeEventListener('abort', onAbort);
                terminateStream('timeout');
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
                    payload: { taskId, subTaskId, chunk }
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
                        BatchRepository.appendSubTaskOutput(subTaskId, dbChunk).catch(() => {});
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
 * 更新子任务状态
 */
async function updateSubTask(
    taskId: string,
    subTaskId: string,
    status: BatchSubTaskStatus,
    progress: number,
    updates: Partial<{
        exitCode: number;
        output: string;
        message: string;
        startedAt: Date;
        endedAt: Date;
    }> = {}
): Promise<void> {
    await BatchRepository.updateSubTaskStatus(taskId, subTaskId, status, progress, updates);
}

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
    exitCode?: number
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
            exitCode
        }
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
    total: number
): Promise<void> {
    const overallProgress = total > 0 ? Math.round(((completed + failed + cancelled) / total) * 100) : 0;

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
        }
    });
}

/**
 * 更新任务状态
 */
async function updateTaskStatus(
    taskId: string,
    status: BatchTaskStatus,
    updates: Partial<{
        overallProgress: number;
        completedSubTasks: number;
        failedSubTasks: number;
        cancelledSubTasks: number;
        message: string;
        startedAt: Date;
        endedAt: Date;
    }> = {}
): Promise<void> {
    await BatchRepository.updateTaskStatus(taskId, status, updates);
}

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
    taskCancelled: boolean
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
    const eventType = finalStatus === 'completed' ? 'batch:completed' :
                      finalStatus === 'failed' ? 'batch:failed' :
                      finalStatus === 'cancelled' ? 'batch:cancelled' : 'batch:completed';

    sendBatchEvent(userId, {
        type: eventType,
        payload: {
            taskId,
            status: finalStatus,
            overallProgress: 100,
            completed,
            failed,
            cancelled,
            reason: finalStatus === 'failed' ? '部分或全部子任务执行失败' :
                    finalStatus === 'cancelled' ? '任务已取消' : undefined,
        }
    });

    console.info(`[BatchService] 任务 ${taskId} 已完成，最终状态: ${finalStatus}，成功: ${completed}，失败: ${failed}，取消: ${cancelled}`);
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
    offset: number = 0
): Promise<BatchTask[]> {
    return BatchRepository.getTasksByUser(userId, limit, offset);
}

/**
 * 取消任务
 */
export async function cancelTask(taskId: string, reason: string = '用户取消'): Promise<boolean> {
    const task = await BatchRepository.getTask(taskId);
    if (!task) {
        console.warn(`[BatchService] 尝试取消不存在的任务: ${taskId}`);
        return false;
    }

    // 检查任务是否可以取消
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        console.warn(`[BatchService] 任务 ${taskId} 状态为 ${task.status}，无法取消。`);
        return false;
    }

    // 触发 AbortController
    const abortController = taskAbortControllers.get(taskId);
    if (abortController) {
        abortController.abort();
    }

    // 取消排队中的子任务
    const cancelledCount = await BatchRepository.cancelSubTasks(taskId, reason);
    console.info(`[BatchService] 已取消任务 ${taskId} 的 ${cancelledCount} 个排队子任务。`);

    // 注意：不在这里更新任务状态，让 processTask 的 finalizeTask 来处理
    // 这样可以确保状态计数准确

    // 发送取消事件
    sendBatchEvent(task.userId, {
        type: 'batch:cancelled',
        payload: {
            taskId,
            reason,
        }
    });

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
        console.warn(`[BatchService] 用户 ${userId} 尝试删除不属于自己的任务 ${taskId}。`);
        return false;
    }

    // 如果任务正在执行，先取消
    if (task.status === 'in-progress' || task.status === 'queued') {
        await cancelTask(taskId, '任务被删除');
    }

    await BatchRepository.deleteTask(taskId);
    taskAbortControllers.delete(taskId);
    console.info(`[BatchService] 任务 ${taskId} 已删除。`);
    return true;
}

/**
 * 清理过期任务
 */
export async function cleanupOldTasks(daysOld: number = 7): Promise<number> {
    const count = await BatchRepository.cleanupOldTasks(daysOld);
    if (count > 0) {
        console.info(`[BatchService] 已清理 ${count} 个过期任务。`);
    }
    return count;
}
