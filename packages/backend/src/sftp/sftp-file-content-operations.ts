import { Stats } from 'ssh2';

import * as iconv from 'iconv-lite';

import type { ClientState } from '../websocket/types';

import { getErrorMessage } from '../utils/AppError';

import { detectAndDecodeSftpFileContent } from './sftp-encoding.utils';

import { logger } from '../utils/logger';
import { sendWsMessage } from '../websocket/utils';

interface FileItemPayload {
  filename: string;
  longname: string;
  attrs: {
    size: number;
    uid: number;
    gid: number;
    mode: number;
    atime: number;
    mtime: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
  };
}

const toFileItemPayload = (path: string, stats: Stats): FileItemPayload => {
  return {
    filename: path.substring(path.lastIndexOf('/') + 1),
    longname: '',
    attrs: {
      size: stats.size,
      uid: stats.uid,
      gid: stats.gid,
      mode: stats.mode,
      atime: stats.atime * 1000,
      mtime: stats.mtime * 1000,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      isSymbolicLink: stats.isSymbolicLink(),
    },
  };
};

export const executeReadFileContentOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
  requestedEncoding?: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readFile (ID: ${requestId})`);

    sendWsMessage(state?.ws, 'sftp:readfile:error', 'SFTP 会话未就绪', sessionId, {
      path,
      requestId,
    });

    return;
  }

  const { sftp } = state;
  logger.debug(
    `[SFTP ${sessionId}] Received readFile request for ${path} (ID: ${requestId}, Requested Encoding: ${requestedEncoding ?? 'auto'})`,
  );

  try {
    const readStream = sftp.createReadStream(path);

    let fileData = Buffer.alloc(0);

    let errorOccurred = false;
    readStream.on('data', (chunk: Buffer) => {
      fileData = Buffer.concat([fileData, chunk]);
    });

    readStream.on('error', (err: Error) => {
      if (errorOccurred) {
        return;
      }

      errorOccurred = true;
      logger.error(`[SFTP ${sessionId}] readFile ${path} stream error (ID: ${requestId}):`, err);

      sendWsMessage(state.ws, 'sftp:readfile:error', `读取文件流错误: ${err.message}`, sessionId, {
        path,
        requestId,
      });
    });

    readStream.on('end', () => {
      if (errorOccurred) {
        return;
      }

      logger.debug(
        `[SFTP ${sessionId}] readFile ${path} success, size: ${fileData.length} bytes (ID: ${requestId}). Processing content...`,
      );

      // SFTP 下载字节指标（延迟导入避免循环依赖）
      try {
        const { sftpTransferredBytes } = require('../metrics/metrics.service');

        sftpTransferredBytes.inc({ direction: 'download' }, fileData.length);
      } catch (err) {
        logger.warn(`[SFTP ${sessionId}] 指标模块加载失败，下载字节未记录:`, err);
      }

      let encodingUsed = 'utf-8';
      try {
        const decodeResult = detectAndDecodeSftpFileContent({
          fileData,
          requestedEncoding,
          sessionId,
          remotePath: path,
          requestId,
        });

        encodingUsed = decodeResult.encodingUsed;
        logger.debug(
          `[SFTP ${sessionId}] Content decoding completed with encoding ${encodingUsed} (ID: ${requestId}).`,
        );
      } catch (decodeError: unknown) {
        logger.error(
          `[SFTP ${sessionId}] Error detecting/decoding file content for ${path} (ID: ${requestId}):`,
          decodeError,
        );

        sendWsMessage(
          state.ws,
          'sftp:readfile:error',
          `文件编码检测或转换失败: ${getErrorMessage(decodeError)}`,
          sessionId,
          { path, requestId },
        );

        return;
      }

      sendWsMessage(
        state.ws,
        'sftp:readfile:success',
        {
          rawContentBase64: fileData.toString('base64'),
          encodingUsed,
        },
        sessionId,
        { path, requestId },
      );
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] readFile ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );

    sendWsMessage(
      state.ws,
      'sftp:readfile:error',
      `读取文件时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path, requestId },
    );
  }
};

export const executeWriteFileContentOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  data: string,
  requestId: string,
  encoding?: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 writefile (ID: ${requestId})`);

    sendWsMessage(state?.ws, 'sftp:writefile:error', 'SFTP 会话未就绪', sessionId, {
      path,
      requestId,
    });

    return;
  }

  const { sftp } = state;

  const targetEncoding = encoding || 'utf-8';
  logger.debug(
    `[SFTP ${sessionId}] Received writefile request for ${path} (ID: ${requestId}, Encoding: ${targetEncoding})`,
  );

  try {
    let buffer: Buffer;
    try {
      buffer = iconv.encode(data, targetEncoding);

      logger.debug(
        `[SFTP ${sessionId}] Encoded content for ${path} using ${targetEncoding} (Buffer size: ${buffer.length})`,
      );
    } catch (encodeError: unknown) {
      logger.error(
        `[SFTP ${sessionId}] Failed to encode content for ${path} with encoding ${targetEncoding} (ID: ${requestId}):`,
        encodeError,
      );

      sendWsMessage(
        state.ws,
        'sftp:writefile:error',
        `无效的编码或编码失败: ${targetEncoding}`,
        sessionId,
        { path, requestId },
      );

      return;
    }

    let originalMode: number | undefined;
    try {
      const fileStats = await new Promise<Stats>((resolve, reject) => {
        sftp.lstat(path, (err, lstatStats) => {
          if (err) {
            reject(err);

            return;
          }

          resolve(lstatStats);
        });
      });

      originalMode = fileStats.mode;
      logger.debug(
        `[SFTP ${sessionId}] Retrieved original file mode for ${path}: ${originalMode.toString(8)} (ID: ${requestId})`,
      );
    } catch (statError: unknown) {
      logger.warn(
        `[SFTP ${sessionId}] Could not retrieve original file mode for ${path} (ID: ${requestId}):`,
        statError,
      );
    }

    const writeStreamOptions = originalMode !== undefined ? { mode: originalMode } : {};

    const writeStream = sftp.createWriteStream(path, writeStreamOptions);

    let errorOccurred = false;
    writeStream.on('error', (err: Error) => {
      if (errorOccurred) {
        return;
      }

      errorOccurred = true;
      logger.error(`[SFTP ${sessionId}] writefile ${path} stream error (ID: ${requestId}):`, err);

      sendWsMessage(state.ws, 'sftp:writefile:error', `写入文件流错误: ${err.message}`, sessionId, {
        path,
        requestId,
      });
    });

    writeStream.on('close', () => {
      if (errorOccurred) {
        return;
      }

      if (originalMode !== undefined) {
        logger.debug(
          `[SFTP ${sessionId}] Set file mode for ${path} during creation: ${originalMode.toString(8)} (ID: ${requestId})`,
        );
      }

      sftp.lstat(path, (statErr, stats) => {
        if (statErr) {
          logger.error(
            `[SFTP ${sessionId}] lstat after writefile ${path} failed (ID: ${requestId}):`,
            statErr,
          );

          sendWsMessage(state.ws, 'sftp:writefile:success', null, sessionId, { path, requestId });

          return;
        }

        sendWsMessage(
          state.ws,
          'sftp:writefile:success',
          toFileItemPayload(path, stats),
          sessionId,
          { path, requestId },
        );
      });
    });

    logger.debug(
      `[SFTP ${sessionId}] Writing ${buffer.length} bytes to ${path} (ID: ${requestId})`,
    );

    writeStream.end(buffer);

    logger.debug(`[SFTP ${sessionId}] writefile ${path} end() called (ID: ${requestId})`);
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] writefile ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );

    sendWsMessage(
      state.ws,
      'sftp:writefile:error',
      `写入文件时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path, requestId },
    );
  }
};
