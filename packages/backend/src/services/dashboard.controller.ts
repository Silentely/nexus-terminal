import { Request, Response, NextFunction } from 'express';
import * as Service from './dashboard.service';
import { ErrorFactory } from '../utils/AppError';

const parseTimestampSeconds = (raw: unknown): number | null => {
  if (raw === undefined || raw === null) return null;
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  // 兼容毫秒时间戳（>= 10^12 基本可以认为是 ms）
  if (parsed >= 1_000_000_000_000) return Math.floor(parsed / 1000);
  return Math.floor(parsed);
};

/**
 * 获取仪表盘统计数据
 */
export const getStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { start, end } = req.query;

    let timeRange: { start: number; end: number } | undefined;
    if (start && end) {
      const startSeconds = parseTimestampSeconds(start);
      const endSeconds = parseTimestampSeconds(end);
      if (startSeconds && endSeconds) {
        timeRange = { start: startSeconds, end: endSeconds };
      }
    }

    const stats = await Service.getDashboardStats(timeRange);
    res.status(200).json(stats);
  } catch (error) {
    console.error('Controller: 获取仪表盘统计失败:', error);
    next(error);
  }
};

/**
 * 获取资产健康状态
 */
export const getAssetHealth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const health = await Service.getAssetHealth();
    res.status(200).json(health);
  } catch (error) {
    console.error('Controller: 获取资产健康状态失败:', error);
    next(error);
  }
};

/**
 * 获取活动时间线
 */
export const getTimeline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const { start, end } = req.query;

    let timeRange: { start: number; end: number } | undefined;
    if (start && end) {
      const startSeconds = parseTimestampSeconds(start);
      const endSeconds = parseTimestampSeconds(end);
      if (startSeconds && endSeconds) {
        timeRange = { start: startSeconds, end: endSeconds };
      }
    }

    const timeline = await Service.getActivityTimeline(limit, timeRange);
    res.status(200).json({ events: timeline });
  } catch (error) {
    console.error('Controller: 获取活动时间线失败:', error);
    next(error);
  }
};

/**
 * 获取存储统计
 */
export const getStorage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await Service.getStorageStats();
    res.status(200).json({
      ...stats,
      formatted: {
        recordings: Service.formatBytes(stats.recordingsSize),
        database: Service.formatBytes(stats.databaseSize),
        uploads: Service.formatBytes(stats.uploadsSize),
        total: Service.formatBytes(stats.totalSize),
      },
    });
  } catch (error) {
    console.error('Controller: 获取存储统计失败:', error);
    next(error);
  }
};

/**
 * 获取系统资源使用情况
 */
export const getSystemResources = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const resources = await Service.getSystemResources();
    res.status(200).json({
      ...resources,
      formatted: {
        memUsed: Service.formatBytes(resources.memUsed),
        memTotal: Service.formatBytes(resources.memTotal),
        diskUsed: Service.formatBytes(resources.diskUsed),
        diskTotal: Service.formatBytes(resources.diskTotal),
      },
    });
  } catch (error) {
    console.error('Controller: 获取系统资源失败:', error);
    next(error);
  }
};
