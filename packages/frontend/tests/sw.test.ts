/**
 * Service Worker (sw.js) 缓存策略单元测试
 *
 * 由于 sw.js 是纯 JS 文件，未导出内部函数，这里通过
 * 模拟 Service Worker 全局环境后加载 sw.js 来测试其行为。
 * 主要测试 cacheFirst, networkFirst, networkFirstWithFallback,
 * networkFirstWithTimeout, trimCache 五个缓存策略函数。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== 构建 Mock 的 Cache/CacheStorage ====================

type MockCacheStore = Map<string, Response>;

function createMockCache(store: MockCacheStore = new Map()) {
  return {
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.get(key) || undefined;
    }),
    put: vi.fn(async (req: Request | string, res: Response) => {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, res);
    }),
    delete: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.delete(key);
    }),
    keys: vi.fn(async () => {
      return Array.from(store.keys()).map((url) => new Request(url));
    }),
    addAll: vi.fn(async (_urls: string[]) => {}),
    _store: store,
  };
}

type MockCache = ReturnType<typeof createMockCache>;

function createMockCaches() {
  const cacheMap = new Map<string, MockCache>();

  return {
    open: vi.fn(async (name: string) => {
      if (!cacheMap.has(name)) {
        cacheMap.set(name, createMockCache());
      }
      return cacheMap.get(name)!;
    }),
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      for (const cache of cacheMap.values()) {
        const match = await cache.match(req);
        if (match) return match;
        // Also check store directly
        const storeMatch = cache._store.get(key);
        if (storeMatch) return storeMatch;
      }
      return undefined;
    }),
    keys: vi.fn(async () => Array.from(cacheMap.keys())),
    delete: vi.fn(async (name: string) => {
      return cacheMap.delete(name);
    }),
    _cacheMap: cacheMap,
  };
}

// ==================== 创建 Mock Response ====================

function createMockResponse(
  body: string,
  options: { status?: number; headers?: Record<string, string>; ok?: boolean } = {}
): Response {
  const { status = 200, headers = {}, ok = status >= 200 && status < 300 } = options;
  return {
    ok,
    status,
    headers: new Headers(headers),
    body,
    clone: vi.fn(function (this: Response) {
      return createMockResponse(body, { status, headers, ok });
    }),
    text: vi.fn(async () => body),
    json: vi.fn(async () => JSON.parse(body)),
  } as unknown as Response;
}

// ==================== 加载 sw.js 并暴露内部函数 ====================

/**
 * 在模拟的 Service Worker 环境中执行 sw.js，并提取内部函数。
 * 通过在 sw.js 代码后附加赋值语句将模块作用域的函数暴露出来。
 */
function loadSwFunctions(mockCaches: ReturnType<typeof createMockCaches>, mockFetch: ReturnType<typeof vi.fn>) {
  const swPath = resolve(__dirname, '../public/sw.js');
  const swCode = readFileSync(swPath, 'utf-8');

  // 注入获取内部函数的代码
  const extractCode = `
    __sw_exports.cacheFirst = cacheFirst;
    __sw_exports.networkFirst = networkFirst;
    __sw_exports.networkFirstWithFallback = networkFirstWithFallback;
    __sw_exports.networkFirstWithTimeout = networkFirstWithTimeout;
    __sw_exports.trimCache = trimCache;
    __sw_exports.SW_VERSION = SW_VERSION;
  `;

  const exports: Record<string, unknown> = {};

  // 创建 SW 执行上下文
  const selfMock = {
    addEventListener: vi.fn(),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    location: { origin: 'http://localhost' },
    postMessage: vi.fn(),
  };

  // 使用 Function 构造器在受控作用域中执行 sw.js
  const fn = new Function(
    'self',
    'caches',
    'fetch',
    'AbortController',
    'setTimeout',
    'clearTimeout',
    'console',
    'Response',
    'Request',
    'Headers',
    '__sw_exports',
    `${swCode}\n${extractCode}`
  );

  fn(
    selfMock,
    mockCaches,
    mockFetch,
    globalThis.AbortController,
    globalThis.setTimeout,
    globalThis.clearTimeout,
    console,
    globalThis.Response || class Response {
      constructor(body: string, init?: { status?: number; headers?: Record<string, string> }) {
        Object.assign(this, { body, ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300, status: init?.status ?? 200 });
      }
      clone() { return this; }
    },
    globalThis.Request || class Request {
      url: string;
      constructor(url: string) { this.url = url; }
    },
    globalThis.Headers || class Headers {
      constructor(_init?: Record<string, string>) {}
    },
    exports
  );

  return exports as {
    cacheFirst: (request: Request, cacheName: string) => Promise<Response>;
    networkFirst: (request: Request) => Promise<Response>;
    networkFirstWithFallback: (request: Request, cacheName: string) => Promise<Response>;
    networkFirstWithTimeout: (request: Request, cacheName: string, timeoutMs: number) => Promise<Response>;
    trimCache: (cacheName: string, maxEntries: number) => Promise<void>;
    SW_VERSION: string;
  };
}

// ==================== 测试套件 ====================

describe('Service Worker 缓存策略', () => {
  let mockCaches: ReturnType<typeof createMockCaches>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let sw: ReturnType<typeof loadSwFunctions>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCaches = createMockCaches();
    mockFetch = vi.fn();
    sw = loadSwFunctions(mockCaches, mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('SW_VERSION', () => {
    it('版本号应为 2.0.0', () => {
      expect(sw.SW_VERSION).toBe('2.0.0');
    });
  });

  describe('cacheFirst', () => {
    it('缓存命中时应返回缓存的响应', async () => {
      const cachedResponse = createMockResponse('cached content');
      const cache = await mockCaches.open('test-cache');
      cache._store.set('http://localhost/app.js', cachedResponse);
      mockCaches.match.mockResolvedValue(cachedResponse);

      const request = new Request('http://localhost/app.js');
      const result = await sw.cacheFirst(request, 'test-cache');

      expect(result).toBe(cachedResponse);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('缓存未命中时应从网络获取', async () => {
      mockCaches.match.mockResolvedValue(undefined);
      const networkResponse = createMockResponse('network content', { ok: true });
      mockFetch.mockResolvedValue(networkResponse);

      const request = new Request('http://localhost/app.js');
      const result = await sw.cacheFirst(request, 'test-cache');

      expect(mockFetch).toHaveBeenCalledWith(request);
      expect(result).toBe(networkResponse);
    });

    it('网络响应 ok 时应缓存响应', async () => {
      mockCaches.match.mockResolvedValue(undefined);
      const networkResponse = createMockResponse('fresh content', { ok: true });
      mockFetch.mockResolvedValue(networkResponse);

      const cache = await mockCaches.open('test-cache');
      const request = new Request('http://localhost/app.js');
      await sw.cacheFirst(request, 'test-cache');

      expect(cache.put).toHaveBeenCalled();
    });

    it('网络响应非 ok 时不应缓存', async () => {
      mockCaches.match.mockResolvedValue(undefined);
      const errorResponse = createMockResponse('Not Found', { status: 404, ok: false });
      mockFetch.mockResolvedValue(errorResponse);

      const cache = await mockCaches.open('test-cache');
      const request = new Request('http://localhost/app.js');
      await sw.cacheFirst(request, 'test-cache');

      expect(cache.put).not.toHaveBeenCalled();
    });
  });

  describe('networkFirst', () => {
    it('网络可用时应返回网络响应', async () => {
      const networkResponse = createMockResponse('network data');
      mockFetch.mockResolvedValue(networkResponse);

      const request = new Request('http://localhost/data');
      const result = await sw.networkFirst(request);

      expect(result).toBe(networkResponse);
    });

    it('网络失败时应返回缓存响应', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const cachedResponse = createMockResponse('cached data');
      mockCaches.match.mockResolvedValue(cachedResponse);

      const request = new Request('http://localhost/data');
      const result = await sw.networkFirst(request);

      expect(result).toBe(cachedResponse);
    });

    it('网络失败且无缓存时应返回 503 Offline', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      mockCaches.match.mockResolvedValue(undefined);

      const request = new Request('http://localhost/data');
      const result = await sw.networkFirst(request);

      expect(result.status).toBe(503);
    });
  });

  describe('networkFirstWithFallback', () => {
    it('网络成功时应返回网络响应', async () => {
      const networkResponse = createMockResponse('<html>page</html>', { ok: true });
      mockFetch.mockResolvedValue(networkResponse);

      const request = new Request('http://localhost/');
      const result = await sw.networkFirstWithFallback(request, 'pages-cache');

      expect(result).toBe(networkResponse);
    });

    it('网络成功时应缓存响应', async () => {
      const networkResponse = createMockResponse('<html>page</html>', { ok: true });
      mockFetch.mockResolvedValue(networkResponse);

      const cache = await mockCaches.open('pages-cache');
      const request = new Request('http://localhost/');
      await sw.networkFirstWithFallback(request, 'pages-cache');

      expect(cache.put).toHaveBeenCalled();
    });

    it('网络失败时应从缓存读取', async () => {
      mockFetch.mockRejectedValue(new Error('Offline'));
      const cachedPage = createMockResponse('<html>cached page</html>');
      mockCaches.match.mockResolvedValueOnce(cachedPage);

      const request = new Request('http://localhost/about');
      const result = await sw.networkFirstWithFallback(request, 'pages-cache');

      expect(result).toBe(cachedPage);
    });

    it('网络失败且无匹配缓存时应尝试 /index.html', async () => {
      mockFetch.mockRejectedValue(new Error('Offline'));
      // 第一次 match 返回 undefined（具体路由），第二次返回 index.html
      const indexPage = createMockResponse('<html>index</html>');
      mockCaches.match
        .mockResolvedValueOnce(undefined)  // match(request) fails
        .mockResolvedValueOnce(indexPage);  // match('/index.html') succeeds

      const request = new Request('http://localhost/about');
      const result = await sw.networkFirstWithFallback(request, 'pages-cache');

      expect(result).toBe(indexPage);
    });

    it('网络失败且无任何缓存时应返回 503 HTML 响应', async () => {
      mockFetch.mockRejectedValue(new Error('Offline'));
      mockCaches.match.mockResolvedValue(undefined);

      const request = new Request('http://localhost/about');
      const result = await sw.networkFirstWithFallback(request, 'pages-cache');

      expect(result.status).toBe(503);
    });
  });

  describe('networkFirstWithTimeout', () => {
    it('网络响应在超时前返回时应成功', async () => {
      const networkResponse = createMockResponse('{"data":true}', { ok: true });
      mockFetch.mockResolvedValue(networkResponse);

      const request = new Request('http://localhost/api/data');
      const result = await sw.networkFirstWithTimeout(request, 'api-cache', 5000);

      expect(result).toBe(networkResponse);
    });

    it('网络成功时应缓存 API 响应', async () => {
      const networkResponse = createMockResponse('{"data":true}', { ok: true });
      mockFetch.mockResolvedValue(networkResponse);

      const cache = await mockCaches.open('api-cache');
      const request = new Request('http://localhost/api/data');
      await sw.networkFirstWithTimeout(request, 'api-cache', 5000);

      expect(cache.put).toHaveBeenCalled();
    });

    it('网络失败时应返回缓存响应', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const cachedResponse = createMockResponse('{"cached":true}');
      mockCaches.match.mockResolvedValue(cachedResponse);

      const request = new Request('http://localhost/api/data');
      const result = await sw.networkFirstWithTimeout(request, 'api-cache', 5000);

      expect(result).toBe(cachedResponse);
    });

    it('网络失败且无缓存时应返回 503 JSON 响应', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      mockCaches.match.mockResolvedValue(undefined);

      const request = new Request('http://localhost/api/data');
      const result = await sw.networkFirstWithTimeout(request, 'api-cache', 5000);

      expect(result.status).toBe(503);
    });

    it('超时时应中止请求并降级到缓存', async () => {
      // 模拟网络超时（fetch 因 AbortSignal 被 reject）
      mockFetch.mockImplementation((_req: Request, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              reject(new Error('AbortError'));
            });
          }
          // 不 resolve，模拟永远挂起的请求
        });
      });

      const cachedResponse = createMockResponse('{"stale":true}');
      mockCaches.match.mockResolvedValue(cachedResponse);

      const request = new Request('http://localhost/api/slow');
      const resultPromise = sw.networkFirstWithTimeout(request, 'api-cache', 100);

      // 推进时间到超时
      vi.advanceTimersByTime(150);

      const result = await resultPromise;
      expect(result).toBe(cachedResponse);
    });

    it('网络响应非 ok 时不应缓存', async () => {
      const errorResponse = createMockResponse('{"error":"Not Found"}', { status: 404, ok: false });
      mockFetch.mockResolvedValue(errorResponse);

      const cache = await mockCaches.open('api-cache');
      const request = new Request('http://localhost/api/missing');
      await sw.networkFirstWithTimeout(request, 'api-cache', 5000);

      expect(cache.put).not.toHaveBeenCalled();
    });
  });

  describe('trimCache', () => {
    it('条目数超过 maxEntries 时应删除最早的条目', async () => {
      const cache = await mockCaches.open('api-cache');

      // 添加 5 个条目
      const requests: Request[] = [];
      for (let i = 0; i < 5; i++) {
        const req = new Request(`http://localhost/api/item-${i}`);
        requests.push(req);
        cache._store.set(req.url, createMockResponse(`data-${i}`));
      }

      // cache.keys 返回所有请求
      cache.keys.mockResolvedValue(requests);

      await sw.trimCache('api-cache', 3);

      // 应删除最早的 2 个（5 - 3 = 2）
      expect(cache.delete).toHaveBeenCalledTimes(2);
      expect(cache.delete).toHaveBeenCalledWith(requests[0]);
      expect(cache.delete).toHaveBeenCalledWith(requests[1]);
    });

    it('条目数未超过 maxEntries 时不应删除任何条目', async () => {
      const cache = await mockCaches.open('api-cache');

      const requests = [new Request('http://localhost/api/item-0')];
      cache.keys.mockResolvedValue(requests);

      await sw.trimCache('api-cache', 3);

      // 只有 1 个条目，最大 3，不应删除
      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('条目数恰好等于 maxEntries 时不应删除', async () => {
      const cache = await mockCaches.open('api-cache');

      const requests = [
        new Request('http://localhost/api/item-0'),
        new Request('http://localhost/api/item-1'),
        new Request('http://localhost/api/item-2'),
      ];
      cache.keys.mockResolvedValue(requests);

      await sw.trimCache('api-cache', 3);

      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('空缓存时不应删除', async () => {
      const cache = await mockCaches.open('api-cache');
      cache.keys.mockResolvedValue([]);

      await sw.trimCache('api-cache', 50);

      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('API_CACHE_MAX=50 时超过 50 个条目应触发淘汰', async () => {
      const cache = await mockCaches.open('api-cache');

      const requests = Array.from({ length: 55 }, (_, i) =>
        new Request(`http://localhost/api/item-${i}`)
      );
      cache.keys.mockResolvedValue(requests);

      await sw.trimCache('api-cache', 50);

      // 55 - 50 = 5 个应被删除
      expect(cache.delete).toHaveBeenCalledTimes(5);
      // 删除的应该是最早的 5 个
      expect(cache.delete).toHaveBeenCalledWith(requests[0]);
      expect(cache.delete).toHaveBeenCalledWith(requests[4]);
    });
  });
});
