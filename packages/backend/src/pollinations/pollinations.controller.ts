/**
 * Pollinations Controller 层
 * 处理 Pollinations 相关的 HTTP 请求
 */

import { Request, Response } from 'express';
import * as PollinationsService from './pollinations.service';
import * as PollinationsRepository from './pollinations.repository';
import { logger } from '../utils/logger';
import type { AuthStartRequest, TextGenerationRequest } from '../types/pollinations.types';

type SessionWithUserId = Request['session'] & { userId?: number };

/**
 * 从 session 获取 userId
 */
const getUserId = (req: Request): number | null => {
  return (req.session as SessionWithUserId | undefined)?.userId ?? null;
};

/**
 * GET /api/v1/pollinations/settings
 * 获取用户的 Pollinations 配置（User Key 部分遮蔽）
 */
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  try {
    const settings = await PollinationsRepository.getUserSettings(userId);

    if (!settings) {
      res.json({ hasSettings: false, settings: null });
      return;
    }

    // 遮蔽敏感字段（仅显示前 8 位，避免暴露尾部字符）
    const maskedUserKey = settings.user_key ? `${settings.user_key.slice(0, 8)}...` : null;
    const maskedAppKey = settings.app_key ? `${settings.app_key.slice(0, 8)}...` : null;

    res.json({
      hasSettings: true,
      settings: {
        scope: settings.scope,
        models: settings.models,
        budget: settings.budget,
        expiry: settings.expiry,
        enabled: settings.enabled,
        hasAppKey: !!settings.app_key,
        hasUserKey: !!settings.user_key,
        appKey: maskedAppKey,
        userKey: maskedUserKey,
      },
    });
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 获取配置失败', { userId, error });
    res.status(500).json({ error: '获取配置失败' });
  }
};

/**
 * POST /api/v1/pollinations/settings
 * 保存用户的 Pollinations 配置
 */
export const saveSettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  const { app_key, scope, models, budget, expiry, enabled } = req.body;

  if (!app_key || typeof app_key !== 'string') {
    res.status(400).json({ error: 'app_key 必须是非空字符串' });
    return;
  }
  if (!app_key.startsWith('pk_')) {
    res.status(400).json({ error: 'app_key 格式无效，必须以 pk_ 开头' });
    return;
  }

  // 模型白名单校验
  const ALLOWED_MODELS = ['openai', 'claude', 'gemini', 'mistral', 'deepseek', 'qwen'];
  if (models !== undefined) {
    if (!Array.isArray(models)) {
      res.status(400).json({ error: 'models 必须是数组' });
      return;
    }
    const invalidModels = models.filter((m: string) => !ALLOWED_MODELS.includes(m));
    if (invalidModels.length > 0) {
      res.status(400).json({ error: `不支持的模型: ${invalidModels.join(', ')}` });
      return;
    }
  }

  // 数值范围校验
  if (budget !== undefined && (typeof budget !== 'number' || budget < 0 || budget > 10000)) {
    res.status(400).json({ error: 'budget 必须是 0-10000 之间的数字' });
    return;
  }
  if (expiry !== undefined && (typeof expiry !== 'number' || expiry < 3600 || expiry > 2592000)) {
    res.status(400).json({ error: 'expiry 必须是 1小时(3600)-30天(2592000) 之间的秒数' });
    return;
  }

  try {
    await PollinationsRepository.saveSettings(userId, {
      app_key,
      scope: scope || 'usage,keys',
      models: Array.isArray(models) ? models : ['openai', 'claude', 'gemini'],
      budget: typeof budget === 'number' ? budget : 5.0,
      expiry: typeof expiry === 'number' ? expiry : 604800,
      enabled: typeof enabled === 'boolean' ? enabled : false,
    });

    res.json({ success: true, message: '配置保存成功' });
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 保存配置失败', { userId, error });
    res.status(500).json({ error: '保存配置失败' });
  }
};

/**
 * POST /api/v1/pollinations/auth/start
 * 启动 Web Redirect 授权流程
 */
export const startWebAuth = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  const request: AuthStartRequest = req.body;
  if (!request.app_key) {
    res.status(400).json({ error: 'app_key 必填' });
    return;
  }

  try {
    const response = await PollinationsService.startWebAuth(userId, request);
    res.json(response);
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 启动 Web Redirect 授权失败', { userId, error });
    res.status(500).json({ error: '启动授权失败' });
  }
};

/**
 * POST /api/v1/pollinations/auth/callback
 * 处理 Web Redirect 授权回调（前端从 URL fragment 解析后通过 POST body 传入 api_key）
 * 仅接受 POST body 传参，避免 api_key 出现在 URL 中被记录
 */
export const handleCallback = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  const apiKey = req.body?.api_key;

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(400).json({ error: 'api_key 参数缺失' });
    return;
  }

  try {
    await PollinationsService.handleCallback(userId, apiKey);
    res.json({ success: true, message: '授权成功' });
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 处理授权回调失败', { userId, error });
    res.status(500).json({ error: '授权失败' });
  }
};

/**
 * POST /api/v1/pollinations/device-auth/start
 * 启动 Device Code 授权流程
 */
export const startDeviceAuth = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  const request: AuthStartRequest = req.body;
  if (!request.app_key) {
    res.status(400).json({ error: 'app_key 必填' });
    return;
  }

  try {
    const response = await PollinationsService.startDeviceAuth(userId, request);
    res.json(response);
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 启动 Device Code 授权失败', { userId, error });
    res.status(500).json({ error: '启动授权失败' });
  }
};

/**
 * POST /api/v1/pollinations/device-auth/poll
 * 轮询 Device Code 授权状态（改为 POST 避免 device_code 出现在 URL 中）
 */
export const pollDeviceAuth = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  const deviceCode = req.body?.device_code as string;
  if (!deviceCode || typeof deviceCode !== 'string') {
    res.status(400).json({ error: 'device_code 参数缺失' });
    return;
  }

  try {
    const response = await PollinationsService.pollDeviceAuth(userId, deviceCode);
    res.json(response);
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 轮询授权状态失败', { userId, error });
    res.status(500).json({ error: '轮询失败' });
  }
};

/**
 * POST /api/v1/pollinations/revoke
 * 撤销授权
 */
export const revokeAuth = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  try {
    await PollinationsService.revokeAuth(userId);
    res.json({ success: true, message: '授权已撤销' });
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 撤销授权失败', { userId, error });
    res.status(500).json({ error: '撤销授权失败' });
  }
};

/**
 * GET /api/v1/pollinations/balance
 * 查询余额
 */
export const getBalance = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: '未认证' });
    return;
  }

  try {
    const response = await PollinationsService.getBalance(userId);
    res.json(response);
  } catch (error: unknown) {
    logger.error('[Pollinations Controller] 查询余额失败', { userId, error });
    res.status(500).json({ error: '查询余额失败' });
  }
};

// 注意：generateText 端点已移除，文本生成仅通过 nl2cmd.service.ts 内部调用 PollinationsService.generateText
// 不暴露外部 API，避免绕过 NL2CMD 的安全边界（限流、命令清洗、危险检测）
