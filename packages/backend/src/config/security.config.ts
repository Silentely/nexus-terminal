/**
 * 安全配置常量
 * 集中管理所有安全相关的超时时间和配置值
 */
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

  // bcrypt 盐轮次
  BCRYPT_SALT_ROUNDS: 10,

  // WebSocket 允许的 Origin 白名单 (CSWSH 防护)
  ALLOWED_WS_ORIGINS: [
    'http://localhost:5173', // 开发环境前端
    'http://localhost:3001', // 开发环境后端
    'http://localhost:18111', // Docker 部署端口
  ] as readonly string[],
} as const;

// 类型导出
export type SecurityConfig = typeof SECURITY_CONFIG;
