/**
 * Tests for public/sw.js – Service Worker caching strategies and event handlers.
 *
 * Strategy: mock the Service Worker global environment (caches, fetch, self)
 * before importing sw.js so that its event-listener registrations are captured
 * and can be replayed in each test.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ==================== Cache API mock ====================

type MockCache = {
  _store: Map<string, Response>;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  addAll: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
};

function createMockCache(): MockCache {
  const store = new Map<string, Response>();
  return {
    _store: store,
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.get(key) ?? undefined;
    }),
    put: vi.fn(async (req: Request | string, resp: Response) => {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, resp);
    }),
    addAll: vi.fn(async (urls: string[]) => {
      for (const url of urls) {
        store.set(url, new Response('cached', { status: 200 }));
      }
    }),
    add: vi.fn(async (url: string) => {
      store.set(url, new Response('cached', { status: 200 }));
    }),
    delete: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.delete(key);
    }),
    keys: vi.fn(async () =>
      Array.from(store.keys()).map((url) => new Request(url))
    ),
  };
}

const mockCacheRegistry = new Map<string, MockCache>();

/** Reset registry and re-create fresh caches between tests */
function resetCacheRegistry() {
  mockCacheRegistry.clear();
}

const mockCaches = {
  open: vi.fn(async (name: string) => {
    if (!mockCacheRegistry.has(name)) {
      mockCacheRegistry.set(name, createMockCache());
    }
    return mockCacheRegistry.get(name)!;
  }),
  match: vi.fn(async (req: Request | string) => {
    const key = typeof req === 'string' ? req : req.url;
    for (const cache of mockCacheRegistry.values()) {
      const val = cache._store.get(key);
      if (val) return val;
    }
    return undefined;
  }),
  keys: vi.fn(async () => Array.from(mockCacheRegistry.keys())),
  delete: vi.fn(async (name: string) => mockCacheRegistry.delete(name)),
  has: vi.fn(async (name: string) => mockCacheRegistry.has(name)),
};

// ==================== fetch mock ====================

/** Permanent mock – never reassigned; use mockImplementationOnce for per-test overrides */
const mockFetch = vi.fn(async (_req: Request | string, _opts?: RequestInit) => {
  return new Response('network response', { status: 200 });
});

// ==================== self mock ====================

/** Event handler registry – populated when sw.js calls self.addEventListener */
const swHandlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};

const mockSelf = {
  location: { origin: 'http://localhost' },
  skipWaiting: vi.fn(),
  clients: { claim: vi.fn() },
  addEventListener: vi.fn((type: string, handler: (...args: unknown[]) => unknown) => {
    if (!swHandlers[type]) swHandlers[type] = [];
    swHandlers[type].push(handler);
  }),
};

// ==================== Helpers ====================

function fire(type: string, event: unknown) {
  for (const handler of swHandlers[type] ?? []) handler(event);
}

function makeExtendableEvent(type: string) {
  return { type, waitUntil: vi.fn((p: Promise<unknown>) => p) };
}

function makeFetchEvent(url: string, mode: RequestMode = 'cors') {
  return {
    type: 'fetch',
    request: new Request(url, { mode }),
    respondWith: vi.fn(),
    waitUntil: vi.fn((p: Promise<unknown>) => p),
  };
}

function makeMessageEvent(data: unknown, sourceFn?: ReturnType<typeof vi.fn>) {
  return {
    type: 'message',
    data,
    source: { postMessage: sourceFn ?? vi.fn() },
  };
}

// ==================== Module load ====================
// Stubs must be set before sw.js is imported (its top-level code runs at import time)

vi.stubGlobal('caches', mockCaches);
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('self', mockSelf);

// Import sw.js – registers event listeners on `self` at module evaluation time
await import('../public/sw.js');

// ==================== Test suites ====================

describe('SW install event', () => {
  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
    // Restore open implementation after clearAllMocks clears call history
    mockCaches.open.mockImplementation(async (name: string) => {
      if (!mockCacheRegistry.has(name)) {
        mockCacheRegistry.set(name, createMockCache());
      }
      return mockCacheRegistry.get(name)!;
    });
  });

  it('calls self.skipWaiting()', () => {
    const evt = makeExtendableEvent('install');
    fire('install', evt);
    expect(mockSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it('opens the static cache during install', async () => {
    const evt = makeExtendableEvent('install');
    fire('install', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    const names = mockCaches.open.mock.calls.map((c) => c[0] as string);
    expect(names.some((n) => n.includes('static'))).toBe(true);
  });

  it('opens the icons cache during install', async () => {
    const evt = makeExtendableEvent('install');
    fire('install', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    const names = mockCaches.open.mock.calls.map((c) => c[0] as string);
    expect(names.some((n) => n.includes('icon'))).toBe(true);
  });

  it('calls addAll at least twice (once per cache bucket)', async () => {
    const evt = makeExtendableEvent('install');
    fire('install', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    let total = 0;
    for (const cache of mockCacheRegistry.values()) {
      total += (cache.addAll as ReturnType<typeof vi.fn>).mock.calls.length;
    }
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it('uses versioned cache names containing "2.0.0"', async () => {
    const evt = makeExtendableEvent('install');
    fire('install', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    const names = mockCaches.open.mock.calls.map((c) => c[0] as string);
    expect(names.some((n) => n.includes('2.0.0'))).toBe(true);
  });

  it('static and icon buckets are separate named caches', async () => {
    const evt = makeExtendableEvent('install');
    fire('install', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    const names = mockCaches.open.mock.calls.map((c) => c[0] as string);
    const staticNames = names.filter((n) => n.includes('static'));
    const iconNames = names.filter((n) => n.includes('icon'));
    expect(staticNames.length).toBeGreaterThan(0);
    expect(iconNames.length).toBeGreaterThan(0);
    // Confirm no single name contains both "static" and "icon"
    expect(names.some((n) => n.includes('static') && n.includes('icon'))).toBe(false);
  });
});

describe('SW activate event', () => {
  beforeAll(() => {
    mockCaches.delete.mockImplementation(async (name: string) => {
      mockCacheRegistry.delete(name);
      return true;
    });
  });

  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
  });

  it('calls self.clients.claim() on activate', () => {
    const evt = makeExtendableEvent('activate');
    fire('activate', evt);
    expect(mockSelf.clients.claim).toHaveBeenCalledOnce();
  });

  it('deletes stale caches not in the current version list', async () => {
    mockCaches.keys.mockResolvedValueOnce(['nexus-static-v1.0.0', 'nexus-cache-old']);
    const evt = makeExtendableEvent('activate');
    fire('activate', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    const deleted = (mockCaches.delete as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(deleted).toContain('nexus-static-v1.0.0');
    expect(deleted).toContain('nexus-cache-old');
  });

  it('preserves all four current-version caches', async () => {
    mockCaches.keys.mockResolvedValueOnce([
      'nexus-static-v2.0.0',
      'nexus-api-v2.0.0',
      'nexus-icons-v2.0.0',
      'nexus-pages-v2.0.0',
    ]);
    const evt = makeExtendableEvent('activate');
    fire('activate', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    expect(mockCaches.delete).not.toHaveBeenCalled();
  });

  it('deletes stale caches but keeps current ones in mixed list', async () => {
    mockCaches.keys.mockResolvedValueOnce([
      'nexus-static-v0.9.0',      // stale
      'nexus-static-v2.0.0',      // current – keep
      'nexus-legacy-cache',        // stale
    ]);
    const evt = makeExtendableEvent('activate');
    fire('activate', evt);
    const [promise] = (evt.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0];
    await promise;
    const deleted = (mockCaches.delete as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(deleted).toContain('nexus-static-v0.9.0');
    expect(deleted).toContain('nexus-legacy-cache');
    expect(deleted).not.toContain('nexus-static-v2.0.0');
  });
});

describe('SW message handler', () => {
  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
    mockCaches.open.mockImplementation(async (name: string) => {
      if (!mockCacheRegistry.has(name)) {
        mockCacheRegistry.set(name, createMockCache());
      }
      return mockCacheRegistry.get(name)!;
    });
    mockFetch.mockImplementation(async () => new Response('ok', { status: 200 }));
  });

  it('GET_SW_VERSION replies with { type: "SW_VERSION", version: <string> }', () => {
    const reply = vi.fn();
    fire('message', makeMessageEvent({ type: 'GET_SW_VERSION' }, reply));
    expect(reply).toHaveBeenCalledOnce();
    const msg = reply.mock.calls[0][0] as { type: string; version: string };
    expect(msg.type).toBe('SW_VERSION');
    expect(typeof msg.version).toBe('string');
    expect(msg.version.length).toBeGreaterThan(0);
  });

  it('GET_SW_VERSION reports a semver-like version (x.y.z)', () => {
    const reply = vi.fn();
    fire('message', makeMessageEvent({ type: 'GET_SW_VERSION' }, reply));
    const msg = reply.mock.calls[0][0] as { version: string };
    expect(msg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('SKIP_WAITING calls self.skipWaiting()', () => {
    fire('message', makeMessageEvent({ type: 'SKIP_WAITING' }));
    expect(mockSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it('unknown message type is silently ignored (no throw)', () => {
    expect(() => fire('message', makeMessageEvent({ type: 'UNKNOWN' }))).not.toThrow();
  });

  it('null message data is silently ignored', () => {
    expect(() => fire('message', makeMessageEvent(null))).not.toThrow();
  });

  it('CACHE_URLS fetches each URL and stores in API cache', async () => {
    const urls = ['http://localhost/api/a', 'http://localhost/api/b'];
    fire('message', makeMessageEvent({ type: 'CACHE_URLS', urls }));
    // Allow micro-tasks/promises to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const openedCaches = mockCaches.open.mock.calls.map((c) => c[0] as string);
    expect(openedCaches.some((n) => n.includes('api'))).toBe(true);
  });

  it('CACHE_URLS with empty array does not call fetch', async () => {
    fire('message', makeMessageEvent({ type: 'CACHE_URLS', urls: [] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('CACHE_URLS with non-array urls is ignored', async () => {
    fire('message', makeMessageEvent({ type: 'CACHE_URLS', urls: 'not-an-array' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SW fetch event – routing', () => {
  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
    mockCaches.open.mockImplementation(async (name: string) => {
      if (!mockCacheRegistry.has(name)) {
        mockCacheRegistry.set(name, createMockCache());
      }
      return mockCacheRegistry.get(name)!;
    });
    mockCaches.match.mockImplementation(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      for (const cache of mockCacheRegistry.values()) {
        const val = cache._store.get(key);
        if (val) return val;
      }
      return undefined;
    });
    mockFetch.mockImplementation(async () => new Response('network ok', { status: 200 }));
  });

  it('cross-origin requests bypass the SW (respondWith not called)', () => {
    const evt = makeFetchEvent('https://external.example.com/script.js');
    fire('fetch', evt);
    expect(evt.respondWith).not.toHaveBeenCalled();
  });

  it('navigate requests call respondWith', () => {
    const evt = makeFetchEvent('http://localhost/page', 'navigate');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('/api/* requests call respondWith', () => {
    const evt = makeFetchEvent('http://localhost/api/users');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('.js assets call respondWith (Cache-First)', () => {
    const evt = makeFetchEvent('http://localhost/assets/app.js');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('.css assets call respondWith (Cache-First)', () => {
    const evt = makeFetchEvent('http://localhost/assets/style.css');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('.woff2 fonts call respondWith (Cache-First)', () => {
    const evt = makeFetchEvent('http://localhost/fonts/icon.woff2');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('.woff fonts call respondWith (Cache-First)', () => {
    const evt = makeFetchEvent('http://localhost/fonts/icon.woff');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('.ttf fonts call respondWith (Cache-First)', () => {
    const evt = makeFetchEvent('http://localhost/fonts/font.ttf');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('/icons/* requests call respondWith (Cache-First)', () => {
    const evt = makeFetchEvent('http://localhost/icons/icon-192x192.png');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });

  it('other same-origin requests call respondWith (Network-First fallback)', () => {
    const evt = makeFetchEvent('http://localhost/manifest.json');
    fire('fetch', evt);
    expect(evt.respondWith).toHaveBeenCalledOnce();
  });
});

describe('SW fetch – Cache-First strategy', () => {
  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
    mockCaches.open.mockImplementation(async (name: string) => {
      if (!mockCacheRegistry.has(name)) {
        mockCacheRegistry.set(name, createMockCache());
      }
      return mockCacheRegistry.get(name)!;
    });
    mockFetch.mockImplementation(async () => new Response('fresh', { status: 200 }));
  });

  it('serves a cached .js asset without calling fetch', async () => {
    const cached = new Response('cached js', { status: 200 });
    mockCaches.match.mockResolvedValueOnce(cached);

    const evt = makeFetchEvent('http://localhost/assets/app.js');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(mockFetch).not.toHaveBeenCalled();
    expect(response).toBe(cached);
  });

  it('fetches from network and returns response when asset not cached', async () => {
    mockCaches.match.mockResolvedValueOnce(undefined);

    const evt = makeFetchEvent('http://localhost/assets/main.css');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it('caches a newly fetched static asset', async () => {
    mockCaches.match.mockResolvedValueOnce(undefined);

    const evt = makeFetchEvent('http://localhost/assets/vendor.js');
    fire('fetch', evt);
    await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // The static cache should have had put called
    let putCalled = false;
    for (const cache of mockCacheRegistry.values()) {
      if ((cache.put as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        putCalled = true;
      }
    }
    expect(putCalled).toBe(true);
  });

  it('does not cache a non-ok (4xx) response', async () => {
    mockCaches.match.mockResolvedValueOnce(undefined);
    mockFetch.mockImplementationOnce(async () => new Response('Not Found', { status: 404 }));

    const evt = makeFetchEvent('http://localhost/assets/missing.js');
    fire('fetch', evt);
    await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // No cache.put should have been called
    for (const cache of mockCacheRegistry.values()) {
      expect(cache.put).not.toHaveBeenCalled();
    }
  });
});

describe('SW fetch – Network-First (navigate) strategy', () => {
  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
    mockCaches.open.mockImplementation(async (name: string) => {
      if (!mockCacheRegistry.has(name)) {
        mockCacheRegistry.set(name, createMockCache());
      }
      return mockCacheRegistry.get(name)!;
    });
    mockCaches.match.mockImplementation(async () => undefined);
    mockFetch.mockImplementation(async () => new Response('<html>app</html>', { status: 200 }));
  });

  it('returns live network response for navigation when online', async () => {
    const evt = makeFetchEvent('http://localhost/', 'navigate');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('caches successful navigation response for offline use', async () => {
    const evt = makeFetchEvent('http://localhost/', 'navigate');
    fire('fetch', evt);
    await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];
    let putCalled = false;
    for (const cache of mockCacheRegistry.values()) {
      if ((cache.put as ReturnType<typeof vi.fn>).mock.calls.length > 0) putCalled = true;
    }
    expect(putCalled).toBe(true);
  });

  it('falls back to 503 HTML response when offline and no cache exists', async () => {
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Network failure');
    });
    mockCaches.match.mockResolvedValue(undefined);

    const evt = makeFetchEvent('http://localhost/settings', 'navigate');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response.status).toBe(503);
    const ct = response.headers.get('Content-Type') ?? '';
    expect(ct).toContain('text/html');
  });

  it('falls back to cached index.html when offline', async () => {
    const cachedIndex = new Response('<html>cached</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Network failure');
    });
    // caches.match returns /index.html on second call
    mockCaches.match.mockImplementation(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      if (key === '/index.html' || key.endsWith('/index.html')) return cachedIndex;
      return undefined;
    });

    const evt = makeFetchEvent('http://localhost/workspace', 'navigate');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response.status).toBe(200);
  });
});

describe('SW fetch – Network-First-With-Timeout (API) strategy', () => {
  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
    mockCaches.open.mockImplementation(async (name: string) => {
      if (!mockCacheRegistry.has(name)) {
        mockCacheRegistry.set(name, createMockCache());
      }
      return mockCacheRegistry.get(name)!;
    });
    mockCaches.match.mockImplementation(async () => undefined);
    mockFetch.mockImplementation(async () => new Response('{"data":1}', { status: 200 }));
  });

  it('returns live API response when network succeeds', async () => {
    const evt = makeFetchEvent('http://localhost/api/users');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.status).toBe(200);
  });

  it('returns 503 JSON { error: "Offline" } when API unreachable and no cache', async () => {
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Network failure');
    });
    mockCaches.match.mockResolvedValue(undefined);

    const evt = makeFetchEvent('http://localhost/api/data');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response.status).toBe(503);
    const ct = response.headers.get('Content-Type') ?? '';
    expect(ct).toContain('application/json');
    const body = await response.json();
    expect(body).toEqual({ error: 'Offline' });
  });

  it('serves cached API response when network fails', async () => {
    const cachedApi = new Response('{"cached":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    mockCaches.match.mockResolvedValue(cachedApi);
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Network failure');
    });

    const evt = makeFetchEvent('http://localhost/api/search');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response).toBe(cachedApi);
  });

  it('caches a successful API response', async () => {
    const evt = makeFetchEvent('http://localhost/api/settings');
    fire('fetch', evt);
    await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    let putCalled = false;
    for (const cache of mockCacheRegistry.values()) {
      if ((cache.put as ReturnType<typeof vi.fn>).mock.calls.length > 0) putCalled = true;
    }
    expect(putCalled).toBe(true);
  });

  it('does not cache a non-ok API response', async () => {
    mockFetch.mockImplementationOnce(async () => new Response('Unauthorized', { status: 401 }));

    const evt = makeFetchEvent('http://localhost/api/secret');
    fire('fetch', evt);
    await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    for (const cache of mockCacheRegistry.values()) {
      expect(cache.put).not.toHaveBeenCalled();
    }
  });
});

describe('SW fetch – Network-First (other requests) strategy', () => {
  beforeEach(() => {
    resetCacheRegistry();
    vi.clearAllMocks();
    mockCaches.match.mockImplementation(async () => undefined);
    mockFetch.mockImplementation(async () => new Response('other', { status: 200 }));
  });

  it('returns network response for non-categorised same-origin request', async () => {
    const evt = makeFetchEvent('http://localhost/manifest.json');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.status).toBe(200);
  });

  it('returns 503 "Offline" when network fails and no cache', async () => {
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Network failure');
    });

    const evt = makeFetchEvent('http://localhost/manifest.json');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe('Offline');
  });

  it('returns cached response when network fails and cache has a match', async () => {
    const cached = new Response('cached manifest', { status: 200 });
    mockCaches.match.mockResolvedValueOnce(cached);
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Network failure');
    });

    const evt = makeFetchEvent('http://localhost/manifest.json');
    fire('fetch', evt);
    const response = await (evt.respondWith as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response).toBe(cached);
  });
});