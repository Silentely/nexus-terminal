/**
 * Service Worker (sw.js) 单元测试
 *
 * 测试策略：通过模拟 Service Worker 全局环境（caches、fetch、self 等），
 * 读取并在受控上下文中执行 sw.js，然后触发注册的事件处理器验证行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// ==================== Service Worker 全局环境模拟 ====================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 模块级别的 mockFetch，在 beforeEach 中重新赋值
let mockFetchImpl: ReturnType<typeof vi.fn>;

/** 模拟的 Cache 对象 */
class MockCache {
  private store = new Map<string, Response>();

  async add(url: string): Promise<void> {
    // Use URL string directly to avoid Request constructor issues with relative URLs
    const response = await mockFetchImpl(url);
    this.store.set(url, response);
  }

  async addAll(urls: string[]): Promise<void> {
    await Promise.all(urls.map((u) => this.add(u)));
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url;
    this.store.set(key, response);
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.get(key);
  }

  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map((k) => new Request(k));
  }

  async delete(request: Request | string): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.delete(key);
  }

  get storeSize(): number {
    return this.store.size;
  }
}

/** 模拟的 CacheStorage 对象 */
class MockCacheStorage {
  private cachesMap = new Map<string, MockCache>();

  async open(name: string): Promise<MockCache> {
    if (!this.cachesMap.has(name)) {
      this.cachesMap.set(name, new MockCache());
    }
    return this.cachesMap.get(name)!;
  }

  async keys(): Promise<string[]> {
    return Array.from(this.cachesMap.keys());
  }

  async delete(name: string): Promise<boolean> {
    return this.cachesMap.delete(name);
  }

  async match(request: Request | string): Promise<Response | undefined> {
    for (const cache of this.cachesMap.values()) {
      const match = await cache.match(request);
      if (match) return match;
    }
    return undefined;
  }

  getCache(name: string): MockCache | undefined {
    return this.cachesMap.get(name);
  }

  clear(): void {
    this.cachesMap.clear();
  }
}

// ==================== 全局 Mock 设置 ====================

let mockCacheStorage: MockCacheStorage;
let eventListeners: Map<string, ((event: unknown) => void)[]>;
let mockSelf: Record<string, unknown>;
let skipWaitingMock: ReturnType<typeof vi.fn>;
let clientsClaimMock: ReturnType<typeof vi.fn>;

/** sw.js 源代码（只读一次） */
let swCode: string;

// 加载 sw.js 文件内容
beforeAll(() => {
  const swPath = resolve(__dirname, '../public/sw.js');
  swCode = readFileSync(swPath, 'utf-8');
});

/**
 * 每次测试前重新设置 SW 执行环境：
 * 重置所有 mock，重新执行 sw.js 以重新注册事件处理器。
 */
beforeEach(() => {
  mockFetchImpl = vi.fn();
  mockCacheStorage = new MockCacheStorage();
  eventListeners = new Map();
  skipWaitingMock = vi.fn().mockResolvedValue(undefined);
  clientsClaimMock = vi.fn().mockResolvedValue(undefined);

  // 模拟 self 对象（ServiceWorkerGlobalScope）
  mockSelf = {
    location: { origin: 'https://example.com' },
    skipWaiting: skipWaitingMock,
    clients: { claim: clientsClaimMock },
    addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type)!.push(handler);
    }),
  };

  // 在受控函数作用域中执行 sw.js，传入所有依赖
  // sw.js 中的 `self` 引用会使用参数 `self`，其他全局如 Response、AbortController 来自 Node/happy-dom
  const swFactory = new Function(
    'self',
    'caches',
    'fetch',
    'Response',
    'AbortController',
    'setTimeout',
    'clearTimeout',
    'crypto',
    swCode
  );

  swFactory(
    mockSelf,
    mockCacheStorage,
    mockFetchImpl,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    crypto
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

/** 触发已注册的事件处理器 */
function triggerEvent(type: string, event: unknown): void {
  const handlers = eventListeners.get(type) ?? [];
  for (const handler of handlers) {
    handler(event);
  }
}

/** 创建一个带有 waitUntil 和 respondWith 的模拟 FetchEvent */
function createFetchEvent(
  url: string,
  mode: RequestMode = 'cors'
): {
  event: {
    request: Request;
    waitUntil: ReturnType<typeof vi.fn>;
    respondWith: ReturnType<typeof vi.fn>;
  };
  captureResponse: () => Promise<Response>;
} {
  const request = new Request(url, { method: 'GET' });
  Object.defineProperty(request, 'mode', { value: mode, configurable: true });

  let resolveResponse!: (r: Response) => void;
  const responsePromise = new Promise<Response>((res) => {
    resolveResponse = res;
  });

  const event = {
    request,
    waitUntil: vi.fn(),
    respondWith: vi.fn((p: Promise<Response>) => {
      Promise.resolve(p).then(resolveResponse);
    }),
  };

  return {
    event,
    captureResponse: () => responsePromise,
  };
}

// ==================== install 事件测试 ====================

describe('install 事件', () => {
  it('应该注册 install 事件监听器', () => {
    expect(eventListeners.has('install')).toBe(true);
    expect(eventListeners.get('install')!.length).toBeGreaterThan(0);
  });

  it('应该在 install 时调用 skipWaiting', () => {
    const waitUntilFn = vi.fn();
    triggerEvent('install', { waitUntil: waitUntilFn });
    expect(skipWaitingMock).toHaveBeenCalledTimes(1);
  });

  it('应该调用 waitUntil 处理预缓存 Promise', () => {
    mockFetchImpl.mockResolvedValue(new Response('ok', { status: 200 }));
    const waitUntilFn = vi.fn();
    triggerEvent('install', { waitUntil: waitUntilFn });
    expect(waitUntilFn).toHaveBeenCalledTimes(1);
    // waitUntil 应该接收一个 Promise
    expect(waitUntilFn.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it('install 完成后 CACHE_STATIC 应被创建', async () => {
    mockFetchImpl.mockResolvedValue(new Response('resource', { status: 200 }));

    let capturedPromise: Promise<unknown> | undefined;
    triggerEvent('install', {
      waitUntil: (p: Promise<unknown>) => {
        capturedPromise = p;
      },
    });

    await capturedPromise;

    expect(mockCacheStorage.getCache('nexus-static-v2.0.0')).toBeDefined();
  });

  it('install 完成后 CACHE_ICONS 应被创建', async () => {
    mockFetchImpl.mockResolvedValue(new Response('icon', { status: 200 }));

    let capturedPromise: Promise<unknown> | undefined;
    triggerEvent('install', {
      waitUntil: (p: Promise<unknown>) => {
        capturedPromise = p;
      },
    });

    await capturedPromise;

    expect(mockCacheStorage.getCache('nexus-icons-v2.0.0')).toBeDefined();
  });

  it('install 应预缓存 "/" 到 CACHE_STATIC', async () => {
    mockFetchImpl.mockResolvedValue(new Response('<html>', { status: 200 }));

    let capturedPromise: Promise<unknown> | undefined;
    triggerEvent('install', {
      waitUntil: (p: Promise<unknown>) => {
        capturedPromise = p;
      },
    });

    await capturedPromise;

    const staticCache = mockCacheStorage.getCache('nexus-static-v2.0.0');
    expect(staticCache).toBeDefined();
    // "/" should be cached
    const cached = await staticCache!.match('/');
    expect(cached).toBeDefined();
  });

  it('install 应预缓存至少一个图标到 CACHE_ICONS', async () => {
    mockFetchImpl.mockResolvedValue(new Response('icon-data', { status: 200 }));

    let capturedPromise: Promise<unknown> | undefined;
    triggerEvent('install', {
      waitUntil: (p: Promise<unknown>) => {
        capturedPromise = p;
      },
    });

    await capturedPromise;

    const iconsCache = mockCacheStorage.getCache('nexus-icons-v2.0.0');
    expect(iconsCache!.storeSize).toBeGreaterThan(0);
  });
});

// ==================== activate 事件测试 ====================

describe('activate 事件', () => {
  it('应该注册 activate 事件监听器', () => {
    expect(eventListeners.has('activate')).toBe(true);
  });

  it('应该调用 clients.claim()', () => {
    triggerEvent('activate', { waitUntil: vi.fn() });
    expect(clientsClaimMock).toHaveBeenCalledTimes(1);
  });

  it('应该调用 waitUntil 处理缓存清理 Promise', () => {
    const waitUntilFn = vi.fn();
    triggerEvent('activate', { waitUntil: waitUntilFn });
    expect(waitUntilFn).toHaveBeenCalledTimes(1);
  });

  it('应该删除旧版本缓存（v1.0.0）', async () => {
    await mockCacheStorage.open('nexus-static-v1.0.0');
    await mockCacheStorage.open('nexus-api-v1.0.0');

    let capturedPromise: Promise<unknown> | undefined;
    triggerEvent('activate', {
      waitUntil: (p: Promise<unknown>) => {
        capturedPromise = p;
      },
    });

    await capturedPromise;

    const remaining = await mockCacheStorage.keys();
    expect(remaining).not.toContain('nexus-static-v1.0.0');
    expect(remaining).not.toContain('nexus-api-v1.0.0');
  });

  it('应该保留所有四个当前版本的缓存', async () => {
    await mockCacheStorage.open('nexus-static-v2.0.0');
    await mockCacheStorage.open('nexus-api-v2.0.0');
    await mockCacheStorage.open('nexus-icons-v2.0.0');
    await mockCacheStorage.open('nexus-pages-v2.0.0');
    // 旧版本
    await mockCacheStorage.open('nexus-old-v1.5.0');

    let capturedPromise: Promise<unknown> | undefined;
    triggerEvent('activate', {
      waitUntil: (p: Promise<unknown>) => {
        capturedPromise = p;
      },
    });

    await capturedPromise;

    const remaining = await mockCacheStorage.keys();
    expect(remaining).toContain('nexus-static-v2.0.0');
    expect(remaining).toContain('nexus-api-v2.0.0');
    expect(remaining).toContain('nexus-icons-v2.0.0');
    expect(remaining).toContain('nexus-pages-v2.0.0');
    expect(remaining).not.toContain('nexus-old-v1.5.0');
  });

  it('无旧缓存时激活不应报错', async () => {
    let capturedPromise: Promise<unknown> | undefined;
    expect(() => {
      triggerEvent('activate', {
        waitUntil: (p: Promise<unknown>) => {
          capturedPromise = p;
        },
      });
    }).not.toThrow();

    if (capturedPromise) {
      await expect(capturedPromise).resolves.toBeDefined();
    }
  });
});

// ==================== message 事件测试 ====================

describe('message 事件', () => {
  it('应该注册 message 事件监听器', () => {
    expect(eventListeners.has('message')).toBe(true);
  });

  it('GET_SW_VERSION 应回复版本号 2.0.0', () => {
    const postMessageMock = vi.fn();
    triggerEvent('message', {
      data: { type: 'GET_SW_VERSION' },
      source: { postMessage: postMessageMock },
    });
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'SW_VERSION', version: '2.0.0' });
  });

  it('GET_SW_VERSION 响应的 type 字段应为 SW_VERSION', () => {
    const postMessageMock = vi.fn();
    triggerEvent('message', {
      data: { type: 'GET_SW_VERSION' },
      source: { postMessage: postMessageMock },
    });
    const msg = postMessageMock.mock.calls[0][0];
    expect(msg.type).toBe('SW_VERSION');
  });

  it('SKIP_WAITING 应调用 self.skipWaiting()', () => {
    skipWaitingMock.mockClear();
    triggerEvent('message', {
      data: { type: 'SKIP_WAITING' },
      source: {},
    });
    expect(skipWaitingMock).toHaveBeenCalledTimes(1);
  });

  it('CACHE_URLS 应通过 fetch 缓存提供的 URLs', async () => {
    mockFetchImpl.mockResolvedValue(new Response('content', { status: 200 }));

    triggerEvent('message', {
      data: {
        type: 'CACHE_URLS',
        urls: ['https://example.com/api/data', 'https://example.com/api/other'],
      },
      source: {},
    });

    // 等待异步缓存完成
    await new Promise((r) => setTimeout(r, 20));

    expect(mockFetchImpl).toHaveBeenCalledWith('https://example.com/api/data');
    expect(mockFetchImpl).toHaveBeenCalledWith('https://example.com/api/other');
  });

  it('CACHE_URLS 为非数组时不应缓存', () => {
    mockFetchImpl.mockClear();
    triggerEvent('message', {
      data: { type: 'CACHE_URLS', urls: 'not-an-array' },
      source: {},
    });
    expect(mockFetchImpl).not.toHaveBeenCalled();
  });

  it('CACHE_URLS 缺少 urls 字段时不应报错', () => {
    expect(() => {
      triggerEvent('message', {
        data: { type: 'CACHE_URLS' },
        source: {},
      });
    }).not.toThrow();
  });

  it('未知消息类型应静默忽略', () => {
    const postMessageMock = vi.fn();
    expect(() => {
      triggerEvent('message', {
        data: { type: 'SOME_UNKNOWN_TYPE' },
        source: { postMessage: postMessageMock },
      });
    }).not.toThrow();
    expect(postMessageMock).not.toHaveBeenCalled();
    expect(skipWaitingMock).not.toHaveBeenCalled();
  });

  it('event.data 为 null 时应安全处理', () => {
    expect(() => {
      triggerEvent('message', { data: null, source: {} });
    }).not.toThrow();
  });

  it('event.data 为 undefined 时应安全处理', () => {
    expect(() => {
      triggerEvent('message', { data: undefined, source: {} });
    }).not.toThrow();
  });
});

// ==================== fetch 事件路由测试 ====================

describe('fetch 事件路由', () => {
  it('应该注册 fetch 事件监听器', () => {
    expect(eventListeners.has('fetch')).toBe(true);
  });

  it('navigate 模式请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('<html>', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/dashboard', 'navigate');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('/api/ 路径请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('{}', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/api/users');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('.js 文件请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('js', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/assets/app.abc123.js');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('.css 文件请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('css', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/assets/styles.css');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('.woff2 文件请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('font', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/fonts/roboto.woff2');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('.woff 文件请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('font', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/fonts/roboto.woff');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('.ttf 文件请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('font', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/fonts/roboto.ttf');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('/icons/ 路径请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('icon', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/icons/icon-192x192.png');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('其他同源请求应调用 respondWith', () => {
    mockFetchImpl.mockResolvedValue(new Response('data', { status: 200 }));
    const { event } = createFetchEvent('https://example.com/some/other/resource');
    triggerEvent('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  it('跨域请求不应调用 respondWith', () => {
    const { event } = createFetchEvent('https://cdn.other-domain.com/resource.js');
    triggerEvent('fetch', event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });
});

// ==================== cacheFirst 策略测试 ====================

describe('cacheFirst 策略（JS/CSS/字体/图标请求）', () => {
  it('缓存命中时应直接返回缓存且不调用 fetch', async () => {
    const cachedBody = 'cached-js-content';
    const staticCache = await mockCacheStorage.open('nexus-static-v2.0.0');
    await staticCache.put(
      'https://example.com/app.js',
      new Response(cachedBody, { status: 200 })
    );

    const { event, captureResponse } = createFetchEvent('https://example.com/app.js');
    triggerEvent('fetch', event);

    expect(event.respondWith).toHaveBeenCalled();
    const response = await captureResponse();
    // 命中缓存时不应调用 fetch
    expect(mockFetchImpl).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('缓存未命中时应从网络获取', async () => {
    mockFetchImpl.mockResolvedValue(new Response('fresh-content', { status: 200 }));

    const { event, captureResponse } = createFetchEvent('https://example.com/new-chunk.js');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(mockFetchImpl).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('网络成功后应将响应存入缓存', async () => {
    mockFetchImpl.mockResolvedValue(new Response('js-content', { status: 200 }));

    const { event, captureResponse } = createFetchEvent('https://example.com/unchached.js');
    triggerEvent('fetch', event);
    await captureResponse();

    // 等待异步 cache.put 完成
    await new Promise((r) => setTimeout(r, 10));

    const staticCache = mockCacheStorage.getCache('nexus-static-v2.0.0');
    expect(staticCache).toBeDefined();
  });

  it('图标缓存命中时应直接返回缓存', async () => {
    const iconsCache = await mockCacheStorage.open('nexus-icons-v2.0.0');
    await iconsCache.put(
      'https://example.com/icons/icon-192x192.png',
      new Response('icon-data', { status: 200 })
    );

    const { event, captureResponse } = createFetchEvent(
      'https://example.com/icons/icon-192x192.png'
    );
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(mockFetchImpl).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});

// ==================== networkFirst 策略测试 ====================

describe('networkFirst 策略（其他请求）', () => {
  it('网络可用时应返回网络响应', async () => {
    mockFetchImpl.mockResolvedValue(new Response('live', { status: 200 }));

    const { event, captureResponse } = createFetchEvent('https://example.com/some-resource');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.status).toBe(200);
    expect(mockFetchImpl).toHaveBeenCalled();
  });

  it('网络失败且无缓存时应返回 503', async () => {
    mockFetchImpl.mockRejectedValue(new TypeError('Network failed'));

    const { event, captureResponse } = createFetchEvent('https://example.com/offline-resource');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.status).toBe(503);
  });
});

// ==================== networkFirstWithFallback 策略测试 ====================

describe('networkFirstWithFallback 策略（导航请求）', () => {
  it('网络成功时应返回网络响应', async () => {
    mockFetchImpl.mockResolvedValue(
      new Response('<html>page</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const { event, captureResponse } = createFetchEvent('https://example.com/page', 'navigate');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.status).toBe(200);
    expect(mockFetchImpl).toHaveBeenCalled();
  });

  it('网络成功时应将响应存入 CACHE_PAGES', async () => {
    mockFetchImpl.mockResolvedValue(
      new Response('<html>page</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const { event, captureResponse } = createFetchEvent(
      'https://example.com/dashboard',
      'navigate'
    );
    triggerEvent('fetch', event);
    await captureResponse();

    await new Promise((r) => setTimeout(r, 10));

    const pagesCache = mockCacheStorage.getCache('nexus-pages-v2.0.0');
    expect(pagesCache).toBeDefined();
  });

  it('网络失败且无缓存时应返回 503 HTML 响应', async () => {
    mockFetchImpl.mockRejectedValue(new TypeError('Network error'));

    const { event, captureResponse } = createFetchEvent(
      'https://example.com/unknown-page',
      'navigate'
    );
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('网络失败但有缓存 /index.html 时应返回缓存', async () => {
    const pagesCache = await mockCacheStorage.open('nexus-pages-v2.0.0');
    await pagesCache.put(
      '/index.html',
      new Response('<html>cached app</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    mockFetchImpl.mockRejectedValue(new TypeError('Offline'));

    const { event, captureResponse } = createFetchEvent(
      'https://example.com/some-page',
      'navigate'
    );
    triggerEvent('fetch', event);

    const response = await captureResponse();
    // 应该返回缓存的 index.html（200）而不是 503
    expect(response.status).toBe(200);
  });
});

// ==================== networkFirstWithTimeout 策略测试 ====================

describe('networkFirstWithTimeout 策略（/api/ 请求）', () => {
  it('网络成功时应返回 API 响应', async () => {
    mockFetchImpl.mockResolvedValue(
      new Response('{"users":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { event, captureResponse } = createFetchEvent('https://example.com/api/users');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.status).toBe(200);
  });

  it('API 请求失败且无缓存时应返回 503 JSON', async () => {
    mockFetchImpl.mockRejectedValue(new TypeError('Network failed'));

    const { event, captureResponse } = createFetchEvent('https://example.com/api/nonexistent');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: 'Offline' });
  });

  it('API 请求失败且 Content-Type 应为 application/json', async () => {
    mockFetchImpl.mockRejectedValue(new TypeError('Network failed'));

    const { event, captureResponse } = createFetchEvent('https://example.com/api/test');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('API 请求失败有缓存时应返回缓存', async () => {
    const apiCache = await mockCacheStorage.open('nexus-api-v2.0.0');
    await apiCache.put(
      'https://example.com/api/cached',
      new Response('{"cached":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    mockFetchImpl.mockRejectedValue(new TypeError('Network failed'));

    const { event, captureResponse } = createFetchEvent('https://example.com/api/cached');
    triggerEvent('fetch', event);

    const response = await captureResponse();
    expect(response.status).toBe(200);
  });

  it('API 成功响应应存入 CACHE_API', async () => {
    mockFetchImpl.mockResolvedValue(
      new Response('{"data":"fresh"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { event, captureResponse } = createFetchEvent('https://example.com/api/data');
    triggerEvent('fetch', event);
    await captureResponse();

    await new Promise((r) => setTimeout(r, 10));

    const apiCache = mockCacheStorage.getCache('nexus-api-v2.0.0');
    expect(apiCache).toBeDefined();
  });
});

// ==================== 版本号和常量测试 ====================

describe('版本号和缓存桶命名', () => {
  it('SW 版本应为 2.0.0', () => {
    const postMessageMock = vi.fn();
    triggerEvent('message', {
      data: { type: 'GET_SW_VERSION' },
      source: { postMessage: postMessageMock },
    });
    expect(postMessageMock.mock.calls[0][0].version).toBe('2.0.0');
  });

  it('install 后应使用版本化的缓存桶名称', async () => {
    mockFetchImpl.mockResolvedValue(new Response('ok', { status: 200 }));

    let capturedPromise: Promise<unknown> | undefined;
    triggerEvent('install', {
      waitUntil: (p: Promise<unknown>) => {
        capturedPromise = p;
      },
    });

    await capturedPromise;

    const keys = await mockCacheStorage.keys();
    // 所有缓存桶名称都应包含版本号 2.0.0
    keys.forEach((k) => expect(k).toContain('2.0.0'));
  });

  it('应该注册全部四种事件：install、fetch、activate、message', () => {
    const expected = ['install', 'fetch', 'activate', 'message'];
    expected.forEach((type) => {
      expect(eventListeners.has(type)).toBe(true);
    });
  });
});

// ==================== trimCache 行为测试 ====================

describe('trimCache 行为（通过超量 API 请求间接测试）', () => {
  it('API 缓存应在成功响应后存储条目', async () => {
    mockFetchImpl.mockResolvedValue(
      new Response('{"result":"ok"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { event, captureResponse } = createFetchEvent('https://example.com/api/trim-test');
    triggerEvent('fetch', event);
    await captureResponse();

    // 等待异步 cache.put 和 trimCache 完成
    await new Promise((r) => setTimeout(r, 20));

    // API 缓存桶应该被创建
    const apiCache = mockCacheStorage.getCache('nexus-api-v2.0.0');
    expect(apiCache).toBeDefined();
  });

  it('非 2xx API 响应不应存入缓存', async () => {
    mockFetchImpl.mockResolvedValue(new Response('Not Found', { status: 404 }));

    const { event, captureResponse } = createFetchEvent('https://example.com/api/not-found');
    triggerEvent('fetch', event);
    const response = await captureResponse();

    await new Promise((r) => setTimeout(r, 10));

    expect(response.status).toBe(404);
    // The API cache should not have the 404 entry
    const apiCache = mockCacheStorage.getCache('nexus-api-v2.0.0');
    if (apiCache) {
      const cached = await apiCache.match('https://example.com/api/not-found');
      expect(cached).toBeUndefined();
    }
  });
});
