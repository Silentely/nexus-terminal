/**
 * SSRF 安全 HTTP 客户端
 *
 * 解决 TOCTOU/DNS Rebinding 漏洞：
 * 1. 预先验证目标 IP 并缓存
 * 2. 通过自定义 DNS lookup 强制 axios 连接到已验证的 IP
 * 3. 禁用自动重定向，对每次重定向目标二次验证
 *
 * 使用方式：
 *   import { safeHttpGet } from '../utils/ssrf-guard';
 *   const response = await safeHttpGet(url, { timeout: 5000 });
 */

import http from 'http';
import https from 'https';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import ipaddr from 'ipaddr.js';
import { resolveAndValidatePublicHost, SsrfValidationResult } from './url';
import { logger } from './logger';

/** DNS 解析结果缓存 TTL（毫秒） */
const DNS_CACHE_TTL_MS = 30_000;

/** 最大重定向次数 */
const DEFAULT_MAX_REDIRECTS = 3;

/** DNS 缓存条目 */
interface DnsCacheEntry {
  result: SsrfValidationResult;
  expiresAt: number;
}

/** DNS 解析结果缓存（hostname -> 缓存条目） */
const dnsCache = new Map<string, DnsCacheEntry>();

/**
 * 获取 DNS 缓存或执行新的解析验证
 * 使用短 TTL 缓存减少重复 DNS 查询
 */
async function getOrResolveHost(
  targetUrl: string,
  sourceTag: string,
): Promise<SsrfValidationResult> {
  const urlObj = new URL(targetUrl);

  // 协议校验：仅允许 http/https，防止 file:/gopher:/ftp: 等非预期协议
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    throw new Error(`不支持的协议类型: ${urlObj.protocol}，仅允许 http: 和 https:`);
  }

  const hostname = urlObj.hostname.replace(/^\[(.*)\]$/, '$1');

  // 检查缓存（直接 IP 地址跳过缓存，因为不涉及 DNS）
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // 解析并验证
  const result = await resolveAndValidatePublicHost(targetUrl, sourceTag);

  // 写入缓存（非直接 IP 才缓存）
  // 使用 ipaddr.js 明确检测 IP 地址
  if (!ipaddr.isValid(hostname)) {
    // hostname 不是合法 IP，说明是域名，可以缓存
    dnsCache.set(hostname, {
      result,
      expiresAt: Date.now() + DNS_CACHE_TTL_MS,
    });
  }

  return result;
}

/**
 * 创建 DNS 绑定的 lookup 函数
 * 强制 HTTP/HTTPS Agent 连接到已验证的 IP 地址，消除 TOCTOU 空窗
 * 可被其他模块复用（如 nl2cmd、bridge）
 */
export function createPinnedLookup(allowedAddresses: string[]) {
  return (
    _hostname: string,
    _options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ): void => {
    const address = allowedAddresses[0];
    const family = address.includes(':') ? 6 : 4;
    callback(null, address, family);
  };
}

/**
 * 处理 HTTP 重定向响应
 * 对重定向目标 URL 进行二次 SSRF 验证
 * @param response axios 响应对象
 * @param originalUrl 原始请求 URL
 * @param sourceTag 调用方标识
 * @param maxRedirects 最大重定向次数
 * @param redirectCount 当前已重定向次数
 * @param config 原始请求配置
 * @returns 重定向后的最终响应
 */
async function handleRedirect(
  response: AxiosResponse,
  originalUrl: string,
  sourceTag: string,
  maxRedirects: number,
  redirectCount: number,
  config: AxiosRequestConfig,
): Promise<AxiosResponse> {
  const statusCode = response.status;
  // 显式限定需要跟随重定向的状态码集合，避免跟随 304 等非重定向 3xx
  const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
  if (
    redirectCount >= maxRedirects ||
    !REDIRECT_STATUS_CODES.has(statusCode) ||
    !response.headers.location
  ) {
    return response;
  }

  const redirectUrl = new URL(response.headers.location, originalUrl).toString();

  // 重定向目标二次验证（关键安全检查）
  logger.debug(
    `[SSRF Guard] ${sourceTag} 跟随重定向 ${redirectCount + 1}/${maxRedirects}: ${redirectUrl}`,
  );

  const { addresses } = await getOrResolveHost(redirectUrl, sourceTag);

  // 使用已验证的 IP 发起重定向请求
  const lookup = createPinnedLookup(addresses);

  const redirectResponse = await axios({
    ...config,
    url: redirectUrl,
    maxRedirects: 0, // 禁用 axios 自动重定向
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup }),
    validateStatus: () => true, // 不抛出 HTTP 错误
  });

  // 递归处理下一次重定向
  return handleRedirect(
    redirectResponse,
    redirectUrl,
    sourceTag,
    maxRedirects,
    redirectCount + 1,
    config,
  );
}

/**
 * 安全 HTTP GET 请求
 * 自动进行 SSRF 验证、DNS 绑定和重定向二次验证
 *
 * @param url 目标 URL
 * @param options 请求配置（timeout、headers 等）
 * @param sourceTag 调用方标识，用于日志追踪
 * @returns axios 响应对象
 * @throws SSRF 验证失败时抛出错误
 */
export async function safeHttpGet(
  url: string,
  options: AxiosRequestConfig = {},
  sourceTag = 'SSRF-Guard',
): Promise<AxiosResponse> {
  // 1. 预验证目标地址（DNS 解析 + 私有地址拦截 + DNS 绑定）
  const { addresses } = await getOrResolveHost(url, sourceTag);

  // 2. 创建 DNS 绑定的 Agent
  const lookup = createPinnedLookup(addresses);

  // 3. 构造已验证的安全 URL（经 SSRF 校验和 DNS 绑定，安全可信）
  const safeUrl = new URL(url).toString();

  // 4. 发起请求（禁用自动重定向和代理，确保 DNS pinning 生效）
  const response = await axios({
    ...options,
    url: safeUrl,
    method: options.method || 'GET',
    maxRedirects: 0, // 禁用 axios 自动重定向
    proxy: false, // 禁用 HTTP_PROXY/HTTPS_PROXY，防止代理绕过 DNS pinning
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup }),
    validateStatus: () => true, // 不抛出 HTTP 错误，由后续逻辑处理
  });

  // 4. 处理重定向
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  return handleRedirect(response, url, sourceTag, maxRedirects, 0, options);
}

/**
 * 安全 HTTP POST 请求
 * 自动进行 SSRF 验证、DNS 绑定和重定向二次验证
 *
 * @param url 目标 URL
 * @param data 请求体
 * @param options 请求配置
 * @param sourceTag 调用方标识
 * @returns axios 响应对象
 */
export async function safeHttpPost(
  url: string,
  data?: unknown,
  options: AxiosRequestConfig = {},
  sourceTag = 'SSRF-Guard',
): Promise<AxiosResponse> {
  return safeHttpGet(url, { ...options, method: 'POST', data }, sourceTag);
}

/**
 * 清理过期的 DNS 缓存条目
 * 可定期调用或在内存压力时调用
 */
export function cleanupDnsCache(): void {
  const now = Date.now();
  for (const [hostname, entry] of dnsCache) {
    if (entry.expiresAt <= now) {
      dnsCache.delete(hostname);
    }
  }
}

/**
 * 获取 DNS 缓存统计信息（用于监控）
 */
export function getDnsCacheStats(): { size: number; hostnames: string[] } {
  return {
    size: dnsCache.size,
    hostnames: Array.from(dnsCache.keys()),
  };
}
