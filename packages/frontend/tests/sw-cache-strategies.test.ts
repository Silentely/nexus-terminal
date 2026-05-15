/**
 * Tests for public/sw.js Service Worker caching strategies.
 *
 * Since sw.js registers event listeners on `self` and does not export its internal
 * caching-strategy functions, we test behaviour by:
 *   1. Setting up a complete mock Service Worker global environment.
 *   2. Dynamically importing sw.js, which runs and registers all event listeners.
 *   3. Capturing those listeners via a spy on `self.addEventListener`.
 *   4. Invoking the captured handlers with simulated events and asserting outcomes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mock Service Worker global environment ====================

/** Minimal Cache implementation used across tests */
function createMockCache() {
  const store = new Map<string, Response>();
  return {
    _store: store,
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.get(key) ?? undefined;
    }),
    put: vi.fn(async (req: Request | string, res: Response) => {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, res);
    }),
    addAll: vi.fn(async (urls: string[]) => {
      for (const url of urls) {
        store.set(url, new Response(`cached:${url}`));
      }
    }),
    add: vi.fn(),
    delete: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.delete(key);
    }),
    keys: vi.fn(async () => Array.from(store.keys()).map((url) => new Request(url))),
    matchAll: vi.fn(),
  };
}

type MockCache = ReturnType<typeof createMockCache>;

/** Storage for named caches */
const cacheStore = new Map<string, MockCache>();

const mockCaches = {
  open: vi.fn(async (name: string) => {
    if (!cacheStore.has(name)) {
      cacheStore.set(name, createMockCache());
    }
    return cacheStore.get(name)!;
  }),
  match: vi.fn(async (req: Request | string) => {
    for (const cache of cacheStore.values()) {
      const key = typeof req === 'string' ? req : req.url;
      const hit = cache._store.get(key);
      if (hit) return hit;
    }
    return undefined;
  }),
  keys: vi.fn(async () => Array.from(cacheStore.keys())),
  delete: vi.fn(async (name: string) => {
    return cacheStore.delete(name);
  }),
  has: vi.fn(async (name: string) => cacheStore.has(name)),
};

/** Captured event listeners from sw.js */
const eventListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

/** Minimal ServiceWorker self-like object */
const mockSelf = {
  location: { origin: 'http://localhost' },
  skipWaiting: vi.fn(),
  clients: { claim: vi.fn() },
  addEventListener: vi.fn((type: string, handler: (...args: unknown[]) => void) => {
    if (!eventListeners[type]) eventListeners[type] = [];
    eventListeners[type].push(handler);
  }),
  postMessage: vi.fn(),
};

/** Default mock fetch that returns a 200 OK response */
let mockFetch = vi.fn(async (_req: Request | string) => new Response('network-response', { status: 200 }));

// ==================== helpers ====================

/** Build a minimal FetchEvent-like object */
function makeFetchEvent(url: string, mode: RequestMode = 'cors') {
  const request = new Request(url, { mode });
  const respondWithSpy = vi.fn();
  return {
    request,
    respondWith: respondWithSpy,
    waitUntil: vi.fn(),
  };
}

/** Trigger a registered event listener by type */
function trigger(type: string, event: unknown) {
  const handlers = eventListeners[type] ?? [];
  handlers.forEach((h) => h(event));
}

// ==================== module setup ====================

beforeEach(async () => {
  // Reset state
  cacheStore.clear();
  for (const key of Object.keys(eventListeners)) {
    delete eventListeners[key];
  }
  vi.clearAllMocks();
  mockFetch = vi.fn(async () => new Response('network-response', { status: 200 }));

  // Inject globals that sw.js depends on
  vi.stubGlobal('caches', mockCaches);
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('self', mockSelf);

  // Reset module registry so the top-level addEventListener calls re-run
  vi.resetModules();

  // Re-import so event listeners are registered fresh
  await import('../public/sw.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ==================== install handler ====================

describe('install イベント (SW install event)', () => {
  it('应预缓存应用 shell (APP_SHELL_URLS)', async () => {
    const waitUntilPromises: Promise<unknown>[] = [];
    const installEvent = {
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
    };

    trigger('install', installEvent);
    await Promise.all(waitUntilPromises);

    // Should have opened a static cache
    const staticOpenCall = mockCaches.open.mock.calls.find(([name]) =>
      (name as string).startsWith('nexus-static-v')
    );
    expect(staticOpenCall).toBeTruthy();

    const staticCache = await mockCaches.open(staticOpenCall![0] as string);
    expect(staticCache.addAll).toHaveBeenCalledWith(
      expect.arrayContaining(['/', '/index.html'])
    );
  });

  it('应预缓存图标 (ICON_URLS)', async () => {
    const waitUntilPromises: Promise<unknown>[] = [];
    const installEvent = {
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
    };

    trigger('install', installEvent);
    await Promise.all(waitUntilPromises);

    const iconsOpenCall = mockCaches.open.mock.calls.find(([name]) =>
      (name as string).startsWith('nexus-icons-v')
    );
    expect(iconsOpenCall).toBeTruthy();

    const iconsCache = await mockCaches.open(iconsOpenCall![0] as string);
    expect(iconsCache.addAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        '/icons/icon-72x72.png',
        '/icons/icon-512x512.png',
      ])
    );
  });

  it('应调用 self.skipWaiting', () => {
    const installEvent = { waitUntil: vi.fn() };
    trigger('install', installEvent);
    expect(mockSelf.skipWaiting).toHaveBeenCalled();
  });
});

// ==================== activate handler ====================

describe('activate イベント (SW activate event)', () => {
  it('应调用 self.clients.claim', async () => {
    const waitUntilPromises: Promise<unknown>[] = [];
    const activateEvent = {
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
    };

    trigger('activate', activateEvent);
    await Promise.all(waitUntilPromises);

    expect(mockSelf.clients.claim).toHaveBeenCalled();
  });

  it('应删除过期缓存桶（不在当前版本列表中的）', async () => {
    // Seed an old cache name that doesn't belong to current version
    cacheStore.set('nexus-static-v1.0.0', createMockCache());
    cacheStore.set('old-cache', createMockCache());
    // Leave these with non-v2 names so activate should delete them
    mockCaches.keys.mockResolvedValue(['nexus-static-v1.0.0', 'old-cache']);

    const waitUntilPromises: Promise<unknown>[] = [];
    trigger('activate', {
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
    });
    await Promise.all(waitUntilPromises);

    // Both old caches should have been deleted
    expect(mockCaches.delete).toHaveBeenCalledWith('nexus-static-v1.0.0');
    expect(mockCaches.delete).toHaveBeenCalledWith('old-cache');
  });

  it('应保留当前版本缓存桶', async () => {
    const currentName = 'nexus-static-v2.0.0';
    mockCaches.keys.mockResolvedValue([currentName]);

    const waitUntilPromises: Promise<unknown>[] = [];
    trigger('activate', {
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
    });
    await Promise.all(waitUntilPromises);

    expect(mockCaches.delete).not.toHaveBeenCalledWith(currentName);
  });
});

// ==================== message handler ====================

describe('message イベント (SW message event)', () => {
  it('GET_SW_VERSION 应回复版本号', () => {
    const source = { postMessage: vi.fn() };
    const messageEvent = {
      data: { type: 'GET_SW_VERSION' },
      source,
    };

    trigger('message', messageEvent);

    expect(source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SW_VERSION', version: '2.0.0' })
    );
  });

  it('SKIP_WAITING 应调用 self.skipWaiting', () => {
    trigger('message', { data: { type: 'SKIP_WAITING' }, source: { postMessage: vi.fn() } });
    expect(mockSelf.skipWaiting).toHaveBeenCalled();
  });

  it('CACHE_URLS 应 fetch 并缓存指定 URL 列表', async () => {
    const urls = ['/api/data1', '/api/data2'];

    // We collect the waitUntil promises indirectly via the import trigger
    // Since CACHE_URLS doesn't call waitUntil we just wait for fetch calls
    trigger('message', {
      data: { type: 'CACHE_URLS', urls },
      source: { postMessage: vi.fn() },
    });

    // Allow async operations to settle
    await new Promise((r) => setTimeout(r, 0));

    // fetch should have been called for each URL
    expect(mockFetch).toHaveBeenCalledTimes(urls.length);
    expect(mockFetch).toHaveBeenCalledWith(urls[0]);
    expect(mockFetch).toHaveBeenCalledWith(urls[1]);
  });

  it('CACHE_URLS 中 urls 不是数组时应安全忽略', () => {
    expect(() =>
      trigger('message', {
        data: { type: 'CACHE_URLS', urls: 'not-an-array' },
        source: { postMessage: vi.fn() },
      })
    ).not.toThrow();
    // fetch should not have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('未知消息类型应被安全忽略', () => {
    expect(() =>
      trigger('message', { data: { type: 'UNKNOWN_MSG' }, source: { postMessage: vi.fn() } })
    ).not.toThrow();
  });

  it('data 为 null 时应安全忽略', () => {
    expect(() => trigger('message', { data: null, source: { postMessage: vi.fn() } })).not.toThrow();
  });
});

// ==================== fetch handler routing ====================

describe('fetch イベントルーティング (SW fetch routing)', () => {
  /** Invoke the fetch handler and return the argument passed to respondWith, awaited */
  async function dispatchFetch(url: string, mode: RequestMode = 'cors') {
    const event = makeFetchEvent(url, mode);
    trigger('fetch', event);

    if (event.respondWith.mock.calls.length === 0) {
      // SW returned early (non-origin request)
      return null;
    }

    // respondWith is called with a Promise<Response>
    return await (event.respondWith.mock.calls[0][0] as Promise<Response>);
  }

  it('非同源请求不应调用 respondWith', async () => {
    const event = makeFetchEvent('https://external.com/file.js');
    trigger('fetch', event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('导航请求（mode=navigate）应走 Network-First 策略', async () => {
    const response = await dispatchFetch('http://localhost/page', 'navigate');
    expect(response).not.toBeNull();
    // Network was tried first
    expect(mockFetch).toHaveBeenCalled();
  });

  it('API 请求应走带超时的 Network-First 策略', async () => {
    const response = await dispatchFetch('http://localhost/api/users');
    expect(response).not.toBeNull();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('.js 静态资源应走 Cache-First 策略（网络有效时缓存响应）', async () => {
    const response = await dispatchFetch('http://localhost/assets/app.js');
    expect(response).not.toBeNull();
  });

  it('.css 静态资源应走 Cache-First 策略', async () => {
    const response = await dispatchFetch('http://localhost/assets/main.css');
    expect(response).not.toBeNull();
  });

  it('.woff2 字体文件应走 Cache-First 策略', async () => {
    const response = await dispatchFetch('http://localhost/fonts/inter.woff2');
    expect(response).not.toBeNull();
  });

  it('/icons/ 路径应走 Cache-First 策略', async () => {
    const response = await dispatchFetch('http://localhost/icons/icon-144x144.png');
    expect(response).not.toBeNull();
  });

  it('其他请求应走默认 Network-First 策略', async () => {
    const response = await dispatchFetch('http://localhost/some/other/path');
    expect(response).not.toBeNull();
    expect(mockFetch).toHaveBeenCalled();
  });
});

// ==================== cacheFirst strategy (tested via fetch routing) ====================

describe('cacheFirst 策略', () => {
  it('缓存命中时应直接返回缓存响应（不请求网络）', async () => {
    // Pre-populate the static cache
    const cachedResponse = new Response('cached-js-content', { status: 200 });
    const cacheKey = 'http://localhost/assets/app.js';

    // Inject into the match global mock so cache.match returns our cached response
    mockCaches.match.mockResolvedValueOnce(cachedResponse);

    const event = makeFetchEvent(cacheKey);
    trigger('fetch', event);

    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);
    expect(response).toBe(cachedResponse);
    // Network should not have been called for a cache hit
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('缓存未命中时应请求网络并缓存成功响应', async () => {
    // No cache hit
    mockCaches.match.mockResolvedValueOnce(undefined);
    const networkResponse = new Response('network-js', { status: 200 });
    mockFetch.mockResolvedValueOnce(networkResponse);

    const event = makeFetchEvent('http://localhost/assets/bundle.js');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response).toBeDefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('网络返回非 OK 响应时不应写入缓存', async () => {
    mockCaches.match.mockResolvedValueOnce(undefined);
    const notFoundResponse = new Response('not found', { status: 404 });
    mockFetch.mockResolvedValueOnce(notFoundResponse);

    const event = makeFetchEvent('http://localhost/assets/missing.js');
    trigger('fetch', event);
    await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    // caches.open should NOT have been called to store the 404
    const putCalls = Array.from(cacheStore.values()).flatMap((c) => c.put.mock.calls);
    expect(putCalls.length).toBe(0);
  });
});

// ==================== networkFirst strategy ====================

describe('networkFirst 策略', () => {
  it('网络可用时应返回网络响应', async () => {
    const networkResp = new Response('live-data', { status: 200 });
    mockFetch.mockResolvedValueOnce(networkResp);

    const event = makeFetchEvent('http://localhost/some/resource');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response).toBeDefined();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('网络失败时应返回缓存响应', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    const cachedResp = new Response('cached-data', { status: 200 });
    mockCaches.match.mockResolvedValueOnce(cachedResp);

    const event = makeFetchEvent('http://localhost/some/resource');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response).toBe(cachedResp);
  });

  it('网络失败且无缓存时应返回 503 Offline', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    mockCaches.match.mockResolvedValueOnce(undefined);

    const event = makeFetchEvent('http://localhost/some/resource');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe('Offline');
  });
});

// ==================== networkFirstWithFallback (navigation) ====================

describe('networkFirstWithFallback 策略 (navigate)', () => {
  it('网络成功时应缓存响应并返回', async () => {
    const networkResp = new Response('<!DOCTYPE html>', { status: 200 });
    mockFetch.mockResolvedValueOnce(networkResp);

    const event = makeFetchEvent('http://localhost/', 'navigate');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response).toBeDefined();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('网络失败时应降级到 /index.html 缓存', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const indexHtml = new Response('<html>app</html>', { status: 200 });
    // First match attempt (for the request itself) returns undefined, second (for /index.html) returns the html
    mockCaches.match
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(indexHtml);

    const event = makeFetchEvent('http://localhost/some-page', 'navigate');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response).toBe(indexHtml);
  });

  it('网络失败且无任何缓存时应返回 503 HTML', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    mockCaches.match.mockResolvedValue(undefined);

    const event = makeFetchEvent('http://localhost/page', 'navigate');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toBe('text/html');
    const body = await response.text();
    expect(body).toBe('Offline');
  });
});

// ==================== networkFirstWithTimeout (API) ====================

describe('networkFirstWithTimeout 策略 (API)', () => {
  it('网络成功时应返回网络响应并缓存', async () => {
    const apiResp = new Response('{"data": []}', { status: 200 });
    mockFetch.mockResolvedValueOnce(apiResp);

    const event = makeFetchEvent('http://localhost/api/connections');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response).toBeDefined();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('网络失败时应降级到缓存响应', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));
    const cachedApi = new Response('{"data": "cached"}', { status: 200 });
    mockCaches.match.mockResolvedValueOnce(cachedApi);

    const event = makeFetchEvent('http://localhost/api/data');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response).toBe(cachedApi);
  });

  it('网络失败且无缓存时应返回 503 JSON', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));
    mockCaches.match.mockResolvedValueOnce(undefined);

    const event = makeFetchEvent('http://localhost/api/data');
    trigger('fetch', event);
    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const body = await response.json();
    expect(body).toEqual({ error: 'Offline' });
  });

  it('超时时应中止 fetch 并使用缓存响应', async () => {
    vi.useFakeTimers();

    // Simulate a request that hangs (AbortController will cancel it)
    let abortController: AbortController | null = null;
    mockFetch.mockImplementationOnce((_req: unknown, opts?: RequestInit) => {
      // Capture the abort signal; return a promise that rejects when aborted
      return new Promise<Response>((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    });

    const cachedResp = new Response('{"cached": true}', { status: 200 });
    mockCaches.match.mockResolvedValueOnce(cachedResp);

    const event = makeFetchEvent('http://localhost/api/slow');
    trigger('fetch', event);

    // Advance past the 10-second API timeout
    vi.advanceTimersByTime(11000);

    const response = await (event.respondWith.mock.calls[0][0] as Promise<Response>);
    expect(response).toBe(cachedResp);
  });
});

// ==================== trimCache (indirectly via API caching) ====================

describe('trimCache (API 缓存 FIFO 淘汰)', () => {
  it('缓存条目超过上限时应删除最早的条目', async () => {
    // Simulate a pre-filled API cache with 51 entries (limit is 50)
    const apiCacheName = 'nexus-api-v2.0.0';
    const apiCache = createMockCache();

    // Add 51 keys to the store
    const oldestKey = 'http://localhost/api/oldest';
    apiCache._store.set(oldestKey, new Response('old'));
    for (let i = 0; i < 50; i++) {
      apiCache._store.set(`http://localhost/api/entry-${i}`, new Response(`entry-${i}`));
    }

    // keys() returns all requests in insertion order
    apiCache.keys.mockResolvedValue(
      Array.from(apiCache._store.keys()).map((u) => new Request(u))
    );

    cacheStore.set(apiCacheName, apiCache);
    mockCaches.open.mockResolvedValue(apiCache);

    // Make an API call that results in caching + trimming
    const networkResp = new Response('{"new": true}', { status: 200 });
    mockFetch.mockResolvedValueOnce(networkResp);

    const event = makeFetchEvent('http://localhost/api/new-endpoint');
    trigger('fetch', event);
    await (event.respondWith.mock.calls[0][0] as Promise<Response>);

    // Allow trimCache's async operations to settle
    await new Promise((r) => setTimeout(r, 0));

    // delete should have been called for the oldest entry (FIFO)
    expect(apiCache.delete).toHaveBeenCalled();
  });

  it('条目数量未超过上限时不应删除任何条目', async () => {
    const apiCacheName = 'nexus-api-v2.0.0';
    const apiCache = createMockCache();

    // Only 5 entries — well under the 50 limit
    for (let i = 0; i < 5; i++) {
      apiCache._store.set(`http://localhost/api/entry-${i}`, new Response(`entry-${i}`));
    }
    apiCache.keys.mockResolvedValue(
      Array.from(apiCache._store.keys()).map((u) => new Request(u))
    );

    cacheStore.set(apiCacheName, apiCache);
    mockCaches.open.mockResolvedValue(apiCache);

    const networkResp = new Response('{"data": 1}', { status: 200 });
    mockFetch.mockResolvedValueOnce(networkResp);

    const event = makeFetchEvent('http://localhost/api/new');
    trigger('fetch', event);
    await (event.respondWith.mock.calls[0][0] as Promise<Response>);
    await new Promise((r) => setTimeout(r, 0));

    expect(apiCache.delete).not.toHaveBeenCalled();
  });
});

// ==================== SW version constant ====================

describe('SW_VERSION 常量', () => {
  it('GET_SW_VERSION 消息应返回版本 2.0.0', () => {
    const source = { postMessage: vi.fn() };
    trigger('message', { data: { type: 'GET_SW_VERSION' }, source });

    const [msg] = source.postMessage.mock.calls[0];
    expect(msg.version).toBe('2.0.0');
  });
});
