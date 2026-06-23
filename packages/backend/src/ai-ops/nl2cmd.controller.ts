/**
 * NL2CMD Controller 层
 * 处理自然语言转命令的 HTTP 请求
 */

import { Request, Response } from 'express';
import {
  createTraceId,
  shouldLogTiming,
  safeBaseUrlForLog,
  NL2CMD_CONFIG,
} from './nl2cmd.constants';
import * as NL2CMDService from './nl2cmd.service';
import { NL2CMDRequest, AIProviderConfig, AISettings } from './nl2cmd.types';
import { logger } from '../utils/logger';

type SessionWithUserId = Request['session'] & { userId?: number };

/**
 * 获取当前用户 ID
 */
function getUserId(req: Request): number | null {
  return (req.session as SessionWithUserId | undefined)?.userId ?? null;
}

/**
 * 生成命令
 * POST /api/v1/ai/nl2cmd
 */
export const generateCommand = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: '未授权', code: 'UNAUTHORIZED' });
    return;
  }

  const { query, osType, shellType, currentPath } = req.body;
  const traceId = createTraceId();
  const start = Date.now();
  res.setHeader('x-request-id', traceId);

  // 参数验证
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    res.status(400).json({ success: false, error: '查询内容不能为空' });
    return;
  }

  if (query.length > NL2CMD_CONFIG.MAX_QUERY_LENGTH) {
    res.status(400).json({ success: false, error: '查询内容不能超过 500 字符' });
    return;
  }

  try {
    const request: NL2CMDRequest = {
      query: query.trim(),
      osType,
      shellType,
      currentPath,
    };

    const response = await NL2CMDService.generateCommand(request, traceId);
    res.status(200).json(response);

    const durationMs = Date.now() - start;
    if (shouldLogTiming(durationMs)) {
      logger.info('[NL2CMD HTTP] /nl2cmd', {
        traceId,
        ok: response.success,
        durationMs,
        queryLen: request.query.length,
        osType: request.osType,
        shellType: request.shellType,
      });
    }
  } catch (error: unknown) {
    logger.error('[NL2CMD Controller] 生成命令失败:', error);
    const durationMs = Date.now() - start;
    if (shouldLogTiming(durationMs)) {
      logger.warn('[NL2CMD HTTP] /nl2cmd failed', { traceId, durationMs });
    }
    res.status(500).json({ success: false, error: '生成命令失败' });
  }
};

/**
 * 获取 AI 配置
 * GET /api/v1/ai/settings
 */
export const getAISettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: '未授权', code: 'UNAUTHORIZED' });
    return;
  }

  try {
    const settings = await NL2CMDService.getAISettings();
    if (!settings) {
      res.status(200).json({
        success: true,
        settings: {
          enabled: false,
          provider: 'openai',
          baseUrl: 'https://api.openai.com',
          apiKey: '',
          model: 'gpt-5-nano',
          openaiEndpoint: '/chat/completions',
          rateLimitEnabled: true,
        },
      });
      return;
    }

    // 隐藏 API Key（只返回前几位）
    const maskedSettings = {
      ...settings,
      apiKey: settings.apiKey ? `${settings.apiKey.substring(0, 8)}...` : '',
    };

    res.status(200).json({ success: true, settings: maskedSettings });
  } catch (error: unknown) {
    logger.error('[NL2CMD Controller] 获取 AI 配置失败:', error);
    res.status(500).json({ success: false, error: '获取 AI 配置失败', code: 'INTERNAL_ERROR' });
  }
};

/**
 * 保存 AI 配置
 * POST /api/v1/ai/settings
 */
export const saveAISettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: '未授权', code: 'UNAUTHORIZED' });
    return;
  }

  const { enabled, provider, baseUrl, apiKey, model, openaiEndpoint, rateLimitEnabled } = req.body;

  // 参数验证
  if (typeof enabled !== 'boolean') {
    res
      .status(400)
      .json({ success: false, error: 'enabled 必须是布尔值', code: 'VALIDATION_ERROR' });
    return;
  }

  if (!['openai', 'claude'].includes(provider)) {
    res.status(400).json({
      success: false,
      error: 'provider 必须是 openai 或 claude',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  if (!baseUrl || typeof baseUrl !== 'string') {
    res.status(400).json({ success: false, error: 'baseUrl 不能为空', code: 'VALIDATION_ERROR' });
    return;
  }

  // URL 格式校验：必须是合法的 http/https URL
  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      res.status(400).json({
        success: false,
        error: 'baseUrl 必须使用 http 或 https 协议',
        code: 'VALIDATION_ERROR',
      });
      return;
    }
  } catch {
    res.status(400).json({ success: false, error: 'baseUrl 格式无效', code: 'VALIDATION_ERROR' });
    return;
  }

  // openaiEndpoint 路径安全校验：禁止协议注入和路径遍历
  if (openaiEndpoint && typeof openaiEndpoint === 'string') {
    if (openaiEndpoint.includes('://') || openaiEndpoint.includes('..')) {
      res.status(400).json({
        success: false,
        error: 'openaiEndpoint 包含非法字符',
        code: 'VALIDATION_ERROR',
      });
      return;
    }
  }

  if (!model || typeof model !== 'string') {
    res.status(400).json({ success: false, error: 'model 不能为空', code: 'VALIDATION_ERROR' });
    return;
  }

  try {
    // 如果 apiKey 是 masked 的（包含...），则不更新
    let finalApiKey = apiKey;
    if (apiKey && apiKey.includes('...')) {
      const existingSettings = await NL2CMDService.getAISettings();
      if (existingSettings) {
        finalApiKey = existingSettings.apiKey;
      }
    }

    const settings: AISettings = {
      enabled: !!enabled,
      provider,
      baseUrl,
      apiKey: finalApiKey || '',
      model,
      openaiEndpoint: provider === 'openai' ? openaiEndpoint || '/chat/completions' : undefined,
      rateLimitEnabled: rateLimitEnabled !== false,
    };

    await NL2CMDService.saveAISettings(settings);

    // 清除旧的 Axios 客户端缓存（如果有配置变更）
    NL2CMDService.clearAxiosClientCache();

    // 返回更新后的配置（mask apiKey）
    const savedSettings = await NL2CMDService.getAISettings();
    const masked = savedSettings
      ? {
          ...savedSettings,
          apiKey: savedSettings.apiKey ? `${savedSettings.apiKey.substring(0, 8)}...` : '',
        }
      : settings;

    res.status(200).json({ success: true, settings: masked, message: 'AI 配置已保存' });
  } catch (error: unknown) {
    logger.error('[NL2CMD Controller] 保存 AI 配置失败:', error);
    res.status(500).json({ success: false, error: '保存 AI 配置失败', code: 'INTERNAL_ERROR' });
  }
};

/**
 * 生成命令（流式 SSE）
 * POST /api/v1/ai/nl2cmd/stream
 */
export const generateCommandStream = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: '未授权', code: 'UNAUTHORIZED' });
    return;
  }

  const { query, osType, shellType, currentPath } = req.body;
  const traceId = createTraceId();
  res.setHeader('x-request-id', traceId);

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    res.status(400).json({ success: false, error: '查询内容不能为空' });
    return;
  }

  if (query.length > NL2CMD_CONFIG.MAX_QUERY_LENGTH) {
    res.status(400).json({ success: false, error: '查询内容不能超过 500 字符' });
    return;
  }

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const request: NL2CMDRequest = { query: query.trim(), osType, shellType, currentPath };
  let clientDisconnected = false;

  // 客户端断开时中止上游请求
  const abortController = new AbortController();
  req.on('close', () => {
    clientDisconnected = true;
    abortController.abort();
    logger.debug('[NL2CMD] SSE 客户端断开，中止上游请求', { traceId });
  });

  const start = Date.now();
  try {
    const response = await NL2CMDService.generateCommandStream(
      request,
      (chunk) => {
        if (!clientDisconnected && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        }
      },
      traceId,
      abortController.signal,
    );

    if (!clientDisconnected && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'done', ...response })}\n\n`);
      res.end();
    }

    const durationMs = Date.now() - start;
    if (shouldLogTiming(durationMs)) {
      logger.info('[NL2CMD HTTP] /nl2cmd/stream', {
        traceId,
        ok: response.success,
        durationMs,
        queryLen: request.query.length,
      });
    }
  } catch (error: unknown) {
    logger.error('[NL2CMD Controller] 流式生成命令失败:', error);
    if (!clientDisconnected && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: '生成命令失败' })}\n\n`);
      res.end();
    }
  }
};

/**
 * 测试 AI 连接
 * POST /api/v1/ai/test
 */
export const testAIConnection = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: '未授权', code: 'UNAUTHORIZED' });
    return;
  }

  const { provider, baseUrl, apiKey, model, openaiEndpoint } = req.body;
  const traceId = createTraceId();
  const start = Date.now();
  res.setHeader('x-request-id', traceId);

  // 参数验证
  if (!['openai', 'claude'].includes(provider)) {
    res.status(400).json({
      success: false,
      error: 'provider 必须是 openai 或 claude',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  if (!baseUrl || typeof baseUrl !== 'string') {
    res.status(400).json({ success: false, error: 'baseUrl 不能为空', code: 'VALIDATION_ERROR' });
    return;
  }

  // URL 格式校验：必须是合法的 http/https URL
  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      res.status(400).json({
        success: false,
        error: 'baseUrl 必须使用 http 或 https 协议',
        code: 'VALIDATION_ERROR',
      });
      return;
    }
  } catch {
    res.status(400).json({ success: false, error: 'baseUrl 格式无效', code: 'VALIDATION_ERROR' });
    return;
  }

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(400).json({ success: false, error: 'apiKey 不能为空', code: 'VALIDATION_ERROR' });
    return;
  }

  if (!model || typeof model !== 'string') {
    res.status(400).json({ success: false, error: 'model 不能为空', code: 'VALIDATION_ERROR' });
    return;
  }

  try {
    // 如果 apiKey 是 masked 的（包含...），则使用已保存的 key
    let finalApiKey = apiKey;
    if (apiKey && apiKey.includes('...')) {
      const existingSettings = await NL2CMDService.getAISettings();
      if (existingSettings && existingSettings.apiKey) {
        finalApiKey = existingSettings.apiKey;
      }
    }

    const config: AIProviderConfig = {
      provider,
      baseUrl,
      apiKey: finalApiKey,
      model,
      openaiEndpoint: provider === 'openai' ? openaiEndpoint || '/chat/completions' : undefined,
    };

    const success = await NL2CMDService.testAIConnection(config, traceId);

    if (success) {
      res.status(200).json({ success: true, message: '连接测试成功' });
    } else {
      res.status(400).json({ success: false, error: '连接测试失败', code: 'CONNECTION_FAILED' });
    }

    const durationMs = Date.now() - start;
    if (shouldLogTiming(durationMs)) {
      logger.info('[NL2CMD HTTP] /test', {
        traceId,
        ok: success,
        durationMs,
        provider,
        model,
        baseUrl: safeBaseUrlForLog(baseUrl),
      });
    }
  } catch (error: unknown) {
    logger.error('[NL2CMD Controller] 测试连接失败:', error);
    const durationMs = Date.now() - start;
    if (shouldLogTiming(durationMs)) {
      logger.warn('[NL2CMD HTTP] /test failed', { traceId, durationMs });
    }
    res.status(500).json({ success: false, message: '连接测试失败' });
  }
};
