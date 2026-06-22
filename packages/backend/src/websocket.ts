import http from 'http';
import { WebSocketServer } from 'ws';
import { RequestHandler } from 'express';
import { initializeHeartbeat } from './websocket/heartbeat';
import { initializeUpgradeHandler } from './websocket/upgrade';
import { initializeConnectionHandler } from './websocket/connection';
import { clientStates } from './websocket/state';
import { sshSuspendService } from './ssh-suspend/ssh-suspend.service';
import { SftpService } from './sftp/sftp.service';
import { cleanupClientConnection } from './websocket/utils';
import { logger } from './utils/logger';

export {
  ClientState,
  AuthenticatedWebSocket,
  DockerContainer,
  DockerStats,
  PortInfo,
  SshSuspendClientToServerMessages,
  SshSuspendServerToClientMessages,
  SuspendedSessionInfo,
} from './websocket/types'; // Re-export essential types

export const initializeWebSocket = async (
  server: http.Server,
  sessionParser: RequestHandler,
): Promise<WebSocketServer> => {
  // Environment variables are expected to be loaded by index.ts

  // 设置最大负载大小为 4MB，防止 DoS 攻击
  // 启用 permessage-deflate 压缩，降低带宽占用
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024, // 4MB
    perMessageDeflate: {
      zlibDeflateOptions: {
        level: 3, // 低 CPU 开销的压缩级别
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      threshold: 256, // 小于 256 字节不压缩
      serverNoContextTakeover: true, // 避免字典内存累积
      clientNoContextTakeover: true,
    },
  });
  // const db = await getDbInstance(); // db instance might not be directly needed here anymore if all DB interactions are in services/handlers

  // 1. Initialize Heartbeat
  const heartbeatTimer = initializeHeartbeat(wss); // Store timer to potentially clear it, though heartbeat.ts handles its own wss.on('close')

  // 2. Initialize Upgrade Handler (handles authentication and protocol upgrade)
  initializeUpgradeHandler(server, wss, sessionParser);

  // +++ 创建 SftpService 实例 +++
  const sftpService = new SftpService(clientStates);

  // 3. Initialize Connection Handler (handles 'connection' event and message routing)
  initializeConnectionHandler(wss, sshSuspendService, sftpService); // +++ 传递 sftpService 实例 +++

  // --- WebSocket 服务器关闭处理 ---
  wss.on('close', () => {
    logger.info('WebSocket 服务器正在关闭，清理心跳定时器和所有活动会话...');
    clearInterval(heartbeatTimer); // Clear heartbeat started by this function

    clientStates.forEach((_state, sessionId) => {
      cleanupClientConnection(sessionId).catch((error: unknown) => {
        logger.debug(
          { sessionId, err: error instanceof Error ? error : undefined },
          '[WebSocket] 服务器关闭时清理会话失败',
        );
      });
    });
    logger.info('所有活动会话已清理。');
  });

  logger.info('WebSocket 服务器初始化完成。');
  return wss;
};

export { clientStates };
