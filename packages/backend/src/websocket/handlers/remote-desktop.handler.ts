import WebSocket, { RawData } from 'ws';
import { Request } from 'express';
import { AuthenticatedWebSocket } from '../types';
import { resetHeartbeat } from '../heartbeat'; // 导入新的心跳重置函数
import { logger } from '../../utils/logger';
import { sendWsMessage } from '../utils';

interface RdpProxyRequest extends Request {
  clientIpAddress?: string;
  rdpToken?: string;
  rdpWidth?: string;
  rdpHeight?: string;
}

export function handleRdpProxyConnection(ws: AuthenticatedWebSocket, request: Request): void {
  const rdpRequest = request as RdpProxyRequest;
  const clientIp = rdpRequest.clientIpAddress || 'unknown';
  logger.info(
    `WebSocket：RDP 代理客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}) 已连接。`,
  );

  // 使用新的心跳重置函数
  ws.on('pong', () => {
    resetHeartbeat(ws);
  });

  // Retrieve all necessary parameters passed from the upgrade handler
  const { rdpToken } = rdpRequest;
  const rdpWidthStr = rdpRequest.rdpWidth; // Get as string first
  const rdpHeightStr = rdpRequest.rdpHeight; // Get as string first

  // --- 参数验证和 DPI 计算 ---
  if (!rdpToken || !rdpWidthStr || !rdpHeightStr) {
    // Check string presence
    logger.error(
      `WebSocket: RDP Proxy connection for ${ws.username} missing required parameters (token, width, height).`,
    );
    sendWsMessage(
      ws,
      'rdp:error',
      'Missing RDP connection parameters (token, width, height).',
      ws.sessionId,
    );
    ws.close(1008, 'Missing RDP parameters');
    return;
  }

  const rdpWidth = parseInt(rdpWidthStr, 10);
  const rdpHeight = parseInt(rdpHeightStr, 10);

  if (Number.isNaN(rdpWidth) || Number.isNaN(rdpHeight) || rdpWidth <= 0 || rdpHeight <= 0) {
    logger.error(
      `WebSocket: RDP Proxy connection for ${ws.username} has invalid width or height parameters.`,
    );
    sendWsMessage(ws, 'rdp:error', 'Invalid width or height parameters.', ws.sessionId);
    ws.close(1008, 'Invalid RDP dimensions');
    return;
  }

  // 根据宽高的简单 DPI 计算逻辑 (如果宽度 > 1920，则 DPI=120，否则 DPI=96)
  const calculatedDpi = rdpWidth > 1920 ? 120 : 96;
  logger.debug(
    `WebSocket: RDP Proxy calculated DPI for ${ws.username} based on width ${rdpWidth}: ${calculatedDpi}`,
  );

  // Determine RDP target URL based on deployment mode
  const deploymentMode = process.env.DEPLOYMENT_MODE;
  let remoteGatewayWsBaseUrl: string;
  if (deploymentMode === 'local') {
    remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_LOCAL || 'ws://localhost:8081';
    logger.debug(
      `[WebSocket Remote Desktop Proxy] Using LOCAL deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`,
    );
  } else if (deploymentMode === 'docker') {
    remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_DOCKER || 'ws://remote-gateway:8081';
    logger.debug(
      `[WebSocket Remote Desktop Proxy] Using DOCKER deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`,
    );
  } else {
    remoteGatewayWsBaseUrl = 'ws://localhost:8081';
    logger.warn(
      `[WebSocket Remote Desktop Proxy] Unknown deployment mode '${deploymentMode}'. Defaulting to safe fallback Target Base: ${remoteGatewayWsBaseUrl}`,
    );
  }

  const cleanRemoteGatewayWsBaseUrl = remoteGatewayWsBaseUrl.endsWith('/')
    ? remoteGatewayWsBaseUrl.slice(0, -1)
    : remoteGatewayWsBaseUrl;

  const remoteDesktopTargetUrl = `${cleanRemoteGatewayWsBaseUrl}/?token=${encodeURIComponent(rdpToken)}&width=${rdpWidth}&height=${rdpHeight}&dpi=${calculatedDpi}`;

  // 安全日志：不记录包含 token 的完整 URL，避免 token 泄露
  const safeLogUrl = `${cleanRemoteGatewayWsBaseUrl}/?token=[REDACTED]&width=${rdpWidth}&height=${rdpHeight}&dpi=${calculatedDpi}`;
  logger.debug(
    `WebSocket: Remote Desktop Proxy for ${ws.username} attempting to connect to ${safeLogUrl}`,
  );

  const rdpWs = new WebSocket(remoteDesktopTargetUrl);
  let clientWsClosed = false;
  let rdpWsClosed = false;

  // RDP 连接超时保护（15 秒）
  const RDP_CONNECT_TIMEOUT_MS = 15_000;
  const rdpConnectTimeout = setTimeout(() => {
    if (rdpWs.readyState === WebSocket.CONNECTING) {
      logger.error(
        `[RDP 代理] 连接超时 (${RDP_CONNECT_TIMEOUT_MS}ms) 用户: ${ws.username}, 会话: ${ws.sessionId}`,
      );
      rdpWs.terminate();
      if (ws.readyState === WebSocket.OPEN) {
        sendWsMessage(ws, 'rdp:error', 'RDP 连接超时，请检查远程桌面服务是否可达。', ws.sessionId);
        ws.close(1008, 'RDP connect timeout');
      }
      clientWsClosed = true;
      rdpWsClosed = true;
    }
  }, RDP_CONNECT_TIMEOUT_MS);

  // --- 消息转发: Client -> RDP（保留原始帧类型，避免二进制/文本混淆） ---
  // 过滤浏览器发送的握手指令：guacamole-lite 内部已完成 Guacd 握手，
  // 浏览器的 connect/select 指令会导致协议状态混乱（Issue #84）
  const CLIENT_HANDSHAKE_FILTER = /^(connect|select|size|audio|video|image|timezone)[,;]/;
  // 日志采样：每条 100 条转发只打一次 debug，避免高频日志爆炸
  let c2sLogCounter = 0;
  ws.on('message', (message: RawData, isBinary: boolean) => {
    if (rdpWs.readyState === WebSocket.OPEN) {
      const msgStr = isBinary ? null : message.toString();
      if (msgStr && CLIENT_HANDSHAKE_FILTER.test(msgStr)) {
        logger.debug(
          `[RDP 代理 C->S] 用户: ${ws.username}, 会话: ${ws.sessionId}, 过滤浏览器握手指令: ${msgStr.substring(0, 80)}`,
        );
        return;
      }
      // 高频转发日志采样
      if (++c2sLogCounter % 100 === 1) {
        let msgLen = 0;
        if (isBinary) {
          msgLen = (message as Buffer).byteLength;
        } else if (msgStr) {
          msgLen = msgStr.length;
        }
        logger.debug(
          `[RDP 代理 C->S] 用户: ${ws.username}, 会话: ${ws.sessionId}, 转发消息 (采样 1/100): binary=${isBinary}, len=${msgLen}`,
        );
      }
      rdpWs.send(message, { binary: isBinary });
    } else {
      logger.warn(
        `[RDP 代理 C->S] 用户: ${ws.username}, 会话: ${ws.sessionId}, RDP WS 状态=${rdpWs.readyState} 未打开，丢弃消息。`,
      );
    }
  });

  // --- 消息转发: RDP -> Client（保留原始帧类型，guacamole-lite 发文本帧，guacamole-common-js 需要字符串） ---
  let s2cLogCounter = 0;
  rdpWs.on('message', (message: RawData, isBinary: boolean) => {
    if (ws.readyState === WebSocket.OPEN) {
      // 高频转发日志采样
      if (++s2cLogCounter % 100 === 1) {
        const msgLen = isBinary ? (message as Buffer).byteLength : message.toString().length;
        logger.debug(
          `[RDP 代理 S->C] 用户: ${ws.username}, 会话: ${ws.sessionId}, RDP→Client (采样 1/100): binary=${isBinary}, len=${msgLen}`,
        );
      }
      ws.send(message, { binary: isBinary });
    } else {
      logger.warn(
        `[RDP 代理 S->C] 用户: ${ws.username}, 会话: ${ws.sessionId}, 客户端 WS 状态=${ws.readyState} 未打开，丢弃消息。`,
      );
    }
  });

  // --- 错误处理 ---
  ws.on('error', (error) => {
    logger.error(
      `[RDP 代理 客户端 WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 错误:`,
      error,
    );
    if (
      !rdpWsClosed &&
      rdpWs.readyState !== WebSocket.CLOSED &&
      rdpWs.readyState !== WebSocket.CLOSING
    ) {
      logger.debug(`[RDP 代理] 因客户端 WS 错误关闭 RDP WS。会话: ${ws.sessionId}`);
      rdpWs.close(1011, 'Client WS Error');
      rdpWsClosed = true;
    }
    clientWsClosed = true;
  });
  rdpWs.on('error', (error) => {
    clearTimeout(rdpConnectTimeout);
    logger.error(
      `[RDP 代理 RDP WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 连接到 ${safeLogUrl} 时出错:`,
      error,
    );
    if (
      !clientWsClosed &&
      ws.readyState !== WebSocket.CLOSED &&
      ws.readyState !== WebSocket.CLOSING
    ) {
      logger.debug(`[RDP 代理] 因 RDP WS 错误关闭客户端 WS。会话: ${ws.sessionId}`);
      ws.close(1011, `RDP WS Error: ${error.message}`);
      clientWsClosed = true;
    }
    rdpWsClosed = true;
  });

  // --- 关闭处理 ---
  ws.on('close', (code, reason) => {
    clearTimeout(rdpConnectTimeout);
    clientWsClosed = true;
    logger.info(
      `[RDP 代理 客户端 WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 代码: ${code}, 原因: ${reason.toString() || '(空)'}, RDP WS 状态: ${rdpWs.readyState}`,
    );
    if (
      !rdpWsClosed &&
      rdpWs.readyState !== WebSocket.CLOSED &&
      rdpWs.readyState !== WebSocket.CLOSING
    ) {
      logger.debug(`[RDP 代理] 因客户端 WS 关闭而关闭 RDP WS。会话: ${ws.sessionId}`);
      rdpWs.close(1000, 'Client WS Closed');
      rdpWsClosed = true;
    }
  });
  rdpWs.on('close', (code, reason) => {
    clearTimeout(rdpConnectTimeout);
    rdpWsClosed = true;
    logger.info(
      `[RDP 代理 RDP WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 连接已关闭。代码: ${code}, 原因: ${reason.toString() || '(空)'}, 客户端 WS 状态: ${ws.readyState}`,
    );
    if (
      !clientWsClosed &&
      ws.readyState !== WebSocket.CLOSED &&
      ws.readyState !== WebSocket.CLOSING
    ) {
      logger.debug(`[RDP 代理] 因 RDP WS 关闭而关闭客户端 WS。会话: ${ws.sessionId}`);
      ws.close(1000, 'RDP WS Closed');
      clientWsClosed = true;
    }
  });

  rdpWs.on('open', () => {
    clearTimeout(rdpConnectTimeout);
    logger.info(
      `[RDP 代理 RDP WS 打开] 用户: ${ws.username}, 会话: ${ws.sessionId}, 到 ${safeLogUrl} 的连接已建立。开始转发消息。`,
    );
  });
}
