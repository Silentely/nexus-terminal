import { PortInfo, AuthenticatedWebSocket } from './types';
import {
  auditLogService,
  clientStates,
  sftpService,
  statusMonitorService,
  settingsService,
} from './state';
import WebSocket from 'ws';
import { sshSuspendService } from '../ssh-suspend/ssh-suspend.service';
import { lookupGeoInfo } from '../auth/ip-geo.service';
import { logger } from '../utils/logger';
import eventService, { AppEventType } from '../services/event.service';

/**
 * 统一 WebSocket 消息发送 helper
 * 自动注入 sid 字段，确保多路复用模式下前端能正确路由响应
 *
 * @param ws WebSocket 连接
 * @param type 消息类型
 * @param payload 消息负载
 * @param sessionId 会话 ID（作为顶层 sid）
 */
export function sendWsMessage(
  ws: AuthenticatedWebSocket,
  type: string,
  payload: unknown,
  sessionId?: string,
): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const message: Record<string, unknown> = { type, payload };
  if (sessionId) message.sid = sessionId;
  ws.send(JSON.stringify(message));
}

/**
 * 安全发送 WebSocket 消息（自动检查连接状态）
 * 消除各处重复的 readyState 检查
 */
export function safeSend(
  ws: AuthenticatedWebSocket,
  type: string,
  payload: unknown,
  sessionId?: string,
): boolean {
  if (ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    const message: Record<string, unknown> = { type, payload };
    if (sessionId) message.sid = sessionId;
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    // 发送失败（连接已关闭等），静默处理
    return false;
  }
}

// H-19: 会话级清理回调注册表，避免模块间循环依赖
type SessionCleanupCallback = (sessionId: string) => void;
const sessionCleanupCallbacks = new Set<SessionCleanupCallback>();

export const registerSessionCleanup = (callback: SessionCleanupCallback): void => {
  sessionCleanupCallbacks.add(callback);
};

const SSH_SUSPEND_KEEP_ALIVE_SECONDS_KEY = 'sshSuspendKeepAliveSeconds';
const DEFAULT_SSH_SUSPEND_KEEP_ALIVE_SECONDS = 0;

const parseSshSuspendKeepAliveSeconds = (raw: string | null): number => {
  if (raw === null) {
    return DEFAULT_SSH_SUSPEND_KEEP_ALIVE_SECONDS;
  }
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_SSH_SUSPEND_KEEP_ALIVE_SECONDS;
  }
  return parsed;
};

const getSshSuspendKeepAliveSecondsFromSettings = async (): Promise<number> => {
  try {
    const rawSetting = await settingsService.getSetting(SSH_SUSPEND_KEEP_ALIVE_SECONDS_KEY);
    return parseSshSuspendKeepAliveSeconds(rawSetting);
  } catch (error: unknown) {
    logger.warn(
      `[WebSocket] 读取 ${SSH_SUSPEND_KEEP_ALIVE_SECONDS_KEY} 失败，将使用默认值 ${DEFAULT_SSH_SUSPEND_KEEP_ALIVE_SECONDS}:`,
      error,
    );
    return DEFAULT_SSH_SUSPEND_KEEP_ALIVE_SECONDS;
  }
};

// --- 解析 Ports 字符串的辅助函数 ---
export function parsePortsString(portsString: string | undefined | null): PortInfo[] {
  if (!portsString) {
    return [];
  }
  const ports: PortInfo[] = [];
  const entries = portsString.split(', ');

  for (const entry of entries) {
    const parts = entry.split('->');
    let publicPart = '';
    let privatePart = '';

    if (parts.length === 2) {
      publicPart = parts[0];
      privatePart = parts[1];
    } else if (parts.length === 1) {
      privatePart = parts[0];
    } else {
      logger.warn(`[WebSocket] Skipping unparsable port entry: ${entry}`);
      continue;
    }

    const privateMatch = privatePart.match(/^(\d+)\/(tcp|udp|\w+)$/);
    if (!privateMatch) {
      //  logger.warn(`[WebSocket] Skipping unparsable private port part: ${privatePart}`);
      continue;
    }
    const privatePort = parseInt(privateMatch[1], 10);
    const type = privateMatch[2];

    let ip: string | undefined;
    let publicPort: number | undefined;

    if (publicPart) {
      const publicMatch = publicPart.match(/^(?:([\d.:a-fA-F]+):)?(\d+)$/);
      if (publicMatch) {
        ip = publicMatch[1] || undefined;
        publicPort = parseInt(publicMatch[2], 10);
      } else {
        //   logger.warn(`[WebSocket] Skipping unparsable public port part: ${publicPart}`);
      }
    }

    if (!Number.isNaN(privatePort)) {
      ports.push({
        IP: ip,
        PrivatePort: privatePort,
        PublicPort: publicPort,
        Type: type,
      });
    }
  }
  return ports;
}

/**
 * 清理指定会话 ID 关联的所有资源
 * @param sessionId - 会话 ID
 */
export const cleanupClientConnection = async (sessionId: string | undefined) => {
  // Made async
  if (!sessionId) return;

  const state = clientStates.get(sessionId);
  if (state) {
    logger.debug(
      `WebSocket: 清理会话 ${sessionId} (用户: ${state.ws.username}, DB 连接 ID: ${state.dbConnectionId})...`,
    );
    const nowSeconds = Math.floor(Date.now() / 1000);
    const durationSeconds =
      typeof state.connectedAt === 'number' && state.connectedAt > 0
        ? Math.max(0, nowSeconds - state.connectedAt)
        : undefined;

    // 1. 停止状态轮询 (如果存在)
    if (statusMonitorService) statusMonitorService.stopStatusPolling(sessionId);

    // 2. 清理 SFTP 会话 (如果存在)
    if (sftpService) sftpService.cleanupSftpSession(sessionId);

    // 3. 处理 SSH 连接 (核心修改点)
    if (
      state.isMarkedForSuspend &&
      state.sshClient &&
      state.sshShellStream &&
      state.suspendLogPath &&
      state.ws.userId !== undefined
    ) {
      logger.debug(
        `WebSocket: 会话 ${sessionId} 已被标记为待挂起，尝试移交给 SshSuspendService...`,
      );
      try {
        // H-16: CAS 模式 - await 前原子清除标志，防止双重清理竞态
        state.isMarkedForSuspend = false;
        const keepAliveSeconds = await getSshSuspendKeepAliveSecondsFromSettings();
        const takeoverDetails = {
          userId: state.ws.userId,
          originalSessionId: sessionId, // sessionId 是原始活动会话的ID
          sshClient: state.sshClient,
          channel: state.sshShellStream,
          connectionName: state.connectionName || '未知连接',
          connectionId: String(state.dbConnectionId),
          logIdentifier: state.suspendLogPath, // 这是基于 originalSessionId 的日志标识
          customSuspendName: undefined, // 如果需要，可以从 state 或其他地方获取
          keepAliveSeconds,
        };

        // 从 state 中"分离"SSH资源，防止后续意外关闭
        const sshClientToPass = state.sshClient;
        const channelToPass = state.sshShellStream;
        state.sshShellStream = undefined; // 清除引用
        state.isSuspendedByService = true; // 标记为已被服务接管（即使是尝试接管）

        const newSuspendId = await sshSuspendService.takeOverMarkedSession({
          ...takeoverDetails,
          sshClient: sshClientToPass, // 传递分离出来的实例
          channel: channelToPass, // 传递分离出来的实例
        });

        if (newSuspendId) {
          logger.info(
            `WebSocket: 会话 ${sessionId} 已成功移交给 SshSuspendService，新的挂起ID: ${newSuspendId}。SSH 连接将由服务管理。`,
          );
          const suspendPayload: Record<string, unknown> = {
            userId: state.ws.userId,
            username: state.ws.username,
            connectionId: state.dbConnectionId,
            connectionName: state.connectionName,
            sessionId,
            ip: state.ipAddress,
          };
          void lookupGeoInfo(state.ipAddress)
            .then((geoInfo) => {
              if (geoInfo) suspendPayload.geoInfo = geoInfo;
            })
            .finally(() => {
              void auditLogService.logAction('SSH_SESSION_SUSPENDED', suspendPayload);
            });
          eventService.emitEvent(AppEventType.SshSessionSuspended, {
            userId: state.ws.userId,
            details: {
              connectionId: state.dbConnectionId,
              connectionName: state.connectionName || '',
              sessionId,
              ip: state.ipAddress,
            },
          });
          // SSH 资源已移交，不需要在这里关闭它们
        } else {
          logger.warn(
            `WebSocket: 会话 ${sessionId} 移交给 SshSuspendService 失败 (takeOverMarkedSession 返回 null)。可能 SSH 连接在标记后已断开。将执行常规清理。`,
          );
          // 移交失败，执行常规关闭
          channelToPass?.end();
          sshClientToPass?.end();
          state.isSuspendedByService = false; // 重置标记，因为接管失败
        }
      } catch (error: unknown) {
        logger.error(`WebSocket: 会话 ${sessionId} 移交给 SshSuspendService 时发生错误:`, error);
        // 发生错误，也执行常规关闭以防资源泄露
        if (state.sshClient) state.sshClient.end(); // 如果引用还在，尝试关闭
        if (state.sshShellStream) state.sshShellStream.end(); // 如果引用还在，尝试关闭
        state.isSuspendedByService = false; // 重置标记
      }
    } else if (!state.isSuspendedByService && state.sshClient) {
      // 未标记挂起，也未被服务接管，执行常规关闭
      state.sshShellStream?.end();
      state.sshClient?.end();
      logger.debug(`WebSocket: 会话 ${sessionId} 的 SSH 连接已关闭 (未标记挂起，未被服务接管)。`);
      const disconnectPayload: Record<string, unknown> = {
        userId: state.ws.userId,
        username: state.ws.username,
        connectionId: state.dbConnectionId,
        connectionName: state.connectionName,
        sessionId,
        ip: state.ipAddress,
        durationSeconds,
      };
      void lookupGeoInfo(state.ipAddress)
        .then((geoInfo) => {
          if (geoInfo) disconnectPayload.geoInfo = geoInfo;
        })
        .finally(() => {
          void auditLogService.logAction('SSH_DISCONNECT', disconnectPayload);
        });
      eventService.emitEvent(AppEventType.SshDisconnect, {
        userId: state.ws.userId,
        details: {
          connectionId: state.dbConnectionId,
          connectionName: state.connectionName || '',
          sessionId,
          ip: state.ipAddress,
          durationSeconds,
        },
      });
    } else if (state.isSuspendedByService) {
      // 已被服务接管（例如通过旧的 startSuspend 流程，或成功移交后），不在此处关闭
      logger.debug(`WebSocket: 会话 ${sessionId} 的 SSH 连接已由挂起服务管理，跳过关闭。`);
    }

    // 4. 清理 Docker 状态轮询定时器
    if (state.dockerStatusIntervalId) {
      clearInterval(state.dockerStatusIntervalId);
      logger.debug(`WebSocket: Cleared Docker status interval for session ${sessionId}.`);
    }

    // H-19: 执行已注册的会话级清理回调（如 silent exec 定时器）
    sessionCleanupCallbacks.forEach((cb) => {
      try {
        cb(sessionId);
      } catch (callbackError: unknown) {
        logger.warn(`[WebSocket] 会话 ${sessionId} 清理回调执行失败:`, callbackError);
      }
    });

    // 5. 从状态 Map 中移除
    clientStates.delete(sessionId);

    // 6. 清除 WebSocket 上的 sessionId 关联 (可选，因为 ws 可能已关闭)
    if (state.ws && state.ws.sessionId === sessionId) {
      delete state.ws.sessionId;
    }

    logger.debug(`WebSocket: 会话 ${sessionId} 已清理。`);
  } else {
    // logger.warn(`[WebSocket Utils] cleanupClientConnection: No state found for session ID ${sessionId}.`);
  }
};
