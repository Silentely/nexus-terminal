/**
 * AI 智能运维 Controller 层
 * 处理 HTTP 请求和响应
 */

import { Request, Response } from 'express';
import * as AIService from './ai.service';
import { AIQueryRequest } from './ai.types';

/**
 * 获取当前用户 ID
 */
function getUserId(req: Request): number | null {
    return (req.session as any)?.userId ?? null;
}

/**
 * 处理 AI 查询
 * POST /api/v1/ai/query
 */
export const processQuery = async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
        res.status(401).json({ success: false, message: '未授权' });
        return;
    }

    const { query, sessionId, context } = req.body;

    // 参数验证
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        res.status(400).json({ success: false, message: '查询内容不能为空' });
        return;
    }

    if (query.length > 2000) {
        res.status(400).json({ success: false, message: '查询内容不能超过 2000 字符' });
        return;
    }

    if (sessionId !== undefined && typeof sessionId !== 'string') {
        res.status(400).json({ success: false, message: 'sessionId 必须是字符串' });
        return;
    }

    if (context !== undefined) {
        if (typeof context !== 'object' || context === null || Array.isArray(context)) {
            res.status(400).json({ success: false, message: 'context 必须是对象' });
            return;
        }

        if (context.connectionIds !== undefined) {
            if (!Array.isArray(context.connectionIds)) {
                res.status(400).json({ success: false, message: 'context.connectionIds 必须是数组' });
                return;
            }
        }
    }

    try {
        const request: AIQueryRequest = {
            query: query.trim(),
            sessionId,
            context,
        };

        const response = await AIService.processQuery(userId, request);

        res.status(200).json(response);
    } catch (error: any) {
        console.error('[AIController] 处理查询失败:', error);
        res.status(500).json({ success: false, message: '处理查询失败' });
    }
};

/**
 * 获取用户的会话列表
 * GET /api/v1/ai/sessions
 */
export const getSessions = async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
        res.status(401).json({ success: false, message: '未授权' });
        return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    // 限制范围
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    try {
        const sessions = await AIService.getUserSessions(userId, safeLimit, safeOffset);
        res.status(200).json({
            success: true,
            sessions,
            limit: safeLimit,
            offset: safeOffset,
        });
    } catch (error: any) {
        console.error('[AIController] 获取会话列表失败:', error);
        res.status(500).json({ success: false, message: '获取会话列表失败' });
    }
};

/**
 * 获取会话详情（含消息）
 * GET /api/v1/ai/sessions/:sessionId
 */
export const getSessionDetails = async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
        res.status(401).json({ success: false, message: '未授权' });
        return;
    }

    const { sessionId } = req.params;

    if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({ success: false, message: '无效的会话 ID' });
        return;
    }

    try {
        const session = await AIService.getSessionDetails(sessionId, userId);

        if (!session) {
            res.status(404).json({ success: false, message: '会话不存在或无权访问' });
            return;
        }

        res.status(200).json({ success: true, session });
    } catch (error: any) {
        console.error('[AIController] 获取会话详情失败:', error);
        res.status(500).json({ success: false, message: '获取会话详情失败' });
    }
};

/**
 * 删除会话
 * DELETE /api/v1/ai/sessions/:sessionId
 */
export const deleteSession = async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
        res.status(401).json({ success: false, message: '未授权' });
        return;
    }

    const { sessionId } = req.params;

    if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({ success: false, message: '无效的会话 ID' });
        return;
    }

    try {
        const success = await AIService.deleteSession(sessionId, userId);

        if (success) {
            res.status(200).json({ success: true, message: '会话已删除' });
        } else {
            res.status(404).json({ success: false, message: '会话不存在或无权删除' });
        }
    } catch (error: any) {
        console.error('[AIController] 删除会话失败:', error);
        res.status(500).json({ success: false, message: '删除会话失败' });
    }
};

/**
 * 获取系统健康摘要
 * GET /api/v1/ai/health
 */
export const getHealthSummary = async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
        res.status(401).json({ success: false, message: '未授权' });
        return;
    }

    try {
        // 传入 userId 以过滤用户相关数据
        const summary = await AIService.getSystemHealthSummary(userId);
        res.status(200).json({ success: true, summary });
    } catch (error: any) {
        console.error('[AIController] 获取系统健康摘要失败:', error);
        res.status(500).json({ success: false, message: '获取系统健康摘要失败' });
    }
};

/**
 * 获取命令模式分析
 * GET /api/v1/ai/patterns
 */
export const getCommandPatterns = async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
        res.status(401).json({ success: false, message: '未授权' });
        return;
    }

    try {
        // 传入 userId 以过滤用户相关数据
        const analysis = await AIService.analyzeCommandPatterns(userId);
        res.status(200).json({ success: true, analysis });
    } catch (error: any) {
        console.error('[AIController] 获取命令模式分析失败:', error);
        res.status(500).json({ success: false, message: '获取命令模式分析失败' });
    }
};

/**
 * 清理用户旧会话
 * POST /api/v1/ai/cleanup
 */
export const cleanupSessions = async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) {
        res.status(401).json({ success: false, message: '未授权' });
        return;
    }

    const keepCount = parseInt(req.body.keepCount as string, 10) || 50;
    const safeKeepCount = Math.min(Math.max(10, keepCount), 200);

    try {
        const deletedCount = await AIService.cleanupUserSessions(userId, safeKeepCount);
        res.status(200).json({
            success: true,
            message: `已清理 ${deletedCount} 个旧会话`,
            deletedCount,
            keepCount: safeKeepCount,
        });
    } catch (error: any) {
        console.error('[AIController] 清理会话失败:', error);
        res.status(500).json({ success: false, message: '清理会话失败' });
    }
};
