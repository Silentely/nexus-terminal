import { Request, Response, NextFunction } from 'express';
import ipaddr from 'ipaddr.js';
import { settingsService } from '../settings/settings.service';
import { logger } from '../utils/logger';

const IP_WHITELIST_SETTING_KEY = 'ipWhitelist';
const IP_WHITELIST_ENABLED_SETTING_KEY = 'ipWhitelistEnabled';

// 本地缓存：避免每请求两次 DB 读取，TTL 10 秒
const CACHE_TTL_MS = 10_000;
let whitelistCache: { enabled: boolean; entries: string[] } | null = null;
let whitelistCacheExpiry = 0;

/**
 * 清除白名单缓存（测试用）
 */
export const clearWhitelistCache = (): void => {
  whitelistCache = null;
  whitelistCacheExpiry = 0;
};

// 本地开发环境的 IP 地址列表
const LOCAL_IPS = [
  '127.0.0.1', // IPv4 本地回环
  '::1', // IPv6 本地回环
  'localhost', // 本地主机名
];

// 高频低价值端点：本地 IP 放行时不输出日志，避免 Docker healthcheck 刷屏
const LOCAL_ALLOW_LOG_SKIP_PREFIXES = ['/api/v1/health', '/api/v1/metrics'];

/**
 * IP 白名单中间件
 * 检查请求来源 IP 是否在设置中定义的白名单内。
 * 白名单支持 IPv4, IPv6 地址以及 CIDR 范围。
 * 如果白名单未设置或为空，则允许所有 IP。
 * 本地开发环境的 IP 地址始终允许访问。
 */
export const ipWhitelistMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 获取请求 IP 地址
    const requestIpString = req.ip || req.socket.remoteAddress;

    if (!requestIpString) {
      logger.warn('无法获取请求 IP 地址，已拒绝访问。');
      return res
        .status(403)
        .json({ success: false, error: '禁止访问：无法识别来源 IP。', code: 'IP_UNRECOGNIZABLE' });
    }

    // 检查是否是本地开发环境的 IP
    if (LOCAL_IPS.includes(requestIpString)) {
      // 高频低价值端点（health/metrics）不输出日志，避免 Docker healthcheck 刷屏
      const isSkippablePath = LOCAL_ALLOW_LOG_SKIP_PREFIXES.some((prefix) =>
        req.path.startsWith(prefix),
      );

      if (!isSkippablePath) {
        logger.debug(`允许来自本地开发环境 (${requestIpString}) 的访问。`);
      }

      return next();
    }

    // 使用本地缓存避免每请求两次 DB 读取
    const now = Date.now();
    if (!whitelistCache || now > whitelistCacheExpiry) {
      const [enabledValue, whitelistString] = await Promise.all([
        settingsService.getSetting(IP_WHITELIST_ENABLED_SETTING_KEY),
        settingsService.getSetting(IP_WHITELIST_SETTING_KEY),
      ]);

      const entries = (whitelistString || '')
        .split(/[\n,]+/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      whitelistCache = { enabled: enabledValue !== 'false', entries };
      whitelistCacheExpiry = now + CACHE_TTL_MS;
    }

    if (!whitelistCache.enabled) {
      return next();
    }

    const whitelistEntries = whitelistCache.entries;

    // 如果解析后白名单为空，也允许所有请求 (避免配置错误导致完全锁死)
    if (whitelistEntries.length === 0) {
      logger.warn('IP 白名单设置非空但解析后为空，暂时允许所有 IP。请检查设置。');
      return next();
    }

    let requestIp: ipaddr.IPv4 | ipaddr.IPv6 | null = null;
    try {
      requestIp = ipaddr.parse(requestIpString);
    } catch (err: unknown) {
      logger.debug({ err }, '操作失败，已忽略');
      logger.warn(`无法解析请求 IP 地址 "${requestIpString}"，已拒绝访问。`);
      return res.status(403).json({
        success: false,
        error: '禁止访问：无效的来源 IP 格式。',
        code: 'INVALID_IP_FORMAT',
      });
    }

    if (!requestIp) {
      logger.warn(`无法解析请求 IP 地址 "${requestIpString}"，已拒绝访问。`);
      return res.status(403).json({
        success: false,
        error: '禁止访问：无效的来源 IP 格式。',
        code: 'INVALID_IP_FORMAT',
      });
    }

    // 检查 IP 是否匹配白名单中的任何条目
    const isAllowed = whitelistEntries.some((entry) => {
      try {
        // 尝试解析为 CIDR 范围
        const range = ipaddr.parseCIDR(entry);
        // 使用 match 方法检查 IP 是否在范围内
        // 需要根据 IP 类型调用正确的 match 签名
        if (requestIp.kind() === 'ipv4' && range[0].kind() === 'ipv4') {
          return (requestIp as ipaddr.IPv4).match(range as [ipaddr.IPv4, number]);
        }
        if (requestIp.kind() === 'ipv6' && range[0].kind() === 'ipv6') {
          // 注意：IPv6 的 match 可能需要特殊处理，取决于 ipaddr.js 的具体实现和类型定义
          // 这里假设 IPv6 的 match 签名与 IPv4 类似，但可能需要调整
          return (requestIp as ipaddr.IPv6).match(range as [ipaddr.IPv6, number]);
        }
        // 如果 IP 类型和范围类型不匹配，则认为不匹配
        return false;
      } catch (err: unknown) {
        logger.debug({ err }, '操作失败，已忽略');
        // 如果解析 CIDR 失败，尝试解析为单个 IP 地址
        try {
          const allowedIp = ipaddr.parse(entry);
          // 比较地址是否相同
          return (
            requestIp.kind() === allowedIp.kind() && requestIp.toString() === allowedIp.toString()
          );
        } catch (innerErr: unknown) {
          logger.debug({ err: innerErr }, '操作失败，已忽略');
          // 如果单个 IP 也解析失败，忽略此条目并记录警告
          logger.warn(`无效的 IP 白名单条目: "${entry}"`);
          return false;
        }
      }
    });

    if (isAllowed) {
      // IP 在白名单内，允许继续处理请求
      return next();
    }
    // IP 不在白名单内，拒绝访问
    logger.warn(`已拒绝来自 IP ${requestIpString} 的访问 (不在白名单内)。`);
    return res.status(403).json({
      success: false,
      error: '禁止访问：您的 IP 地址不在允许列表中。',
      code: 'IP_NOT_ALLOWED',
    });
  } catch (error: unknown) {
    logger.error({ err: error }, 'IP 白名单中间件执行出错');
    // 中间件出错时，为安全起见，默认拒绝访问
    return res
      .status(500)
      .json({ success: false, error: '服务器内部错误 (IP 校验失败)。', code: 'INTERNAL_ERROR' });
  }
};
