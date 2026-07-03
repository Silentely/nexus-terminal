import type { Stats } from 'ssh2';

import type { ClientState } from '../websocket/types';

import { getErrorMessage } from '../utils/AppError';

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

const toPathItemPayload = (path: string, stats: Stats): PathItemPayload => {
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

export const executeStatPathQueryOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 stat (ID: ${requestId})`);

    sendWsMessage(state?.ws, 'sftp:stat:error', 'SFTP 会话未就绪', sessionId, { path, requestId });

    return;
  }

  logger.debug(`[SFTP ${sessionId}] Received stat request for ${path} (ID: ${requestId})`);

  try {
    state.sftp.lstat(path, (err, stats: Stats) => {
      if (err) {
        logger.error(`[SFTP ${sessionId}] stat ${path} failed (ID: ${requestId}):`, err);

        sendWsMessage(state.ws, 'sftp:stat:error', `获取状态失败: ${err.message}`, sessionId, {
          path,
          requestId,
        });

        return;
      }

      const fileStats = {
        size: stats.size,
        uid: stats.uid,
        gid: stats.gid,
        mode: stats.mode,
        atime: stats.atime * 1000,
        mtime: stats.mtime * 1000,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        isSymbolicLink: stats.isSymbolicLink(),
      };
      sendWsMessage(state.ws, 'sftp:stat:success', fileStats, sessionId, { path, requestId });
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] stat ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );

    sendWsMessage(
      state.ws,
      'sftp:stat:error',
      `获取状态时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path, requestId },
    );
  }
};

export const executeChmodPathQueryOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  mode: number,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 chmod (ID: ${requestId})`);

    sendWsMessage(state?.ws, 'sftp:chmod:error', 'SFTP 会话未就绪', sessionId, { path, requestId });

    return;
  }

  const { sftp } = state;
  logger.debug(
    `[SFTP ${sessionId}] Received chmod request for ${path} to ${mode.toString(8)} (ID: ${requestId})`,
  );

  try {
    sftp.chmod(path, mode, (err) => {
      if (err) {
        logger.error(
          `[SFTP ${sessionId}] chmod ${path} to ${mode.toString(8)} failed (ID: ${requestId}):`,
          err,
        );

        sendWsMessage(state.ws, 'sftp:chmod:error', `修改权限失败: ${err.message}`, sessionId, {
          path,
          requestId,
        });

        return;
      }

      sftp.lstat(path, (statErr, stats) => {
        if (statErr) {
          logger.error(
            `[SFTP ${sessionId}] lstat after chmod ${path} failed (ID: ${requestId}):`,
            statErr,
          );

          sendWsMessage(state.ws, 'sftp:chmod:success', null, sessionId, { path, requestId });

          return;
        }

        sendWsMessage(state.ws, 'sftp:chmod:success', toPathItemPayload(path, stats), sessionId, {
          requestId,
        });
      });
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] chmod ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );

    sendWsMessage(
      state.ws,
      'sftp:chmod:error',
      `修改权限时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path, requestId },
    );
  }
};

export const executeRealpathPathQueryOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
  resolveCurrentState: () => ClientState | undefined,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 realpath (ID: ${requestId})`);

    sendWsMessage(state?.ws, 'sftp:realpath:error', 'SFTP 会话未就绪', sessionId, {
      path,
      requestId,
    });

    return;
  }

  logger.debug(`[SFTP ${sessionId}] Received realpath request for ${path} (ID: ${requestId})`);

  try {
    state.sftp.realpath(path, (err, absPath) => {
      if (err) {
        logger.error(`[SFTP ${sessionId}] realpath ${path} failed (ID: ${requestId}):`, err);

        sendWsMessage(
          state.ws,
          'sftp:realpath:error',
          { requestedPath: path, error: `获取绝对路径失败: ${err.message}` },
          sessionId,
          { requestId },
        );

        return;
      }

      const currentState = resolveCurrentState();

      if (!currentState || !currentState.sftp) {
        logger.warn(
          `[SFTP ${sessionId}] SFTP session for ${absPath} became invalid before stat call (ID: ${requestId}).`,
        );

        sendWsMessage(
          state.ws,
          'sftp:realpath:error',
          {
            requestedPath: path,
            absolutePath: absPath,
            error: 'SFTP 会话在获取目标类型前已失效',
          },
          sessionId,
          { requestId },
        );

        return;
      }

      currentState.sftp.stat(absPath, (statErr, stats) => {
        if (statErr) {
          logger.error(
            `[SFTP ${sessionId}] stat on realpath target ${absPath} failed (ID: ${requestId}):`,
            statErr,
          );

          sendWsMessage(
            state.ws,
            'sftp:realpath:error',
            {
              requestedPath: path,
              absolutePath: absPath,
              error: `获取目标类型失败: ${statErr.message}`,
            },
            sessionId,
            { requestId },
          );

          return;
        }

        let targetType: 'file' | 'directory' | 'unknown' = 'unknown';
        if (stats.isFile()) {
          targetType = 'file';
        } else if (stats.isDirectory()) {
          targetType = 'directory';
        }

        sendWsMessage(
          state.ws,
          'sftp:realpath:success',
          {
            requestedPath: path,
            absolutePath: absPath,
            targetType,
          },
          sessionId,
          { requestId },
        );
      });
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] realpath ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );

    sendWsMessage(
      state.ws,
      'sftp:realpath:error',
      `获取绝对路径时发生意外错误: ${getErrorMessage(error)}`,
      sessionId,
      { path, requestId },
    );
  }
};
