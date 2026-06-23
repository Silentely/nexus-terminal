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
 *
 * 安全响应头策略：
 * - 默认由 Express（Helmet + 补充头）设置，适用于直连场景（无反向代理）
 * - 当 BEHIND_REVERSE_PROXY=true 时，跳过 Express 端安全头，由反向代理（Nginx/Cloudflare）统一管理
 *   避免重复头导致 CSP 交叉限制（浏览器对多个 CSP 头取交集，可能破坏功能）
 */
export const registerSecurityMiddleware = (app: express.Application) => {
  // 1. 安全响应头控制
  // BEHIND_REVERSE_PROXY=true 表示前端有 Nginx/Cloudflare 等反向代理负责设置安全头
  // 此时 Express 跳过安全头设置，避免重复
  const behindReverseProxy = process.env.BEHIND_REVERSE_PROXY === 'true';

  if (!behindReverseProxy) {
    // Helmet - HTTP 安全头（CSP、X-Content-Type-Options、X-Frame-Options、Referrer-Policy 等）
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
              "'self'",
              "'unsafe-inline'",
              'https://static.cloudflareinsights.com',
              'https://cdn-cgi.cloudflare.com',
              // Google reCAPTCHA（LoginView vue3-recaptcha2 组件动态注入）
              'https://www.google.com',
              'https://www.gstatic.com',
              // hCaptcha（LoginView @hcaptcha/vue3-hcaptcha 组件动态注入）
              'https://hcaptcha.com',
              'https://js.hcaptcha.com',
              'https://newassets.hcaptcha.com',
            ],
            styleSrc: [
              "'self'",
              "'unsafe-inline'",
              // Google Fonts CSS（index.html 预加载）
              'https://fonts.googleapis.com',
            ],
            connectSrc: [
              "'self'",
              'ws:',
              'wss:',
              'https://static.cloudflareinsights.com',
              'https://cdn-cgi.cloudflare.com',
              // reCAPTCHA API 通信
              'https://www.google.com',
              'https://www.gstatic.com',
              // hCaptcha API 通信
              'https://hcaptcha.com',
              'https://js.hcaptcha.com',
              'https://newassets.hcaptcha.com',
            ],
            imgSrc: [
              "'self'",
              'data:',
              'blob:',
              // reCAPTCHA 验证图片
              'https://www.gstatic.com',
              'https://*.google.com',
              // hCaptcha 验证图片
              'https://hcaptcha.com',
              'https://js.hcaptcha.com',
              'https://newassets.hcaptcha.com',
            ],
            // CAPTCHA iframe（reCAPTCHA/hCaptcha v2 widget 弹窗）
            frameSrc: [
              "'self'",
              'https://www.google.com',
              'https://www.gstatic.com',
              'https://hcaptcha.com',
              'https://js.hcaptcha.com',
              'https://newassets.hcaptcha.com',
              'https://*.hcaptcha.com',
            ],
            fontSrc: [
              "'self'",
              'data:',
              // Google Fonts 字体文件（index.html 预加载）
              'https://fonts.googleapis.com',
              'https://fonts.gstatic.com',
            ],
            // Cloudflare Access 受保护域名的 manifest 加载（PWA manifest.json 可能被 Access 拦截）
            manifestSrc: ["'self'", 'https://*.cloudflareaccess.com'],
          },
        },
        crossOriginEmbedderPolicy: false,
      }),
    );

    // Helmet 未覆盖的补充安全头
    const enableHsts = process.env.ENABLE_HSTS === 'true';

    app.use((_req, res, next) => {
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

    logger.info('[安全头] 由 Express 设置（直连模式）');
  } else {
    logger.info('[安全头] 已跳过（BEHIND_REVERSE_PROXY=true，由反向代理管理）');
  }

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
};
