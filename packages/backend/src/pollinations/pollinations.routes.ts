/**
 * Pollinations BYOP 路由定义
 */

import { Router } from 'express';
import * as PollinationsController from './pollinations.controller';
import { isAuthenticated } from '../auth/auth.middleware';
import { aiLimiter } from '../config/rate-limit.config';

const router = Router();

// 所有路由都需要认证
router.use(isAuthenticated);

// 配置管理（使用普通限流）
router.get('/settings', PollinationsController.getSettings);
router.post('/settings', PollinationsController.saveSettings);

// Web Redirect 授权（使用 AI 限流）
router.post('/auth/start', aiLimiter, PollinationsController.startWebAuth);
router.post('/auth/callback', aiLimiter, PollinationsController.handleCallback);

// Device Code 授权（使用 AI 限流，poll 从 GET 改为 POST 避免 device_code 出现在 URL 中）
router.post('/device-auth/start', aiLimiter, PollinationsController.startDeviceAuth);
router.post('/device-auth/poll', aiLimiter, PollinationsController.pollDeviceAuth);

// 授权管理（使用 AI 限流）
router.post('/revoke', PollinationsController.revokeAuth);
router.get('/balance', aiLimiter, PollinationsController.getBalance);

// 注意：/generate 端点已移除，文本生成仅通过 nl2cmd.service.ts 内部调用 PollinationsService.generateText
// 不暴露外部 API，避免绕过 NL2CMD 的安全边界（限流、命令清洗、危险检测）

export default router;
