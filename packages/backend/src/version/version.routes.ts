/**
 * 版本检查代理路由
 * 代理前端对 GitHub 的版本查询请求，规避 CSP connect-src 限制
 */

import { Router, Request, Response } from 'express';
import { safeHttpGet } from '../utils/ssrf-guard';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';

const router = Router();

const GITHUB_REPO = 'Silentely/nexus-terminal';
const VERSION_FILE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/VERSION`;
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// 缓存：避免频繁请求 GitHub（TTL 10 分钟）
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000;

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * GET /api/v1/version/latest
 * 获取 GitHub 最新 release 版本号
 */
router.get(
  '/latest',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const cached = getCached('latest');
      if (cached) {
        res.json(cached);
        return;
      }

      const response = await safeHttpGet(
        GITHUB_RELEASES_URL,
        {
          timeout: 10000,
          headers: { Accept: 'application/vnd.github.v3+json' },
        },
        'Version',
      );

      if (response.status >= 400) {
        const status = response.status;
        logger.warn({ status }, '[Version] GitHub releases 请求失败');
        res.status(status === 404 ? 200 : status).json({
          tag: null,
          htmlUrl: null,
          error: status === 404 ? 'no_release' : 'fetch_failed',
        });
        return;
      }

      const result = {
        tag: response.data?.tag_name ?? null,
        htmlUrl: response.data?.html_url ?? null,
      };

      setCache('latest', result);
      res.json(result);
    } catch (error: unknown) {
      logger.error({ err: error }, '[Version] 未知错误');
      res.status(502).json({ tag: null, htmlUrl: null, error: 'fetch_failed' });
    }
  }),
);

/**
 * GET /api/v1/version/remote
 * 获取远程 VERSION 文件内容（main 分支）
 */
router.get(
  '/remote',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const cached = getCached('remote');
      if (cached) {
        res.json(cached);
        return;
      }

      const response = await safeHttpGet(
        VERSION_FILE_URL,
        {
          timeout: 10000,
        },
        'Version',
      );

      if (response.status >= 400) {
        logger.warn({ status: response.status }, '[Version] 远程 VERSION 文件请求失败');
        res.status(502).json({ version: null, error: 'fetch_failed' });
        return;
      }

      const version = typeof response.data === 'string' ? response.data.trim() : null;
      const result = { version };

      setCache('remote', result);
      res.json(result);
    } catch (error: unknown) {
      logger.warn({ err: error }, '[Version] 远程 VERSION 文件请求失败');
      res.status(502).json({ version: null, error: 'fetch_failed' });
    }
  }),
);

export default router;
