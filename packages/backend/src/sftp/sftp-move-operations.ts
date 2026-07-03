import type { SFTPWrapper } from 'ssh2';

import * as pathModule from 'path';

import type { ClientState } from '../websocket/types';

import { getErrorMessage } from '../utils/AppError';

import { getErrorCode } from './sftp-error.utils';

import { ensureDirectoryExists, formatStatsToFileListItem, getStats } from './sftp-copy-operations';

import type { FileListItem } from './sftp-utils';

import { logger } from '../utils/logger';
import { sendWsMessage } from '../websocket/utils';

const performRename = (sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const ensureMoveTargetNotExists = async (
  sftp: SFTPWrapper,
  targetPath: string,
): Promise<boolean> => {
  try {
    await getStats(sftp, targetPath);

    return true;
  } catch (statErr: unknown) {
    const statErrCode = getErrorCode(statErr);

    const statErrMsg = getErrorMessage(statErr);

    if (statErrCode === 'ENOENT' || statErrMsg.includes('No such file')) {
      return false;
    }

    throw new Error(`检查目标路径 ${targetPath} 状态时出错: ${statErrMsg}`);
  }
};

const moveSingleItem = async (
  sftp: SFTPWrapper,
  oldPath: string,
  destinationDir: string,
  sessionId: string,
  requestId: string,
): Promise<FileListItem | null> => {
  const sourceName = pathModule.basename(oldPath);

  const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/');

  if (oldPath === newPath) {
    logger.warn(
      `[SFTP ${sessionId}] Skipping move: source and destination are the same (${oldPath}) (ID: ${requestId})`,
    );

    return null;
  }

  const targetExists = await ensureMoveTargetNotExists(sftp, newPath);

  if (targetExists) {
    logger.error(
      `[SFTP ${sessionId}] Move failed: Target path ${newPath} already exists (ID: ${requestId})`,
    );

    throw new Error(`目标路径 ${pathModule.basename(newPath)} 已存在`);
  }

  logger.debug(`[SFTP ${sessionId}] Moving ${oldPath} to ${newPath} (ID: ${requestId})`);

  await performRename(sftp, oldPath, newPath);

  const movedStats = await getStats(sftp, newPath);

  return formatStatsToFileListItem(newPath, movedStats);
};

export const executeMoveOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  sources: string[],
  destinationDir: string,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP Move] SFTP 未准备好，无法在 ${sessionId} 上执行 move (ID: ${requestId})`);

    sendWsMessage(state?.ws, 'sftp:move:error', 'SFTP 会话未就绪', sessionId, { requestId });

    return;
  }

  const { sftp } = state;
  logger.debug(
    `[SFTP ${sessionId}] Received move request (ID: ${requestId}) Sources: ${sources.join(', ')}, Dest: ${destinationDir}`,
  );

  const movedItemsDetails: FileListItem[] = [];
  let firstError: Error | null = null;
  try {
    try {
      await ensureDirectoryExists(sftp, destinationDir);
    } catch (ensureErr: unknown) {
      logger.error(
        `[SFTP ${sessionId}] Failed to ensure destination directory ${destinationDir} exists for move (ID: ${requestId}):`,
        ensureErr,
      );

      throw new Error(`无法创建或访问目标目录: ${getErrorMessage(ensureErr)}`);
    }

    for (const oldPath of sources) {
      try {
        const movedItem = await moveSingleItem(sftp, oldPath, destinationDir, sessionId, requestId);

        if (movedItem) {
          movedItemsDetails.push(movedItem);
        }
      } catch (moveErr: unknown) {
        const sourceName = pathModule.basename(oldPath);

        const newPath = pathModule.join(destinationDir, sourceName).replace(/\\/g, '/');

        logger.error(
          `[SFTP ${sessionId}] Error moving ${oldPath} to ${newPath} (ID: ${requestId}):`,
          moveErr,
        );

        firstError = moveErr instanceof Error ? moveErr : new Error(getErrorMessage(moveErr));

        break;
      }
    }

    if (firstError) {
      throw firstError;
    }

    logger.info(
      `[SFTP ${sessionId}] Move operation completed successfully (ID: ${requestId}). Moved items: ${movedItemsDetails.length}`,
    );

    sendWsMessage(
      state.ws,
      'sftp:move:success',
      { sources, destination: destinationDir, items: movedItemsDetails },
      sessionId,
      { requestId },
    );
  } catch (error: unknown) {
    logger.error(`[SFTP ${sessionId}] Move operation failed (ID: ${requestId}):`, error);

    sendWsMessage(
      state.ws,
      'sftp:move:error',
      `移动操作失败: ${getErrorMessage(error)}`,
      sessionId,
      { requestId },
    );
  }
};
