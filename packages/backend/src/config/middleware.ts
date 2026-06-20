/**
 * 中间件配置模块
 * 从 index.ts 提取，集中管理 Express 中间件的配置与注册
 */

import express, { Request, RequestHandler } from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cors from 'cors';
import { normalizeOrigin } from '../utils/url';
import { ipWhitelistMiddleware } from '../auth/ipWhitelist.middleware';
import { metricsMiddleware } from '../metrics/metrics.middleware';
import { logger } from '../utils/logger';

/**
 * 解析正整数环境变量
 */
const parsePositiveIntEnv = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * 限流 key 生成器：优先按用户 ID，否则按 IP
 */
const getRateLimitKey = (req: Request) => {
  if (req.session?.userId) return `uid:${req.session.userId}`;
  return ipKeyGenerator(req.ip || 'unknown');
};

/**
 * 创建 API 限流中间件
 */
export const createApiLimiter = () => {
  const windowMs = parsePositiveIntEnv(process.env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  const max = parsePositiveIntEnv(process.env.API_RATE_LIMIT_MAX, 300);
  return rateLimit({
    windowMs,
    max,
    message: '请求过于频繁，请稍后再试',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitKey,
  });
};

/**
 * 创建 Settings 限流中间件（更宽松）
 */
export const createSettingsLimiter = () => {
  const windowMs = parsePositiveIntEnv(process.env.SETTINGS_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  const max = parsePositiveIntEnv(process.env.SETTINGS_RATE_LIMIT_MAX, 500);
  return rateLimit({
    windowMs,
    max,
    message: '请求过于频繁，请稍后再试',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitKey,
  });
};

/**
 * 信任代理配置
 */
export const configureTrustProxy = (app: express.Application) => {
  const trustProxyEnv = process.env.TRUST_PROXY;
  let trustProxyValue: number | boolean | string = false;

  if (trustProxyEnv) {
    if (trustProxyEnv.toLowerCase() === 'true') trustProxyValue = true;
    else if (trustProxyEnv.toLowerCase() === 'false') trustProxyValue = false;
    else {
      const parsed = parseInt(trustProxyEnv, 10);
      trustProxyValue = Number.isNaN(parsed) ? trustProxyEnv : parsed;
    }
  } else if (process.env.TRUST_PROXY_HOPS) {
    const parsedHops = parseInt(process.env.TRUST_PROXY_HOPS, 10);
    if (!Number.isNaN(parsedHops)) {
      trustProxyValue = parsedHops;
    }
  }

  app.set('trust proxy', trustProxyValue);
};

/**
 * 注册安全中间件（Helmet、CORS、IP 白名单、JSON 解析、指标采集、安全响应头）
 */
export const registerSecurityMiddleware = (app: express.Application) => {
  // 1. Helmet - HTTP 安全头
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 2. CORS - 跨域资源共享
  const baseAllowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:18111'];

  if (!process.env.ALLOWED_ORIGINS && process.env.NODE_ENV === 'production') {
    logger.warn(
      '[CORS] 生产环境未设置 ALLOWED_ORIGINS，正在使用默认值（localhost）。请配置 ALLOWED_ORIGINS 环境变量以限制允许的跨域来源。',
    );
  }

  const rpConfiguredOrigins = process.env.RP_ORIGIN
    ? process.env.RP_ORIGIN.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  const allowedOrigins = Array.from(
    new Set(
      [...baseAllowedOrigins, ...rpConfiguredOrigins]
        .map((origin) => normalizeOrigin(origin) || origin)
        .filter(Boolean),
    ),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const normalizedOrigin = normalizeOrigin(origin) || origin;
        if (allowedOrigins.includes(normalizedOrigin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    }),
  );

  // 3. IP 白名单、JSON 解析、指标采集
  app.use(ipWhitelistMiddleware as RequestHandler);
  app.use(express.json({ limit: '1mb' }));
  app.use(metricsMiddleware as RequestHandler);

  // 4. 安全响应头
  const enableHsts = process.env.ENABLE_HSTS === 'true';

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; font-src 'self' data:",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // P1-3: 补齐安全头
    // HSTS — 仅在 ENABLE_HSTS=true 时启用，避免开发环境强制跳转 HTTPS
    if (enableHsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // 限制浏览器特性访问
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // 跨域隔离策略 — 防止跨域窗口引用
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // 跨域资源策略 — 同源部署用 same-origin，跨域部署需要 cross-origin
    // 默认 cross-origin 以兼容前后端分离部署场景（ALLOWED_ORIGINS 配置）
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    next();
  });
};
