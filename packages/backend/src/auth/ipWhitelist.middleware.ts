import { Request, Response, NextFunction } from 'express';
import ipaddr from 'ipaddr.js';
import { settingsService } from '../settings/settings.service';

const IP_WHITELIST_SETTING_KEY = 'ipWhitelist';

// 本地开发环境的 IP 地址列表
const LOCAL_IPS = [
  '127.0.0.1', // IPv4 本地回环
  '::1', // IPv6 本地回环
  'localhost', // 本地主机名
];

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
      console.warn('无法获取请求 IP 地址，已拒绝访问。');
      return res.status(403).json({ message: '禁止访问：无法识别来源 IP。' });
    }

    // 检查是否是本地开发环境的 IP
    if (LOCAL_IPS.includes(requestIpString)) {
      console.log(`允许来自本地开发环境 (${requestIpString}) 的访问。`);
      return next();
    }

    const whitelistString = await settingsService.getSetting(IP_WHITELIST_SETTING_KEY);

    // 如果白名单未设置或为空字符串，则允许所有请求
    if (!whitelistString || whitelistString.trim() === '') {
      return next();
    }

    // 解析白名单字符串 (假设以换行符或逗号分隔)
    const whitelistEntries = whitelistString
      .split(/[\n,]+/) // 按换行符或逗号分割
      .map((entry) => entry.trim()) // 去除首尾空格
      .filter((entry) => entry.length > 0); // 过滤空条目

    // 如果解析后白名单为空，也允许所有请求 (避免配置错误导致完全锁死)
    if (whitelistEntries.length === 0) {
      console.warn('IP 白名单设置非空但解析后为空，暂时允许所有 IP。请检查设置。');
      return next();
    }

    let requestIp: ipaddr.IPv4 | ipaddr.IPv6 | null = null;
    try {
      requestIp = ipaddr.parse(requestIpString);
    } catch (e) {
      console.warn(`无法解析请求 IP 地址 "${requestIpString}"，已拒绝访问。`);
      return res.status(403).json({ message: '禁止访问：无效的来源 IP 格式。' });
    }

    // 检查 IP 是否匹配白名单中的任何条目
    const isAllowed = whitelistEntries.some((entry) => {
      try {
        // 尝试解析为 CIDR 范围
        const range = ipaddr.parseCIDR(entry);
        // 使用 match 方法检查 IP 是否在范围内
        // 需要根据 IP 类型调用正确的 match 签名
        if (requestIp!.kind() === 'ipv4' && range[0].kind() === 'ipv4') {
          return (requestIp! as ipaddr.IPv4).match(range as [ipaddr.IPv4, number]);
        }
        if (requestIp!.kind() === 'ipv6' && range[0].kind() === 'ipv6') {
          // 注意：IPv6 的 match 可能需要特殊处理，取决于 ipaddr.js 的具体实现和类型定义
          // 这里假设 IPv6 的 match 签名与 IPv4 类似，但可能需要调整
          return (requestIp! as ipaddr.IPv6).match(range as [ipaddr.IPv6, number]);
        }
        // 如果 IP 类型和范围类型不匹配，则认为不匹配
        return false;
      } catch (e1) {
        // 如果解析 CIDR 失败，尝试解析为单个 IP 地址
        try {
          const allowedIp = ipaddr.parse(entry);
          // 比较地址是否相同
          return (
            requestIp!.kind() === allowedIp.kind() && requestIp!.toString() === allowedIp.toString()
          );
        } catch (e2) {
          // 如果单个 IP 也解析失败，忽略此条目并记录警告
          console.warn(`无效的 IP 白名单条目: "${entry}"`);
          return false;
        }
      }
    });

    if (isAllowed) {
      // IP 在白名单内，允许继续处理请求
      return next();
    }
    // IP 不在白名单内，拒绝访问
    console.warn(`已拒绝来自 IP ${requestIpString} 的访问 (不在白名单内)。`);
    return res.status(403).json({ message: '禁止访问：您的 IP 地址不在允许列表中。' });
  } catch (error: any) {
    console.error('IP 白名单中间件执行出错:', error);
    // 中间件出错时，为安全起见，默认拒绝访问
    return res.status(500).json({ message: '服务器内部错误 (IP 校验失败)。' });
  }
};
