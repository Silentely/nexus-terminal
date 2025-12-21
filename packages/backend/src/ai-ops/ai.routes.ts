/**
 * AI 智能运维路由定义
 */

import { Router } from 'express';
import * as AIController from './ai.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();

// 所有路由都需要认证
router.use(isAuthenticated);

// POST /api/v1/ai/query - 处理 AI 查询
router.post('/query', AIController.processQuery);

// GET /api/v1/ai/sessions - 获取用户的会话列表
router.get('/sessions', AIController.getSessions);

// GET /api/v1/ai/sessions/:sessionId - 获取会话详情
router.get('/sessions/:sessionId', AIController.getSessionDetails);

// DELETE /api/v1/ai/sessions/:sessionId - 删除会话
router.delete('/sessions/:sessionId', AIController.deleteSession);

// GET /api/v1/ai/health - 获取系统健康摘要
router.get('/health', AIController.getHealthSummary);

// GET /api/v1/ai/patterns - 获取命令模式分析
router.get('/patterns', AIController.getCommandPatterns);

// POST /api/v1/ai/cleanup - 清理用户旧会话
router.post('/cleanup', AIController.cleanupSessions);

export default router;
