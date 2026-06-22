import http from 'http';
import url from 'url';
import net from 'net';
import { Request, RequestHandler } from 'express';
import { WebSocketServer } from 'ws';
import { AuthenticatedWebSocket } from './types';
import { SECURITY_CONFIG } from '../config/security.config';
import { isMultiplexEnabled } from './multiplex';
import { logger } from '../utils/logger';

type UpgradeRequestMeta = {
  clientIpAddress?: string;
  isRdpProxy?: boolean;
  isWebRTCSignaling?: boolean;
  rdpToken?: unknown;
  rdpWidth?: unknown;
  rdpHeight?: unknown;
  rdpDpi?: unknown;
};

type UpgradeRequest = Request & UpgradeRequestMeta;

function getUpgradeRequest(request: Request): UpgradeRequest {
  return request as UpgradeRequest;
}

export function initializeUpgradeHandler(
  server: http.Server,
  wss: WebSocketServer,
  sessionParser: RequestHandler,
): void {
  server.on('upgrade', (request: Request, socket, head) => {
    // --- 添加详细日志：检查传入的请求头和 request.ip ---
    logger.debug('[WebSocket Upgrade] Received upgrade request.');
    // 安全日志：仅记录非敏感头部（避免泄露 cookie/authorization）
    const safeHeaders = {
      origin: request.headers.origin,
      'user-agent': request.headers['user-agent'],
      'sec-websocket-version': request.headers['sec-websocket-version'],
      upgrade: request.headers.upgrade,
      connection: request.headers.connection,
      host: request.headers.host,
    };
    logger.debug('[WebSocket Upgrade] Safe Headers:', safeHeaders);
    logger.debug(`[WebSocket Upgrade] Initial request.ip value: ${request.ip}`); // Express 尝试解析的 IP
    logger.debug(`[WebSocket Upgrade] X-Real-IP Header: ${request.headers['x-real-ip']}`);
    logger.debug(
      `[WebSocket Upgrade] X-Forwarded-For Header: ${request.headers['x-forwarded-for']}`,
    );
    // --- 结束添加日志 ---

    const parsedUrl = url.parse(request.url || '', true); // Parse URL and query string
    const { pathname } = parsedUrl;

    // --- 安全的 IP 获取：仅在生产环境且在可信代理后才信任代理头部 ---
    let ipAddress: string | undefined;
    const isProduction = process.env.NODE_ENV === 'production';
    const xForwardedFor = request.headers['x-forwarded-for'];
    const xRealIp = request.headers['x-real-ip'];

    // 辅助函数：验证并返回合法 IP，失败则返回 undefined
    const validateAndExtractIp = (
      rawIp: string | undefined,
      source: string,
    ): string | undefined => {
      if (!rawIp) return undefined;
      const trimmedIp = rawIp.trim();
      // 使用 net.isIP() 验证：返回 4 (IPv4) 或 6 (IPv6)，0 表示无效
      if (net.isIP(trimmedIp)) {
        logger.debug(`[WebSocket Upgrade] Valid IP from ${source}: ${trimmedIp}`);
        return trimmedIp;
      } else {
        logger.warn(
          `[WebSocket Upgrade] Invalid IP format from ${source}: ${trimmedIp}, rejecting.`,
        );
        return undefined;
      }
    };

    // 仅在生产环境才信任代理头部（与 trust proxy 配置一致）
    if (isProduction) {
      if (xForwardedFor) {
        // 如果 X-Forwarded-For 存在，取列表中的第一个 IP 并验证
        const rawIp = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor.split(',')[0];
        ipAddress = validateAndExtractIp(rawIp, 'X-Forwarded-For');
      }
      if (!ipAddress && xRealIp) {
        // 否则，尝试 X-Real-IP 并验证
        const rawIp = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
        ipAddress = validateAndExtractIp(rawIp, 'X-Real-IP');
      }
      if (!ipAddress) {
        // 最后回退到 socket.remoteAddress（通常已是合法 IP）
        ipAddress = request.socket.remoteAddress;
        logger.debug(`[WebSocket Upgrade] Using socket.remoteAddress: ${ipAddress}`);
      }
    } else {
      // 开发环境直接使用 socket.remoteAddress，避免被欺骗
      ipAddress = request.socket.remoteAddress || request.ip;
      logger.debug(`[WebSocket Upgrade] Development mode - using direct socket IP: ${ipAddress}`);
    }

    // 确保 ipAddress 不是 undefined 或空字符串，否则设为 'unknown'
    ipAddress = ipAddress || 'unknown';
    logger.debug(`[WebSocket Upgrade] Determined IP Address: ${ipAddress}`);

    logger.debug(`WebSocket: 升级请求来自 IP: ${ipAddress}, Path: ${pathname}`); // 使用新获取的 ipAddress

    const noopResponse = {} as unknown as Parameters<RequestHandler>[1];
    sessionParser(request, noopResponse, () => {
      // --- Origin 校验 (CSWSH 防护) ---
      const { origin } = request.headers;
      logger.debug(`[WebSocket Upgrade] Origin Header: ${origin}`);

      if (!origin || !SECURITY_CONFIG.ALLOWED_WS_ORIGINS.includes(origin)) {
        logger.info(`[WebSocket Upgrade] REJECTED - Origin not in allowlist: ${origin}`);
        logger.debug(`[WebSocket Upgrade] Allowed origins:`, SECURITY_CONFIG.ALLOWED_WS_ORIGINS);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      logger.debug(`[WebSocket Upgrade] Origin validation passed: ${origin}`);

      // --- 认证检查 ---
      if (!request.session || !request.session.userId) {
        logger.info(`WebSocket 认证失败 (Path: ${pathname})：未找到会话或用户未登录。`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      logger.debug(
        `WebSocket 认证成功 (Path: ${pathname})：用户 ${request.session.username} (ID: ${request.session.userId})`,
      );
      const typedRequest = getUpgradeRequest(request);

      // --- 根据路径处理升级 ---
      // WebRTC 信令路径
      if (pathname === '/webrtc-signaling' || pathname === '/ws/webrtc-signaling') {
        logger.debug(
          `WebSocket: Handling WebRTC signaling upgrade for user ${request.session.username}`,
        );
        wss.handleUpgrade(request, socket, head, (ws) => {
          const extWs = ws as AuthenticatedWebSocket;
          extWs.userId = request.session.userId;
          extWs.username = request.session.username;
          typedRequest.clientIpAddress = ipAddress;
          typedRequest.isWebRTCSignaling = true;
          wss.emit('connection', extWs, request);
        });
      }
      // 本地调试用/rdp-proxy，nginx反代用/ws/rdp-proxy
      else if (pathname === '/rdp-proxy' || pathname === '/ws/rdp-proxy') {
        // RDP 代理路径 - 直接处理升级，连接逻辑在 'connection' 事件中处理
        logger.debug(`WebSocket: Handling RDP proxy upgrade for user ${request.session.username}`);
        wss.handleUpgrade(request, socket, head, (ws) => {
          const extWs = ws as AuthenticatedWebSocket;
          extWs.userId = request.session.userId;
          extWs.username = request.session.username;
          // 传递必要信息给 connection 事件
          typedRequest.clientIpAddress = ipAddress;
          typedRequest.isRdpProxy = true; // 标记为 RDP 代理连接
          // 传递 RDP token 和其他参数
          typedRequest.rdpToken = parsedUrl.query.token;
          typedRequest.rdpWidth = parsedUrl.query.width;
          typedRequest.rdpHeight = parsedUrl.query.height;
          typedRequest.rdpDpi = parsedUrl.query.dpi;
          wss.emit('connection', extWs, request);
        });
      } else {
        // 默认路径 (SSH, SFTP, Docker etc.) - 按原逻辑处理
        logger.debug(`WebSocket: Handling standard upgrade for user ${request.session.username}`);
        wss.handleUpgrade(request, socket, head, (ws) => {
          const extWs = ws as AuthenticatedWebSocket;
          extWs.userId = request.session.userId;
          extWs.username = request.session.username;
          typedRequest.clientIpAddress = ipAddress;
          typedRequest.isRdpProxy = false; // 标记为非 RDP 代理连接

          // 检测多路复用协议（支持逗号分隔的协议列表）
          const secProtocol = request.headers['sec-websocket-protocol'];
          const protocols = Array.isArray(secProtocol)
            ? secProtocol
            : (secProtocol?.split(',').map((p) => p.trim()) ?? []);
          if (isMultiplexEnabled() && protocols.includes('nexus-mux')) {
            extWs.isMultiplex = true;
            logger.debug(`WebSocket: 多路复用模式已启用 (用户: ${request.session.username})`);
          }

          wss.emit('connection', extWs, request);
        });
      }
    });
  });
  logger.info('WebSocket upgrade handler initialized.');
}
