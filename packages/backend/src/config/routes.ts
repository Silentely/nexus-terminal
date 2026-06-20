/**
 * 路由注册模块
 * 从 index.ts 提取，集中管理所有 API 路由的注册
 */

import express, { Request, Response } from 'express';
import { getDbInstance } from '../database/connection';
import authRouter from '../auth/auth.routes';
import connectionsRouter from '../connections/connections.routes';
import sftpRouter from '../sftp/sftp.routes';
import proxyRoutes from '../proxies/proxies.routes';
import tagsRouter from '../tags/tags.routes';
import settingsRoutes from '../settings/settings.routes';
import notificationRoutes from '../notifications/notification.routes';
import auditRoutes from '../audit/audit.routes';
import commandHistoryRoutes from '../command-history/command-history.routes';
import quickCommandsRoutes from '../quick-commands/quick-commands.routes';
import terminalThemeRoutes from '../terminal-themes/terminal-theme.routes';
import appearanceRoutes from '../appearance/appearance.routes';
import sshKeysRouter from '../ssh-keys/ssh-keys.routes';
import quickCommandTagRoutes from '../quick-command-tags/quick-command-tag.routes';
import sshSuspendRouter from '../ssh-suspend/ssh-suspend.routes';
import { transfersRoutes } from '../transfers/transfers.routes';
import pathHistoryRoutes from '../path-history/path-history.routes';
import favoritePathsRouter from '../favorite-paths/favorite-paths.routes';
import batchRoutes from '../batch/batch.routes';
import * as BatchService from '../batch/batch.service';
import { logger } from '../utils/logger';
import aiRoutes from '../ai-ops/ai.routes';
import passkeyRoutes from '../passkey/passkey.routes';
import dashboardRoutes from '../services/dashboard.routes';
import metricsRoutes from '../metrics/metrics.routes';
import backupRoutes from '../backup/backup.routes';
import { aiAuditRoutes } from '../ai-audit/ai-audit.routes';
import versionRoutes from '../version/version.routes';
import { errorHandler, notFoundHandler } from '../middleware/error.middleware';
import { requestLogger } from '../middleware/request-logger.middleware';

type RateLimiter = ReturnType<typeof import('express-rate-limit').default>;

/**
 * 注册所有 API 路由
 * @param app Express 应用实例
 * @param apiLimiter 通用 API 限流中间件
 * @param settingsLimiter Settings 专用限流中间件
 */
export const registerRoutes = (
  app: express.Application,
  apiLimiter: RateLimiter,
  settingsLimiter: RateLimiter,
) => {
  // 请求级日志（为每个请求生成 requestId）
  app.use(requestLogger);

  // 认证路由（限流策略已在 auth.routes.ts 中精细化配置）
  app.use('/api/v1/auth', authRouter);

  // 一般 API 路由（宽松限流）
  app.use('/api/v1/connections', apiLimiter, connectionsRouter);
  app.use('/api/v1/sftp', apiLimiter, sftpRouter);
  app.use('/api/v1/proxies', apiLimiter, proxyRoutes);
  app.use('/api/v1/tags', apiLimiter, tagsRouter);
  app.use('/api/v1/settings', settingsLimiter, settingsRoutes);
  app.use('/api/v1/notifications', apiLimiter, notificationRoutes);
  app.use('/api/v1/audit-logs', apiLimiter, auditRoutes);
  app.use('/api/v1/command-history', apiLimiter, commandHistoryRoutes);
  app.use('/api/v1/quick-commands', apiLimiter, quickCommandsRoutes);
  app.use('/api/v1/terminal-themes', apiLimiter, terminalThemeRoutes);
  app.use('/api/v1/appearance', apiLimiter, appearanceRoutes);
  app.use('/api/v1/ssh-keys', apiLimiter, sshKeysRouter);
  app.use('/api/v1/quick-command-tags', apiLimiter, quickCommandTagRoutes);
  app.use('/api/v1/ssh-suspend', apiLimiter, sshSuspendRouter);
  app.use('/api/v1/transfers', apiLimiter, transfersRoutes());
  app.use('/api/v1/path-history', apiLimiter, pathHistoryRoutes);
  app.use('/api/v1/favorite-paths', apiLimiter, favoritePathsRouter);
  app.use('/api/v1/passkey', apiLimiter, passkeyRoutes);
  app.use('/api/v1/batch', apiLimiter, batchRoutes);
  app.use('/api/v1/ai', apiLimiter, aiRoutes);
  app.use('/api/v1/ai-audit', apiLimiter, aiAuditRoutes);
  app.use('/api/v1/dashboard', apiLimiter, dashboardRoutes);
  app.use('/api/v1/backup', apiLimiter, backupRoutes);
  app.use('/api/v1/version', apiLimiter, versionRoutes);

  // Prometheus 指标端点（受 ENABLE_METRICS 环境变量控制）
  if (process.env.ENABLE_METRICS === 'true') {
    app.use('/api/v1/metrics', metricsRoutes);
  }

  // 健康检查接口
  app.get('/api/v1/health', async (_req: Request, res: Response) => {
    const startTime = Date.now();
    const checks: {
      database: 'ok' | 'fail';
      uptime: number;
      memory: { used: number; total: number };
    } = {
      database: 'fail',
      uptime: process.uptime(),
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
      },
    };

    try {
      const db = await getDbInstance();
      await new Promise<void>((resolve, reject) => {
        db.get('SELECT 1', (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
      checks.database = 'ok';
    } catch (err: unknown) {
      logger.debug({ err }, '操作失败，已忽略');
      checks.database = 'fail';
    }

    const isHealthy = checks.database === 'ok';
    const status = isHealthy ? 'healthy' : 'unhealthy';

    res.status(isHealthy ? 200 : 503).json({
      status,
      checks,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
    });
  });

  // 全局错误处理中间件（必须在所有路由之后）
  app.use(notFoundHandler);
  app.use(errorHandler);

  // 初始化批量模块（孤儿任务恢复 + 定时清理）
  BatchService.initialize().catch((err: unknown) => {
    logger.error({ err }, '[Routes] 批量模块初始化失败');
  });
};
