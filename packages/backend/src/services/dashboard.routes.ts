import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import {
  getStats,
  getAssetHealth,
  getTimeline,
  getStorage,
  getSystemResources,
} from './dashboard.controller';

const router = Router();

// 应用认证中间件
router.use(isAuthenticated);

// GET /api/v1/dashboard/stats - 获取仪表盘统计数据（任何登录用户可访问）
router.get('/stats', getStats);

// GET /api/v1/dashboard/timeline - 获取活动时间线（任何登录用户可访问）
router.get('/timeline', getTimeline);

// GET /api/v1/dashboard/assets - 获取资产健康状态
router.get('/assets', getAssetHealth);

// GET /api/v1/dashboard/storage - 获取存储统计
router.get('/storage', getStorage);

// GET /api/v1/dashboard/system - 获取系统资源
router.get('/system', getSystemResources);

export default router;
