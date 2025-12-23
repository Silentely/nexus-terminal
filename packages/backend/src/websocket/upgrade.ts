import http from 'http';
import url from 'url';
import net from 'net';
import { Request, RequestHandler } from 'express';
import { WebSocketServer } from 'ws';
import { AuthenticatedWebSocket } from './types';
import { SECURITY_CONFIG } from '../config/security.config';

export function initializeUpgradeHandler(
  server: http.Server,
  wss: WebSocketServer,
  sessionParser: RequestHandler
): void {
  server.on('upgrade', (request: Request, socket, head) => {
    // --- 添加详细日志：检查传入的请求头和 request.ip ---
    console.log('[WebSocket Upgrade] Received upgrade request.');
    // 安全日志：仅记录非敏感头部（避免泄露 cookie/authorization）
    const safeHeaders = {
      origin: request.headers.origin,
      'user-agent': request.headers['user-agent'],
      'sec-websocket-key': request.headers['sec-websocket-key'],
      'sec-websocket-version': request.headers['sec-websocket-version'],
      upgrade: request.headers.upgrade,
      connection: request.headers.connection,
      host: request.headers.host,
    };
    console.log('[WebSocket Upgrade] Safe Headers:', safeHeaders);
    console.log(`[WebSocket Upgrade] Initial request.ip value: ${request.ip}`); // Express 尝试解析的 IP
    console.log(`[WebSocket Upgrade] X-Real-IP Header: ${request.headers['x-real-ip']}`);
    console.log(
      `[WebSocket Upgrade] X-Forwarded-For Header: ${request.headers['x-forwarded-for']}`
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
    const validateAndExtractIp = (rawIp: string | undefined, source: string): string | undefined => {
      if (!rawIp) return undefined;
      const trimmedIp = rawIp.trim();
      // 使用 net.isIP() 验证：返回 4 (IPv4) 或 6 (IPv6)，0 表示无效
      if (net.isIP(trimmedIp)) {
        console.log(`[WebSocket Upgrade] Valid IP from ${source}: ${trimmedIp}`);
        return trimmedIp;
      } else {
        console.warn(`[WebSocket Upgrade] Invalid IP format from ${source}: ${trimmedIp}, rejecting.`);
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
        console.log(`[WebSocket Upgrade] Using socket.remoteAddress: ${ipAddress}`);
      }
    } else {
      // 开发环境直接使用 socket.remoteAddress，避免被欺骗
      ipAddress = request.socket.remoteAddress || request.ip;
      console.log(`[WebSocket Upgrade] Development mode - using direct socket IP: ${ipAddress}`);
    }

    // 确保 ipAddress 不是 undefined 或空字符串，否则设为 'unknown'
    ipAddress = ipAddress || 'unknown';
    console.log(`[WebSocket Upgrade] Determined IP Address: ${ipAddress}`);

    console.log(`WebSocket: 升级请求来自 IP: ${ipAddress}, Path: ${pathname}`); // 使用新获取的 ipAddress

    // @ts-ignore Express-session 类型问题
    sessionParser(request, {} as any, () => {
      // --- Origin 校验 (CSWSH 防护) ---
      const { origin } = request.headers;
      console.log(`[WebSocket Upgrade] Origin Header: ${origin}`);

      if (!origin || !SECURITY_CONFIG.ALLOWED_WS_ORIGINS.includes(origin)) {
        console.log(`[WebSocket Upgrade] REJECTED - Origin not in allowlist: ${origin}`);
        console.log(`[WebSocket Upgrade] Allowed origins:`, SECURITY_CONFIG.ALLOWED_WS_ORIGINS);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      console.log(`[WebSocket Upgrade] Origin validation passed: ${origin}`);

      // --- 认证检查 ---
      if (!request.session || !request.session.userId) {
        console.log(`WebSocket 认证失败 (Path: ${pathname})：未找到会话或用户未登录。`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      console.log(
        `WebSocket 认证成功 (Path: ${pathname})：用户 ${request.session.username} (ID: ${request.session.userId})`
      );

      // --- 根据路径处理升级 ---
      // 本地调试用/rdp-proxy，nginx反代用/ws/rdp-proxy
      if (pathname === '/rdp-proxy' || pathname === '/ws/rdp-proxy') {
        // RDP 代理路径 - 直接处理升级，连接逻辑在 'connection' 事件中处理
        console.log(`WebSocket: Handling RDP proxy upgrade for user ${request.session.username}`);
        wss.handleUpgrade(request, socket, head, (ws) => {
          const extWs = ws as AuthenticatedWebSocket;
          extWs.userId = request.session.userId;
          extWs.username = request.session.username;
          // 传递必要信息给 connection 事件
          (request as any).clientIpAddress = ipAddress;
          (request as any).isRdpProxy = true; // 标记为 RDP 代理连接
          // 传递 RDP token 和其他参数
          (request as any).rdpToken = parsedUrl.query.token;
          (request as any).rdpWidth = parsedUrl.query.width;
          (request as any).rdpHeight = parsedUrl.query.height;
          (request as any).rdpDpi = parsedUrl.query.dpi;
          wss.emit('connection', extWs, request);
        });
      } else {
        // 默认路径 (SSH, SFTP, Docker etc.) - 按原逻辑处理
        console.log(`WebSocket: Handling standard upgrade for user ${request.session.username}`);
        wss.handleUpgrade(request, socket, head, (ws) => {
          const extWs = ws as AuthenticatedWebSocket;
          extWs.userId = request.session.userId;
          extWs.username = request.session.username;
          (request as any).clientIpAddress = ipAddress;
          (request as any).isRdpProxy = false; // 标记为非 RDP 代理连接
          wss.emit('connection', extWs, request);
        });
      }
    });
  });
  console.log('WebSocket upgrade handler initialized.');
}
