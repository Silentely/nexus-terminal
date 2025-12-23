import { Request, Response, NextFunction } from 'express';
import { ipBlacklistService } from './ip-blacklist.service';
import { settingsService } from '../settings/settings.service';

/**
 * IP 黑名单检查中间件
 * 在处理登录相关请求前，检查来源 IP 是否在黑名单中且处于封禁期。
 */
export const ipBlacklistCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // 获取客户端 IP (与 auth.controller 一致)
  const clientIp = req.ip || req.socket?.remoteAddress;

  if (!clientIp) {
    // 如果无法获取 IP，为安全起见，阻止请求
    console.warn('[IP Blacklist Check] 无法获取请求 IP 地址，已拒绝访问。');
    res.status(403).json({ message: '禁止访问：无法识别来源 IP。' });
    return; // 显式返回 void
  }

  try {
    // 首先检查 IP 黑名单功能是否启用
    const isEnabled = await settingsService.isIpBlacklistEnabled();
    if (!isEnabled) {
      // console.log('[IP Blacklist Check] 功能已禁用，跳过检查。');
      return next(); // 功能禁用，直接放行
    }

    const isBlocked = await ipBlacklistService.isBlocked(clientIp);
    if (isBlocked) {
      console.warn(`[IP Blacklist Check] 已阻止来自被封禁 IP ${clientIp} 的访问。`);
      // 可以返回更通用的错误信息，避免泄露封禁状态
      res.status(403).json({ message: '访问被拒绝。' });
      // 或者返回更具体的错误
      return; // 显式返回 void
    }
    // IP 未被封禁，继续处理请求
    next();
  } catch (error) {
    console.error(`[IP Blacklist Check] 检查 IP ${clientIp} 时发生错误:`, error);
    // 中间件执行出错，为安全起见，阻止请求
    res.status(500).json({ message: '服务器内部错误 (IP 黑名单检查失败)。' });
    // 显式返回 void
  }
};
