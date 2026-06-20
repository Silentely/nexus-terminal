/** Service Worker 版本号，每次部署时递增以触发更新检测 */
const SW_VERSION = '2.0.0';

// 命名缓存桶，按资源类型隔离
const CACHE_STATIC = `nexus-static-v${SW_VERSION}`;
const CACHE_API = `nexus-api-v${SW_VERSION}`;
const CACHE_ICONS = `nexus-icons-v${SW_VERSION}`;
const CACHE_PAGES = `nexus-pages-v${SW_VERSION}`;

// API 缓存配置
const API_CACHE_MAX = 50;
const API_TIMEOUT_MS = 10000;

// 预缓存的应用 shell 资源
const APP_SHELL_URLS = ['/', '/index.html'];

// 需要预缓存的图标
const ICON_URLS = [
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
];

// 不应缓存的 API 端点（认证/会话相关）
const AUTH_API_PREFIXES = ['/api/v1/auth/', '/api/v1/passkey'];

// ==================== install ====================
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      // 预缓存应用 shell
      caches.open(CACHE_STATIC).then((cache) => cache.addAll(APP_SHELL_URLS)),
      // 预缓存图标
      caches.open(CACHE_ICONS).then((cache) => cache.addAll(ICON_URLS)),
    ]).then(() => self.skipWaiting()),
  );
});

// ==================== fetch ====================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 仅处理同源请求
  if (url.origin !== self.location.origin) return;

  // 导航请求：Network-First，降级到缓存的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request, CACHE_PAGES));
    return;
  }

  // API 请求：Network-First，10 秒超时降级到缓存（认证端点排除缓存）
  if (url.pathname.startsWith('/api/')) {
    const isAuthEndpoint = AUTH_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    if (isAuthEndpoint) {
      // 认证端点始终走网络，不缓存
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(networkFirstWithTimeout(request, CACHE_API, API_TIMEOUT_MS));
    }
    return;
  }

  // 静态资源（JS/CSS/字体）：Cache-First
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.ttf')
  ) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 图标：Cache-First
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, CACHE_ICONS));
    return;
  }

  // 其他请求：Network-First
  event.respondWith(networkFirst(request));
});

// ==================== activate ====================
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_STATIC, CACHE_API, CACHE_ICONS, CACHE_PAGES];
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !currentCaches.includes(name))
            .map((name) => caches.delete(name)),
        ),
      ),
  );
  self.clients.claim();
});

// ==================== message ====================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_SW_VERSION') {
    // event.source 可能为 null（消息来源上下文已关闭）
    event.source?.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // 运行时缓存指定 URL（供客户端按需缓存 API 响应等）
  if (event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(CACHE_API).then((cache) =>
        Promise.all(
          event.data.urls.map((url) =>
            fetch(url)
              .then((response) => {
                if (response && response.ok) {
                  return cache.put(url, response.clone());
                }
              })
              .catch(() => {
                // 单个 URL 失败不影响其他 URL 的缓存
              }),
          ),
        ),
      ),
    );
  }
});

// ==================== 缓存策略实现 ====================

/**
 * Serve the given request from cache if available; otherwise fetch from the network and cache successful responses.
 * @param {Request|string} request - The request (or request URL) to satisfy.
 * @param {string} cacheName - The name of the cache to read from and write to.
 * @returns {Response} The cached `Response` if present, otherwise the network `Response`.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Fetches the given request from the network and falls back to a cached response if the network fails.
 * @param {Request} request - The request to retrieve.
 * @returns {Response} The network `Response` when the fetch succeeds; if the fetch fails, a cached `Response` matching the request if available, otherwise a 503 `Response` with body `'Offline'`.
 */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

/**
 * Serve navigation requests using a network-first strategy with an offline fallback.
 *
 * If the network fetch succeeds, a successful response is written to the specified cache.
 * On network failure, returns a cached response matching the request or `/index.html` if available;
 * if no cached fallback exists, returns a 503 HTML response with body "Offline".
 *
 * @param {Request} request - The navigation request to fetch or fall back for.
 * @param {string} cacheName - The name of the cache where successful navigation responses are stored.
 * @returns {Response} The network response when available; otherwise a cached response or a 503 HTML "Offline" response.
 */
async function networkFirstWithFallback(request, cacheName) {
  try {
    const response = await fetch(request);
    // 缓存最新的 index.html 供离线使用
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match('/index.html'));
    return (
      cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } })
    );
  }
}

/**
 * Try to fetch a request from network first, falling back to cache on timeout or failure.
 *
 * If the network response arrives before the timeout and has a successful status, the response is stored in the given cache. If the fetch times out or fails, a matching cached response is returned when available; otherwise a 503 JSON response indicating offline is returned.
 *
 * @param {Request|string} request - Request object or URL to fetch.
 * @param {string} cacheName - Cache to store successful network responses.
 * @param {number} timeoutMs - Milliseconds to wait before aborting the network request.
 * @returns {Response} Network Response when available; otherwise a cached Response if present; if neither is available, a 503 Response with body `{"error":"Offline"}`.
 */
async function networkFirstWithTimeout(request, cacheName, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      // 限制 API 缓存条目数量，FIFO 淘汰
      trimCache(cacheName, API_CACHE_MAX);
    }
    return response;
  } catch {
    clearTimeout(timeoutId);
    const cached = await caches.match(request);
    return (
      cached ||
      new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }
}

/**
 * Limit the number of entries in a cache by removing the oldest entries.
 *
 * Evicts entries when the cache contains more than `maxEntries`; eviction is
 * performed in FIFO order based on the array returned by `cache.keys()`.
 * @param {string} cacheName - The name of the cache to trim.
 * @param {number} maxEntries - The maximum number of entries to retain.
 */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // 删除最早的条目（keys[0] 是最早的）
    await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
  }
}
