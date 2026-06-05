/**
 * WebRTC DataChannel ↔ Remote-Gateway WebSocket 桥接
 *
 * 将 WebRTC DataChannel 上的 Guacamole 协议消息转发到 remote-gateway WebSocket，
 * 并将 remote-gateway 的响应转发回 DataChannel。
 *
 * 复用 remote-desktop.handler.ts 的握手过滤逻辑。
 */

import WebSocket from 'ws';
import { RTCDataChannel } from 'werift';
import { logger } from '../utils/logger';
import { validateUrlNotPrivate } from '../utils/url';

/**
 * Guacamole 握手指令过滤器
 * 浏览器发送的这些指令应被过滤，因为 guacamole-lite 内部已完成握手
 */
const CLIENT_HANDSHAKE_FILTER = /^(connect|select|size|audio|video|image|timezone)[,;]/;

/**
 * 桥接 WebRTC DataChannel 到 remote-gateway WebSocket
 * @param dc WebRTC DataChannel（浏览器侧）
 * @param remoteGatewayUrl remote-gateway WebSocket URL
 * @param sessionId 会话 ID（用于日志）
 */
export async function bridgeDataChannelToGateway(
  dc: RTCDataChannel,
  remoteGatewayUrl: string,
  sessionId: string
): Promise<void> {
  if (!remoteGatewayUrl) {
    logger.error(`[WebRTC Bridge] remoteGatewayUrl 为空: ${sessionId}`);
    dc.send(JSON.stringify({ type: 'error', payload: 'remote-gateway URL 未配置' }));
    return;
  }

  // SSRF 防护：验证目标 URL 不属于私有/内部网络
  try {
    await validateUrlNotPrivate(remoteGatewayUrl, 'WebRTC-Bridge');
  } catch (error) {
    logger.error(`[WebRTC Bridge] SSRF 验证失败: ${sessionId}`, error);
    dc.send(
      JSON.stringify({
        type: 'error',
        payload: `remote-gateway URL 验证失败: ${error instanceof Error ? error.message : '未知错误'}`,
      })
    );
    return;
  }

  // 连接到 remote-gateway
  const gatewayWs = new WebSocket(remoteGatewayUrl);
  let gatewayReady = false;
  let dcClosed = false;
  let gwClosed = false;
  let msgCountClientToGateway = 0;
  let msgCountGatewayToClient = 0;

  // 连接超时保护（15 秒）
  const connectTimeout = setTimeout(() => {
    if (!gatewayReady) {
      logger.error(`[WebRTC Bridge] remote-gateway 连接超时: ${sessionId}`);
      dc.send(JSON.stringify({ type: 'error', payload: 'remote-gateway 连接超时' }));
      cleanup('connect_timeout');
    }
  }, 15_000);

  gatewayWs.on('open', () => {
    gatewayReady = true;
    clearTimeout(connectTimeout);
    logger.info(`[WebRTC Bridge] remote-gateway 已连接: ${sessionId}`);
  });

  // DataChannel → remote-gateway（浏览器 → 服务器）
  dc.onMessage.subscribe((data: unknown) => {
    if (gwClosed || !gatewayReady) return;

    let msg: string | Buffer;
    if (typeof data === 'string') {
      msg = data;
    } else if (data instanceof ArrayBuffer) {
      msg = Buffer.from(data);
    } else {
      msg = String(data);
    }
    const msgStr = typeof msg === 'string' ? msg : msg.toString();

    // 过滤浏览器的握手指令
    if (typeof msg === 'string' && CLIENT_HANDSHAKE_FILTER.test(msg)) {
      msgCountClientToGateway++;
      if (msgCountClientToGateway % 100 === 1) {
        logger.debug(`[WebRTC Bridge] 过滤握手指令: ${sessionId} (${msgCountClientToGateway})`);
      }
      return;
    }

    msgCountClientToGateway++;
    if (msgCountClientToGateway % 100 === 1) {
      logger.debug(
        `[WebRTC Bridge] C→G: ${sessionId} (${msgCountClientToGateway}), len=${msgStr.length}`
      );
    }

    // 转发到 remote-gateway
    if (typeof msg === 'string') {
      gatewayWs.send(msg);
    } else {
      gatewayWs.send(msg);
    }
  });

  // remote-gateway → DataChannel（服务器 → 浏览器）
  gatewayWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (dcClosed) return;

    msgCountGatewayToClient++;
    if (msgCountGatewayToClient % 100 === 1) {
      logger.debug(
        `[WebRTC Bridge] G→C: ${sessionId} (${msgCountGatewayToClient}), len=${typeof data === 'string' ? data.length : data.length}`
      );
    }

    // 转发到 DataChannel
    try {
      if (isBinary) {
        dc.send(Buffer.from(data as Buffer));
      } else {
        dc.send(data.toString());
      }
    } catch (error) {
      logger.error(`[WebRTC Bridge] 发送到 DataChannel 失败: ${sessionId}`, error);
      cleanup('dc_send_error');
    }
  });

  // 清理函数
  function cleanup(reason: string): void {
    if (dcClosed && gwClosed) return;

    logger.info(
      `[WebRTC Bridge] 清理连接: ${sessionId}, 原因=${reason}, C→G=${msgCountClientToGateway}, G→C=${msgCountGatewayToClient}`
    );

    clearTimeout(connectTimeout);

    if (!dcClosed) {
      dcClosed = true;
      try {
        dc.close();
      } catch {
        // 忽略关闭错误
      }
    }

    if (!gwClosed) {
      gwClosed = true;
      try {
        gatewayWs.close();
      } catch {
        // 忽略关闭错误
      }
    }
  }

  // DataChannel 关闭
  const dcCloseHandler = (): void => {
    dcClosed = true;
    logger.debug(`[WebRTC Bridge] DataChannel 关闭: ${sessionId}`);
    cleanup('dc_close');
  };
  // eslint-disable-next-line no-param-reassign
  dc.onclose = dcCloseHandler;

  // remote-gateway 错误
  gatewayWs.on('error', (error) => {
    logger.error(`[WebRTC Bridge] remote-gateway 错误: ${sessionId}`, error);
    cleanup('gw_error');
  });

  // remote-gateway 关闭
  gatewayWs.on('close', (code, _reason) => {
    gwClosed = true;
    logger.debug(`[WebRTC Bridge] remote-gateway 关闭: ${sessionId}, code=${code}`);
    cleanup('gw_close');
  });
}
