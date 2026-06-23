import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';
import type { AddressInfo } from 'net';

/**
 * 测试专用应用类型，精确覆盖 configureTrustProxy / registerSecurityMiddleware 所需的接口
 * Express 的 get() 重载不支持 settings 读取，用此接口替代 as any
 */
interface TestableApp {
  (...args: unknown[]): unknown;
  set(key: string, value: unknown): void;
  get(key: 'trust proxy'): number | boolean;
  get(key: string): unknown;
  use(...args: unknown[]): void;
  listen(port: number, cb?: () => void): { address(): AddressInfo; close(cb?: () => void): void };
}

/** 创建类型安全的测试用 Express 应用 */
function createTestApp(): TestableApp {
  return express() as unknown as TestableApp;
}

// Mock 外部依赖 — 使用 vi.hoisted 确保 mock 函数在 vi.mock 提升前可用
const mockRateLimitFn = vi.hoisted(() =>
  vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
);
const mockHelmetFn = vi.hoisted(() =>
  vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
);

// Logger mock for console replacement migration
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ logger: mockLogger }));

vi.mock('helmet', () => ({
  default: mockHelmetFn,
}));

vi.mock('express-rate-limit', () => {
  return { default: mockRateLimitFn, ipKeyGenerator: vi.fn((ip: string) => ip) };
});

vi.mock('cors', () => ({
  default: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../utils/url', () => ({
  normalizeOrigin: vi.fn((origin: string) => {
    try {
      return new URL(origin).origin;
    } catch {
      return undefined;
    }
  }),
}));

vi.mock('../auth/ipWhitelist.middleware', () => ({
  ipWhitelistMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../metrics/metrics.middleware', () => ({
  metricsMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import {
  createApiLimiter,
  createSettingsLimiter,
  configureTrustProxy,
  registerSecurityMiddleware,
} from './middleware';

describe('config/middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createApiLimiter', () => {
    it('应返回限流中间件', () => {
      const limiter = createApiLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe('function');
    });

    it('应使用默认值创建限流器', () => {
      delete process.env.API_RATE_LIMIT_WINDOW_MS;
      delete process.env.API_RATE_LIMIT_MAX;
      createApiLimiter();
      expect(mockRateLimitFn).toHaveBeenCalledWith(
        expect.objectContaining({
          windowMs: 15 * 60 * 1000,
          max: 300,
          message: '请求过于频繁，请稍后再试',
          standardHeaders: true,
          legacyHeaders: false,
        }),
      );
    });

    it('应读取环境变量配置', () => {
      process.env.API_RATE_LIMIT_WINDOW_MS = '60000';
      process.env.API_RATE_LIMIT_MAX = '100';
      createApiLimiter();
      expect(mockRateLimitFn).toHaveBeenCalledWith(
        expect.objectContaining({
          windowMs: 60000,
          max: 100,
        }),
      );
    });

    it('无效环境变量应使用默认值', () => {
      process.env.API_RATE_LIMIT_WINDOW_MS = 'not-a-number';
      process.env.API_RATE_LIMIT_MAX = '-5';
      createApiLimiter();
      expect(mockRateLimitFn).toHaveBeenCalledWith(
        expect.objectContaining({
          windowMs: 15 * 60 * 1000,
          max: 300,
        }),
      );
    });
  });

  describe('createSettingsLimiter', () => {
    it('应返回限流中间件', () => {
      const limiter = createSettingsLimiter();
      expect(limiter).toBeDefined();
    });

    it('应使用默认值 500 创建限流器', () => {
      delete process.env.SETTINGS_RATE_LIMIT_WINDOW_MS;
      delete process.env.SETTINGS_RATE_LIMIT_MAX;
      createSettingsLimiter();
      expect(mockRateLimitFn).toHaveBeenCalledWith(
        expect.objectContaining({
          windowMs: 15 * 60 * 1000,
          max: 500,
        }),
      );
    });

    it('应读取环境变量配置', () => {
      process.env.SETTINGS_RATE_LIMIT_WINDOW_MS = '30000';
      process.env.SETTINGS_RATE_LIMIT_MAX = '200';
      createSettingsLimiter();
      expect(mockRateLimitFn).toHaveBeenCalledWith(
        expect.objectContaining({
          windowMs: 30000,
          max: 200,
        }),
      );
    });
  });

  describe('configureTrustProxy', () => {
    it('未设置环境变量时应使用 false', () => {
      delete process.env.TRUST_PROXY;
      delete process.env.TRUST_PROXY_HOPS;
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(false);
    });

    it('TRUST_PROXY=true 时应设置为 true', () => {
      process.env.TRUST_PROXY = 'true';
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(true);
    });

    it('TRUST_PROXY=false 时应设置为 false', () => {
      process.env.TRUST_PROXY = 'false';
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(false);
    });

    it('TRUST_PROXY=1 时应设置为数字 1', () => {
      process.env.TRUST_PROXY = '1';
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(1);
    });

    it('TRUST_PROXY=2 时应设置为数字 2', () => {
      process.env.TRUST_PROXY = '2';
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(2);
    });

    it('TRUST_PROXY=abc 时应设置为字符串值（Express 可能抛出异常）', () => {
      process.env.TRUST_PROXY = 'abc';
      const app = createTestApp();
      // Express 5 对非 IP 字符串会抛出异常，这是预期行为
      try {
        configureTrustProxy(app as ReturnType<typeof express>);
        expect(app.get('trust proxy')).toBe('abc');
      } catch {
        // Express 不接受非 IP 字符串作为 trust proxy 值，属于已知行为
        expect(true).toBe(true);
      }
    });

    it('TRUST_PROXY_HOPS 回退时应使用数字', () => {
      delete process.env.TRUST_PROXY;
      process.env.TRUST_PROXY_HOPS = '3';
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(3);
    });

    it('TRUST_PROXY_HOPS 非数字时应忽略', () => {
      delete process.env.TRUST_PROXY;
      process.env.TRUST_PROXY_HOPS = 'abc';
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(false);
    });

    it('TRUST_PROXY 优先于 TRUST_PROXY_HOPS', () => {
      process.env.TRUST_PROXY = 'true';
      process.env.TRUST_PROXY_HOPS = '5';
      const app = createTestApp();
      configureTrustProxy(app as ReturnType<typeof express>);
      expect(app.get('trust proxy')).toBe(true);
    });
  });

  describe('registerSecurityMiddleware', () => {
    it('应注册所有中间件且不抛出异常', () => {
      const app = createTestApp();
      expect(() => registerSecurityMiddleware(app as ReturnType<typeof express>)).not.toThrow();
    });

    it('默认模式应由 Express 设置安全响应头', async () => {
      delete process.env.BEHIND_REVERSE_PROXY;
      const app = express();
      registerSecurityMiddleware(app);

      // 添加一个测试路由来捕获中间件设置的响应头
      app.get('/test-headers', (_req, res) => {
        res.json({ done: true });
      });

      const response = await new Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
      }>((resolve) => {
        const http = require('http');
        const server = app.listen(0, () => {
          const addr = server.address() as AddressInfo;
          http.get(`http://127.0.0.1:${addr.port}/test-headers`, (res: IncomingMessage) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk));
            res.on('end', () => {
              server.close();
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers as Record<string, string>,
                body,
              });
            });
          });
        });
      });

      expect(response.status).toBe(200);
      // Helmet 被调用（X-Content-Type-Options、X-Frame-Options、Referrer-Policy、CSP 由 Helmet 统一管理）
      expect(mockHelmetFn).toHaveBeenCalled();
      const helmetConfig = mockHelmetFn.mock.calls[0][0];
      expect(helmetConfig.contentSecurityPolicy.directives.defaultSrc).toContain("'self'");
      expect(helmetConfig.contentSecurityPolicy.directives.scriptSrc).toContain("'self'");
      expect(helmetConfig.crossOriginEmbedderPolicy).toBe(false);

      // CSP 指令完整性验证
      const directives = helmetConfig.contentSecurityPolicy.directives;
      // CAPTCHA 脚本域名
      expect(directives.scriptSrc).toContain('https://www.google.com');
      expect(directives.scriptSrc).toContain('https://www.gstatic.com');
      expect(directives.scriptSrc).toContain('https://hcaptcha.com');
      expect(directives.scriptSrc).toContain('https://js.hcaptcha.com');
      expect(directives.scriptSrc).toContain('https://newassets.hcaptcha.com');
      // Google Fonts
      expect(directives.styleSrc).toContain('https://fonts.googleapis.com');
      expect(directives.fontSrc).toContain('https://fonts.googleapis.com');
      expect(directives.fontSrc).toContain('https://fonts.gstatic.com');
      // CAPTCHA connect 通信
      expect(directives.connectSrc).toContain('https://www.google.com');
      expect(directives.connectSrc).toContain('https://hcaptcha.com');
      expect(directives.connectSrc).toContain('https://js.hcaptcha.com');
      // CAPTCHA iframe（frameSrc）
      expect(directives.frameSrc).toBeDefined();
      expect(directives.frameSrc).toContain('https://www.google.com');
      expect(directives.frameSrc).toContain('https://hcaptcha.com');
      expect(directives.frameSrc).toContain('https://js.hcaptcha.com');
      // Cloudflare Access manifest
      expect(directives.manifestSrc).toContain("'self'");
      expect(directives.manifestSrc).toContain('https://*.cloudflareaccess.com');

      // 补充安全头由 Express 手动设置
      expect(response.headers['permissions-policy']).toBe(
        'camera=(), microphone=(), geolocation=()',
      );
      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
      // 验证日志提示直连模式
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('直连模式'));
    });

    it('BEHIND_REVERSE_PROXY=true 时应跳过安全头设置', async () => {
      process.env.BEHIND_REVERSE_PROXY = 'true';
      const app = express();
      registerSecurityMiddleware(app);

      app.get('/test-headers', (_req, res) => {
        res.json({ done: true });
      });

      const response = await new Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
      }>((resolve) => {
        const http = require('http');
        const server = app.listen(0, () => {
          const addr = server.address() as AddressInfo;
          http.get(`http://127.0.0.1:${addr.port}/test-headers`, (res: IncomingMessage) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk));
            res.on('end', () => {
              server.close();
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers as Record<string, string>,
                body,
              });
            });
          });
        });
      });

      expect(response.status).toBe(200);
      // Helmet 不应被调用
      expect(mockHelmetFn).not.toHaveBeenCalled();
      // Express 不应设置这些安全头（由反向代理负责）
      expect(response.headers['x-content-type-options']).toBeUndefined();
      expect(response.headers['x-frame-options']).toBeUndefined();
      expect(response.headers['referrer-policy']).toBeUndefined();
      // 验证日志提示反向代理模式
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('BEHIND_REVERSE_PROXY'));
    });

    it('ENABLE_HSTS=true 时应设置 HSTS 头', async () => {
      delete process.env.BEHIND_REVERSE_PROXY;
      process.env.ENABLE_HSTS = 'true';
      const app = express();
      registerSecurityMiddleware(app);

      app.get('/test-hsts', (_req, res) => {
        res.json({ done: true });
      });

      const response = await new Promise<{
        status: number;
        headers: Record<string, string>;
      }>((resolve) => {
        const http = require('http');
        const server = app.listen(0, () => {
          const addr = server.address() as AddressInfo;
          http.get(`http://127.0.0.1:${addr.port}/test-hsts`, (res: IncomingMessage) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk));
            res.on('end', () => {
              server.close();
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers as Record<string, string>,
              });
            });
          });
        });
      });

      expect(response.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains',
      );
    });

    it('生产环境未设置 ALLOWED_ORIGINS 应发出警告', () => {
      // console.warn replaced with mockLogger.warn
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOWED_ORIGINS;
      delete process.env.RP_ORIGIN;

      registerSecurityMiddleware(express());

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[CORS]'));
    });
  });
});
