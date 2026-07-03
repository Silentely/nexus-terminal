/**
 * SFTP 压缩/解压管理器
 * 负责处理远程服务器上的文件压缩和解压操作
 */

import * as pathModule from 'path';
import { WebSocket } from 'ws';
import {
  ClientState,
  AuthenticatedWebSocket,
  SftpCompressRequestPayload,
  SftpCompressSuccessPayload,
  SftpCompressErrorPayload,
  SftpDecompressRequestPayload,
  SftpDecompressSuccessPayload,
  SftpDecompressErrorPayload,
  SftpArchiveProgressPayload,
} from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import { shellEscape } from '../utils/shell-escape';
import { logger } from '../utils/logger';
import { sendWsMessage } from '../websocket/utils';

export class SftpArchiveManager {
  private clientStates: Map<string, ClientState>;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
  }

  /**
   * 压缩远程服务器上的文件/目录
   */
  async compress(sessionId: string, payload: SftpCompressRequestPayload): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const { sources, destinationArchiveName, format, targetDirectory, requestId } = payload;

    if (!state || !state.sshClient) {
      logger.warn(
        `[SFTP Compress] SSH 客户端未准备好，无法在 ${sessionId} 上执行 compress (ID: ${requestId})`,
      );
      this.sendCompressError(state?.ws, 'SSH 会话未就绪', requestId, undefined, sessionId);
      return;
    }

    const requiredCommand = format === 'zip' ? 'zip' : 'tar';
    try {
      const commandExists = await this.checkCommandExists(state, sessionId, requiredCommand);
      if (!commandExists) {
        this.sendCompressError(
          state.ws,
          `命令 '${requiredCommand}' 在服务器上未找到`,
          requestId,
          `Command '${requiredCommand}' not found on server.`,
        );
        return;
      }
    } catch (checkError: unknown) {
      this.sendCompressError(
        state.ws,
        `检查命令 '${requiredCommand}' 时出错`,
        requestId,
        getErrorMessage(checkError),
      );
      return;
    }

    logger.debug(
      `[SFTP Compress ${sessionId}] Request (ID: ${requestId}). Sources: ${sources.join(', ')}, Format: ${format}`,
    );

    // 构建命令
    const relativeSources = sources.map((s: string) => {
      const relativePath = pathModule.posix.relative(targetDirectory, s);
      return relativePath === '' || relativePath === '.'
        ? pathModule.posix.basename(s)
        : relativePath;
    });
    const quotedRelativeSources = relativeSources.map((s: string) => shellEscape(s)).join(' ');

    const quotedTargetDir = shellEscape(targetDirectory);
    const quotedDestName = shellEscape(destinationArchiveName);
    const cdCommand = `cd -- ${quotedTargetDir}`;

    let command: string;
    switch (format) {
      case 'zip':
        command = `${cdCommand} && zip -r ${quotedDestName} ${quotedRelativeSources}`;
        break;
      case 'targz':
        command = `${cdCommand} && tar -czvf ${quotedDestName} ${quotedRelativeSources}`;
        break;
      case 'tarbz2':
        command = `${cdCommand} && tar -cjvf ${quotedDestName} ${quotedRelativeSources}`;
        break;
      default:
        this.sendCompressError(
          state.ws,
          `不支持的压缩格式: ${format}`,
          requestId,
          undefined,
          sessionId,
        );
        return;
    }

    logger.info(`[SFTP Compress ${sessionId}] Executing: ${command} (ID: ${requestId})`);

    try {
      state.sshClient.exec(command, (err, stream) => {
        if (err) {
          logger.error(`[SFTP Compress ${sessionId}] Exec failed (ID: ${requestId}):`, err);
          this.sendCompressError(
            state.ws,
            `执行压缩命令失败: ${err.message}`,
            requestId,
            undefined,
            sessionId,
          );
          return;
        }

        let stderrData = '';
        let code: number | null = null;
        let fileCount = 0;
        let lastProgressTime = 0;
        let lastSeenFileName: string | undefined;

        // 心跳定时器：即使 stderr 长时间无输出（如压缩单个大文件），也每 10 秒发心跳，避免前端误超时
        const heartbeatInterval = setInterval(() => {
          if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            this.sendProgress(
              state.ws,
              'compress',
              requestId,
              fileCount,
              lastSeenFileName,
              sessionId,
            );
          }
        }, 10_000);

        stream.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderrData += chunk;
          // 解析 stderr 中的文件名（tar -v / zip -r 输出）
          // fileCount 始终累加，避免因节流丢失计数（W3 修复）；只控制 ws 发送频率
          const lines = chunk.split('\n').filter((l) => l.trim());
          for (const line of lines) {
            const fileName = this.parseArchiveFileName(line, format);
            if (fileName) {
              fileCount++;
              lastSeenFileName = fileName;
            }
          }
          // 节流：每 3 秒最多发送一次进度（与计数解耦）
          const now = Date.now();
          if (lastSeenFileName && now - lastProgressTime >= 3000) {
            lastProgressTime = now;
            this.sendProgress(
              state.ws,
              'compress',
              requestId,
              fileCount,
              lastSeenFileName,
              sessionId,
            );
          }
        });

        // zip -r 的文件列表输出到 stdout（tar -v 输出到 stderr）
        stream.on('data', (data: Buffer) => {
          const chunk = data.toString();
          const lines = chunk.split('\n').filter((l) => l.trim());
          for (const line of lines) {
            const fileName = this.parseArchiveFileName(line, format);
            if (fileName) {
              fileCount++;
              lastSeenFileName = fileName;
            }
          }
          const now = Date.now();
          if (lastSeenFileName && now - lastProgressTime >= 3000) {
            lastProgressTime = now;
            this.sendProgress(
              state.ws,
              'compress',
              requestId,
              fileCount,
              lastSeenFileName,
              sessionId,
            );
          }
        });

        stream.on('close', (exitCode: number | null) => {
          clearInterval(heartbeatInterval);
          code = exitCode;
          // 关闭时发送最终进度，确保前端拿到准确文件总数（包含被节流吞掉的尾部）
          if (fileCount > 0) {
            this.sendProgress(
              state.ws,
              'compress',
              requestId,
              fileCount,
              lastSeenFileName,
              sessionId,
            );
          }
          logger.info(`[SFTP Compress ${sessionId}] Finished with code ${code} (ID: ${requestId})`);
          if (code === 0 && !this.isErrorInStdErr(stderrData)) {
            const successPayload: SftpCompressSuccessPayload = {
              message: '压缩成功',
              requestId,
            };
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
              sendWsMessage(state.ws, 'sftp:compress:success', successPayload, sessionId, {
                requestId: requestId,
              });
            }
          } else {
            const errorDetails = stderrData.trim() || `压缩命令退出，代码: ${code ?? 'N/A'}`;
            logger.error(`[SFTP Compress ${sessionId}] Failed (ID: ${requestId}): ${errorDetails}`);
            this.sendCompressError(state.ws, '压缩失败', requestId, errorDetails, sessionId);
          }
        });

        stream.on('error', (streamErr: Error) => {
          clearInterval(heartbeatInterval);
          logger.error(`[SFTP Compress ${sessionId}] Stream error (ID: ${requestId}):`, streamErr);
          if (!stderrData && code === null) {
            this.sendCompressError(
              state.ws,
              '压缩命令流错误',
              requestId,
              streamErr.message,
              sessionId,
            );
          }
        });
      });
    } catch (execError: unknown) {
      logger.error(`[SFTP Compress ${sessionId}] Unexpected error (ID: ${requestId}):`, execError);
      this.sendCompressError(
        state.ws,
        `执行压缩时发生意外错误: ${getErrorMessage(execError)}`,
        requestId,
      );
    }
  }

  /**
   * 解压远程服务器上的压缩文件
   */
  async decompress(sessionId: string, payload: SftpDecompressRequestPayload): Promise<void> {
    const state = this.clientStates.get(sessionId);
    const { archivePath, requestId } = payload;

    if (!state || !state.sshClient) {
      logger.warn(
        `[SFTP Decompress] SSH 客户端未准备好，无法在 ${sessionId} 上执行 decompress (ID: ${requestId})`,
      );
      this.sendDecompressError(state?.ws, 'SSH 会话未就绪', requestId, undefined, sessionId);
      return;
    }

    const lowerArchivePath = archivePath.toLowerCase();

    let requiredCommand = '';
    if (lowerArchivePath.endsWith('.zip')) {
      requiredCommand = 'unzip';
    } else if (
      lowerArchivePath.endsWith('.tar.gz') ||
      lowerArchivePath.endsWith('.tgz') ||
      lowerArchivePath.endsWith('.tar.bz2') ||
      lowerArchivePath.endsWith('.tbz2')
    ) {
      requiredCommand = 'tar';
    } else {
      this.sendDecompressError(
        state.ws,
        `不支持的压缩文件格式: ${archivePath}`,
        requestId,
        undefined,
        sessionId,
      );
      return;
    }

    try {
      const commandExists = await this.checkCommandExists(state, sessionId, requiredCommand);
      if (!commandExists) {
        this.sendDecompressError(
          state.ws,
          `命令 '${requiredCommand}' 在服务器上未找到`,
          requestId,
          `Command '${requiredCommand}' not found on server.`,
        );
        return;
      }
    } catch (checkError: unknown) {
      this.sendDecompressError(
        state.ws,
        `检查命令 '${requiredCommand}' 时出错`,
        requestId,
        getErrorMessage(checkError),
      );
      return;
    }

    logger.debug(`[SFTP Decompress ${sessionId}] Request for ${archivePath} (ID: ${requestId})`);

    const extractDir = pathModule.posix.dirname(archivePath);
    const archiveBasename = pathModule.posix.basename(archivePath);
    const quotedExtractDir = shellEscape(extractDir);
    const quotedArchiveBasename = shellEscape(archiveBasename);
    const cdCommand = `cd -- ${quotedExtractDir}`;

    let command: string;
    if (lowerArchivePath.endsWith('.zip')) {
      command = `${cdCommand} && unzip -o ${quotedArchiveBasename}`;
    } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
      command = `${cdCommand} && tar -xzvf ${quotedArchiveBasename}`;
    } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
      command = `${cdCommand} && tar -xjvf ${quotedArchiveBasename}`;
    } else {
      this.sendDecompressError(
        state.ws,
        `不支持的压缩文件格式: ${archivePath}`,
        requestId,
        undefined,
        sessionId,
      );
      return;
    }

    logger.info(`[SFTP Decompress ${sessionId}] Executing: ${command} (ID: ${requestId})`);

    try {
      state.sshClient.exec(command, (err, stream) => {
        if (err) {
          logger.error(`[SFTP Decompress ${sessionId}] Exec failed (ID: ${requestId}):`, err);
          this.sendDecompressError(
            state.ws,
            `执行解压命令失败: ${err.message}`,
            requestId,
            undefined,
            sessionId,
          );
          return;
        }

        let stderrData = '';
        let code: number | null = null;
        let fileCount = 0;
        let lastProgressTime = 0;
        let lastSeenFileName: string | undefined;

        // 心跳定时器：即使 stderr 长时间无输出，也每 10 秒发心跳，避免前端误超时
        const heartbeatInterval = setInterval(() => {
          if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            this.sendProgress(
              state.ws,
              'decompress',
              requestId,
              fileCount,
              lastSeenFileName,
              sessionId,
            );
          }
        }, 10_000);

        stream.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderrData += chunk;
          // 解析 stderr 中的文件名（tar -v / unzip 输出）
          // fileCount 始终累加，避免因节流丢失计数（W3 修复）；只控制 ws 发送频率
          const lines = chunk.split('\n').filter((l) => l.trim());
          for (const line of lines) {
            const fileName = this.parseArchiveFileName(line, 'decompress');
            if (fileName) {
              fileCount++;
              lastSeenFileName = fileName;
            }
          }
          // 节流：每 3 秒最多发送一次进度（与计数解耦）
          const now = Date.now();
          if (lastSeenFileName && now - lastProgressTime >= 3000) {
            lastProgressTime = now;
            this.sendProgress(
              state.ws,
              'decompress',
              requestId,
              fileCount,
              lastSeenFileName,
              sessionId,
            );
          }
        });

        stream.on('close', (exitCode: number | null) => {
          clearInterval(heartbeatInterval);
          code = exitCode;
          // 关闭时发送最终进度
          if (fileCount > 0) {
            this.sendProgress(
              state.ws,
              'decompress',
              requestId,
              fileCount,
              lastSeenFileName,
              sessionId,
            );
          }
          logger.info(
            `[SFTP Decompress ${sessionId}] Finished with code ${code} (ID: ${requestId})`,
          );
          if (code === 0 && !this.isErrorInStdErr(stderrData)) {
            const successPayload: SftpDecompressSuccessPayload = {
              message: '解压成功',
              requestId,
            };
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
              sendWsMessage(state.ws, 'sftp:decompress:success', successPayload, sessionId, {
                requestId: requestId,
              });
            }
          } else {
            const errorDetails = stderrData.trim() || `解压命令退出，代码: ${code ?? 'N/A'}`;
            logger.error(
              `[SFTP Decompress ${sessionId}] Failed (ID: ${requestId}): ${errorDetails}`,
            );
            this.sendDecompressError(state.ws, '解压失败', requestId, errorDetails, sessionId);
          }
        });

        stream.on('error', (streamErr: Error) => {
          clearInterval(heartbeatInterval);
          logger.error(
            `[SFTP Decompress ${sessionId}] Stream error (ID: ${requestId}):`,
            streamErr,
          );
          if (!stderrData && code === null) {
            this.sendDecompressError(
              state.ws,
              '解压命令流错误',
              requestId,
              streamErr.message,
              sessionId,
            );
          }
        });
      });
    } catch (execError: unknown) {
      logger.error(
        `[SFTP Decompress ${sessionId}] Unexpected error (ID: ${requestId}):`,
        execError,
      );
      this.sendDecompressError(
        state.ws,
        `执行解压时发生意外错误: ${getErrorMessage(execError)}`,
        requestId,
      );
    }
  }

  /** 检查远程服务器上是否存在指定命令 */
  private checkCommandExists(
    state: ClientState,
    sessionId: string,
    commandName: string,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!state.sshClient) {
        return reject(new Error('SSH client is not available.'));
      }
      const checkCommands = [`command -v ${commandName}`, `which ${commandName}`];
      let currentCheckIndex = 0;

      const tryCommand = () => {
        if (currentCheckIndex >= checkCommands.length) {
          resolve(false);
          return;
        }
        const checkCmd = checkCommands[currentCheckIndex];
        state.sshClient.exec(checkCmd, (err, stream) => {
          if (err) {
            currentCheckIndex++;
            tryCommand();
            return;
          }
          let output = '';
          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });
          stream.on('close', (code: number | null) => {
            if (code === 0 && output.trim() !== '') {
              resolve(true);
            } else {
              currentCheckIndex++;
              tryCommand();
            }
          });
          stream.on('error', () => {
            currentCheckIndex++;
            tryCommand();
          });
        });
      };
      tryCommand();
    });
  }

  /** 发送压缩错误消息 */
  private sendCompressError(
    ws: AuthenticatedWebSocket | undefined,
    error: string,
    requestId: string,
    details?: string,
    sessionId?: string,
  ): void {
    const payload: SftpCompressErrorPayload = { error, requestId };
    if (details) payload.details = details;
    if (error.includes('在服务器上未找到')) {
      sendWsMessage(
        ws,
        'sftp:command_not_found',
        {
          operation: 'compress',
          command: error.match(/'([^']+)'/)?.[1] || 'unknown',
          message: details || error,
        },
        sessionId,
        { requestId },
      );
    } else {
      sendWsMessage(ws, 'sftp:compress:error', payload, sessionId, { requestId });
    }
  }

  /** 发送解压错误消息 */
  private sendDecompressError(
    ws: AuthenticatedWebSocket | undefined,
    error: string,
    requestId: string,
    details?: string,
    sessionId?: string,
  ): void {
    const payload: SftpDecompressErrorPayload = { error, requestId };
    if (details) payload.details = details;
    if (error.includes('在服务器上未找到')) {
      sendWsMessage(
        ws,
        'sftp:command_not_found',
        {
          operation: 'decompress',
          command: error.match(/'([^']+)'/)?.[1] || 'unknown',
          message: details || error,
        },
        sessionId,
        { requestId },
      );
    } else {
      sendWsMessage(ws, 'sftp:decompress:error', payload, sessionId, { requestId });
    }
  }

  /**
   * 解析 tar/zip/unzip 的 stderr 输出，提取文件名
   * tar -v 输出格式: "file.txt" 或 "dir/file.txt"
   * zip -r 输出格式: "adding: file.txt" 或 "  adding: dir/"
   * unzip 输出格式: "inflating: file.txt" 或 " extracting: dir/"
   *
   * 注意：使用 match() 返回数组，避免 RegExp.$1/$2 全局状态污染。
   */
  private parseArchiveFileName(
    line: string,
    format: 'zip' | 'targz' | 'tarbz2' | 'decompress',
  ): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // zip 输出：以 "adding:" 开头
    if (format === 'zip') {
      const m = trimmed.match(/^adding:\s+(.+?)(?:\s+\(.*\))?$/i);
      if (m && m[1]) return m[1].trim();
    }

    // unzip 输出：以 "inflating:" 或 "extracting:" 或 "creating:" 开头
    if (format === 'decompress') {
      const m = trimmed.match(/^(inflating|extracting|creating):\s+(.+)/i);
      if (m && m[2]) return m[2].trim();
    }

    // tar -v 输出：整行就是一个文件名
    // 需要过滤掉 tar 的警告/错误信息（如 "tar: ..." 前缀），避免虚假进度
    if (format === 'targz' || format === 'tarbz2') {
      // 排除以 "tar:" / "tar (" / 大写字母+冒号 开头的诊断信息
      if (
        trimmed &&
        !trimmed.startsWith('/') &&
        !/^tar(\s|:|\()/i.test(trimmed) &&
        trimmed.length < 1024 &&
        // 排除明显的错误提示（包含 ":"+空格 后跟英文短语）
        !/^[A-Za-z]+:\s/.test(trimmed)
      ) {
        return trimmed;
      }
    }

    return null;
  }

  /**
   * 发送归档操作进度消息到前端
   * 前端收到进度消息后会重置超时计时器
   */
  private sendProgress(
    ws: AuthenticatedWebSocket | undefined,
    operation: 'compress' | 'decompress',
    requestId: string,
    fileCount: number,
    currentFile?: string,
    sessionId?: string,
  ): void {
    const progressPayload: SftpArchiveProgressPayload = {
      requestId,
      fileCount,
      currentFile,
    };
    sendWsMessage(ws, `sftp:${operation}:progress`, progressPayload, sessionId, { requestId });
  }

  /** 检查 stderr 是否包含错误 */
  private isErrorInStdErr(stderr: string): boolean {
    if (!stderr || stderr.trim().length === 0) {
      return false;
    }
    const lowerStderr = stderr.toLowerCase();
    const errorPatterns = [
      'error',
      'fail',
      'cannot',
      'not found',
      'no such file',
      'permission denied',
      'invalid',
      '不支持',
    ];
    if (
      /[\d.]+%/.test(stderr) ||
      /adding:/.test(lowerStderr) ||
      /inflating:/.test(lowerStderr) ||
      /extracting:/.test(lowerStderr)
    ) {
      if (errorPatterns.some((pattern) => lowerStderr.includes(pattern))) {
        return true;
      }
      return false;
    }
    return errorPatterns.some((pattern) => lowerStderr.includes(pattern));
  }
}
