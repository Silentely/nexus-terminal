import crypto from 'crypto';
/**
 * Telnet WebSocket 消息处理器
 * 处理 telnet:connect、telnet:input、telnet:resize、telnet:disconnect 消息
 */

import { findFullConnectionById } from '../connections/connection.repository';
import { logger } from '../utils/logger';
import { AuditLogService } from '../audit/audit.service';
import eventService from '../services/event.service';
import { AppEventType } from '../types/event.types';
import { clientStates } from '../websocket/state';
import type { ClientState, AuthenticatedWebSocket } from '../websocket/types';
import { getOrCreateBatcher, destroyBatcher } from '../websocket/output-batcher';
import { TelnetService } from './telnet.service';
import type { TelnetService as TelnetServiceType } from './telnet.service';

// 扩展 ClientState 支持 Telnet 字段
interface TelnetClientState extends ClientState {
  telnetService?: TelnetServiceType;
  telnetSessionId?: string;
  sshClient: ClientState['sshClient'];
}

interface TelnetConnectPayload {
  connectionId: number;
}

interface TelnetInputPayload {
  sessionId: string;
  data: string; // base64 编码的输入数据
}

interface TelnetResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

interface TelnetDisconnectPayload {
  sessionId: string;
}

/**
 * 处理 Telnet 连接请求
 */
export async function handleTelnetConnect(
  ws: AuthenticatedWebSocket,
  payload: TelnetConnectPayload,
  request?: { clientIpAddress?: string },
): Promise<void> {
  const { connectionId } = payload;
  const userId = ws.userId;
  const username = ws.username;
  const clientIp = request?.clientIpAddress;

  try {
    // 检查是否已有活动连接
    for (const [sessionId, state] of clientStates.entries()) {
      if (state.dbConnectionId === connectionId && state.ws === ws) {
        logger.debug({ connectionId, sessionId }, '已有活动 Telnet 连接');
        ws.send(JSON.stringify({ type: 'telnet:connected', payload: { sessionId } }));
        return;
      }
    }

    // 获取连接详情
    const fullConnection = await findFullConnectionById(connectionId);

    if (!fullConnection) {
      ws.send(
        JSON.stringify({
          type: 'telnet:error',
          payload: { message: '连接配置不存在' },
        }),
      );
      return;
    }

    // Telnet 是交互式登录，密码在连接后手动输入，无需解密

    // 创建 Telnet 服务
    const telnetService = new TelnetService({
      host: fullConnection.host,
      port: fullConnection.port,
      timeout: 10000,
    });

    // 建立连接
    const connectResult = await telnetService.connect();

    if (!connectResult.success || !connectResult.socket) {
      const errorMessage = connectResult.error || '连接失败';
      logger.error(
        { connectionId, host: fullConnection.host, error: errorMessage },
        'Telnet 连接失败',
      );

      // 记录审计日志
      const auditService = new AuditLogService();
      await auditService.logAction(
        'TELNET_CONNECT_FAILURE',
        {
          userId,
          username,
          connectionId,
          connectionName: fullConnection.name,
          ip: clientIp,
          reason: errorMessage,
        },
        userId,
      );

      // 发送事件
      eventService.emitEvent(AppEventType.TelnetConnectFailure, {
        userId,
        details: {
          connectionId,
          connectionName: fullConnection.name || fullConnection.host,
          ip: clientIp,
          reason: errorMessage,
        },
      });

      ws.send(
        JSON.stringify({
          type: 'telnet:error',
          payload: { message: errorMessage },
        }),
      );
      return;
    }

    // 生成会话 ID
    const sessionId = crypto.randomUUID();

    // 创建输出批处理器
    const outputBatcher = getOrCreateBatcher(ws, sessionId, (encoded: string) => {
      if (ws.readyState === 1) {
        // WebSocket.OPEN = 1
        ws.send(
          JSON.stringify({
            type: 'telnet:output',
            payload: encoded,
          }),
        );
      }
    });

    // 存储客户端状态
    const clientState: TelnetClientState = {
      ws,
      sshClient: null as unknown as ClientState['sshClient'],
      dbConnectionId: connectionId,
      connectionName: fullConnection.name || fullConnection.host,
      connectedAt: Date.now(),
      ipAddress: clientIp,
      isShellReady: true,
      telnetService,
      telnetSessionId: sessionId,
    };

    clientStates.set(sessionId, clientState as ClientState);

    // 注册数据接收回调（传递 UTF-8 字符串，由 outputBatcher 统一 base64 编码）
    telnetService.onData((data: Buffer) => {
      try {
        // 转换为 UTF-8 字符串，由 outputBatcher 统一编码
        const utf8String = data.toString('utf-8');
        outputBatcher.write(utf8String);
      } catch (err) {
        logger.error({ error: err }, 'Telnet 数据处理失败');
      }
    });

    // 注册连接关闭回调
    telnetService.onClose(() => {
      logger.info({ sessionId, connectionId }, 'Telnet 连接已关闭');
      cleanupTelnetSession(sessionId);
      ws.send(JSON.stringify({ type: 'telnet:disconnected', payload: { sessionId } }));
    });

    // 注册错误回调
    telnetService.onError((err: Error) => {
      logger.error({ sessionId, error: err.message }, 'Telnet 连接错误');
      ws.send(
        JSON.stringify({
          type: 'telnet:error',
          payload: { sessionId, message: err.message },
        }),
      );
    });

    // 发送连接成功响应
    ws.send(
      JSON.stringify({
        type: 'telnet:connected',
        payload: { sessionId, connectionId },
      }),
    );

    // 记录审计日志
    const auditService = new AuditLogService();
    await auditService.logAction(
      'TELNET_CONNECT_SUCCESS',
      {
        userId,
        username,
        connectionId,
        connectionName: fullConnection.name,
        sessionId,
        ip: clientIp,
      },
      userId,
    );

    // 发送事件
    eventService.emitEvent(AppEventType.TelnetConnectSuccess, {
      userId,
      details: {
        connectionId,
        connectionName: fullConnection.name || fullConnection.host,
        sessionId,
        ip: clientIp,
      },
    });

    logger.info(
      {
        sessionId,
        connectionId,
        host: fullConnection.host,
        port: fullConnection.port,
      },
      'Telnet 连接成功',
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ error: error.message, connectionId }, 'Telnet 连接处理异常');

    ws.send(
      JSON.stringify({
        type: 'telnet:error',
        payload: { message: error.message },
      }),
    );
  }
}

/**
 * 处理 Telnet 输入数据
 */
export function handleTelnetInput(ws: AuthenticatedWebSocket, payload: TelnetInputPayload): void {
  const { sessionId, data } = payload;

  const clientState = clientStates.get(sessionId) as TelnetClientState | undefined;
  if (!clientState) {
    logger.warn({ sessionId }, 'Telnet 会话不存在');
    return;
  }

  // 校验会话归属
  if (clientState.ws !== ws) {
    logger.warn({ sessionId }, 'Telnet 会话归属不匹配');
    return;
  }

  const telnetService = clientState.telnetService;
  if (!telnetService) {
    logger.warn({ sessionId }, 'Telnet 服务不存在');
    return;
  }

  try {
    // 解码 base64 数据为原始 Buffer
    const decodedData = Buffer.from(data, 'base64');
    telnetService.write(decodedData);
  } catch (err) {
    logger.error({ sessionId, error: err }, 'Telnet 输入处理失败');
  }
}

/**
 * 处理 Telnet 窗口大小调整
 */
export function handleTelnetResize(ws: AuthenticatedWebSocket, payload: TelnetResizePayload): void {
  const { sessionId, cols, rows } = payload;

  const clientState = clientStates.get(sessionId) as TelnetClientState | undefined;
  if (!clientState) {
    logger.warn({ sessionId }, 'Telnet 会话不存在');
    return;
  }

  // 校验会话归属
  if (clientState.ws !== ws) {
    logger.warn({ sessionId }, 'Telnet 会话归属不匹配');
    return;
  }

  const telnetService = clientState.telnetService;
  if (!telnetService) {
    logger.warn({ sessionId }, 'Telnet 服务不存在');
    return;
  }

  telnetService.resize(cols, rows);
}

/**
 * 处理 Telnet 断开连接
 */
export async function handleTelnetDisconnect(
  _ws: AuthenticatedWebSocket,
  payload: TelnetDisconnectPayload,
): Promise<void> {
  const { sessionId } = payload;

  const clientState = clientStates.get(sessionId) as TelnetClientState | undefined;
  if (!clientState) {
    logger.warn({ sessionId }, 'Telnet 会话不存在');
    return;
  }

  const telnetService = clientState.telnetService;
  if (telnetService) {
    telnetService.disconnect();
  }

  // 计算会话时长
  const durationSeconds = clientState.connectedAt
    ? Math.floor((Date.now() - clientState.connectedAt) / 1000)
    : 0;

  // 记录审计日志
  const auditService = new AuditLogService();
  await auditService.logAction(
    'TELNET_DISCONNECT',
    {
      userId: clientState.ws.userId,
      username: clientState.ws.username,
      connectionId: clientState.dbConnectionId,
      connectionName: clientState.connectionName,
      sessionId,
      ip: clientState.ipAddress,
      durationSeconds,
    },
    clientState.ws.userId,
  );

  // 发送事件
  eventService.emitEvent(AppEventType.TelnetDisconnect, {
    userId: clientState.ws.userId,
    details: {
      connectionId: clientState.dbConnectionId,
      connectionName: clientState.connectionName,
      sessionId,
      ip: clientState.ipAddress,
      durationSeconds,
    },
  });

  cleanupTelnetSession(sessionId);

  logger.info({ sessionId, durationSeconds }, 'Telnet 会话已断开');
}

/**
 * 清理 Telnet 会话资源
 */
function cleanupTelnetSession(sessionId: string): void {
  const clientState = clientStates.get(sessionId);
  if (!clientState) return;

  const telnetService = (clientState as Record<string, unknown>)['telnetService'] as
    | TelnetService
    | undefined;
  if (telnetService) {
    telnetService.disconnect();
  }

  // 销毁输出批处理器
  destroyBatcher(sessionId);

  // 移除客户端状态
  clientStates.delete(sessionId);

  logger.debug({ sessionId }, 'Telnet 会话资源已清理');
}
