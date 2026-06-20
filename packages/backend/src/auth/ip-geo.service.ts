/**
 * IP 地理定位服务
 * 支持多提供商适配器（ip-api、ipinfo、iplocate 等）
 * 两级缓存：内存 L1 + SQLite L2，持久化避免重启后重复查询
 * 用于登录事件审计日志增强
 */

import { getDbInstance, runDb, getDb as getDbRow } from '../database/connection';
import { logger } from '../utils/logger';

// ==================== 类型定义 ====================

export interface GeoInfo {
  country: string;
  regionName: string;
  city: string;
  isp: string;
  asn: string;
  query: string;
}

interface CacheEntry {
  geo: GeoInfo;
  expiresAt: number;
}

interface DbCacheRow {
  ip: string;
  country: string;
  region_name: string;
  city: string;
  isp: string;
  asn: string;
  provider: string;
  queried_at: number;
}

/** 地理定位提供商适配器接口 */
interface GeoProviderAdapter {
  readonly name: string;
  /** 从原始 API 响应中提取标准化 GeoInfo */
  parseResponse(data: unknown, ip: string): GeoInfo | null;
  /** 构造 API 请求 URL */
  buildUrl(ip: string): string;
}

// ==================== 常量 ====================

const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GEO_API_TIMEOUT_MS = 3000;
const GEO_CACHE_MAX_SIZE = 10000;
const GEO_DB_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 小时（秒）

// ==================== 提供商适配器 ====================

/** ip-api.com 适配器（免费 45 req/min，仅 HTTP；Pro 支持 HTTPS） */
const ipApiAdapter: GeoProviderAdapter = {
  name: 'ip-api',

  buildUrl(ip: string): string {
    // 免费端点不支持 HTTPS，Pro 用户可通过环境变量切换
    const useHttps = process.env.IP_API_USE_HTTPS === 'true';
    const protocol = useHttps ? 'https' : 'http';
    return `${protocol}://ip-api.com/json/${ip}?fields=country,regionName,city,isp,as,query`;
  },

  parseResponse(data: unknown, ip: string): GeoInfo | null {
    const d = data as Record<string, unknown>;
    if (d.status !== 'success') return null;
    return {
      country: (d.country as string) || '',
      regionName: (d.regionName as string) || '',
      city: (d.city as string) || '',
      isp: (d.isp as string) || '',
      asn: (d.as as string) || '',
      query: (d.query as string) || ip,
    };
  },
};

/** ipinfo.io 适配器（免费 50k req/month，需 token 可选） */
const ipinfoAdapter: GeoProviderAdapter = {
  name: 'ipinfo',

  buildUrl(ip: string): string {
    const token = process.env.IPINFO_TOKEN;
    return token ? `https://ipinfo.io/${ip}/json?token=${token}` : `https://ipinfo.io/${ip}/json`;
  },

  parseResponse(data: unknown, ip: string): GeoInfo | null {
    const d = data as Record<string, unknown>;
    if (d.bogon) return null;
    // ipinfo 的 org 字段格式为 "AS9269 Hong Kong Broadband Network Ltd."
    // 同时包含 ASN 和组织名，拆分后 asn 存完整 ASN 字符串，isp 存纯组织名
    const org = (d.org as string) || '';
    const asnMatch = org.match(/^(AS\d+)\s+(.+)$/);
    return {
      country: (d.country as string) || '',
      regionName: (d.region as string) || '',
      city: (d.city as string) || '',
      isp: asnMatch ? asnMatch[2] : org,
      asn: asnMatch ? `${asnMatch[1]} ${asnMatch[2]}` : org,
      query: ip,
    };
  },
};

/** iplocate.io 适配器（免费基础查询，可选 API key 提升配额） */
const iplocateAdapter: GeoProviderAdapter = {
  name: 'iplocate',

  buildUrl(ip: string): string {
    const token = process.env.IPLOCATE_TOKEN;
    const base = `https://iplocate.io/api/lookup/${ip}`;
    return token ? `${base}?apikey=${token}` : base;
  },

  parseResponse(data: unknown, ip: string): GeoInfo | null {
    const d = data as Record<string, unknown>;
    // iplocate 对无效 IP 返回空对象或错误，无 country 字段即视为失败
    if (!d || typeof d.country !== 'string') return null;
    const asnObj = d.asn as Record<string, unknown> | undefined;
    return {
      country: (d.country as string) || '',
      regionName: (d.subdivision as string) || '',
      city: (d.city as string) || '',
      isp: (asnObj?.name as string) || '',
      asn: asnObj ? `${asnObj.asn as string} ${(asnObj.name as string) || ''}`.trim() : '',
      query: (d.ip as string) || ip,
    };
  },
};

// ==================== 适配器注册表 ====================

const PROVIDER_ADAPTERS: Record<string, GeoProviderAdapter> = {
  'ip-api': ipApiAdapter,
  ipinfo: ipinfoAdapter,
  iplocate: iplocateAdapter,
};

// ==================== 服务实现 ====================

class IpGeoService {
  /** L1 内存缓存 */
  private memCache = new Map<string, CacheEntry>();
  /** 当前活跃的提供商适配器 */
  private adapter: GeoProviderAdapter;

  constructor() {
    const providerName = (process.env.GEO_PROVIDER || 'ip-api').trim();
    this.adapter = PROVIDER_ADAPTERS[providerName] || ipApiAdapter;
    if (providerName !== 'ip-api' && !PROVIDER_ADAPTERS[providerName]) {
      logger.warn(
        `[IpGeo] 未知提供商 "${providerName}"，可用: ${Object.keys(PROVIDER_ADAPTERS).join(', ')}。回退到 ip-api。`,
      );
      this.adapter = ipApiAdapter;
    }
    logger.info(`[IpGeo] 使用地理定位提供商: ${this.adapter.name}`);
  }

  /**
   * 查询 IP 地理位置（L1 内存 → L2 SQLite → API → 回写缓存）
   * 仅对公网 IP 查询，内网/未知 IP 直接返回 null
   * 可通过 ENABLE_GEO_LOOKUP=false 禁用
   */
  async lookup(ip: string): Promise<GeoInfo | null> {
    if (process.env.ENABLE_GEO_LOOKUP === 'false') {
      return null;
    }
    if (!ip || ip === 'unknown' || this.isPrivateIp(ip)) {
      return null;
    }

    // L1: 内存缓存
    const memCached = this.memCache.get(ip);
    if (memCached && memCached.expiresAt > Date.now()) {
      return memCached.geo;
    }

    // L2: SQLite 持久化缓存
    const dbCached = await this.loadFromDb(ip);
    if (dbCached) {
      this.setMemCache(ip, dbCached);
      return dbCached;
    }

    // 缓存未命中，调用 API
    const geo = await this.fetchFromApi(ip);
    if (geo) {
      // 回写两级缓存
      this.setMemCache(ip, geo);
      await this.saveToDb(ip, geo);
    }

    return geo;
  }

  /** 从 SQLite 加载缓存 */
  private async loadFromDb(ip: string): Promise<GeoInfo | null> {
    try {
      const db = await getDbInstance();
      const cutoff = Math.floor(Date.now() / 1000) - GEO_DB_CACHE_TTL_SECONDS;
      const row = await getDbRow<DbCacheRow>(
        db,
        'SELECT * FROM ip_geo_cache WHERE ip = ? AND queried_at > ?',
        [ip, cutoff],
      );
      if (!row) return null;
      return {
        country: row.country,
        regionName: row.region_name,
        city: row.city,
        isp: row.isp,
        asn: row.asn || '',
        query: row.ip,
      };
    } catch (err: unknown) {
      logger.debug({ err }, '操作失败，已忽略');
      return null;
    }
  }

  /** 写入 SQLite 缓存（UPSERT） */
  private async saveToDb(ip: string, geo: GeoInfo): Promise<void> {
    try {
      const db = await getDbInstance();
      const now = Math.floor(Date.now() / 1000);
      await runDb(
        db,
        `INSERT INTO ip_geo_cache (ip, country, region_name, city, isp, asn, provider, queried_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET
           country = excluded.country,
           region_name = excluded.region_name,
           city = excluded.city,
           isp = excluded.isp,
           asn = excluded.asn,
           provider = excluded.provider,
           queried_at = excluded.queried_at`,
        [ip, geo.country, geo.regionName, geo.city, geo.isp, geo.asn, this.adapter.name, now],
      );
    } catch (err: unknown) {
      logger.debug('[IpGeo] 写入 SQLite 缓存失败:', err instanceof Error ? err.message : err);
    }
  }

  /** 调用外部 API 查询地理位置 */
  private async fetchFromApi(ip: string): Promise<GeoInfo | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEO_API_TIMEOUT_MS);

      const url = this.adapter.buildUrl(ip);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data = await response.json();
      return this.adapter.parseResponse(data, ip);
    } catch (error: unknown) {
      logger.debug('[IpGeo] API 查询失败:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** 设置内存缓存，超出上限时 FIFO 淘汰 */
  private setMemCache(ip: string, geo: GeoInfo): void {
    this.memCache.set(ip, { geo, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
    if (this.memCache.size > GEO_CACHE_MAX_SIZE) {
      const oldestKey = this.memCache.keys().next().value;
      if (oldestKey) this.memCache.delete(oldestKey);
    }
  }

  /** 判断是否为内网/私有 IP（RFC 1918 + loopback + IPv6 ULA） */
  private isPrivateIp(ip: string): boolean {
    if (ip === '127.0.0.1' || ip === '::1') return true;
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    // RFC 1918: 172.16.0.0/12 (172.16.x.x ~ 172.31.x.x)
    if (ip.startsWith('172.')) {
      const second = parseInt(ip.split('.')[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    // IPv6 ULA: fc00::/7
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    return false;
  }

  /** 清理内存过期缓存 */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.memCache) {
      if (entry.expiresAt <= now) {
        this.memCache.delete(key);
      }
    }
  }
}

export const ipGeoService = new IpGeoService();

/**
 * 查询 IP 地理位置信息，返回格式化字符串。
 * 查询失败时静默忽略，返回 undefined。
 */
export async function lookupGeoInfo(ip: string | undefined | null): Promise<string | undefined> {
  if (!ip) return undefined;
  try {
    const geo = await ipGeoService.lookup(ip);
    if (geo) {
      const asnOrIsp = geo.asn || geo.isp;
      const parts = [geo.country, geo.city].filter(Boolean);
      const location = parts.join(', ');
      return location ? `${location} | ${asnOrIsp}` : asnOrIsp;
    }
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    /* 静默忽略 */
  }
  return undefined;
}
