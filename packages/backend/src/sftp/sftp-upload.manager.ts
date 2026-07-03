/**
 * SFTP 文件上传管理器
 * 负责处理文件上传的启动、数据块处理和取消操作
 */

import { WriteStream } from 'ssh2';
import { WebSocket } from 'ws';
import * as pathModule from 'path';
import { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import { SftpUtils } from './sftp-utils';
import { logger } from '../utils/logger';
import { sendWsMessage } from '../websocket/utils';

/** 活动上传状态 */
interface ActiveUpload {
  remotePath: string;
  totalSize: number;
  bytesWritten: number;
  stream: WriteStream;
  sessionId: string;
  relativePath?: string;
  drainPromise?: Promise<void> | null;
  /** 滑动窗口：已接收但尚未写入完成的块数量 */
  inFlightChunks: number;
  /** 待写入的乱序块缓冲区（chunkIndex → Buffer） */
  pendingChunks: Map<number, Buffer>;
  /** 下一个期望写入的块索引 */
  expectedChunkIndex: number;
  /** 刷写缓冲区的 Promise 锁（防止重入，排队等待当前刷写完成后再执行） */
  flushLock: Promise<void> | null;
  /** stream.end() 后等待 close 事件的兜底定时器 */
  closeTimeoutFallback: ReturnType<typeof setTimeout> | null;
  /** 标记 stream.end() 是否已调用（防止重入） */
  endRequested: boolean;
}

/** 滑动窗口大小：允许同时在途的最大块数量 */
const UPLOAD_WINDOW_SIZE = 8;

/** 全局内存跟踪：所有活跃上传的已缓冲字节总量上限（256MB） */
const GLOBAL_UPLOAD_MEMORY_LIMIT = 256 * 1024 * 1024;
/** 所有活跃上传的当前已缓冲内存总量 */
let globalBufferedBytes = 0;

export class SftpUploadManager {
  private clientStates: Map<string, ClientState>;
  private activeUploads: Map<string, ActiveUpload>;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
    this.activeUploads = new Map();
  }

  /**
   * 清理指定会话的所有活动上传
   */
  cleanupSessionUploads(sessionId: string): void {
    this.activeUploads.forEach((upload, uploadId) => {
      if (upload.sessionId === sessionId) {
        logger.warn(`[SFTP Upload] Cleaning up upload ${uploadId} for session ${sessionId}`);
        this.cancelUploadInternal(uploadId, 'Session ended');
      }
    });
  }

  /**
   * 启动新文件上传
   */
  async startUpload(
    sessionId: string,
    uploadId: string,
    remotePath: string,
    totalSize: number,
    relativePath?: string,
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    if (!state || !state.sftp) {
      logger.warn(`[SFTP Upload ${uploadId}] SFTP not ready for session ${sessionId}.`);
      if (state?.ws) {
        sendWsMessage(
          state.ws,
          'sftp:upload:error',
          { uploadId, message: 'SFTP 会话未就绪' },
          sessionId,
        );
      }
      return;
    }
    const sftp = state.sftp;
    if (this.activeUploads.has(uploadId)) {
      logger.warn(`[SFTP Upload ${uploadId}] Upload already in progress for session ${sessionId}.`);
      sendWsMessage(
        state.ws,
        'sftp:upload:error',
        { uploadId, message: 'Upload already started' },
        sessionId,
      );
      return;
    }

    try {
      // 确保目录存在
      if (relativePath) {
        const targetDirectory = pathModule.dirname(remotePath).replace(/\\/g, '/');
        try {
          if (!state.sftp) throw new Error('SFTP session is not available.');
          await SftpUtils.ensureDirectoryExists(state.sftp, targetDirectory);
        } catch (dirError: unknown) {
          const dirErrMsg = getErrorMessage(dirError);
          logger.error(
            `[SFTP Upload ${uploadId}] Failed to create directory ${targetDirectory}:`,
            dirError,
          );
          sendWsMessage(
            state.ws,
            'sftp:upload:error',
            { uploadId, message: `创建目录失败: ${dirErrMsg}` },
            sessionId,
          );
          return;
        }
      }

      // 预检查文件可写性
      try {
        if (!state.sftp) throw new Error('SFTP session is not available.');
        await new Promise<void>((resolve, reject) => {
          sftp.open(remotePath, 'w', (openErr, handle) => {
            if (openErr) {
              return reject(openErr);
            }
            sftp.close(handle, () => resolve());
          });
        });
      } catch (preCheckError: unknown) {
        const preCheckErrMsg = getErrorMessage(preCheckError);
        logger.error(
          `[SFTP Upload ${uploadId}] Writability pre-check failed for ${remotePath}:`,
          preCheckError,
        );
        sendWsMessage(
          state.ws,
          'sftp:upload:error',
          { uploadId, message: `文件不可写或创建失败: ${preCheckErrMsg}` },
          sessionId,
        );
        return;
      }

      if (!state.sftp) throw new Error('SFTP session is not available after pre-check.');

      // 上传替换已有文件时，保留原始权限（避免 755 被默认 666 覆盖）
      let existingMode: number | undefined;
      try {
        const fileStats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
          sftp.stat(remotePath, (statErr, s) => {
            if (statErr) return reject(statErr);
            resolve(s);
          });
        });
        existingMode = fileStats.mode;
      } catch (error: unknown) {
        // 文件不存在（新上传），使用默认权限
        logger.debug('[SFTP上传] 远程文件 stat 失败，使用默认权限:', error);
      }

      const stream = state.sftp.createWriteStream(
        remotePath,
        existingMode !== undefined ? { mode: existingMode } : {},
      );
      const uploadState: ActiveUpload = {
        remotePath,
        totalSize,
        bytesWritten: 0,
        stream,
        sessionId,
        relativePath,
        drainPromise: null,
        inFlightChunks: 0,
        pendingChunks: new Map(),
        expectedChunkIndex: 0,
        flushLock: null,
        closeTimeoutFallback: null,
        endRequested: false,
      };
      this.activeUploads.set(uploadId, uploadState);

      stream.on('error', (err: Error) => {
        logger.error(`[SFTP Upload ${uploadId}] WriteStream error for ${remotePath}:`, err);
        // 清理 close 兜底定时器（如有）
        const errUploadState = this.activeUploads.get(uploadId);
        if (errUploadState?.closeTimeoutFallback) {
          clearTimeout(errUploadState.closeTimeoutFallback);
          errUploadState.closeTimeoutFallback = null;
        }
        sendWsMessage(
          state.ws,
          'sftp:upload:error',
          { uploadId, message: `写入流错误: ${err.message}` },
          uploadState.sessionId,
        );
        this.activeUploads.delete(uploadId);
      });

      stream.on('close', () => {
        // 清理 close 兜底定时器（如有）
        const closingState = this.activeUploads.get(uploadId);
        if (closingState?.closeTimeoutFallback) {
          clearTimeout(closingState.closeTimeoutFallback);
          closingState.closeTimeoutFallback = null;
        }
        const finalState = this.activeUploads.get(uploadId);
        if (finalState) {
          if (finalState.bytesWritten >= finalState.totalSize) {
            sftp.lstat(finalState.remotePath, (statErr, stats) => {
              if (statErr) {
                logger.error(`[SFTP Upload ${uploadId}] lstat after close failed:`, statErr);
                sendWsMessage(
                  state.ws,
                  'sftp:upload:error',
                  { uploadId, message: `获取最终文件状态失败: ${statErr.message}` },
                  uploadState.sessionId,
                );
              } else if (stats.size < finalState.totalSize) {
                logger.error(
                  `[SFTP Upload ${uploadId}] Final size (${stats.size}) < expected (${finalState.totalSize})`,
                );
                sendWsMessage(
                  state.ws,
                  'sftp:upload:error',
                  {
                    uploadId,
                    message: `最终文件大小 (${stats.size}) 小于预期 (${finalState.totalSize})`,
                  },
                  uploadState.sessionId,
                );
              } else {
                const finalStatsPayload = SftpUtils.formatStatsToFileListItem(
                  finalState.remotePath,
                  stats,
                );
                sendWsMessage(
                  state.ws,
                  'sftp:upload:success',
                  { ...finalStatsPayload, uploadId, path: finalState.remotePath },
                  uploadState.sessionId,
                );
              }
              this.activeUploads.delete(uploadId);
            });
          } else {
            this.activeUploads.delete(uploadId);
          }
        }
      });

      sendWsMessage(state.ws, 'sftp:upload:ready', { uploadId }, sessionId);
    } catch (error: unknown) {
      logger.error(`[SFTP Upload ${uploadId}] Error starting upload for ${remotePath}:`, error);
      sendWsMessage(
        state.ws,
        'sftp:upload:error',
        { uploadId, message: `开始上传时出错: ${getErrorMessage(error)}` },
        sessionId,
      );
      this.activeUploads.delete(uploadId);
    }
  }

  /**
   * 处理上传数据块
   * 使用排序缓冲区保证按序写入 SFTP 流
   */
  async handleUploadChunk(
    sessionId: string,
    uploadId: string,
    chunkIndex: number,
    dataBase64: string,
    _isLast?: boolean,
  ): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const uploadState = this.activeUploads.get(uploadId);

    if (!state || !state.sftp) {
      logger.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but session invalid.`);
      this.cancelUploadInternal(uploadId, 'Session or SFTP invalid');
      return;
    }
    if (!uploadState) {
      logger.warn(`[SFTP Upload ${uploadId}] Received chunk ${chunkIndex}, but no active upload.`);
      return;
    }

    // 滑动窗口硬限制：拒绝超出窗口的块，防止恶意/旧客户端绕过流控
    if (uploadState.inFlightChunks >= UPLOAD_WINDOW_SIZE) {
      logger.warn(
        `[SFTP Upload ${uploadId}] Window full (${uploadState.inFlightChunks}/${UPLOAD_WINDOW_SIZE}), rejecting chunk ${chunkIndex}.`,
      );
      sendWsMessage(
        state.ws,
        'sftp:upload:error',
        {
          uploadId,
          message: `滑动窗口已满（${uploadState.inFlightChunks}/${UPLOAD_WINDOW_SIZE}），请等待确认后再发送`,
        },
        uploadState.sessionId,
      );
      return;
    }

    try {
      // 全局内存上限检查：拒绝超出总缓冲内存上限的新分块。
      // 重复块会覆盖 pending buffer，预算只计算净增量，避免重复计数。
      const estimatedChunkBytes = Math.ceil((dataBase64.length * 3) / 4); // base64 解码后大致字节数
      const previousPendingChunk = uploadState.pendingChunks.get(chunkIndex);
      const additionalBufferedBytes = estimatedChunkBytes - (previousPendingChunk?.length ?? 0);
      if (globalBufferedBytes + additionalBufferedBytes > GLOBAL_UPLOAD_MEMORY_LIMIT) {
        logger.warn(
          `[SFTP Upload ${uploadId}] Global buffer memory limit reached (${Math.round(globalBufferedBytes / 1024 / 1024)}MB/${Math.round(GLOBAL_UPLOAD_MEMORY_LIMIT / 1024 / 1024)}MB), rejecting chunk ${chunkIndex}.`,
        );
        sendWsMessage(
          state.ws,
          'sftp:upload:error',
          {
            uploadId,
            message: `服务器缓冲内存已满（${Math.round(globalBufferedBytes / 1024 / 1024)}MB），请等待上传完成后再继续`,
          },
          uploadState.sessionId,
        );
        return;
      }

      // 仅在块未重复时才计入在途计数，防止重复块耗尽滑动窗口
      const isDuplicate = previousPendingChunk !== undefined;
      if (!isDuplicate) {
        uploadState.inFlightChunks++;
      } else {
        logger.warn(
          `[SFTP Upload ${uploadId}] Duplicate chunk ${chunkIndex} received, overwriting buffer.`,
        );
      }
      const chunkBuffer = Buffer.from(dataBase64, 'base64');

      // 跟踪全局缓冲内存；重复块覆盖时先释放旧 buffer 的预算。
      if (previousPendingChunk) {
        globalBufferedBytes = Math.max(0, globalBufferedBytes - previousPendingChunk.length);
      }
      globalBufferedBytes += chunkBuffer.length;

      // 将块存入排序缓冲区（不直接写入流）
      uploadState.pendingChunks.set(chunkIndex, chunkBuffer);

      // 按序刷写缓冲区
      await this.flushPendingChunks(uploadId);
    } catch (error: unknown) {
      logger.error(`[SFTP Upload ${uploadId}] Error handling chunk ${chunkIndex}:`, error);
      sendWsMessage(
        state.ws,
        'sftp:upload:error',
        { uploadId, message: `处理块 ${chunkIndex} 时出错: ${getErrorMessage(error)}` },
        sessionId,
      );
      this.cancelUploadInternal(uploadId, `Error handling chunk ${chunkIndex}`);
    }
  }

  /**
   * 按序刷写待写入块缓冲区
   * 从 expectedChunkIndex 开始，连续写入已到达的块
   * 使用 Promise 锁保证同一时间只有一个刷写流程运行，后续调用排队等待
   */
  private flushPendingChunks(uploadId: string): Promise<void> {
    const uploadState = this.activeUploads.get(uploadId);
    if (!uploadState) return Promise.resolve();

    const state = this.clientStates.get(uploadState.sessionId);
    if (!state) return Promise.resolve();

    // Promise 锁：如果已经在刷写，排队等待当前刷写完成后再执行新一轮
    if (uploadState.flushLock) {
      return uploadState.flushLock.then(() => this._doFlushPendingChunks(uploadId));
    }

    // 没有正在进行的刷写，直接启动
    const flushPromise = this._doFlushPendingChunks(uploadId);
    uploadState.flushLock = flushPromise;
    flushPromise.finally(() => {
      // 刷写完成后清除锁，但如果有新数据在 await 期间到达，会在 finally 后由下一轮调用重新启动
      if (uploadState) uploadState.flushLock = null;
    });
    return flushPromise;
  }

  /**
   * 实际执行刷写逻辑（由 flushPendingChunks 调用）
   */
  private async _doFlushPendingChunks(uploadId: string): Promise<void> {
    const uploadState = this.activeUploads.get(uploadId);
    if (!uploadState) return;

    const state = this.clientStates.get(uploadState.sessionId);
    if (!state) return;

    try {
      while (uploadState.pendingChunks.has(uploadState.expectedChunkIndex)) {
        const currentIndex = uploadState.expectedChunkIndex;
        const bufferedChunk = uploadState.pendingChunks.get(currentIndex);
        if (!bufferedChunk) break;
        uploadState.pendingChunks.delete(currentIndex);

        // 释放已写入块的全局缓冲内存跟踪
        globalBufferedBytes = Math.max(0, globalBufferedBytes - bufferedChunk.length);

        uploadState.expectedChunkIndex++;

        // 写入流并等待完成（传入 buffer，避免 writeChunkToStream 重新查找已被删除的条目）
        await this.writeChunkToStream(uploadId, bufferedChunk);

        // 写入完成后减少在途计数并发送 ack
        uploadState.inFlightChunks = Math.max(0, uploadState.inFlightChunks - 1);

        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          const progressPercent =
            uploadState.totalSize === 0
              ? 100
              : Math.round((uploadState.bytesWritten / uploadState.totalSize) * 100);
          sendWsMessage(
            state.ws,
            'sftp:upload:progress',
            {
              uploadId,
              bytesWritten: uploadState.bytesWritten,
              totalSize: uploadState.totalSize,
              progress: Math.min(100, progressPercent),
            },
            uploadState.sessionId,
          );

          // 发送滑动窗口 ack，告知前端剩余窗口槽位
          const windowSlots = Math.max(0, UPLOAD_WINDOW_SIZE - uploadState.inFlightChunks);
          sendWsMessage(
            state.ws,
            'sftp:upload:chunk:ack',
            { uploadId, chunkIndex: currentIndex, windowSlots },
            uploadState.sessionId,
          );
        }

        // 检查是否所有字节已写入完毕
        if (uploadState.bytesWritten >= uploadState.totalSize) {
          if (!uploadState.endRequested && !uploadState.stream.writableEnded) {
            uploadState.endRequested = true;

            // 超时回退：stream.end() 后如果 close 事件未在 5s 内触发，强制销毁流并清理
            uploadState.closeTimeoutFallback = setTimeout(() => {
              const pendingState = this.activeUploads.get(uploadId);
              if (pendingState && !pendingState.stream.destroyed) {
                logger.warn(
                  `[SFTP Upload ${uploadId}] stream close 事件超时 (5s)，强制销毁流。` +
                    ` (bytesWritten=${pendingState.bytesWritten}/${pendingState.totalSize},` +
                    ` expectedChunkIndex=${pendingState.expectedChunkIndex},` +
                    ` pendingChunks=${pendingState.pendingChunks.size})`,
                );
                pendingState.stream.destroy();
                this.activeUploads.delete(uploadId);
              }
            }, 5000);

            uploadState.stream.end((endErr: (Error & { code?: string }) | undefined) => {
              if (endErr) {
                if (
                  endErr.code === 'ERR_STREAM_DESTROYED' &&
                  uploadState.bytesWritten >= uploadState.totalSize
                ) {
                  logger.warn(
                    `[SFTP Upload ${uploadId}] ERR_STREAM_DESTROYED but all bytes written.`,
                  );
                } else {
                  logger.error(`[SFTP Upload ${uploadId}] Error from stream.end():`, endErr);
                  sendWsMessage(
                    state.ws,
                    'sftp:upload:error',
                    { uploadId, message: `结束写入流时出错: ${endErr.message}` },
                    uploadState.sessionId,
                  );
                  this.cancelUploadInternal(uploadId, `Stream end error: ${endErr.message}`);
                }
              }
            });
          }
          break;
        }
      }
    } catch (error: unknown) {
      logger.error(`[SFTP Upload ${uploadId}] _doFlushPendingChunks 异常:`, error);
      const clientState = this.clientStates.get(uploadState.sessionId);
      if (clientState?.ws && clientState.ws.readyState === WebSocket.OPEN) {
        sendWsMessage(
          clientState.ws,
          'sftp:upload:error',
          { uploadId, message: `刷写缓冲区时出错: ${getErrorMessage(error)}` },
          uploadState.sessionId,
        );
      }
      this.cancelUploadInternal(uploadId, `Flush error: ${getErrorMessage(error)}`);
    }
  }

  /**
   * 将单个块写入 SFTP 流，支持背压处理
   * 写回调作为唯一 resolve/reject 入口；
   * 当 write() 返回 false 时，先等 drain 再从回调 resolve。
   */
  private writeChunkToStream(uploadId: string, chunkBuffer: Buffer): Promise<void> {
    const uploadState = this.activeUploads.get(uploadId);
    if (!uploadState) return Promise.resolve();

    const state = this.clientStates.get(uploadState.sessionId);
    if (!state) return Promise.resolve();

    return new Promise<void>((resolveWrite, reject) => {
      let settled = false;
      let writeCallbackResolved = false;
      let drainResolved = false;
      const settle = (action: 'resolve' | 'reject', err?: Error) => {
        if (settled) return;
        settled = true;
        if (action === 'resolve') resolveWrite();
        else reject(err);
      };
      const settleIfReady = () => {
        if (writeCallbackResolved && drainResolved) {
          settle('resolve');
        }
      };

      const writeSuccess = uploadState.stream.write(chunkBuffer, (err) => {
        if (err) {
          logger.error(`[SFTP Upload ${uploadId}] Write callback error:`, err);
          sendWsMessage(
            state.ws,
            'sftp:upload:error',
            { uploadId, message: `写入块失败: ${(err as Error).message}` },
            uploadState.sessionId,
          );
          this.cancelUploadInternal(uploadId, `Write error`);
          settle('reject', err as Error);
          return;
        }

        uploadState.bytesWritten += chunkBuffer.length;
        writeCallbackResolved = true;
        // SFTP 上传字节指标（延迟导入避免循环依赖）
        try {
          const { sftpTransferredBytes } = require('../metrics/metrics.service');
          sftpTransferredBytes.inc({ direction: 'upload' }, chunkBuffer.length);
        } catch (metricsErr) {
          logger.warn('[SFTP Upload] 指标模块加载失败，上传字节未记录:', metricsErr);
        }

        // write callback 表示远端确认写入；write() 返回 false 时还需确认 drain 已释放背压。
        queueMicrotask(settleIfReady);
      });

      if (writeSuccess === false) {
        // 背压：drain 和 write callback 都到达后再 resolve，避免任意事件先到导致挂起。
        if (!uploadState.drainPromise) {
          uploadState.drainPromise = new Promise<void>((drainResolve) => {
            uploadState.stream.once('drain', () => {
              uploadState.drainPromise = null;
              drainResolve();
            });
          });
        }
        uploadState.drainPromise.then(() => {
          drainResolved = true;
          settleIfReady();
        });
      } else {
        drainResolved = true;
        queueMicrotask(settleIfReady);
      }
    });
  }

  /**
   * 取消上传
   */
  cancelUpload(sessionId: string, uploadId: string): void {
    const state = this.clientStates.get(sessionId);
    const uploadState = this.activeUploads.get(uploadId);

    if (!state) {
      logger.warn(`[SFTP Upload ${uploadId}] Cancel requested but session not found.`);
      this.cancelUploadInternal(uploadId, 'Session not found');
      return;
    }
    if (!uploadState) {
      logger.warn(`[SFTP Upload ${uploadId}] Cancel requested but no active upload.`);
      sendWsMessage(
        state.ws,
        'sftp:upload:error',
        { uploadId, message: '无效的上传 ID 或上传已取消/完成' },
        sessionId,
      );
      return;
    }

    logger.info(`[SFTP Upload ${uploadId}] Cancelling upload for ${uploadState.remotePath}`);
    this.cancelUploadInternal(uploadId, 'User cancelled');
    sendWsMessage(state.ws, 'sftp:upload:cancelled', { uploadId }, sessionId);
  }

  /**
   * 内部取消上传清理
   */
  private cancelUploadInternal(uploadId: string, reason: string): void {
    const uploadState = this.activeUploads.get(uploadId);
    if (uploadState) {
      logger.info(`[SFTP Upload ${uploadId}] Cleaning upload state: ${reason}`);
      // 清理 close 兜底定时器
      if (uploadState.closeTimeoutFallback) {
        clearTimeout(uploadState.closeTimeoutFallback);
        uploadState.closeTimeoutFallback = null;
      }
      const currentStream = uploadState.stream;
      if (currentStream && !currentStream.destroyed) {
        if (!currentStream.writableEnded) {
          currentStream.end((endErr: Error | undefined) => {
            if (endErr && !currentStream.destroyed) {
              currentStream.destroy();
            }
          });
        } else {
          currentStream.destroy();
        }
      }
      // 释放待写入块的全局缓冲内存跟踪，防止内存泄漏
      for (const [, buffered] of uploadState.pendingChunks) {
        globalBufferedBytes = Math.max(0, globalBufferedBytes - buffered.length);
      }
      this.activeUploads.delete(uploadId);
    }
  }
}
