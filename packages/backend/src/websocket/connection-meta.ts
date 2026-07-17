/**
 * WebSocket 连接元信息工具
 * 从 connection.ts 抽出，便于单测与复用。
 */
import type { Request } from 'express';
import type { AuthenticatedWebSocket } from './types';

/** 升级请求上挂载的额外元数据 */
export type ConnectionRequestMeta = {
  clientType?: unknown;
  isRdpProxy?: unknown;
  isWebRTCSignaling?: unknown;
  clientIpAddress?: unknown;
};

/**
 * 读取连接升级阶段写入的请求元数据
 */
export function getConnectionRequestMeta(request: Request): ConnectionRequestMeta {
  return request as Request & ConnectionRequestMeta;
}

/**
 * 校验客户端类型参数
 */
export function isClientType(value: unknown): value is 'desktop' | 'mobile' {
  return value === 'desktop' || value === 'mobile';
}

/**
 * 统一生成速率限制 key，确保检查与清理使用相同逻辑
 */
export function getRateLimitKey(ws: AuthenticatedWebSocket): string {
  return ws.sessionId || `ws_${ws.userId || 'anon'}`;
}

/**
 * 根据 User-Agent 检测客户端类型
 */
export function detectClientType(userAgent: string): 'mobile' | 'desktop' {
  const mobileKeywords = [
    'Mobile',
    'Android',
    'iPhone',
    'iPad',
    'iPod',
    'BlackBerry',
    'Windows Phone',
    'webOS',
  ];

  const lowerUA = userAgent.toLowerCase();
  const isMobile = mobileKeywords.some((keyword) => lowerUA.includes(keyword.toLowerCase()));

  return isMobile ? 'mobile' : 'desktop';
}
