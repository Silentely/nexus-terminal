/**
 * 速率限制配置
 * 为不同类型的 API 端点提供差异化的限流策略
 */
import rateLimit from 'express-rate-limit';

/**
 * 严格限流器 - 用于登录相关端点（防暴力破解）
 * 适用于：/login, /login/2fa, /passkey/authenticate, /setup
 */
export const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟窗口
  max: 5, // 最多 5 次尝试
  message: { message: '登录尝试次数过多，请 15 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  // 使用 IP 地址作为限流键
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
});

/**
 * 中等限流器 - 用于认证选项生成等端点
 * 适用于：/passkey/authentication-options, /passkey/registration-options
 */
export const moderateAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟窗口
  max: 30, // 最多 30 次请求
  message: { message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
});

/**
 * 宽松限流器 - 用于一般 API 端点
 * 适用于：只读配置查询、认证状态检查等
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟窗口
  max: 100, // 最多 100 次请求
  message: { message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
});
