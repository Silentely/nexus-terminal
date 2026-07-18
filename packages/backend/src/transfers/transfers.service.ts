import * as path from 'path';
import * as crypto from 'crypto';

import { Client, SFTPWrapper } from 'ssh2';
import { InitiateTransferPayload, TransferTask, TransferSubTask } from './transfers.types';
import { getConnectionWithDecryptedCredentials } from '../connections/connection.service';
import type { ConnectionWithTags, DecryptedConnectionCredentials } from '../types/connection.types';
import { getErrorMessage, isError } from '../utils/AppError';
import { logger } from '../utils/logger';
import {
  buildSshConnectConfig,
  buildTransferCommandString,
  escapeShellArg,
  hasOpenClientSocket,
} from './transfers.utils';

export class TransfersService {
  private transferTasks: Map<string, TransferTask> = new Map();
  private taskAbortControllers: Map<string, AbortController> = new Map(); // +++ 用于存储任务的 AbortController +++
  private readonly TEMP_KEY_PREFIX = 'nexus_target_key_';
  private readonly MAX_CONCURRENT_SUB_TASKS = 5;

  constructor() {
    logger.debug('[TransfersService] Initialized.');
  }

  public async initiateNewTransfer(
    payload: InitiateTransferPayload,
    userId: string | number,
  ): Promise<TransferTask> {
    const taskId = crypto.randomUUID();
    const now = new Date();
    const subTasks: TransferSubTask[] = [];
    const abortController = new AbortController();
    this.taskAbortControllers.set(taskId, abortController);

    // 每个 (目标服务器, 源文件) 组合都是一个子任务
    for (const connectionId of payload.connectionIds) {
      // 目标服务器ID列表
      for (const item of payload.sourceItems) {
        // 源服务器上的文件/目录列表
        const subTaskId = crypto.randomUUID();
        subTasks.push({
          subTaskId,
          connectionId, // 这是目标服务器的ID
          sourceItemName: item.name, // 源文件的名称，用于标识
          status: 'queued',
          startTime: now,
        });
      }
    }

    const newTask: TransferTask = {
      taskId,
      status: 'queued',
      userId,
      createdAt: now,
      updatedAt: now,
      subTasks,
      payload, // payload 包含 sourceConnectionId
    };

    this.transferTasks.set(taskId, newTask);
    logger.info(
      `[TransfersService] New transfer task created: ${taskId} for source ${payload.sourceConnectionId} with ${subTasks.length} sub-tasks.`,
    );

    // 异步启动传输，不阻塞当前请求
    this.processTransferTask(taskId, abortController.signal).catch((error: unknown) => {
      // +++ 传递 signal +++
      logger.error(`[TransfersService] Error processing task ${taskId} in background:`, error);
      // 如果不是因为终止操作导致的错误，则更新状态
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (!isAbortError) {
        this.updateOverallTaskStatus(
          taskId,
          'failed',
          `Background processing error: ${getErrorMessage(error)}`,
        );
      }
    });

    return { ...newTask }; // 返回任务的副本
  }

  public async cancelTransferTask(taskId: string, userId: string | number): Promise<boolean> {
    const task = this.transferTasks.get(taskId);
    if (!task || task.userId !== userId) {
      logger.warn(
        `[TransfersService] Attempt to cancel non-existent task ${taskId} or task not owned by user ${userId}.`,
      );
      return false;
    }

    const abortController = this.taskAbortControllers.get(taskId);
    if (abortController) {
      logger.info(`[TransfersService] Cancelling task ${taskId}.`);
      abortController.abort(); // 触发终止信号

      // 更新主任务状态
      // 假设 'cancelling' 和 'cancelled' 是有效的状态
      if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
        this.updateOverallTaskStatus(taskId, 'cancelling', 'Task cancellation initiated by user.');
        // 可以在 processTransferTask 的 finally 中将状态设置为 'cancelled'
      }

      // 更新所有未完成的子任务状态
      task.subTasks.forEach((subTask) => {
        if (
          subTask.status !== 'completed' &&
          subTask.status !== 'failed' &&
          subTask.status !== 'cancelled'
        ) {
          this.updateSubTaskStatus(
            taskId,
            subTask.subTaskId,
            'cancelled',
            subTask.progress,
            'Cancelled due to parent task cancellation.',
          );
        }
      });

      return true;
    }
    logger.warn(`[TransfersService] No AbortController found for task ${taskId} to cancel.`);
    return false;
  }

  private async processTransferTask(taskId: string, signal: AbortSignal): Promise<void> {
    // +++ 接收 AbortSignal +++
    const task = this.transferTasks.get(taskId);
    if (!task) {
      logger.error(`[TransfersService] Task ${taskId} not found for processing.`);
      return;
    }

    if (signal.aborted) {
      logger.debug(`[TransfersService] Task ${taskId} was cancelled before processing started.`);
      this.updateOverallTaskStatus(taskId, 'cancelled', 'Cancelled before start.');
      this.taskAbortControllers.delete(taskId); // 清理
      return;
    }

    this.updateOverallTaskStatus(taskId, 'in-progress');
    let sourceSshClient: Client | undefined;

    try {
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      const sourceConnectionResult = await getConnectionWithDecryptedCredentials(
        task.payload.sourceConnectionId,
      );
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      if (!sourceConnectionResult || !sourceConnectionResult.connection) {
        throw new Error(
          `Source connection with ID ${task.payload.sourceConnectionId} not found or inaccessible.`,
        );
      }
      const { connection: sourceConnection, ...sourceCredentials } = sourceConnectionResult;

      sourceSshClient = new Client();
      const activeSourceSshClient = sourceSshClient;
      const sourceConnectConfig = buildSshConnectConfig(sourceConnection, sourceCredentials);

      await new Promise<void>((resolve, reject) => {
        if (signal.aborted)
          return reject(new DOMException('Transfer cancelled by user.', 'AbortError'));

        const onAbort = () => {
          activeSourceSshClient.end(); // 尝试关闭连接
          reject(new DOMException('Transfer cancelled by user.', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        activeSourceSshClient
          .on('ready', () => {
            signal.removeEventListener('abort', onAbort);
            logger.debug(
              `[TransfersService] SSH connection established to source server ${sourceConnection.host} for task ${taskId}.`,
            );
            resolve();
          })
          .on('error', (err) => {
            signal.removeEventListener('abort', onAbort);
            logger.error(
              `[TransfersService] SSH connection error to source server ${sourceConnection.host} for task ${taskId}:`,
              err,
            );
            reject(err);
          })
          .on('close', () => {
            signal.removeEventListener('abort', onAbort);
            logger.debug(
              `[TransfersService] SSH connection closed to source server ${sourceConnection.host} for task ${taskId}.`,
            );
          })
          .connect(sourceConnectConfig);
      });

      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      // New concurrent processing logic for sub-tasks
      const subTaskExecutionPromises: Promise<void>[] = []; // Stores promises for all initiated sub-tasks
      let currentlyActiveSubTasks = 0;
      const maxConcurrentSubTasks = this.MAX_CONCURRENT_SUB_TASKS;
      let currentSubTaskIndex = 0; // Points to the next sub-task in task.subTasks to be processed
      const totalSubTasks = task.subTasks.length;

      logger.info(
        `[TransfersService] Task ${taskId}: Starting to process ${totalSubTasks} sub-tasks with max concurrency of ${maxConcurrentSubTasks}.`,
      );

      // Wrapper function to process a single sub-task and manage active counts
      const processSingleSubTaskWrapper = async (
        subTask: TransferSubTask,
        subTaskIndexForLog: number,
      ): Promise<void> => {
        logger.debug(
          `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (index ${subTaskIndexForLog}) started. Active: ${currentlyActiveSubTasks}/${maxConcurrentSubTasks}`,
        );

        if (signal.aborted) {
          this.updateSubTaskStatus(
            taskId,
            subTask.subTaskId,
            'cancelled',
            undefined,
            'Cancelled before start.',
          );
          logger.debug(
            `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} cancelled before processing.`,
          );
          return; // Do not process this sub-task
        }

        const currentSourceItem = task.payload.sourceItems.find(
          (it) => it.name === subTask.sourceItemName,
        );
        if (!currentSourceItem) {
          this.updateSubTaskStatus(
            taskId,
            subTask.subTaskId,
            'failed',
            undefined,
            `Source item '${subTask.sourceItemName}' not found in payload.`,
          );
          logger.warn(
            `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (item: ${subTask.sourceItemName}) - Source item not found.`,
          );
          return;
        }

        try {
          if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
          this.updateSubTaskStatus(
            taskId,
            subTask.subTaskId,
            'connecting',
            undefined,
            `Preparing transfer for ${currentSourceItem.name} to target ID ${subTask.connectionId}`,
          );
          logger.debug(
            `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (item: ${currentSourceItem.name}) - Connecting to target ID ${subTask.connectionId}.`,
          );

          const targetConnectionResult = await getConnectionWithDecryptedCredentials(
            subTask.connectionId,
          );
          if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

          if (!targetConnectionResult || !targetConnectionResult.connection) {
            this.updateSubTaskStatus(
              taskId,
              subTask.subTaskId,
              'failed',
              undefined,
              `Target connection with ID ${subTask.connectionId} not found.`,
            );
            return;
          }
          const { connection: targetConnection, ...targetCredentials } = targetConnectionResult;

          await this.executeRemoteTransferOnSource(
            taskId,
            subTask.subTaskId,
            activeSourceSshClient,
            sourceConnection,
            currentSourceItem,
            targetConnection,
            targetCredentials,
            task.payload.remoteTargetPath,
            task.payload.transferMethod,
            signal, // +++ Pass signal +++
          );
        } catch (subTaskError: unknown) {
          if (isError(subTaskError) && subTaskError.name === 'AbortError') {
            this.updateSubTaskStatus(
              taskId,
              subTask.subTaskId,
              'cancelled',
              undefined,
              'Sub-task cancelled by user.',
            );
            logger.debug(
              `[TransfersService] Task ${taskId}: Sub-task ${subTask.subTaskId} (item: ${currentSourceItem.name}) was cancelled.`,
            );
          } else {
            const subTaskErrMsg = getErrorMessage(subTaskError);
            logger.error(
              `[TransfersService] Task ${taskId}: Error in sub-task ${subTask.subTaskId} (item: ${currentSourceItem.name}) wrapper:`,
              subTaskErrMsg,
              isError(subTaskError) ? subTaskError.stack : undefined,
            );
            const subTaskInstance = task.subTasks.find((st) => st.subTaskId === subTask.subTaskId);
            if (
              subTaskInstance &&
              subTaskInstance.status !== 'failed' &&
              subTaskInstance.status !== 'completed' &&
              subTaskInstance.status !== 'cancelled'
            ) {
              this.updateSubTaskStatus(
                taskId,
                subTask.subTaskId,
                'failed',
                undefined,
                subTaskErrMsg || `Unknown error in sub-task ${subTask.subTaskId} wrapper.`,
              );
            }
          }
        }
      };

      await new Promise<void>((resolveAllTasksCompleted, rejectAllTasksCompleted) => {
        const onAbortOverall = () => {
          logger.debug(
            `[TransfersService] Task ${taskId}: Overall cancellation signal received during sub-task processing phase.`,
          );
          // Attempt to clean up / signal running sub-tasks is handled by individual sub-task signal checks
          rejectAllTasksCompleted(new DOMException('Transfer cancelled by user.', 'AbortError'));
        };
        signal.addEventListener('abort', onAbortOverall, { once: true });

        const handleSubTaskSettled = () => {
          currentlyActiveSubTasks--;
          if (signal.aborted && currentlyActiveSubTasks === 0) {
            logger.debug(
              `[TransfersService] Task ${taskId}: All active sub-tasks finished after main abort signal.`,
            );
            signal.removeEventListener('abort', onAbortOverall);
            resolveAllTasksCompleted(); // All active tasks completed/aborted after main signal
            return;
          }
          if (currentSubTaskIndex < totalSubTasks && !signal.aborted) {
            launchNextSubTaskIfPossible();
          } else if (currentlyActiveSubTasks === 0) {
            logger.debug(
              `[TransfersService] Task ${taskId}: All ${totalSubTasks} sub-tasks have completed or been skipped after processing.`,
            );
            signal.removeEventListener('abort', onAbortOverall);
            resolveAllTasksCompleted();
          }
        };

        const launchNextSubTaskIfPossible = () => {
          if (signal.aborted) {
            // Check before launching new sub-tasks
            logger.debug(
              `[TransfersService] Task ${taskId}: Abort signal detected, not launching more sub-tasks.`,
            );
            if (currentlyActiveSubTasks === 0) resolveAllTasksCompleted(); // If no tasks are active, resolve.
            return;
          }

          while (
            currentlyActiveSubTasks < maxConcurrentSubTasks &&
            currentSubTaskIndex < totalSubTasks
          ) {
            const subTaskToProcess = task.subTasks[currentSubTaskIndex];
            // If sub-task is already marked (e.g. cancelled by overall cancel before it started), skip.
            if (subTaskToProcess.status === 'cancelled') {
              logger.debug(
                `[TransfersService] Task ${taskId}: Skipping already cancelled sub-task ${subTaskToProcess.subTaskId}`,
              );
              currentSubTaskIndex++;
              if (currentSubTaskIndex === totalSubTasks && currentlyActiveSubTasks === 0) {
                signal.removeEventListener('abort', onAbortOverall);
                resolveAllTasksCompleted();
              }
              continue; // check next sub-task
            }

            const capturedIndexForLog = currentSubTaskIndex;
            currentlyActiveSubTasks++;
            currentSubTaskIndex++;

            const taskPromise = processSingleSubTaskWrapper(
              subTaskToProcess,
              capturedIndexForLog,
            ).finally(handleSubTaskSettled);
            subTaskExecutionPromises.push(taskPromise);
          }
          if (
            currentSubTaskIndex === totalSubTasks &&
            currentlyActiveSubTasks === 0 &&
            !signal.aborted
          ) {
            logger.debug(
              `[TransfersService] Task ${taskId}: All sub-tasks processed (no active, no more to launch).`,
            );
            signal.removeEventListener('abort', onAbortOverall);
            resolveAllTasksCompleted();
          }
        };

        if (totalSubTasks === 0) {
          logger.debug(`[TransfersService] Task ${taskId}: No sub-tasks to process.`);
          signal.removeEventListener('abort', onAbortOverall);
          resolveAllTasksCompleted();
          return;
        }
        if (signal.aborted) {
          // Check if cancelled even before starting the loop
          logger.debug(
            `[TransfersService] Task ${taskId}: Cancelled before sub-task loop initiation.`,
          );
          task.subTasks.forEach((st) => {
            // Mark all sub-tasks as cancelled
            if (st.status !== 'completed' && st.status !== 'failed')
              this.updateSubTaskStatus(
                taskId,
                st.subTaskId,
                'cancelled',
                undefined,
                'Task cancelled before sub-task execution.',
              );
          });
          signal.removeEventListener('abort', onAbortOverall);
          rejectAllTasksCompleted(new DOMException('Transfer cancelled by user.', 'AbortError'));
          return;
        }
        launchNextSubTaskIfPossible();
      });
    } catch (error: unknown) {
      if (isError(error) && error.name === 'AbortError') {
        logger.info(`[TransfersService] Task ${taskId} processing was aborted.`);
        this.updateOverallTaskStatus(taskId, 'cancelled', 'Transfer cancelled by user.');
      } else {
        logger.error(
          `[TransfersService] Major error processing task ${taskId}: ${getErrorMessage(error)}`,
          isError(error) ? error.stack : undefined,
        );
        this.updateOverallTaskStatus(
          taskId,
          'failed',
          getErrorMessage(error) || 'Failed to process task due to a major error.',
        );
      }
    } finally {
      if (sourceSshClient) {
        // 直接检查 sourceSshClient 是否存在
        try {
          sourceSshClient.end();
          logger.debug(
            `[TransfersService] SSH connection to source server explicitly closed for task ${taskId}.`,
          );
        } catch (error: unknown) {
          logger.warn(
            `[TransfersService] Error ending sourceSshClient for task ${taskId}: ${getErrorMessage(error)}`,
          );
        }
      }
      this.finalizeOverallTaskStatus(taskId); // Ensure final status is set
      this.taskAbortControllers.delete(taskId);
      if (task) {
        // task 可能未定义如果 taskId 错误
        logger.debug(
          `[TransfersService] Task ${taskId} processing finished. Final status: ${task.status}.`,
        );
      } else {
        logger.debug(
          `[TransfersService] Task ${taskId} processing finished (task object was not found at the end).`,
        );
      }
    }
  }

  private async checkCommandOnSource(client: Client, command: string): Promise<string | null> {
    return new Promise((resolve) => {
      const checkCmd = `command -v ${escapeShellArg(command)} 2>/dev/null`;
      client.exec(checkCmd, (err, stream) => {
        if (err) {
          return resolve(null);
        }
        let stdout = '';
        stream
          .on('data', (data: Buffer) => (stdout += data.toString()))
          .on('close', (code: number) => {
            const foundPath = stdout.trim();
            if (code === 0 && foundPath) {
              resolve(foundPath);
            } else {
              resolve(null);
            }
          })
          .stderr.on('data', (_data: Buffer) => {});
      });
    });
  }

  private async checkCommandOnTargetServer(
    targetConnection: ConnectionWithTags,
    targetCredentials: DecryptedConnectionCredentials,
    command: string,
  ): Promise<string | null> {
    const targetClient = new Client();
    const connectConfig = buildSshConnectConfig(targetConnection, targetCredentials);
    let foundCommandPath: string | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        targetClient
          .on('ready', () => {
            logger.debug(
              `[TransfersService] SSH connection established to target server ${targetConnection.host} for command check.`,
            );
            resolve();
          })
          .on('error', (err) => {
            logger.error(
              `[TransfersService] SSH connection error to target server ${targetConnection.host} for command check:`,
              err,
            );
            reject(err);
          })
          .on('close', () => {
            logger.debug(
              `[TransfersService] SSH connection closed to target server ${targetConnection.host} after command check.`,
            );
          })
          .connect(connectConfig);
      });

      foundCommandPath = await new Promise((resolve) => {
        const checkCmd = `command -v ${escapeShellArg(command)} 2>/dev/null`;
        targetClient.exec(checkCmd, (err, stream) => {
          if (err) {
            return resolve(null);
          }
          let stdout = '';
          stream
            .on('data', (data: Buffer) => (stdout += data.toString()))
            .on('close', (code: number) => {
              const pathOutput = stdout.trim();
              if (code === 0 && pathOutput) {
                resolve(pathOutput);
              } else {
                resolve(null);
              }
            })
            .stderr.on('data', (_data: Buffer) => {});
        });
      });
    } catch (err: unknown) {
      logger.debug({ err }, '操作失败，已忽略');
      foundCommandPath = null; // Ensure it's null on error
    } finally {
      targetClient.end();
    }
    return foundCommandPath;
  }

  private async uploadKeyToSourceViaSftp(
    client: Client,
    privateKeyContent: string,
    remotePath: string,
  ): Promise<void> {
    const SFTP_UPLOAD_TIMEOUT_MS = 30000; // 30 seconds timeout for SFTP key upload

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let sftpSession: SFTPWrapper | null = null; // To ensure sftp.end() can be called in timeout

      const cleanupAndReject = (errMsg: string) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        sftpSession?.end();
        reject(new Error(errMsg));
      };

      timeoutHandle = setTimeout(() => {
        cleanupAndReject(
          `SFTP upload to ${remotePath} timed out after ${SFTP_UPLOAD_TIMEOUT_MS / 1000}s.`,
        );
      }, SFTP_UPLOAD_TIMEOUT_MS);

      client.sftp((err, sftp) => {
        sftpSession = sftp; // Store session for potential cleanup
        if (err) {
          return cleanupAndReject(`SFTP session error for key upload: ${err.message}`);
        }
        if (!sftp) {
          return cleanupAndReject(`SFTP session error: SFTP object is null.`);
        }
        const stream = sftp.createWriteStream(remotePath, { mode: 0o600 });

        stream.on('error', (writeErr: Error) => {
          cleanupAndReject(`Failed to write key to ${remotePath} on source: ${writeErr.message}`);
        });

        // Listen to 'close' instead of 'finish' for more reliability
        stream.on('close', () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          logger.debug(
            `[TransfersService] Private key for target successfully uploaded to source at ${remotePath}`,
          );
          sftp.end();
          resolve();
        });

        let keyContentToWrite = privateKeyContent;
        if (!keyContentToWrite.endsWith('\n')) {
          keyContentToWrite += '\n';
        }
        stream.end(keyContentToWrite);
      });
    });
  }

  private async deleteFileOnSourceViaSftp(
    client: Client,
    remotePath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 取消检查：操作开始前
      if (signal?.aborted) {
        return reject(new DOMException('Delete operation cancelled by user.', 'AbortError'));
      }

      let sftpSessionStarted = false;

      const onAbort = () => {
        if (!sftpSessionStarted) {
          reject(new DOMException('Delete operation cancelled by user.', 'AbortError'));
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      client.sftp((err, sftp) => {
        sftpSessionStarted = true;
        signal?.removeEventListener('abort', onAbort);

        if (signal?.aborted) {
          sftp?.end();
          return reject(new DOMException('Delete operation cancelled by user.', 'AbortError'));
        }

        if (err) return reject(new Error(`SFTP session error for key deletion: ${err.message}`));

        sftp.unlink(remotePath, (unlinkErr) => {
          sftp.end();
          if (unlinkErr) {
            logger.warn(
              `[TransfersService] Failed to delete temporary key ${remotePath} from source:`,
              unlinkErr,
            );
            return reject(
              new Error(`Failed to delete ${remotePath} from source: ${unlinkErr.message}`),
            );
          }
          logger.debug(`[TransfersService] Temporary key ${remotePath} deleted from source.`);
          resolve();
        });
      });
    });
  }

  private async executeRemoteTransferOnSource(
    taskId: string,
    subTaskId: string,
    sourceSshClient: Client,
    sourceConnectionForInfo: ConnectionWithTags,
    sourceItem: { name: string; path: string; type: 'file' | 'directory' },
    targetConnection: ConnectionWithTags,
    targetCredentials: DecryptedConnectionCredentials,
    remoteTargetPathOnTarget: string,
    transferMethodPreference: 'auto' | 'rsync' | 'scp',
    signal: AbortSignal, // +++ Add AbortSignal parameter +++
  ): Promise<void> {
    if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
    this.updateSubTaskStatus(
      taskId,
      subTaskId,
      'transferring',
      0,
      `Initializing remote transfer for ${sourceItem.name}`,
    );
    let tempTargetKeyPathOnSource: string | undefined;

    try {
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      // Pass signal to these check commands if they are made to support it. For now, they are quick.
      const sshpassPath = await this.checkCommandOnSource(
        sourceSshClient,
        'sshpass' /* , signal */,
      );
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      const rsyncPathOnSource = await this.checkCommandOnSource(
        sourceSshClient,
        'rsync' /* , signal */,
      );
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
      const scpPathOnSource = await this.checkCommandOnSource(
        sourceSshClient,
        'scp' /* , signal */,
      );
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      let executableCommandPath: string | null = null;
      let commandTypeForLogic: 'rsync' | 'scp' | undefined; // Initialize as undefined
      let rsyncPathOnTarget: string | null = null;

      if (transferMethodPreference === 'auto') {
        if (rsyncPathOnSource) {
          // Source has rsync, check target
          rsyncPathOnTarget = await this.checkCommandOnTargetServer(
            targetConnection,
            targetCredentials,
            'rsync' /* , signal */,
          );
          if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
          if (rsyncPathOnTarget) {
            executableCommandPath = rsyncPathOnSource;
            commandTypeForLogic = 'rsync';
          }
        }
        if (!commandTypeForLogic) {
          // If rsync not chosen, try SCP
          if (scpPathOnSource) {
            executableCommandPath = scpPathOnSource;
            commandTypeForLogic = 'scp';
          } else {
            throw new Error(
              `Neither Rsync nor SCP are available on source for ${sourceItem.name} (auto mode).`,
            );
          }
        }
      } else if (transferMethodPreference === 'rsync') {
        if (!rsyncPathOnSource)
          throw new Error(`Rsync preferred but not available on source for ${sourceItem.name}.`);
        rsyncPathOnTarget = await this.checkCommandOnTargetServer(
          targetConnection,
          targetCredentials,
          'rsync' /* , signal */,
        );
        if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
        if (!rsyncPathOnTarget)
          throw new Error(`Rsync preferred, but not available on target for ${sourceItem.name}.`);
        executableCommandPath = rsyncPathOnSource;
        commandTypeForLogic = 'rsync';
      } else if (transferMethodPreference === 'scp') {
        if (!scpPathOnSource)
          throw new Error(`SCP preferred but not available on source for ${sourceItem.name}.`);
        executableCommandPath = scpPathOnSource;
        commandTypeForLogic = 'scp';
      }

      if (!executableCommandPath || !commandTypeForLogic) {
        throw new Error(`Could not determine a valid transfer command for ${sourceItem.name}.`);
      }
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      this.updateSubTaskStatus(
        taskId,
        subTaskId,
        'transferring',
        5,
        `Using ${commandTypeForLogic}.`,
      );

      // +++ Declare and initialize cmdOptions here +++
      let sshPortOption: string | undefined;
      if (targetConnection.port) {
        if (commandTypeForLogic === 'scp') {
          sshPortOption = `-P ${targetConnection.port}`;
        } else if (commandTypeForLogic === 'rsync') {
          sshPortOption = `-p ${targetConnection.port}`;
        }
      }

      const cmdOptions: {
        targetUserAndHost: string;
        sshPortOption?: string;
        sshIdentityFileOption?: string;
        sshPassCommand?: string;
      } = {
        targetUserAndHost: `${targetConnection.username}@${targetConnection.host}`,
        sshPortOption,
      };
      const subTaskToUpdate = this.transferTasks
        .get(taskId)
        ?.subTasks.find((st) => st.subTaskId === subTaskId);
      if (subTaskToUpdate) subTaskToUpdate.transferMethodUsed = commandTypeForLogic;

      // +++ 自动创建目标目录 +++
      this.updateSubTaskStatus(
        taskId,
        subTaskId,
        'transferring',
        6,
        `Ensuring target directory ${escapeShellArg(remoteTargetPathOnTarget)} exists on ${targetConnection.host}.`,
      );
      const targetClientForMkdir = new Client();
      const targetConnectConfigForMkdir = buildSshConnectConfig(
        targetConnection,
        targetCredentials,
      );
      try {
        if (signal.aborted)
          throw new DOMException('Transfer cancelled by user (before mkdir).', 'AbortError');
        await new Promise<void>((resolveMkdir, rejectMkdir) => {
          let mkdirStreamClosed = false;
          const onAbortMkdir = () => {
            if (!mkdirStreamClosed) {
              targetClientForMkdir.end();
            }
            rejectMkdir(new DOMException('Mkdir operation cancelled by user.', 'AbortError'));
          };
          signal.addEventListener('abort', onAbortMkdir, { once: true });

          targetClientForMkdir
            .on('ready', () => {
              if (signal.aborted) {
                // Check signal again after ready, before exec
                signal.removeEventListener('abort', onAbortMkdir);
                targetClientForMkdir.end();
                return rejectMkdir(
                  new DOMException('Mkdir operation cancelled by user (on ready).', 'AbortError'),
                );
              }
              const mkdirCommand = `mkdir -p ${escapeShellArg(remoteTargetPathOnTarget)}`;
              targetClientForMkdir.exec(mkdirCommand, (err, stream) => {
                if (err) {
                  signal.removeEventListener('abort', onAbortMkdir);
                  targetClientForMkdir.end();
                  return rejectMkdir(err);
                }
                let mkdirStderr = '';
                stream
                  .on('close', (code: number) => {
                    mkdirStreamClosed = true;
                    signal.removeEventListener('abort', onAbortMkdir);
                    targetClientForMkdir.end();
                    if (code === 0) {
                      logger.debug(
                        `[TransfersService] Sub-task ${subTaskId}: Target directory ${remoteTargetPathOnTarget} ensured on ${targetConnection.host}.`,
                      );
                      resolveMkdir();
                    } else {
                      rejectMkdir(
                        new Error(
                          `Failed to create directory ${remoteTargetPathOnTarget} on ${targetConnection.host}. Exit code: ${code}. Stderr: ${mkdirStderr.trim()}`,
                        ),
                      );
                    }
                  })
                  .on('data', (_data: Buffer) => {})
                  .stderr.on('data', (data: Buffer) => {
                    mkdirStderr += data.toString();
                  })
                  .on('error', (streamErr: Error) => {
                    mkdirStreamClosed = true;
                    signal.removeEventListener('abort', onAbortMkdir);
                    targetClientForMkdir.end();
                    rejectMkdir(streamErr);
                  });
              });
            })
            .on('error', (connErr: Error) => {
              signal.removeEventListener('abort', onAbortMkdir);
              rejectMkdir(connErr);
            })
            .on('close', () => {
              signal.removeEventListener('abort', onAbortMkdir);
            })
            .connect(targetConnectConfigForMkdir);
        });

        if (signal.aborted)
          throw new DOMException('Transfer cancelled by user (after mkdir attempt).', 'AbortError');
        this.updateSubTaskStatus(
          taskId,
          subTaskId,
          'transferring',
          8,
          `Target directory ensured. Preparing transfer command.`,
        );
      } catch (mkdirError: unknown) {
        const mkdirErrMsg = getErrorMessage(mkdirError);
        if (hasOpenClientSocket(targetClientForMkdir)) {
          try {
            targetClientForMkdir.end();
          } catch (cleanupError: unknown) {
            logger.debug(
              '[TransfersService] 关闭目标连接失败:',
              cleanupError instanceof Error ? cleanupError.message : cleanupError,
            );
          }
        }
        logger.error(
          `[TransfersService] Sub-task ${subTaskId}: Failed to ensure target directory ${remoteTargetPathOnTarget} on ${targetConnection.host}:`,
          mkdirErrMsg,
        );
        if (isError(mkdirError) && mkdirError.name === 'AbortError') {
          this.updateSubTaskStatus(
            taskId,
            subTaskId,
            'cancelled',
            undefined,
            `Directory creation cancelled: ${mkdirErrMsg}`,
          );
          throw mkdirError;
        }
        this.updateSubTaskStatus(
          taskId,
          subTaskId,
          'failed',
          undefined,
          `Failed to create target directory: ${mkdirErrMsg}`,
        );
        throw new Error(
          `Failed to create target directory ${remoteTargetPathOnTarget}: ${mkdirErrMsg}`,
        ); // This will be caught by the outer try-catch
      }
      // +++ 结束自动创建目标目录 +++

      if (targetConnection.auth_method === 'key' && targetCredentials.decryptedPrivateKey) {
        const randomSuffix = crypto.randomBytes(6).toString('hex');
        tempTargetKeyPathOnSource = path.posix.join(
          '/tmp',
          `${this.TEMP_KEY_PREFIX}${randomSuffix}`,
        );
        await this.uploadKeyToSourceViaSftp(
          sourceSshClient,
          targetCredentials.decryptedPrivateKey,
          tempTargetKeyPathOnSource,
        );
        if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
        cmdOptions.sshIdentityFileOption = `-i ${escapeShellArg(tempTargetKeyPathOnSource)}`;
        if (targetCredentials.decryptedPassphrase && !sshpassPath) {
          throw new Error(
            `Target key has passphrase, but sshpass is not available on source for ${sourceItem.name}.`,
          );
        }
        if (targetCredentials.decryptedPassphrase && sshpassPath) {
          cmdOptions.sshPassCommand = `${escapeShellArg(sshpassPath)} -p ${escapeShellArg(targetCredentials.decryptedPassphrase)}`;
        }
      } else if (
        targetConnection.auth_method === 'password' &&
        targetCredentials.decryptedPassword
      ) {
        if (!sshpassPath) {
          throw new Error(
            `Target uses password auth, but sshpass is not available on source for ${sourceItem.name}.`,
          );
        }
        cmdOptions.sshPassCommand = `${escapeShellArg(sshpassPath)} -p ${escapeShellArg(targetCredentials.decryptedPassword)}`;
      } else if (targetConnection.auth_method === 'key' && !targetCredentials.decryptedPrivateKey) {
        throw new Error(
          `Target connection ${targetConnection.name} is key-based but no private key found.`,
        );
      }
      if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');

      const commandToExecute = buildTransferCommandString(
        sourceItem.path,
        sourceItem.type === 'directory',
        remoteTargetPathOnTarget,
        executableCommandPath,
        commandTypeForLogic,
        cmdOptions,
      );
      this.updateSubTaskStatus(
        taskId,
        subTaskId,
        'transferring',
        10,
        `Executing: ${commandTypeForLogic}`,
      );

      await new Promise<void>((resolveCmd, rejectCmd) => {
        let streamClosed = false;
        const onAbortCmd = () => {
          if (!streamClosed) {
            logger.warn(
              `[TransfersService] Abort signal received for command stream of sub-task ${subTaskId}. Attempting to close stream.`,
            );
          }
          rejectCmd(new DOMException('Command cancelled by user.', 'AbortError'));
        };
        signal.addEventListener('abort', onAbortCmd, { once: true });

        const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
        const timeoutHandle = setTimeout(() => {
          signal.removeEventListener('abort', onAbortCmd);
          if (!streamClosed)
            rejectCmd(
              new Error(`${commandTypeForLogic} command timed out for ${sourceItem.name}.`),
            );
        }, COMMAND_TIMEOUT_MS);

        const execOptions: { pty?: boolean } = {};
        if (cmdOptions.sshPassCommand) execOptions.pty = true;

        sourceSshClient.exec(commandToExecute, execOptions, (err, stream) => {
          if (signal.aborted && !streamClosed) {
            // Check signal immediately after exec callback
            clearTimeout(timeoutHandle);
            signal.removeEventListener('abort', onAbortCmd);
            stream?.close(); // Attempt to close if stream exists
            return rejectCmd(
              new DOMException('Command cancelled by user (at exec).', 'AbortError'),
            );
          }
          if (err) {
            clearTimeout(timeoutHandle);
            signal.removeEventListener('abort', onAbortCmd);
            return rejectCmd(new Error(`Failed to execute command: ${err.message}`));
          }

          stream.on('data', (data: Buffer) => {
            if (signal.aborted) return; // Stop processing data if aborted
            // ... (progress update logic)
            if (commandTypeForLogic === 'rsync') {
              const output = data.toString();
              const progressMatch = output.match(/(\d+)%/);
              if (progressMatch && progressMatch[1]) {
                this.updateSubTaskStatus(
                  taskId,
                  subTaskId,
                  'transferring',
                  parseInt(progressMatch[1], 10),
                );
              }
            } else {
              this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 50, 'SCP in progress...');
            }
          });
          let stderrCombined = '';
          stream.stderr.on('data', (data: Buffer) => {
            if (signal.aborted) return;
            stderrCombined += data.toString();
          });
          stream.on('close', (code: number | null) => {
            streamClosed = true;
            clearTimeout(timeoutHandle);
            signal.removeEventListener('abort', onAbortCmd);
            if (signal.aborted) {
              // Check if aborted during the command run
              return rejectCmd(
                new DOMException('Command cancelled by user (on close).', 'AbortError'),
              );
            }
            if (code === 0) {
              this.updateSubTaskStatus(
                taskId,
                subTaskId,
                'completed',
                100,
                `${commandTypeForLogic} successful.`,
              );
              resolveCmd();
            } else {
              rejectCmd(
                new Error(
                  `${commandTypeForLogic} failed. Code: ${code}. Stderr: ${stderrCombined.trim()}`,
                ),
              );
            }
          });
          stream.on('error', (streamErr: Error) => {
            streamClosed = true;
            clearTimeout(timeoutHandle);
            signal.removeEventListener('abort', onAbortCmd);
            if (signal.aborted && streamErr.message.includes('closed')) {
              // If aborted and stream closed, treat as AbortError
              return rejectCmd(
                new DOMException('Command stream error due to cancellation.', 'AbortError'),
              );
            }
            rejectCmd(streamErr);
          });
        });
      });
    } catch (error: unknown) {
      if (isError(error) && error.name === 'AbortError') {
        logger.debug(
          `[TransfersService] executeRemoteTransferOnSource for sub-task ${subTaskId} (item: ${sourceItem.name}) was aborted.`,
        );
        // Status will be updated to 'cancelled' by the caller or here if not already
        const subTaskInstance = this.transferTasks
          .get(taskId)
          ?.subTasks.find((st) => st.subTaskId === subTaskId);
        if (subTaskInstance && subTaskInstance.status !== 'cancelled') {
          this.updateSubTaskStatus(
            taskId,
            subTaskId,
            'cancelled',
            undefined,
            getErrorMessage(error),
          );
        }
      } else {
        logger.error(
          `[TransfersService] executeRemoteTransferOnSource error for sub-task ${subTaskId} (item: ${sourceItem.name}): ${getErrorMessage(error)}`,
          isError(error) ? error.stack : undefined,
        );
        this.updateSubTaskStatus(
          taskId,
          subTaskId,
          'failed',
          undefined,
          getErrorMessage(error) || `Remote transfer execution failed for ${sourceItem.name}.`,
        );
      }
      throw error; // Re-throw to be caught by processSingleSubTaskWrapper
    } finally {
      if (tempTargetKeyPathOnSource) {
        try {
          await this.deleteFileOnSourceViaSftp(sourceSshClient, tempTargetKeyPathOnSource, signal);
        } catch (cleanupError: unknown) {
          logger.warn(
            `[TransfersService] Failed to cleanup temp key ${tempTargetKeyPathOnSource} on source for sub-task ${subTaskId}: ${getErrorMessage(cleanupError)}`,
          );
        }
      }
    }
  }

  // --- Status Update and Retrieval Methods (largely unchanged) ---
  public async getTransferTaskDetails(
    taskId: string,
    userId: string | number,
  ): Promise<TransferTask | null> {
    const task = this.transferTasks.get(taskId);
    logger.debug(`[TransfersService] Retrieving details for task: ${taskId} for user: ${userId}`);
    if (task && task.userId === userId) {
      // Spread the task, then explicitly add top-level fields from payload
      const taskToReturn = {
        ...task,
        subTasks: task.subTasks.map((st) => ({ ...st })),
        sourceConnectionId: task.payload.sourceConnectionId,
        remoteTargetPath: task.payload.remoteTargetPath,
      };
      return taskToReturn;
    }
    if (task && task.userId !== userId) {
      logger.warn(
        `[TransfersService] User ${userId} attempted to access task ${taskId} owned by ${task.userId}.`,
      );
      return null;
    }
    return null;
  }

  public async getAllTransferTasks(userId: string | number): Promise<TransferTask[]> {
    logger.debug(`[TransfersService] Retrieving all transfer tasks for user: ${userId}.`);
    return Array.from(this.transferTasks.values())
      .filter((task) => task.userId === userId)
      .map((task) => {
        // Spread the task, then explicitly add top-level fields from payload
        return {
          ...task,
          subTasks: task.subTasks.map((st) => ({ ...st })),
          sourceConnectionId: task.payload.sourceConnectionId,
          remoteTargetPath: task.payload.remoteTargetPath,
        };
      });
  }

  public updateSubTaskStatus(
    taskId: string,
    subTaskId: string,
    newStatus: TransferSubTask['status'],
    progress?: number,
    message?: string,
  ): void {
    const task = this.transferTasks.get(taskId);
    if (task) {
      const subTask = task.subTasks.find((st) => st.subTaskId === subTaskId);
      if (subTask) {
        // Prevent overwriting a final state with a transient one unless it's a retry mechanism (not implemented here)
        if (
          (subTask.status === 'completed' || subTask.status === 'failed') &&
          newStatus !== 'completed' &&
          newStatus !== 'failed'
        ) {
          logger.warn(
            `[TransfersService] Attempted to update final sub-task ${subTaskId} status '${subTask.status}' to '${newStatus}'. Ignoring.`,
          );
          return;
        }

        subTask.status = newStatus;
        if (progress !== undefined) subTask.progress = Math.min(100, Math.max(0, progress)); // Clamp progress
        if (message !== undefined) subTask.message = message;
        if ((newStatus === 'completed' || newStatus === 'failed') && !subTask.endTime) {
          subTask.endTime = new Date();
        }
        task.updatedAt = new Date();
        this.updateOverallTaskStatusBasedOnSubTasks(taskId); // Important: update overall task
        logger.debug(
          `[TransfersService] Sub-task ${subTaskId} (task ${taskId}) updated: ${newStatus}, progress: ${subTask.progress}%, msg: "${subTask.message}"`,
        );
      } else {
        logger.warn(
          `[TransfersService] Sub-task ${subTaskId} not found for task ${taskId} during status update.`,
        );
      }
    } else {
      logger.warn(`[TransfersService] Task ${taskId} not found during sub-task status update.`);
    }
  }

  private updateOverallTaskStatus(
    taskId: string,
    newStatus: TransferTask['status'],
    message?: string,
  ): void {
    const task = this.transferTasks.get(taskId);
    if (task) {
      const isCurrentStatusFinal =
        task.status === 'completed' ||
        task.status === 'failed' ||
        task.status === 'partially-completed';
      // Check if newStatus is one of the transient states
      const isNewStatusTransient = newStatus === 'queued' || newStatus === 'in-progress';

      if (isCurrentStatusFinal && isNewStatusTransient) {
        // If current status is final and new status is transient, ignore the update.
        logger.warn(
          `[TransfersService] Attempted to update final task ${taskId} status '${task.status}' to transient '${newStatus}'. Ignoring.`,
        );
        return;
      }

      // Proceed with the update if:
      // 1. Current status is not final.
      // 2. Current status is final, and newStatus is also a final state (e.g., 'partially-completed' to 'failed').
      task.status = newStatus;
      task.updatedAt = new Date();
      // Overall task message could be an aggregation or just the first major error.
      // For simplicity, not adding detailed message aggregation here.
      logger.info(
        `[TransfersService] Overall status for task ${taskId} directly updated to: ${newStatus}${
          message ? ` (Msg: ${message})` : ''
        }`,
      );
    }
  }

  private updateOverallTaskStatusBasedOnSubTasks(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;

    let completedCount = 0;
    let failedCount = 0;
    let inProgressCount = 0;
    let queuedCount = 0;
    let totalProgress = 0;
    const numSubTasks = task.subTasks.length;

    if (numSubTasks === 0) {
      task.overallProgress = 0;
      return;
    }

    task.subTasks.forEach((st) => {
      switch (st.status) {
        case 'completed':
          completedCount++;
          totalProgress += 100;
          break;
        case 'failed':
          failedCount++;
          break;
        case 'transferring':
        case 'connecting':
          inProgressCount++;
          if (st.progress !== undefined) {
            totalProgress += st.progress;
          } else if (st.status === 'connecting') {
            totalProgress += 5; // Small progress for connecting
          }
          break;
        case 'queued':
          queuedCount++;
          break;
      }
    });

    task.overallProgress = numSubTasks > 0 ? Math.round(totalProgress / numSubTasks) : 0;

    let newOverallStatus: TransferTask['status'];
    if (failedCount === numSubTasks) {
      newOverallStatus = 'failed';
    } else if (completedCount === numSubTasks) {
      newOverallStatus = 'completed';
    } else if (failedCount > 0 && completedCount + failedCount === numSubTasks) {
      newOverallStatus = 'partially-completed';
    } else if (
      inProgressCount > 0 ||
      (queuedCount > 0 && (failedCount > 0 || completedCount > 0))
    ) {
      // If anything is in progress, or if some are queued while others are done/failed, it's in-progress
      newOverallStatus = 'in-progress';
    } else if (queuedCount === numSubTasks) {
      newOverallStatus = 'queued'; // All subtasks are still queued
    } else {
      newOverallStatus = 'in-progress'; // Or 'partially-completed' if completedCount > 0
      if (completedCount > 0 && queuedCount > 0 && failedCount === 0 && inProgressCount === 0) {
        newOverallStatus = 'partially-completed'; // More accurate for this specific mix
      }
    }

    if (task.status !== newOverallStatus) {
      logger.info(
        `[TransfersService] Task ${taskId} overall status changing from ${task.status} to ${newOverallStatus} (P: ${task.overallProgress}%)`,
      );
      task.status = newOverallStatus;
    }
    task.updatedAt = new Date();
  }

  private finalizeOverallTaskStatus(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;
    this.updateOverallTaskStatusBasedOnSubTasks(taskId); // Recalculate based on final sub-task states
    logger.info(
      `[TransfersService] Finalized overall status for task ${taskId}: ${task.status}, progress: ${task.overallProgress}%`,
    );
  }
}
