import WebSocket, { RawData } from 'ws';
import { Request } from 'express';
import { AuthenticatedWebSocket } from '../types';
import { resetHeartbeat } from '../heartbeat'; // 导入新的心跳重置函数

export function handleRdpProxyConnection(ws: AuthenticatedWebSocket, request: Request): void {
  const clientIp = (request as any).clientIpAddress || 'unknown';
  console.log(
    `WebSocket：RDP 代理客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}) 已连接。`
  );

  // 使用新的心跳重置函数
  ws.on('pong', () => {
    resetHeartbeat(ws);
  });

  // Retrieve all necessary parameters passed from the upgrade handler
  const { rdpToken } = request as any;
  const rdpWidthStr = (request as any).rdpWidth; // Get as string first
  const rdpHeightStr = (request as any).rdpHeight; // Get as string first

  // --- 参数验证和 DPI 计算 ---
  if (!rdpToken || !rdpWidthStr || !rdpHeightStr) {
    // Check string presence
    console.error(
      `WebSocket: RDP Proxy connection for ${ws.username} missing required parameters (token, width, height).`
    );
    ws.send(
      JSON.stringify({
        type: 'rdp:error',
        payload: 'Missing RDP connection parameters (token, width, height).',
      })
    );
    ws.close(1008, 'Missing RDP parameters');
    return;
  }

  const rdpWidth = parseInt(rdpWidthStr, 10);
  const rdpHeight = parseInt(rdpHeightStr, 10);

  if (isNaN(rdpWidth) || isNaN(rdpHeight) || rdpWidth <= 0 || rdpHeight <= 0) {
    console.error(
      `WebSocket: RDP Proxy connection for ${ws.username} has invalid width or height parameters.`
    );
    ws.send(JSON.stringify({ type: 'rdp:error', payload: 'Invalid width or height parameters.' }));
    ws.close(1008, 'Invalid RDP dimensions');
    return;
  }

  // 根据宽高的简单 DPI 计算逻辑 (如果宽度 > 1920，则 DPI=120，否则 DPI=96)
  const calculatedDpi = rdpWidth > 1920 ? 120 : 96;
  console.log(
    `WebSocket: RDP Proxy calculated DPI for ${ws.username} based on width ${rdpWidth}: ${calculatedDpi}`
  );

  // Determine RDP target URL based on deployment mode
  const deploymentMode = process.env.DEPLOYMENT_MODE;
  let remoteGatewayWsBaseUrl: string;
  if (deploymentMode === 'local') {
    remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_LOCAL || 'ws://localhost:8080';
    console.log(
      `[WebSocket Remote Desktop Proxy] Using LOCAL deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`
    );
  } else if (deploymentMode === 'docker') {
    remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_DOCKER || 'ws://remote-gateway:8080';
    console.log(
      `[WebSocket Remote Desktop Proxy] Using DOCKER deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`
    );
  } else {
    remoteGatewayWsBaseUrl = 'ws://localhost:8080';
    console.warn(
      `[WebSocket Remote Desktop Proxy] Unknown deployment mode '${deploymentMode}'. Defaulting to safe fallback Target Base: ${remoteGatewayWsBaseUrl}`
    );
  }

  const cleanRemoteGatewayWsBaseUrl = remoteGatewayWsBaseUrl.endsWith('/')
    ? remoteGatewayWsBaseUrl.slice(0, -1)
    : remoteGatewayWsBaseUrl;

  const remoteDesktopTargetUrl = `${cleanRemoteGatewayWsBaseUrl}/?token=${encodeURIComponent(rdpToken)}&width=${encodeURIComponent(rdpWidth)}&height=${encodeURIComponent(rdpHeight)}&dpi=${encodeURIComponent(calculatedDpi)}`;

  // 安全日志：不记录包含 token 的完整 URL，避免 token 泄露
  const safeLogUrl = `${cleanRemoteGatewayWsBaseUrl}/?token=[REDACTED]&width=${rdpWidth}&height=${rdpHeight}&dpi=${calculatedDpi}`;
  console.log(
    `WebSocket: Remote Desktop Proxy for ${ws.username} attempting to connect to ${safeLogUrl}`
  );

  const rdpWs = new WebSocket(remoteDesktopTargetUrl);
  let clientWsClosed = false;
  let rdpWsClosed = false;

  // --- 消息转发: Client -> RDP ---
  ws.on('message', (message: RawData) => {
    if (rdpWs.readyState === WebSocket.OPEN) {
      rdpWs.send(message);
    } else {
      console.warn(
        `[RDP 代理 C->S] 用户: ${ws.username}, 会话: ${ws.sessionId}, RDP WS 未打开，丢弃消息。`
      );
    }
  });

  // --- 消息转发: RDP -> Client ---
  rdpWs.on('message', (message: RawData) => {
    if (ws.readyState === WebSocket.OPEN) {
      const messageString = message.toString('utf-8');
      ws.send(messageString);
    } else {
      console.warn(
        `[RDP 代理 S->C] 用户: ${ws.username}, 会话: ${ws.sessionId}, 客户端 WS 未打开，丢弃消息。`
      );
    }
  });

  // --- 错误处理 ---
  ws.on('error', (error) => {
    console.error(
      `[RDP 代理 客户端 WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 错误:`,
      error
    );
    if (
      !rdpWsClosed &&
      rdpWs.readyState !== WebSocket.CLOSED &&
      rdpWs.readyState !== WebSocket.CLOSING
    ) {
      console.log(`[RDP 代理] 因客户端 WS 错误关闭 RDP WS。会话: ${ws.sessionId}`);
      rdpWs.close(1011, 'Client WS Error');
      rdpWsClosed = true;
    }
    clientWsClosed = true;
  });
  rdpWs.on('error', (error) => {
    console.error(
      `[RDP 代理 RDP WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 连接到 ${remoteDesktopTargetUrl} 时出错:`,
      error
    );
    if (
      !clientWsClosed &&
      ws.readyState !== WebSocket.CLOSED &&
      ws.readyState !== WebSocket.CLOSING
    ) {
      console.log(`[RDP 代理] 因 RDP WS 错误关闭客户端 WS。会话: ${ws.sessionId}`);
      ws.close(1011, `RDP WS Error: ${error.message}`);
      clientWsClosed = true;
    }
    rdpWsClosed = true;
  });

  // --- 关闭处理 ---
  ws.on('close', (code, reason) => {
    clientWsClosed = true;
    console.log(
      `[RDP 代理 客户端 WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 代码: ${code}, 原因: ${reason.toString()}`
    );
    if (
      !rdpWsClosed &&
      rdpWs.readyState !== WebSocket.CLOSED &&
      rdpWs.readyState !== WebSocket.CLOSING
    ) {
      console.log(`[RDP 代理] 因客户端 WS 关闭而关闭 RDP WS。会话: ${ws.sessionId}`);
      rdpWs.close(1000, 'Client WS Closed');
      rdpWsClosed = true;
    }
  });
  rdpWs.on('close', (code, reason) => {
    rdpWsClosed = true;
    console.log(
      `[RDP 代理 RDP WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 到 ${remoteDesktopTargetUrl} 的连接已关闭。代码: ${code}, 原因: ${reason.toString()}`
    );
    if (
      !clientWsClosed &&
      ws.readyState !== WebSocket.CLOSED &&
      ws.readyState !== WebSocket.CLOSING
    ) {
      console.log(`[RDP 代理] 因 RDP WS 关闭而关闭客户端 WS。会话: ${ws.sessionId}`);
      ws.close(1000, 'RDP WS Closed');
      clientWsClosed = true;
    }
  });

  rdpWs.on('open', () => {
    console.log(
      `[RDP 代理 RDP WS 打开] 用户: ${ws.username}, 会话: ${ws.sessionId}, 到 ${remoteDesktopTargetUrl} 的连接已建立。开始转发消息。`
    );
  });
}
