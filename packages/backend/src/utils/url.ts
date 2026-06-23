import dns from 'dns/promises';
import ipaddr from 'ipaddr.js';
import { logger } from './logger';

/** SSRF 防护：需要阻止的 ipaddr.js 范围标识 */
const SSRF_BLOCKED_RANGES = new Set([
  'private', // RFC 1918 (10/8, 172.16/12, 192.168/16)
  'loopback', // 127.0.0.0/8, ::1
  'linkLocal', // 169.254.0.0/16, fe80::/10
  'uniqueLocal', // fc00::/7 (IPv6 ULA)
  'broadcast', // 广播地址
  'carrierGradeNat', // 100.64.0.0/10 (运营商级 NAT)
  'reserved', // 其他保留地址段
]);

/**
 * 检查单个 IP 地址是否属于受限地址段
 * @param address IP 地址字符串
 * @returns 如果属于受限范围则返回 range 名称，否则返回 null
 */
const checkAddressRange = (address: string): string | null => {
  try {
    const parsed = ipaddr.parse(address);
    // IPv4-mapped IPv6（如 ::ffff:127.0.0.1）需提取内嵌 IPv4 再检查
    let range = parsed.range();
    if (range === 'ipv4Mapped' && parsed.kind() === 'ipv6') {
      range = (parsed as ipaddr.IPv6).toIPv4Address().range();
    }
    return SSRF_BLOCKED_RANGES.has(range) ? range : null;
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    return null;
  }
};

/**
 * 解析主机名的所有 IP 地址（IPv4 + IPv6）
 * @param hostname 主机名
 * @returns 解析到的 IP 地址列表
 */
const resolveAllAddresses = async (hostname: string): Promise<string[]> => {
  const [ipv4List, ipv6List] = await Promise.all([
    dns.resolve4(hostname).catch(() => []),
    dns.resolve6(hostname).catch(() => []),
  ]);
  return [...ipv4List, ...ipv6List];
};

/** SSRF 防护验证结果 */
export interface SsrfValidationResult {
  /** 主机名 */
  hostname: string;
  /** 解析到的所有公开 IP 地址 */
  addresses: string[];
}

/**
 * SSRF 防护：验证 URL 目标地址不属于私有/内部网络
 * 通过 DNS 解析主机名，检查所有解析到的 IP 是否属于受限地址段
 * @param targetUrl 需要验证的目标 URL
 * @param sourceTag 调用方标识，用于日志
 * @throws 如果解析到私有/保留 IP 或 DNS 解析失败则抛出错误
 */
export const validateUrlNotPrivate = async (
  targetUrl: string,
  sourceTag = 'URL',
): Promise<void> => {
  await resolveAndValidatePublicHost(targetUrl, sourceTag);
};

/**
 * SSRF 防护增强版：解析 + 校验 + 返回 IP 列表
 * 解决 TOCTOU 问题：调用方可使用返回的 IP 列表进行 DNS 绑定
 * @param targetUrl 需要验证的目标 URL
 * @param sourceTag 调用方标识，用于日志
 * @returns 主机名和解析到的公开 IP 地址列表
 * @throws 如果解析到私有/保留 IP 或 DNS 解析失败则抛出错误
 */
export const resolveAndValidatePublicHost = async (
  targetUrl: string,
  sourceTag = 'URL',
): Promise<SsrfValidationResult> => {
  const urlObj = new URL(targetUrl);

  // 协议白名单：仅允许 http/https，阻止 file:/gopher:/data: 等危险协议
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    logger.warn(`[SSRF] ${sourceTag} 阻止：不允许的协议 ${urlObj.protocol}`);
    throw new Error('仅支持 http/https 协议，请求已阻止。');
  }

  // IPv6 地址在 URL.hostname 中带方括号，ipaddr.parse 需要去除
  const hostname = urlObj.hostname.replace(/^\[(.*)\]$/, '$1');

  // 如果主机名本身是 IP 地址，直接检查，无需 DNS 解析
  try {
    const parsed = ipaddr.parse(hostname);
    // IPv4-mapped IPv6（如 ::ffff:127.0.0.1）需先提取内嵌 IPv4 再检查范围
    let checkRange = parsed.range();
    if (checkRange === 'ipv4Mapped' && parsed.kind() === 'ipv6') {
      const ipv4 = (parsed as ipaddr.IPv6).toIPv4Address();
      checkRange = ipv4.range();
    }
    if (SSRF_BLOCKED_RANGES.has(checkRange)) {
      logger.warn(`[SSRF] ${sourceTag} 阻止：主机名 ${hostname} 是私有/保留 IP (${checkRange})`);
      throw new Error('目标地址解析到不允许的网络范围，请求已阻止。');
    }
    return { hostname, addresses: [hostname] };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('目标地址')) {
      throw error;
    }
    // 主机名不是合法 IP，继续 DNS 解析
  }

  // DNS 解析并检查所有解析到的 IP
  const allAddresses = await resolveAllAddresses(hostname);

  // 关键修复：DNS 解析全部失败时阻止放行（而非静默放行）
  if (allAddresses.length === 0) {
    logger.warn(`[SSRF] ${sourceTag} 阻止：主机名 ${hostname} DNS 解析失败，无法验证安全性`);
    throw new Error('目标域名无法解析，无法验证地址安全性，请求已阻止。');
  }

  for (const addr of allAddresses) {
    const range = checkAddressRange(addr);
    if (range) {
      logger.warn(
        `[SSRF] ${sourceTag} 阻止：主机名 ${hostname} 解析到私有/保留 IP ${addr} (${range})`,
      );
      throw new Error('目标地址解析到不允许的网络范围，请求已阻止。');
    }
  }

  return { hostname, addresses: allAddresses };
};

export const getSingleHeaderToken = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .find(Boolean);
};

const normalizeHostname = (hostname: string): string => {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
};

export const normalizeOrigin = (origin: string): string | undefined => {
  try {
    return new URL(origin).origin;
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    return undefined;
  }
};

export const getHostnameFromOrigin = (origin: string): string | undefined => {
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    return undefined;
  }
};

export const getHostnameFromHostHeader = (hostHeader: string): string | undefined => {
  const token = getSingleHeaderToken(hostHeader);
  if (!token) {
    return undefined;
  }

  try {
    return normalizeHostname(new URL(`http://${token}`).hostname);
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    return undefined;
  }
};
