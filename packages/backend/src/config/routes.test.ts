import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction, Express, RequestHandler } from 'express';

// Mock 所有路由模块
const mockRouter = vi.hoisted(() => {
  const r = (() => {}) as Express;
  r.use = vi.fn() as unknown as Express['use'];
  r.get = vi.fn() as unknown as Express['get'];
  r.post = vi.fn() as unknown as Express['post'];
  return r;
});

vi.mock('../auth/auth.routes', () => ({ default: mockRouter }));
vi.mock('../connections/connections.routes', () => ({ default: mockRouter }));
vi.mock('../sftp/sftp.routes', () => ({ default: mockRouter }));
vi.mock('../proxies/proxies.routes', () => ({ default: mockRouter }));
vi.mock('../tags/tags.routes', () => ({ default: mockRouter }));
vi.mock('../settings/settings.routes', () => ({ default: mockRouter }));
vi.mock('../notifications/notification.routes', () => ({ default: mockRouter }));
vi.mock('../audit/audit.routes', () => ({ default: mockRouter }));
vi.mock('../command-history/command-history.routes', () => ({ default: mockRouter }));
vi.mock('../quick-commands/quick-commands.routes', () => ({ default: mockRouter }));
vi.mock('../terminal-themes/terminal-theme.routes', () => ({ default: mockRouter }));
vi.mock('../appearance/appearance.routes', () => ({ default: mockRouter }));
vi.mock('../ssh-keys/ssh-keys.routes', () => ({ default: mockRouter }));
vi.mock('../quick-command-tags/quick-command-tag.routes', () => ({ default: mockRouter }));
vi.mock('../ssh-suspend/ssh-suspend.routes', () => ({ default: mockRouter }));
vi.mock('../transfers/transfers.routes', () => ({ transfersRoutes: () => mockRouter }));
vi.mock('../path-history/path-history.routes', () => ({ default: mockRouter }));
vi.mock('../favorite-paths/favorite-paths.routes', () => ({ default: mockRouter }));
vi.mock('../passkey/passkey.routes', () => ({ default: mockRouter }));
vi.mock('../batch/batch.routes', () => ({ default: mockRouter }));
vi.mock('../ai-ops/ai.routes', () => ({ default: mockRouter }));
vi.mock('../services/dashboard.routes', () => ({ default: mockRouter }));
vi.mock('../metrics/metrics.routes', () => ({ default: mockRouter }));
vi.mock('../backup/backup.routes', () => ({ default: mockRouter }));
vi.mock('../middleware/error.middleware', () => ({
  errorHandler: (_err: Error, _req: Request, _res: Response, _next: NextFunction) => {},
  notFoundHandler: (_req: Request, _res: Response) => {},
}));
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn(),
}));

import { registerRoutes } from './routes';

describe('config/routes', () => {
  let mockApp: { use: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let useCalls: unknown[][];
  let getCalls: unknown[][];

  const mockApiLimiter = vi.fn((_req: Request, _res: Response, next: NextFunction) =>
    next(),
  ) as unknown as RequestHandler;
  const mockSettingsLimiter = vi.fn((_req: Request, _res: Response, next: NextFunction) =>
    next(),
  ) as unknown as RequestHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    useCalls = [];
    getCalls = [];
    mockApp = {
      use: vi.fn((...args: unknown[]) => useCalls.push(args)),
      get: vi.fn((...args: unknown[]) => getCalls.push(args)),
    };
  });

  it('应注册所有核心路由', () => {
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);

    const prefixes = useCalls.map((c) => c[0]);
    expect(prefixes).toContain('/api/v1/auth');
    expect(prefixes).toContain('/api/v1/connections');
    expect(prefixes).toContain('/api/v1/sftp');
    expect(prefixes).toContain('/api/v1/proxies');
    expect(prefixes).toContain('/api/v1/tags');
    expect(prefixes).toContain('/api/v1/settings');
    expect(prefixes).toContain('/api/v1/notifications');
    expect(prefixes).toContain('/api/v1/audit-logs');
    expect(prefixes).toContain('/api/v1/command-history');
    expect(prefixes).toContain('/api/v1/quick-commands');
    expect(prefixes).toContain('/api/v1/terminal-themes');
    expect(prefixes).toContain('/api/v1/appearance');
    expect(prefixes).toContain('/api/v1/ssh-keys');
    expect(prefixes).toContain('/api/v1/quick-command-tags');
    expect(prefixes).toContain('/api/v1/ssh-suspend');
    expect(prefixes).toContain('/api/v1/transfers');
    expect(prefixes).toContain('/api/v1/path-history');
    expect(prefixes).toContain('/api/v1/favorite-paths');
    expect(prefixes).toContain('/api/v1/passkey');
    expect(prefixes).toContain('/api/v1/batch');
    expect(prefixes).toContain('/api/v1/ai');
    expect(prefixes).toContain('/api/v1/dashboard');
    expect(prefixes).toContain('/api/v1/backup');
  });

  it('认证路由不应使用限流中间件', () => {
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);
    const authCall = useCalls.find((c) => c[0] === '/api/v1/auth');
    expect(authCall).toBeDefined();
    // auth 路由只传 router，不传 limiter（2 个参数）
    expect(authCall?.length).toBe(2);
  });

  it('settings 路由应使用 settingsLimiter', () => {
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);
    const settingsCall = useCalls.find((c) => c[0] === '/api/v1/settings');
    expect(settingsCall).toBeDefined();
    expect(settingsCall?.[1]).toBe(mockSettingsLimiter);
  });

  it('一般路由应使用 apiLimiter', () => {
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);
    const connCall = useCalls.find((c) => c[0] === '/api/v1/connections');
    expect(connCall).toBeDefined();
    expect(connCall?.[1]).toBe(mockApiLimiter);
  });

  it('ENABLE_METRICS=true 时应注册 metrics 路由', () => {
    process.env.ENABLE_METRICS = 'true';
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);
    const metricsCall = useCalls.find((c) => c[0] === '/api/v1/metrics');
    expect(metricsCall).toBeDefined();
  });

  it('ENABLE_METRICS 未设置时不应注册 metrics 路由', () => {
    delete process.env.ENABLE_METRICS;
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);
    const metricsCall = useCalls.find((c) => c[0] === '/api/v1/metrics');
    expect(metricsCall).toBeUndefined();
  });

  it('应注册健康检查端点', () => {
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);
    const healthCall = getCalls.find((c) => c[0] === '/api/v1/health');
    expect(healthCall).toBeDefined();
  });

  it('应注册 notFoundHandler 和 errorHandler', () => {
    registerRoutes(mockApp, mockApiLimiter, mockSettingsLimiter);
    // 最后两个 use 调用应该是 notFoundHandler 和 errorHandler
    const lastTwo = useCalls.slice(-2);
    expect(lastTwo.length).toBe(2);
  });
});
