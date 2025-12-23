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

    // Session Cookie 最大存活时间 (10 年 - Remember Me)
    SESSION_COOKIE_MAX_AGE: 315360000000,

    // bcrypt 盐轮次
    BCRYPT_SALT_ROUNDS: 10,
} as const;

// 类型导出
export type SecurityConfig = typeof SECURITY_CONFIG;
