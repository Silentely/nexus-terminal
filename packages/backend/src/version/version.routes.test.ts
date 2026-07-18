/**
 * version.routes 单元测试
 * 通过 mock Request/Response 直接调用路由 handler，不依赖 supertest
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockSafeHttpGet = vi.fn();

vi.mock('../utils/ssrf-guard', () => ({
  safeHttpGet: (...args: unknown[]) => mockSafeHttpGet(...args),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
};

function createMockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function invokeRoute(
  router: { stack: RouteLayer[] },
  method: 'get',
  path: string,
): Promise<{ statusCode: number; body: unknown }> {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const req = {} as Request;
  const res = createMockRes();
  const next: NextFunction = (err?: unknown) => {
    if (err) throw err;
  };
  await handler(req, res as unknown as Response, next);
  // asyncHandler 可能通过 Promise 完成
  await new Promise((r) => setImmediate(r));
  return { statusCode: res.statusCode, body: res.body };
}

describe('version.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('GET /check 应优先使用 VERSION 文件并返回规范化版本', async () => {
    mockSafeHttpGet.mockImplementation(async (url: string) => {
      if (url.includes('VERSION')) {
        return { status: 200, data: 'v1.5.7\n' };
      }
      if (url.includes('releases/latest')) {
        return {
          status: 200,
          data: {
            tag_name: 'v1.5.7',
            html_url: 'https://github.com/Silentely/nexus-terminal/releases/tag/v1.5.7',
          },
        };
      }
      return { status: 404, data: null };
    });

    const { default: versionRoutes } = await import('./version.routes');
    const result = await invokeRoute(
      versionRoutes as unknown as { stack: RouteLayer[] },
      'get',
      '/check',
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      version: '1.5.7',
      rawVersion: 'v1.5.7',
      source: 'version_file',
    });
    expect((result.body as { htmlUrl: string }).htmlUrl).toContain('releases/tag/v1.5.7');
  });

  it('GET /check 在 VERSION 失败时应回退到 Releases', async () => {
    mockSafeHttpGet.mockImplementation(async (url: string) => {
      if (url.includes('VERSION')) {
        return { status: 500, data: null };
      }
      if (url.includes('releases/latest')) {
        return {
          status: 200,
          data: {
            tag_name: 'v2.0.0',
            html_url: 'https://github.com/Silentely/nexus-terminal/releases/tag/v2.0.0',
          },
        };
      }
      return { status: 404, data: null };
    });

    const { default: versionRoutes } = await import('./version.routes');
    const result = await invokeRoute(
      versionRoutes as unknown as { stack: RouteLayer[] },
      'get',
      '/check',
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      version: '2.0.0',
      source: 'release',
    });
  });

  it('GET /check 应缓存结果避免重复外发', async () => {
    mockSafeHttpGet.mockImplementation(async (url: string) => {
      if (url.includes('VERSION')) {
        return { status: 200, data: '1.0.0' };
      }
      if (url.includes('releases/latest')) {
        return { status: 200, data: { tag_name: 'v1.0.0', html_url: null } };
      }
      return { status: 404, data: null };
    });

    const { default: versionRoutes } = await import('./version.routes');
    const router = versionRoutes as unknown as { stack: RouteLayer[] };
    await invokeRoute(router, 'get', '/check');
    await invokeRoute(router, 'get', '/check');

    // 第二次命中 version_check 缓存
    expect(mockSafeHttpGet).toHaveBeenCalledTimes(2);
  });

  it('GET /remote 应返回原始 VERSION 文本', async () => {
    mockSafeHttpGet.mockImplementation(async (url: string) => {
      if (url.includes('VERSION')) {
        return { status: 200, data: '1.2.3' };
      }
      return { status: 404, data: null };
    });

    const { default: versionRoutes } = await import('./version.routes');
    const result = await invokeRoute(
      versionRoutes as unknown as { stack: RouteLayer[] },
      'get',
      '/remote',
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      version: '1.2.3',
      normalized: '1.2.3',
    });
  });
});
