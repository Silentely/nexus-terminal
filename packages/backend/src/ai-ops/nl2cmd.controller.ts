/**
 * NL2CMD Controller 层
 * 处理自然语言转命令的 HTTP 请求
 */

import { Request, Response } from 'express';
import * as NL2CMDService from './nl2cmd.service';
import { NL2CMDRequest, AIProviderConfig, AISettings } from './nl2cmd.types';

/**
 * 获取当前用户 ID
 */
function getUserId(req: Request): number | null {
  return (req.session as any)?.userId ?? null;
}

/**
 * 生成命令
 * POST /api/v1/ai/nl2cmd
 */
export const generateCommand = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const { query, osType, shellType, currentPath } = req.body;

  // 参数验证
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    res.status(400).json({ success: false, error: '查询内容不能为空' });
    return;
  }

  if (query.length > 500) {
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

    const response = await NL2CMDService.generateCommand(request);
    res.status(200).json(response);
  } catch (error: any) {
    console.error('[NL2CMD Controller] 生成命令失败:', error);
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
    res.status(401).json({ success: false, message: '未授权' });
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
          model: 'gpt-4o-mini',
          openaiEndpoint: 'chat/completions',
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
  } catch (error: any) {
    console.error('[NL2CMD Controller] 获取 AI 配置失败:', error);
    res.status(500).json({ success: false, message: '获取 AI 配置失败' });
  }
};

/**
 * 保存 AI 配置
 * POST /api/v1/ai/settings
 */
export const saveAISettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const { enabled, provider, baseUrl, apiKey, model, openaiEndpoint, rateLimitEnabled } = req.body;

  // 参数验证
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ success: false, message: 'enabled 必须是布尔值' });
    return;
  }

  if (!['openai', 'gemini', 'claude'].includes(provider)) {
    res.status(400).json({ success: false, message: 'provider 必须是 openai, gemini 或 claude' });
    return;
  }

  if (!baseUrl || typeof baseUrl !== 'string') {
    res.status(400).json({ success: false, message: 'baseUrl 不能为空' });
    return;
  }

  if (!model || typeof model !== 'string') {
    res.status(400).json({ success: false, message: 'model 不能为空' });
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
      enabled,
      provider,
      baseUrl,
      apiKey: finalApiKey || '',
      model,
      openaiEndpoint: provider === 'openai' ? openaiEndpoint || 'chat/completions' : undefined,
      rateLimitEnabled: rateLimitEnabled !== false, // 默认启用
    };

    await NL2CMDService.saveAISettings(settings);
    res.status(200).json({ success: true, message: 'AI 配置已保存' });
  } catch (error: any) {
    console.error('[NL2CMD Controller] 保存 AI 配置失败:', error);
    res.status(500).json({ success: false, message: '保存 AI 配置失败' });
  }
};

/**
 * 测试 AI 连接
 * POST /api/v1/ai/test
 */
export const testAIConnection = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const { provider, baseUrl, apiKey, model, openaiEndpoint } = req.body;

  // 参数验证
  if (!['openai', 'gemini', 'claude'].includes(provider)) {
    res.status(400).json({ success: false, message: 'provider 必须是 openai, gemini 或 claude' });
    return;
  }

  if (!baseUrl || typeof baseUrl !== 'string') {
    res.status(400).json({ success: false, message: 'baseUrl 不能为空' });
    return;
  }

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(400).json({ success: false, message: 'apiKey 不能为空' });
    return;
  }

  if (!model || typeof model !== 'string') {
    res.status(400).json({ success: false, message: 'model 不能为空' });
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
      openaiEndpoint: provider === 'openai' ? openaiEndpoint || 'chat/completions' : undefined,
    };

    const success = await NL2CMDService.testAIConnection(config);

    if (success) {
      res.status(200).json({ success: true, message: '连接测试成功' });
    } else {
      res.status(400).json({ success: false, message: '连接测试失败' });
    }
  } catch (error: any) {
    console.error('[NL2CMD Controller] 测试连接失败:', error);
    res.status(500).json({ success: false, message: '连接测试失败' });
  }
};
