/**
 * WebRTC DataChannel ↔ Remote-Gateway WebSocket 桥接
 *
 * 将 WebRTC DataChannel 上的 Guacamole 协议消息转发到 remote-gateway WebSocket，
 * 并将 remote-gateway 的响应转发回 DataChannel。
 *
 * 复用 remote-desktop.handler.ts 的握手过滤逻辑。
 */

import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import { RTCDataChannel } from 'werift';
import { logger } from '../utils/logger';
import { resolveAndValidatePublicHost } from '../utils/url';
import { createPinnedLookup } from '../utils/ssrf-guard';

/**
 * 允许的内部网关主机名（remote-gateway 是内部服务）
 * 使用主机名精确匹配，防止 userinfo 绕过（如 ws://attacker@localhost:8081）
 */
const INTERNAL_GATEWAY_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', 'remote-gateway']);

function isInternalGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return INTERNAL_GATEWAY_HOSTNAMES.has(parsed.hostname);
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    return false;
  }
}

/**
 * Guacamole 握手指令过滤器
 * 浏览器发送的这些指令应被过滤，因为 guacamole-lite 内部已完成握手
 */
const CLIENT_HANDSHAKE_FILTER = /^(connect|select|size|audio|video|image|timezone)[,;]/;

function getRemoteGatewayWsBaseUrl(): string {
  const deploymentMode = process.env.DEPLOYMENT_MODE;
  if (deploymentMode === 'local') {
    return process.env.REMOTE_GATEWAY_WS_URL_LOCAL || 'ws://localhost:8081';
  }
  if (deploymentMode === 'docker') {
    return process.env.REMOTE_GATEWAY_WS_URL_DOCKER || 'ws://remote-gateway:8081';
  }
  return 'ws://localhost:8081';
}

function getSafeErrorDetails(error: unknown): { name: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name || 'Error',
      ...(typeof code === 'string' ? { code } : {}),
    };
  }

  return { name: typeof error };
}

function resolveRemoteGatewayUrl(remoteGatewayUrl: string): string {
  const incomingUrl = new URL(remoteGatewayUrl);
  const gatewayBaseUrl = new URL(getRemoteGatewayWsBaseUrl());

  gatewayBaseUrl.search = incomingUrl.search;
  gatewayBaseUrl.hash = '';

  return gatewayBaseUrl.toString();
}

function toHttpValidationUrl(gatewayUrl: string): string {
  const validationUrl = new URL(gatewayUrl);
  if (validationUrl.protocol === 'ws:') {
    validationUrl.protocol = 'http:';
  } else if (validationUrl.protocol === 'wss:') {
    validationUrl.protocol = 'https:';
  } else {
    throw new Error('remote-gateway WebSocket URL 必须使用 ws/wss 协议');
  }
  validationUrl.hash = '';
  return validationUrl.toString();
}

/**
 * 桥接 WebRTC DataChannel 到 remote-gateway WebSocket
 * @param dc WebRTC DataChannel（浏览器侧）
 * @param remoteGatewayUrl remote-gateway WebSocket URL
 * @param sessionId 会话 ID（用于日志）
 * @param onClosed 可选回调：桥接清理时通知调用方（如 signaling.ts 清理 session/pc）
 */
export async function bridgeDataChannelToGateway(
  dc: RTCDataChannel,
  remoteGatewayUrl: string,
  sessionId: string,
  onClosed?: () => void,
): Promise<void> {
  if (!remoteGatewayUrl) {
    logger.error(`[WebRTC Bridge] remoteGatewayUrl 为空: ${sessionId}`);
    dc.send(JSON.stringify({ type: 'error', payload: 'remote-gateway URL 未配置' }));
    return;
  }

  let gatewayUrl: string;
  try {
    gatewayUrl = resolveRemoteGatewayUrl(remoteGatewayUrl);
  } catch (error) {
    logger.error(`[WebRTC Bridge] remoteGatewayUrl 无效: ${sessionId}`, {
      error: getSafeErrorDetails(error),
    });
    dc.send(
      JSON.stringify({
        type: 'error',
        payload: 'remote-gateway URL 无效，请检查服务端网关配置',
      }),
    );
    return;
  }

  // SSRF 防护：内部网关地址直接放行，外部地址需 DNS 验证 + 绑定
  let agent: http.Agent | undefined;
  if (!isInternalGatewayUrl(gatewayUrl)) {
    try {
      const validationUrl = toHttpValidationUrl(gatewayUrl);
      const { addresses } = await resolveAndValidatePublicHost(
        validationUrl,
        `WebRTC-Bridge-${sessionId}`,
      );
      const lookup = createPinnedLookup(addresses);
      const urlObj = new URL(gatewayUrl);
      agent = urlObj.protocol === 'wss:' ? new https.Agent({ lookup }) : new http.Agent({ lookup });
    } catch (error) {
      logger.error(`[WebRTC Bridge] SSRF 验证失败: ${sessionId}`, {
        error: getSafeErrorDetails(error),
      });
      dc.send(
        JSON.stringify({
          type: 'error',
          payload: 'remote-gateway URL 验证失败，请检查服务端网关配置',
        }),
      );
      return;
    }
  }

  // 连接到 remote-gateway（DNS pinning 消除 TOCTOU 竞态）
  const gatewayWs = new WebSocket(gatewayUrl, { agent });
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
        `[WebRTC Bridge] C→G: ${sessionId} (${msgCountClientToGateway}), len=${msgStr.length}`,
      );
    }

    // 转发到 remote-gateway
    gatewayWs.send(msg);
  });

  // remote-gateway → DataChannel（服务器 → 浏览器）
  gatewayWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (dcClosed) return;

    msgCountGatewayToClient++;
    if (msgCountGatewayToClient % 100 === 1) {
      logger.debug(
        `[WebRTC Bridge] G→C: ${sessionId} (${msgCountGatewayToClient}), len=${typeof data === 'string' ? data.length : data.length}`,
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
  let cleanedUp = false;
  function cleanup(reason: string): void {
    if (cleanedUp) return;
    cleanedUp = true;

    logger.info(
      `[WebRTC Bridge] 清理连接: ${sessionId}, 原因=${reason}, C→G=${msgCountClientToGateway}, G→C=${msgCountGatewayToClient}`,
    );

    clearTimeout(connectTimeout);

    if (!dcClosed) {
      dcClosed = true;
      try {
        dc.close();
      } catch (err: unknown) {
        logger.debug({ err }, '操作失败，已忽略');
      }
    }

    if (!gwClosed) {
      gwClosed = true;
      try {
        gatewayWs.close();
      } catch (err: unknown) {
        logger.debug({ err }, '操作失败，已忽略');
      }
    }

    // 通知调用方（signaling.ts）清理 session/pc
    onClosed?.();
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
