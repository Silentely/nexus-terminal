/**
 * 版本检查代理路由
 * 代理前端对 GitHub 的版本查询请求，规避 CSP connect-src 限制与客户端直连限流
 *
 * 策略：
 * 1. 优先读取 main 分支 VERSION（raw.githubusercontent.com，无 API 限流）
 * 2. 可选补充 GitHub Releases 的 htmlUrl（有缓存，失败不阻塞版本号返回）
 * 3. 内存缓存 10 分钟，避免频繁外发
 */

import { Router, Request, Response } from 'express';
import { safeHttpGet } from '../utils/ssrf-guard';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';

const router = Router();

const GITHUB_REPO = 'Silentely/nexus-terminal';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
const VERSION_FILE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/VERSION`;
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export interface VersionCheckResult {
  /** 规范化后的远程版本号（无 v 前缀，失败时为 null） */
  version: string | null;
  /** 原始远程版本字符串 */
  rawVersion: string | null;
  /** 发布页 URL（优先 Releases，否则按 tag 拼装） */
  htmlUrl: string | null;
  /** 数据来源：version_file | release | null */
  source: 'version_file' | 'release' | null;
  error?: string;
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/** 去掉空白与可选 v 前缀 */
function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function isComparableVersion(version: string): boolean {
  const normalized = normalizeVersion(version);
  return /^\d+(?:\.\d+)*(?:-[\w.]+)?$/i.test(normalized);
}

function buildReleaseTagUrl(version: string): string {
  const normalized = normalizeVersion(version);
  const tag = `v${normalized}`;
  return `${GITHUB_REPO_URL}/releases/tag/${tag}`;
}

async function fetchRemoteVersionFile(): Promise<string | null> {
  const cached = getCached<string>('remote_version_text');
  if (cached !== null) return cached;

  const response = await safeHttpGet(
    VERSION_FILE_URL,
    {
      timeout: 10000,
    },
    'Version',
  );

  if (response.status >= 400) {
    logger.warn({ status: response.status }, '[Version] 远程 VERSION 文件请求失败');
    return null;
  }

  let text = '';
  if (typeof response.data === 'string') {
    text = response.data.trim();
  } else if (response.data != null) {
    text = String(response.data).trim();
  }

  if (!text) return null;
  setCache('remote_version_text', text);
  return text;
}

async function fetchLatestRelease(): Promise<{ tag: string | null; htmlUrl: string | null }> {
  const cached = getCached<{ tag: string | null; htmlUrl: string | null }>('latest_release');
  if (cached) return cached;

  const response = await safeHttpGet(
    GITHUB_RELEASES_URL,
    {
      timeout: 10000,
      headers: { Accept: 'application/vnd.github.v3+json' },
    },
    'Version',
  );

  if (response.status >= 400) {
    logger.warn({ status: response.status }, '[Version] GitHub releases 请求失败');
    // 404 缓存空结果，避免反复打 API；403 不缓存以便稍后重试
    if (response.status === 404) {
      const empty = { tag: null, htmlUrl: null };
      setCache('latest_release', empty);
      return empty;
    }
    return { tag: null, htmlUrl: null };
  }

  const result = {
    tag: (response.data?.tag_name as string | undefined) ?? null,
    htmlUrl: (response.data?.html_url as string | undefined) ?? null,
  };
  setCache('latest_release', result);
  return result;
}

/**
 * 综合获取最新版本：VERSION 文件优先，Releases 补充链接
 */
async function resolveLatestVersion(): Promise<VersionCheckResult> {
  let versionText: string | null = null;
  let release: { tag: string | null; htmlUrl: string | null } = { tag: null, htmlUrl: null };

  // 并行拉取，缩短延迟；VERSION 失败时再用 release.tag 兜底
  const [versionResult, releaseResult] = await Promise.allSettled([
    fetchRemoteVersionFile(),
    fetchLatestRelease(),
  ]);

  if (versionResult.status === 'fulfilled') {
    versionText = versionResult.value;
  } else {
    logger.warn({ err: versionResult.reason }, '[Version] VERSION 文件获取异常');
  }

  if (releaseResult.status === 'fulfilled') {
    release = releaseResult.value;
  } else {
    logger.warn({ err: releaseResult.reason }, '[Version] Releases 获取异常');
  }

  // 1) VERSION 文件（主源，无 API 限流）
  if (versionText && isComparableVersion(versionText)) {
    const version = normalizeVersion(versionText);
    return {
      version,
      rawVersion: versionText,
      htmlUrl: release.htmlUrl ?? buildReleaseTagUrl(version),
      source: 'version_file',
    };
  }

  // 2) Releases tag 兜底
  if (release.tag && isComparableVersion(release.tag)) {
    const version = normalizeVersion(release.tag);
    return {
      version,
      rawVersion: release.tag,
      htmlUrl: release.htmlUrl ?? buildReleaseTagUrl(version),
      source: 'release',
    };
  }

  // 3) VERSION 存在但非标准版本（如 dev）——原样返回，前端自行判断不可比较
  if (versionText) {
    return {
      version: normalizeVersion(versionText) || null,
      rawVersion: versionText,
      htmlUrl: release.htmlUrl,
      source: 'version_file',
    };
  }

  return {
    version: null,
    rawVersion: null,
    htmlUrl: null,
    source: null,
    error: 'fetch_failed',
  };
}

/**
 * GET /api/v1/version/check
 * 统一版本检查入口（推荐前端使用）
 */
router.get(
  '/check',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const cached = getCached<VersionCheckResult>('version_check');
      if (cached) {
        res.json(cached);
        return;
      }

      const result = await resolveLatestVersion();
      if (result.version || result.rawVersion) {
        setCache('version_check', result);
        res.json(result);
        return;
      }

      res.status(502).json(result);
    } catch (error: unknown) {
      logger.error({ err: error }, '[Version] check 未知错误');
      res.status(502).json({
        version: null,
        rawVersion: null,
        htmlUrl: null,
        source: null,
        error: 'fetch_failed',
      } satisfies VersionCheckResult);
    }
  }),
);

/**
 * GET /api/v1/version/latest
 * 获取 GitHub 最新 release（兼容旧调用）
 */
router.get(
  '/latest',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const release = await fetchLatestRelease();
      if (!release.tag) {
        res.status(200).json({
          tag: null,
          htmlUrl: null,
          error: 'no_release',
        });
        return;
      }
      res.json({ tag: release.tag, htmlUrl: release.htmlUrl });
    } catch (error: unknown) {
      logger.error({ err: error }, '[Version] latest 未知错误');
      res.status(502).json({ tag: null, htmlUrl: null, error: 'fetch_failed' });
    }
  }),
);

/**
 * GET /api/v1/version/remote
 * 获取远程 VERSION 文件内容（兼容旧调用）
 */
router.get(
  '/remote',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const versionText = await fetchRemoteVersionFile();
      if (!versionText) {
        res.status(502).json({ version: null, error: 'fetch_failed' });
        return;
      }
      res.json({
        version: versionText,
        normalized: isComparableVersion(versionText) ? normalizeVersion(versionText) : null,
      });
    } catch (error: unknown) {
      logger.warn({ err: error }, '[Version] 远程 VERSION 文件请求失败');
      res.status(502).json({ version: null, error: 'fetch_failed' });
    }
  }),
);

export default router;
