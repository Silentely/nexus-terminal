/**
 * 请求级日志中间件
 * 为每个请求生成 requestId 并注入 req，所有后续日志自动携带
 * 通过 ENABLE_REQUEST_LOG 环境变量控制是否输出请求访问日志
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { withLogContext } from './log-context.middleware';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// 是否启用请求访问日志，默认启用
const ENABLE_REQUEST_LOG = process.env.ENABLE_REQUEST_LOG !== 'false';

// 跳过日志的高频低价值端点前缀
const SKIP_PATH_PREFIXES = ['/api/v1/health', '/api/v1/metrics'];

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  req.requestId = requestId;

  // 将 requestId 写入响应头，帮助区分 503 来自源站还是代理层
  // 如果浏览器收到 503 但响应中没有此头，说明 503 由 Cloudflare/反向代理生成
  res.setHeader('X-Request-Id', requestId);

  // 将 requestId 注入 AsyncLocalStorage，后续所有日志自动携带
  withLogContext({ requestId, protocol: 'http' }, () => {
    // 未启用请求日志时仅注入 requestId，不输出日志
    if (!ENABLE_REQUEST_LOG) {
      next();
      return;
    }

    const startTime = Date.now();

    // 跳过健康检查等高频低价值端点（前缀匹配）
    const skip = SKIP_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix));

    if (!skip) {
      logger.info({ method: req.method, path: req.path }, '请求开始');
    }

    // 防止 finish + close 双触发导致重复日志
    let isLogged = false;
    const logCompletion = () => {
      if (skip || isLogged) return;
      isLogged = true;
      const duration = Date.now() - startTime;
      let level: 'error' | 'warn' | 'info' = 'info';
      if (res.statusCode >= 500) {
        level = 'error';
      } else if (res.statusCode >= 400) {
        level = 'warn';
      }
      logger[level](
        {
          requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
        },
        '请求完成',
      );
    };

    // 监听 finish（正常完成）和 close（客户端中断）
    res.on('finish', logCompletion);
    res.on('close', logCompletion);

    next();
  });
};
