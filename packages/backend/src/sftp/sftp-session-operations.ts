import type { SFTPWrapper } from 'ssh2';

import type { ClientState } from '../websocket/types';

import { logger } from '../utils/logger';

import { sendWsMessage } from '../websocket/utils';

import eventService, { AppEventType } from '../services/event.service';

export const executeInitializeSftpSessionOperation = async (
  state: ClientState | undefined,
  sessionId: string,
): Promise<void> => {
  if (!state || !state.sshClient || state.sftp) {
    logger.warn(
      `[SFTP] 无法为会话 ${sessionId} 初始化 SFTP：状态无效、SSH客户端不存在或 SFTP 已初始化。`,
    );

    return;
  }

  if (!state.sshClient) {
    logger.error(`[SFTP] 会话 ${sessionId} 的 SSH 客户端不存在，无法初始化 SFTP。`);

    return;
  }

  return new Promise((resolve, reject) => {
    state.sshClient.sftp((err: Error | undefined, sftpInstance: SFTPWrapper) => {
      if (err) {
        logger.error(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话失败:`, err);

        sendWsMessage(
          state.ws,
          'sftp_error',
          { connectionId: state.dbConnectionId, message: 'SFTP 初始化失败' },
          sessionId,
        );

        eventService.emitEvent(AppEventType.SftpConnectFailure, {
          details: {
            sessionId,
            reason: 'SFTP 初始化失败',
            connectionId: state.dbConnectionId,
            userId: state.ws.userId,
            ipAddress: state.ipAddress,
          },
        });

        reject(err);

        return;
      }

      logger.info(`[SFTP] 为会话 ${sessionId} 初始化 SFTP 会话成功。`);

      state.sftp = sftpInstance;
      sendWsMessage(state.ws, 'sftp_ready', { connectionId: state.dbConnectionId }, sessionId);

      eventService.emitEvent(AppEventType.SftpConnectSuccess, {
        details: {
          sessionId,
          connectionId: state.dbConnectionId,
          userId: state.ws.userId,
          ipAddress: state.ipAddress,
        },
      });

      sftpInstance.on('end', () => {
        logger.info(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已结束。`);

        state.sftp = undefined;
      });

      sftpInstance.on('close', () => {
        logger.info(`[SFTP] 会话 ${sessionId} 的 SFTP 会话已关闭。`);

        state.sftp = undefined;
      });

      sftpInstance.on('error', (sftpErr: Error) => {
        logger.error(`[SFTP] 会话 ${sessionId} 的 SFTP 会话出错:`, sftpErr);

        state.sftp = undefined;
        sendWsMessage(
          state.ws,
          'sftp_error',
          { connectionId: state.dbConnectionId, message: 'SFTP 会话错误' },
          sessionId,
        );
      });

      resolve();
    });
  });
};

export const executeCleanupSftpSessionOperation = (
  state: ClientState | undefined,
  sessionId: string,
): void => {
  if (state?.sftp) {
    logger.debug(`[SFTP] 正在清理 ${sessionId} 的 SFTP 会话...`);

    state.sftp.end();

    state.sftp = undefined;
  }
};
