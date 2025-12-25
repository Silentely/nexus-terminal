/**
 * AI 智能运维路由定义
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as AIController from './ai.controller';
import * as NL2CMDController from './nl2cmd.controller';
import { isAuthenticated } from '../auth/auth.middleware';
import { aiLimiter } from '../config/rate-limit.config';
import * as NL2CMDService from './nl2cmd.service';

const router = Router();

// 所有路由都需要认证
router.use(isAuthenticated);

/**
 * 动态速率限制中间件
 * 根据用户配置决定是否应用速率限制
 */
const conditionalAiLimiter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await NL2CMDService.getAISettings();
    // 默认启用速率限制，除非用户明确禁用
    if (settings?.rateLimitEnabled === false) {
      return next();
    }
    return aiLimiter(req, res, next);
  } catch (error) {
    // 获取配置失败时，默认应用速率限制
    return aiLimiter(req, res, next);
  }
};

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

// AI Provider 配置相关路由
router.get('/settings', NL2CMDController.getAISettings);
router.post('/settings', NL2CMDController.saveAISettings);

// NL2CMD 相关路由（应用动态速率限制）
router.post('/test', conditionalAiLimiter, NL2CMDController.testAIConnection);
router.post('/nl2cmd', conditionalAiLimiter, NL2CMDController.generateCommand);

export default router;
