import { Stats } from 'ssh2';
import type { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import { shellEscape } from '../utils/shell-escape';
import { logger } from '../utils/logger';
import { sendWsMessage } from '../websocket/utils';

interface PathItemPayload {
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

const getFilenameFromPath = (path: string): string => {
  return path.substring(path.lastIndexOf('/') + 1);
};

const toPathItemPayload = (path: string, stats: Stats): PathItemPayload => {
  return {
    filename: getFilenameFromPath(path),
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

export const executeMkdirPathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 mkdir (ID: ${requestId})`);
    sendWsMessage(state?.ws, 'sftp:mkdir:error', 'SFTP 会话未就绪', sessionId, {
      path: path,
      requestId: requestId,
    });
    return;
  }

  const { sftp } = state;
  logger.debug(`[SFTP ${sessionId}] Received mkdir request for ${path} (ID: ${requestId})`);
  try {
    sftp.mkdir(path, (err) => {
      if (err) {
        logger.error(`[SFTP ${sessionId}] mkdir ${path} failed (ID: ${requestId}):`, err);
        sendWsMessage(state.ws, 'sftp:mkdir:error', `创建目录失败: ${err.message}`, sessionId, {
          path: path,
          requestId: requestId,
        });
        return;
      }

      logger.debug(
        `[SFTP ${sessionId}] mkdir ${path} success (ID: ${requestId}). Fetching stats...`,
      );
      sftp.lstat(path, (statErr, stats) => {
        if (statErr) {
          logger.error(
            `[SFTP ${sessionId}] lstat after mkdir ${path} failed (ID: ${requestId}):`,
            statErr,
          );
          sendWsMessage(state.ws, 'sftp:mkdir:success', null, sessionId, {
            path: path,
            requestId: requestId,
          });
          return;
        }

        sendWsMessage(state.ws, 'sftp:mkdir:success', toPathItemPayload(path, stats), sessionId, {
          path,
          requestId,
        });
      });
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] mkdir ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );
    sendWsMessage(
      state.ws,
      'sftp:mkdir:error',
      `创建目录时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path: path, requestId: requestId },
    );
  }
};

export const executeRmdirPathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sshClient) {
    logger.warn(
      `[SSH Exec] SSH 客户端未准备好，无法在 ${sessionId} 上执行 rmdir (ID: ${requestId})`,
    );
    sendWsMessage(state?.ws, 'sftp:rmdir:error', 'SSH 会话未就绪', sessionId, {
      path: path,
      requestId: requestId,
    });
    return;
  }

  logger.debug(`[SSH Exec ${sessionId}] Received rmdir request for ${path} (ID: ${requestId})`);
  const command = `rm -rf ${shellEscape(path)}`;

  logger.debug(`[SSH Exec ${sessionId}] 尝试使用 rm -rf 命令删除 ${path} (ID: ${requestId})`);
  logger.debug(`[SSH Exec ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        logger.error(
          `[SSH Exec ${sessionId}] Failed to start exec for rm -rf ${path} (ID: ${requestId}):`,
          err,
        );
        sendWsMessage(
          state.ws,
          'sftp:rmdir:error',
          `删除目录失败: rm -rf 命令执行失败: ${err.message}`,
          sessionId,
          { path: path, requestId: requestId },
        );
        return;
      }

      let stderrOutput = '';
      stream.stderr.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });

      stream.on('close', (code: number | null, signal: string | null) => {
        if (code === 0) {
          logger.debug(
            `[SSH Exec ${sessionId}] rm -rf ${path} command executed successfully (ID: ${requestId})`,
          );
          sendWsMessage(state.ws, 'sftp:rmdir:success', undefined, sessionId, { path: path });
          return;
        }

        const errorMessage =
          stderrOutput.trim() ||
          `命令退出，代码: ${code ?? 'N/A'}${signal ? `, 信号: ${signal}` : ''}`;
        logger.error(
          `[SSH Exec ${sessionId}] rm -rf ${path} command failed (ID: ${requestId}). Code: ${code}, Signal: ${signal}, Stderr: ${errorMessage}`,
        );
        sendWsMessage(state.ws, 'sftp:rmdir:error', `删除目录失败: ${errorMessage}`, sessionId, {
          path: path,
          requestId: requestId,
        });
      });

      stream.on('data', (data: Buffer) => {
        logger.debug(
          `[SSH Exec ${sessionId}] rm -rf stdout (ID: ${requestId}): ${data.toString()}`,
        );
      });
    });
  } catch (error: unknown) {
    logger.error(
      `[SSH Exec ${sessionId}] rm -rf ${path} caught unexpected error during exec setup (ID: ${requestId}):`,
      error,
    );
    sendWsMessage(
      state.ws,
      'sftp:rmdir:error',
      `删除目录失败: rm -rf 执行时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path: path, requestId: requestId },
    );
  }
};

export const executeUnlinkPathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 unlink (ID: ${requestId})`);
    sendWsMessage(state?.ws, 'sftp:unlink:error', 'SFTP 会话未就绪', sessionId, {
      path: path,
      requestId: requestId,
    });
    return;
  }

  logger.debug(`[SFTP ${sessionId}] Received unlink request for ${path} (ID: ${requestId})`);
  try {
    state.sftp.unlink(path, (err) => {
      if (err) {
        logger.error(`[SFTP ${sessionId}] unlink ${path} failed (ID: ${requestId}):`, err);
        sendWsMessage(state.ws, 'sftp:unlink:error', `删除文件失败: ${err.message}`, sessionId, {
          path: path,
          requestId: requestId,
        });
        return;
      }

      logger.debug(`[SFTP ${sessionId}] unlink ${path} success (ID: ${requestId})`);
      sendWsMessage(state.ws, 'sftp:unlink:success', undefined, sessionId, { path: path });
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] unlink ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );
    sendWsMessage(
      state.ws,
      'sftp:unlink:error',
      `删除文件时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path: path, requestId: requestId },
    );
  }
};

export const executeRenamePathOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  oldPath: string,
  newPath: string,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 rename (ID: ${requestId})`);
    sendWsMessage(state?.ws, 'sftp:rename:error', 'SFTP 会话未就绪', sessionId, {
      requestId: requestId,
      oldPath: oldPath,
      newPath: newPath,
    });
    return;
  }

  const { sftp } = state;
  logger.debug(
    `[SFTP ${sessionId}] Received rename request ${oldPath} -> ${newPath} (ID: ${requestId})`,
  );
  try {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) {
        logger.error(
          `[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} failed (ID: ${requestId}):`,
          err,
        );
        sendWsMessage(state.ws, 'sftp:rename:error', `重命名/移动失败: ${err.message}`, sessionId, {
          requestId: requestId,
          oldPath: oldPath,
          newPath: newPath,
        });
        return;
      }

      logger.debug(
        `[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} success (ID: ${requestId}). Fetching stats for new path...`,
      );
      sftp.lstat(newPath, (statErr, stats) => {
        if (statErr) {
          logger.error(
            `[SFTP ${sessionId}] lstat after rename ${newPath} failed (ID: ${requestId}):`,
            statErr,
          );
          sendWsMessage(
            state.ws,
            'sftp:rename:success',
            { oldPath, newPath, newItem: null },
            sessionId,
            { requestId: requestId },
          );
          return;
        }

        sendWsMessage(
          state.ws,
          'sftp:rename:success',
          { oldPath, newPath, newItem: toPathItemPayload(newPath, stats) },
          sessionId,
          { requestId: requestId },
        );
      });
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] rename ${oldPath} -> ${newPath} caught unexpected error (ID: ${requestId}):`,
      error,
    );
    sendWsMessage(
      state.ws,
      'sftp:rename:error',
      `重命名/移动时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { requestId: requestId, oldPath: oldPath, newPath: newPath },
    );
  }
};
