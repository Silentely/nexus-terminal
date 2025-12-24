/**
 * 安全配置常量
 * 集中管理所有安全相关的超时时间和配置值
 */

// 构建 WebSocket 允许的 Origin 白名单
// 默认包含开发环境地址，支持通过环境变量添加生产域名
const buildAllowedWsOrigins = (): string[] => {
  const defaultOrigins = [
    'http://localhost:5173', // 开发环境前端
    'http://localhost:3001', // 开发环境后端
    'http://localhost:18111', // Docker 部署端口
  ];

  // 从环境变量 ALLOWED_WS_ORIGINS 读取额外域名（逗号分隔）
  // 例如: ALLOWED_WS_ORIGINS=https://ssh.cosr.eu,https://example.com
  const envOrigins = process.env.ALLOWED_WS_ORIGINS;
  if (envOrigins) {
    const additionalOrigins = envOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    defaultOrigins.push(...additionalOrigins);
  }

  // 如果设置了 RP_ORIGIN（Passkey 配置），也自动添加到白名单
  // 这通常是生产环境的域名
  const rpOrigin = process.env.RP_ORIGIN;
  if (rpOrigin && !defaultOrigins.includes(rpOrigin)) {
    defaultOrigins.push(rpOrigin);
  }

  return defaultOrigins;
};

export const SECURITY_CONFIG = {
  // WebAuthn Challenge 超时 (5 分钟)
  CHALLENGE_TIMEOUT: 5 * 60 * 1000,

  // 2FA 临时认证超时 (5 分钟)
  PENDING_AUTH_TIMEOUT: 5 * 60 * 1000,

  // 临时令牌长度 (32 字节)
  TEMP_TOKEN_LENGTH: 32,

  // Session Cookie 最大存活时间 (30 天 - Remember Me)
  // 与 Session Store TTL (packages/backend/src/index.ts:319) 保持一致
  SESSION_COOKIE_MAX_AGE: 30 * 24 * 60 * 60 * 1000, // 2592000000 毫秒

  // bcrypt 盐轮次 (2025年推荐值：12-14)
  BCRYPT_SALT_ROUNDS: 12,

  // WebSocket 允许的 Origin 白名单 (CSWSH 防护)
  // 支持通过环境变量配置：ALLOWED_WS_ORIGINS 或 RP_ORIGIN
  ALLOWED_WS_ORIGINS: buildAllowedWsOrigins(),
} as const;

// 类型导出
export type SecurityConfig = typeof SECURITY_CONFIG;
