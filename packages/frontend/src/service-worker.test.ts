/**
 * Service Worker (sw.js) 单元测试
 *
 * 测试缓存策略实现（cacheFirst, networkFirst, networkFirstWithFallback,
 * networkFirstWithTimeout, trimCache）以及各事件处理器（install, activate, fetch, message）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== Cache API Mock ====================

class MockCache {
  public contents: Map<string, Response> = new Map();

  async match(request: Request | string): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    return this.contents.get(key);
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url;
    this.contents.set(key, response);
  }

  async addAll(urls: string[]): Promise<void> {
    for (const url of urls) {
      const resp = new Response('ok', { status: 200 });
      this.contents.set(url, resp);
    }
  }

  async keys(): Promise<Request[]> {
    return Array.from(this.contents.keys()).map((k) => new Request(k));
  }

  async delete(request: Request | string): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url;
    return this.contents.delete(key);
  }

  size(): number {
    return this.contents.size;
  }
}

class MockCacheStorage {
  public stores: Map<string, MockCache> = new Map();

  async open(name: string): Promise<MockCache> {
    if (!this.stores.has(name)) {
      this.stores.set(name, new MockCache());
    }
    return this.stores.get(name)!;
  }

  async keys(): Promise<string[]> {
    return Array.from(this.stores.keys());
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    for (const cache of this.stores.values()) {
      const match = cache.contents.get(key);
      if (match) return match;
    }
    return undefined;
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  reset(): void {
    this.stores.clear();
  }

  getCache(name: string): MockCache | undefined {
    return this.stores.get(name);
  }
}

// ==================== Global setup ====================

const mockCacheStorage = new MockCacheStorage();
const mockFetch = vi.fn();
const mockSkipWaiting = vi.fn();
const mockClaimClients = vi.fn();

// Registry for SW event listeners
type AnyEventListener = (event: unknown) => void;
const swListeners: Map<string, AnyEventListener[]> = new Map();

function swAddEventListener(type: string, listener: AnyEventListener) {
  if (!swListeners.has(type)) swListeners.set(type, []);
  swListeners.get(type)!.push(listener);
}

function dispatchSwEvent(type: string, event: unknown) {
  const listeners = swListeners.get(type) || [];
  listeners.forEach((l) => l(event));
}

// Install mocks before importing sw.js
const mockOrigin = 'http://localhost:5173';

Object.defineProperty(globalThis, 'caches', {
  value: mockCacheStorage,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'fetch', {
  value: mockFetch,
  writable: true,
  configurable: true,
});
// Override self.location.origin
Object.defineProperty(globalThis, 'location', {
  value: { origin: mockOrigin },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'skipWaiting', {
  value: mockSkipWaiting,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'clients', {
  value: { claim: mockClaimClients },
  writable: true,
  configurable: true,
});

// Intercept addEventListener BEFORE importing sw.js
const originalAddEventListener = globalThis.addEventListener;
Object.defineProperty(globalThis, 'addEventListener', {
  value: swAddEventListener,
  writable: true,
  configurable: true,
});

// Import sw.js — registers event listeners onto globalThis (self)
await import('../public/sw.js');

// Restore addEventListener for the test framework
if (originalAddEventListener) {
  Object.defineProperty(globalThis, 'addEventListener', {
    value: originalAddEventListener,
    writable: true,
    configurable: true,
  });
}

// ==================== Test helpers ====================

function makeResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

/**
 * Build a minimal fetch FetchEvent-like object.
 * NOTE: happy-dom does not allow constructing a Request with mode:'navigate',
 * so for navigation tests we pass a plain object with mode:'navigate'.
 */
function makeFetchEvent(
  url: string,
  mode: 'cors' | 'navigate' | 'no-cors' | 'same-origin' = 'cors'
): {
  request: { url: string; mode: string };
  respondedWith: Promise<Response> | undefined;
  respondWith(p: Promise<Response>): void;
} {
  // For navigate mode, use a plain object so happy-dom doesn't throw
  const request =
    mode === 'navigate'
      ? { url: `${mockOrigin}${url.startsWith('/') ? url : '/' + url}`, mode: 'navigate' }
      : new Request(`${mockOrigin}${url.startsWith('/') ? url : '/' + url}`);

  const event: {
    request: typeof request;
    respondedWith: Promise<Response> | undefined;
    respondWith(p: Promise<Response>): void;
  } = {
    request,
    respondedWith: undefined,
    respondWith(p: Promise<Response>) {
      this.respondedWith = p;
    },
  };
  return event;
}

/** Build an install event with waitUntil tracking */
function makeInstallEvent() {
  const waited: Array<Promise<unknown>> = [];
  return {
    waitUntil(p: Promise<unknown>) {
      waited.push(p);
    },
    _waitAll(): Promise<unknown[]> {
      return Promise.all(waited);
    },
  };
}

/** Build an activate event with waitUntil tracking */
function makeActivateEvent() {
  const waited: Array<Promise<unknown>> = [];
  return {
    waitUntil(p: Promise<unknown>) {
      waited.push(p);
    },
    _waitAll(): Promise<unknown[]> {
      return Promise.all(waited);
    },
  };
}

// ==================== Tests ====================

describe('Service Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheStorage.reset();
  });

  // ==================== install event ====================
  describe('install 事件', () => {
    it('应注册 install 事件监听器', () => {
      expect(swListeners.has('install')).toBe(true);
    });

    it('install 时应预缓存 APP_SHELL_URLS 到静态缓存（nexus-static-v2.0.0）', async () => {
      const event = makeInstallEvent();
      dispatchSwEvent('install', event);
      await event._waitAll();

      const staticCache = mockCacheStorage.getCache('nexus-static-v2.0.0');
      expect(staticCache).toBeDefined();
      // APP_SHELL_URLS = ['/', '/index.html']
      expect(staticCache!.contents.has('/')).toBe(true);
      expect(staticCache!.contents.has('/index.html')).toBe(true);
    });

    it('install 时应预缓存图标到 nexus-icons-v2.0.0', async () => {
      const event = makeInstallEvent();
      dispatchSwEvent('install', event);
      await event._waitAll();

      const iconsCache = mockCacheStorage.getCache('nexus-icons-v2.0.0');
      expect(iconsCache).toBeDefined();
      expect(iconsCache!.contents.has('/icons/icon-192x192.png')).toBe(true);
      expect(iconsCache!.contents.has('/icons/icon-512x512.png')).toBe(true);
    });

    it('install 后应调用 skipWaiting', async () => {
      const event = makeInstallEvent();
      dispatchSwEvent('install', event);
      await event._waitAll();
      expect(mockSkipWaiting).toHaveBeenCalled();
    });
  });

  // ==================== activate event ====================
  describe('activate 事件', () => {
    it('应注册 activate 事件监听器', () => {
      expect(swListeners.has('activate')).toBe(true);
    });

    it('activate 时应删除旧版本缓存', async () => {
      // Pre-populate an old cache name that is NOT in currentCaches
      await mockCacheStorage.open('nexus-terminal-cache-1.0.0');
      await mockCacheStorage.open('nexus-static-v2.0.0');

      const event = makeActivateEvent();
      dispatchSwEvent('activate', event);
      await event._waitAll();

      // Old cache should have been deleted
      expect(mockCacheStorage.stores.has('nexus-terminal-cache-1.0.0')).toBe(false);
    });

    it('activate 时应保留当前版本的四个缓存桶', async () => {
      // Pre-populate with all current version caches plus one old one
      await mockCacheStorage.open('nexus-static-v2.0.0');
      await mockCacheStorage.open('nexus-api-v2.0.0');
      await mockCacheStorage.open('nexus-icons-v2.0.0');
      await mockCacheStorage.open('nexus-pages-v2.0.0');
      await mockCacheStorage.open('old-cache-v1.0.0');

      const event = makeActivateEvent();
      dispatchSwEvent('activate', event);
      await event._waitAll();

      // Current version caches should survive
      expect(mockCacheStorage.stores.has('nexus-static-v2.0.0')).toBe(true);
      expect(mockCacheStorage.stores.has('nexus-api-v2.0.0')).toBe(true);
      expect(mockCacheStorage.stores.has('nexus-icons-v2.0.0')).toBe(true);
      expect(mockCacheStorage.stores.has('nexus-pages-v2.0.0')).toBe(true);
      // Old cache should be deleted
      expect(mockCacheStorage.stores.has('old-cache-v1.0.0')).toBe(false);
    });

    it('activate 后应调用 clients.claim()', async () => {
      const event = makeActivateEvent();
      dispatchSwEvent('activate', event);
      await event._waitAll();
      expect(mockClaimClients).toHaveBeenCalled();
    });

    it('无旧缓存时 activate 不应抛出错误', async () => {
      const event = makeActivateEvent();
      await expect(
        (async () => {
          dispatchSwEvent('activate', event);
          await event._waitAll();
        })()
      ).resolves.not.toThrow();
    });
  });

  // ==================== fetch event routing ====================
  describe('fetch 事件路由', () => {
    it('应注册 fetch 事件监听器', () => {
      expect(swListeners.has('fetch')).toBe(true);
    });

    it('跨域请求不应设置 respondWith', () => {
      const crossOriginEvent = {
        request: new Request('https://cdn.other.com/lib.js'),
        respondedWith: undefined as Promise<Response> | undefined,
        respondWith(p: Promise<Response>) {
          this.respondedWith = p;
        },
      };
      dispatchSwEvent('fetch', crossOriginEvent);
      expect(crossOriginEvent.respondedWith).toBeUndefined();
    });

    it('导航请求（mode: navigate）应使用 networkFirstWithFallback', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('<html>Page</html>', 200));

      const event = makeFetchEvent('/dashboard', 'navigate');
      dispatchSwEvent('fetch', event);

      expect(event.respondedWith).toBeDefined();
      const response = await event.respondedWith;
      expect(response?.status).toBe(200);
    });

    it('API 请求（/api/...）应使用 networkFirstWithTimeout', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('{"items":[]}', 200));

      const event = makeFetchEvent('/api/connections');
      dispatchSwEvent('fetch', event);

      expect(event.respondedWith).toBeDefined();
      const response = await event.respondedWith;
      expect(response?.status).toBe(200);
    });

    it('.js 静态资源应使用 cacheFirst（Cache-First）', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('console.log(1)', 200));

      const event = makeFetchEvent('/assets/app.abc123.js');
      dispatchSwEvent('fetch', event);

      expect(event.respondedWith).toBeDefined();
      await event.respondedWith;
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('.css 资源应使用 Cache-First', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('body{}', 200));
      const event = makeFetchEvent('/assets/style.css');
      dispatchSwEvent('fetch', event);
      expect(event.respondedWith).toBeDefined();
    });

    it('.woff2 字体资源应使用 Cache-First', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('font', 200));
      const event = makeFetchEvent('/fonts/roboto.woff2');
      dispatchSwEvent('fetch', event);
      expect(event.respondedWith).toBeDefined();
    });

    it('.woff 字体资源应使用 Cache-First', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('font', 200));
      const event = makeFetchEvent('/fonts/roboto.woff');
      dispatchSwEvent('fetch', event);
      expect(event.respondedWith).toBeDefined();
    });

    it('.ttf 字体资源应使用 Cache-First', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('font', 200));
      const event = makeFetchEvent('/fonts/roboto.ttf');
      dispatchSwEvent('fetch', event);
      expect(event.respondedWith).toBeDefined();
    });

    it('/icons/ 路径应使用 cacheFirst', async () => {
      // Pre-cache an icon
      const iconsCache = await mockCacheStorage.open('nexus-icons-v2.0.0');
      const cachedIcon = makeResponse('icon-bytes', 200);
      await iconsCache.put(`${mockOrigin}/icons/icon-192x192.png`, cachedIcon);

      const event = makeFetchEvent('/icons/icon-192x192.png');
      dispatchSwEvent('fetch', event);

      expect(event.respondedWith).toBeDefined();
      const response = await event.respondedWith;
      // Cache hit → fetch not called
      expect(mockFetch).not.toHaveBeenCalled();
      expect(response?.status).toBe(200);
    });

    it('其他同源路径应使用 networkFirst', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('data', 200));
      const event = makeFetchEvent('/manifest.json');
      dispatchSwEvent('fetch', event);
      expect(event.respondedWith).toBeDefined();
      const response = await event.respondedWith;
      expect(response?.status).toBe(200);
    });
  });

  // ==================== message event ====================
  describe('message 事件', () => {
    it('应注册 message 事件监听器', () => {
      expect(swListeners.has('message')).toBe(true);
    });

    it('GET_SW_VERSION 消息应回复 SW_VERSION 2.0.0', () => {
      const postMessageMock = vi.fn();
      const event = { data: { type: 'GET_SW_VERSION' }, source: { postMessage: postMessageMock } };
      dispatchSwEvent('message', event);
      expect(postMessageMock).toHaveBeenCalledWith({ type: 'SW_VERSION', version: '2.0.0' });
    });

    it('SKIP_WAITING 消息应调用 skipWaiting()', () => {
      const event = {
        data: { type: 'SKIP_WAITING' },
        source: { postMessage: vi.fn() },
      };
      dispatchSwEvent('message', event);
      expect(mockSkipWaiting).toHaveBeenCalled();
    });

    it('CACHE_URLS 消息应缓存指定 URLs', async () => {
      const urlToCache = `${mockOrigin}/api/config`;
      mockFetch.mockResolvedValueOnce(makeResponse('{"ok":true}', 200));

      const event = {
        data: { type: 'CACHE_URLS', urls: [urlToCache] },
        source: { postMessage: vi.fn() },
      };
      dispatchSwEvent('message', event);

      // Allow async operations to complete
      await new Promise((r) => setTimeout(r, 50));

      const apiCache = mockCacheStorage.getCache('nexus-api-v2.0.0');
      expect(apiCache).toBeDefined();
    });

    it('data 为 null 时不应抛出错误', () => {
      const event = { data: null, source: { postMessage: vi.fn() } };
      expect(() => dispatchSwEvent('message', event)).not.toThrow();
    });

    it('CACHE_URLS urls 为非数组时应忽略', () => {
      const event = { data: { type: 'CACHE_URLS', urls: 'not-array' }, source: {} };
      expect(() => dispatchSwEvent('message', event)).not.toThrow();
    });

    it('未知消息类型不应抛出错误', () => {
      const event = { data: { type: 'UNKNOWN_TYPE' }, source: { postMessage: vi.fn() } };
      expect(() => dispatchSwEvent('message', event)).not.toThrow();
    });
  });

  // ==================== cacheFirst 策略 ====================
  describe('cacheFirst 缓存策略（通过 .js 请求间接测试）', () => {
    it('缓存命中时应直接返回缓存响应，不调用 fetch', async () => {
      const cachedResponse = makeResponse('cached-js', 200);
      const staticCache = await mockCacheStorage.open('nexus-static-v2.0.0');
      await staticCache.put(`${mockOrigin}/assets/main.js`, cachedResponse);

      const event = makeFetchEvent('/assets/main.js');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;

      expect(mockFetch).not.toHaveBeenCalled();
      expect(response?.status).toBe(200);
    });

    it('缓存未命中时应向网络请求并写入缓存', async () => {
      const networkResponse = makeResponse('fresh-js', 200);
      mockFetch.mockResolvedValueOnce(networkResponse);

      const event = makeFetchEvent('/assets/bundle.abc.js');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(response?.status).toBe(200);

      // Response should be cached
      const staticCache = mockCacheStorage.getCache('nexus-static-v2.0.0');
      const cached = await staticCache?.match(`${mockOrigin}/assets/bundle.abc.js`);
      expect(cached).toBeDefined();
    });

    it('网络返回非 ok 响应时不应写入缓存', async () => {
      const notFoundResponse = makeResponse('Not Found', 404);
      mockFetch.mockResolvedValueOnce(notFoundResponse);

      const event = makeFetchEvent('/assets/missing.js');
      dispatchSwEvent('fetch', event);
      await event.respondedWith;

      const staticCache = mockCacheStorage.getCache('nexus-static-v2.0.0');
      const cached = await staticCache?.match(`${mockOrigin}/assets/missing.js`);
      expect(cached).toBeUndefined();
    });

    it('网络 fetch 失败且无缓存时应向上抛出错误', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Network error'));

      const event = makeFetchEvent('/assets/no-cache-fail.js');
      dispatchSwEvent('fetch', event);

      await expect(event.respondedWith).rejects.toThrow();
    });
  });

  // ==================== networkFirst 策略 ====================
  describe('networkFirst 策略（通过其他同源请求间接测试）', () => {
    it('网络可用时应返回成功响应', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('resource-data', 200));
      const event = makeFetchEvent('/other/resource');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;
      expect(response?.status).toBe(200);
    });

    it('网络失败时应降级返回缓存', async () => {
      // Pre-populate the cache for this specific resource
      const cachedResponse = makeResponse('cached-resource', 200);
      const staticCache = await mockCacheStorage.open('nexus-static-v2.0.0');
      await staticCache.put(`${mockOrigin}/other/cached-page`, cachedResponse);

      mockFetch.mockRejectedValueOnce(new TypeError('Network failed'));

      const event = makeFetchEvent('/other/cached-page');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;
      expect(response?.status).toBe(200);
    });

    it('网络失败且无缓存时应返回 503 响应', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Network failed'));

      const event = makeFetchEvent('/other/uncached-page');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;
      expect(response?.status).toBe(503);
    });
  });

  // ==================== networkFirstWithFallback 策略 ====================
  describe('networkFirstWithFallback 策略（通过导航请求间接测试）', () => {
    it('网络成功时应返回 200 响应并缓存', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('<html>App</html>', 200));

      const event = makeFetchEvent('/dashboard', 'navigate');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;

      expect(response?.status).toBe(200);
      const pagesCache = mockCacheStorage.getCache('nexus-pages-v2.0.0');
      expect(pagesCache).toBeDefined();
    });

    it('网络失败且有精确匹配缓存时应返回缓存响应', async () => {
      // Pre-populate the pages cache
      const pagesCache = await mockCacheStorage.open('nexus-pages-v2.0.0');
      const cachedPage = makeResponse('<html>Cached Page</html>', 200);
      await pagesCache.put(`${mockOrigin}/about`, cachedPage);

      mockFetch.mockRejectedValueOnce(new TypeError('Network failed'));

      const event = makeFetchEvent('/about', 'navigate');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;

      expect(response?.status).toBe(200);
    });

    it('网络失败且无缓存时应返回 503 HTML 响应', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Network failed'));

      const event = makeFetchEvent('/new-page', 'navigate');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;

      expect(response?.status).toBe(503);
    });

    it('网络返回非 ok 状态码时不应写入页面缓存', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('Server Error', 500));

      const event = makeFetchEvent('/broken-page', 'navigate');
      dispatchSwEvent('fetch', event);
      await event.respondedWith;

      // Pages cache should NOT have the 500 response
      const pagesCache = mockCacheStorage.getCache('nexus-pages-v2.0.0');
      const cached = await pagesCache?.match(`${mockOrigin}/broken-page`);
      expect(cached).toBeUndefined();
    });
  });

  // ==================== networkFirstWithTimeout 策略 ====================
  describe('networkFirstWithTimeout 策略（通过 API 请求间接测试）', () => {
    it('API 请求成功时应返回 200 响应', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('{"ok":true}', 200));
      const event = makeFetchEvent('/api/health');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;
      expect(response?.status).toBe(200);
    });

    it('API 请求成功时应将响应写入 API 缓存', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('{"users":[]}', 200));
      const event = makeFetchEvent('/api/users');
      dispatchSwEvent('fetch', event);
      await event.respondedWith;

      const apiCache = mockCacheStorage.getCache('nexus-api-v2.0.0');
      expect(apiCache).toBeDefined();
      const cached = await apiCache?.match(`${mockOrigin}/api/users`);
      expect(cached).toBeDefined();
    });

    it('AbortError（超时）后应降级返回 API 缓存', async () => {
      // Pre-populate API cache
      const apiCache = await mockCacheStorage.open('nexus-api-v2.0.0');
      const cachedResponse = makeResponse('{"cached":true}', 200);
      await apiCache.put(`${mockOrigin}/api/slow`, cachedResponse);

      mockFetch.mockRejectedValueOnce(
        Object.assign(new DOMException('Aborted', 'AbortError'))
      );

      const event = makeFetchEvent('/api/slow');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;

      expect(response?.status).toBe(200);
    });

    it('网络错误且无 API 缓存时应返回 503 JSON 响应', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Network error'));

      const event = makeFetchEvent('/api/no-cache-endpoint');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;

      expect(response?.status).toBe(503);
      const body = await response?.json();
      expect(body).toEqual({ error: 'Offline' });
    });

    it('API 返回非 ok 状态码时不应写入缓存', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('Unauthorized', 401));
      const event = makeFetchEvent('/api/protected');
      dispatchSwEvent('fetch', event);
      await event.respondedWith;

      const apiCache = mockCacheStorage.getCache('nexus-api-v2.0.0');
      const cached = await apiCache?.match(`${mockOrigin}/api/protected`);
      expect(cached).toBeUndefined();
    });
  });

  // ==================== trimCache ====================
  describe('trimCache FIFO 缓存裁剪（API_CACHE_MAX = 50）', () => {
    it('缓存条目未超过 50 条时不应触发删除', async () => {
      // Add 3 entries then a 4th via fetch → total 4, well below max of 50
      const apiCache = await mockCacheStorage.open('nexus-api-v2.0.0');
      for (let i = 0; i < 3; i++) {
        await apiCache.put(`${mockOrigin}/api/resource-${i}`, makeResponse(`data-${i}`, 200));
      }

      const deleteSpy = vi.spyOn(apiCache, 'delete');
      mockFetch.mockResolvedValueOnce(makeResponse('new-data', 200));

      const event = makeFetchEvent('/api/new-resource');
      dispatchSwEvent('fetch', event);
      await event.respondedWith;

      // With 4 total entries (< 50), no eviction should occur
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  // ==================== SW 版本号 ====================
  describe('SW 版本号', () => {
    it('GET_SW_VERSION 应回复版本 2.0.0', () => {
      const postMessageMock = vi.fn();
      const event = { data: { type: 'GET_SW_VERSION' }, source: { postMessage: postMessageMock } };
      dispatchSwEvent('message', event);
      expect(postMessageMock).toHaveBeenCalledWith({ type: 'SW_VERSION', version: '2.0.0' });
    });

    it('缓存桶名应包含版本号 v2.0.0', async () => {
      const installEvent = makeInstallEvent();
      dispatchSwEvent('install', installEvent);
      await installEvent._waitAll();

      const keys = await mockCacheStorage.keys();
      const versionedCaches = keys.filter((k) => k.includes('v2.0.0'));
      expect(versionedCaches.length).toBeGreaterThan(0);
    });
  });

  // ==================== 边界情况 ====================
  describe('边界情况', () => {
    it('多次调用 install 不应抛出错误', async () => {
      const e1 = makeInstallEvent();
      const e2 = makeInstallEvent();
      dispatchSwEvent('install', e1);
      dispatchSwEvent('install', e2);
      await Promise.all([e1._waitAll(), e2._waitAll()]);
      expect(mockSkipWaiting).toHaveBeenCalledTimes(2);
    });

    it('fetch 事件中 request.url 来自非 localhost origin 应跳过处理', () => {
      const event = {
        request: { url: 'https://cdn.example.com/lib.js', mode: 'cors' },
        respondedWith: undefined as Promise<Response> | undefined,
        respondWith(p: Promise<Response>) {
          this.respondedWith = p;
        },
      };
      dispatchSwEvent('fetch', event);
      expect(event.respondedWith).toBeUndefined();
    });

    it('API 响应 503 应包含 Content-Type: application/json', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Offline'));
      const event = makeFetchEvent('/api/missing');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;
      expect(response?.headers.get('Content-Type')).toContain('application/json');
    });

    it('导航请求离线时响应 Content-Type 应为 text/html', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Offline'));
      const event = makeFetchEvent('/page-offline', 'navigate');
      dispatchSwEvent('fetch', event);
      const response = await event.respondedWith;
      expect(response?.status).toBe(503);
      expect(response?.headers.get('Content-Type')).toContain('text/html');
    });
  });
});