/**
 * Pollinations Service 层
 * 负责与 Pollinations API 交互、授权流程管理和文本生成
 */

import { logger } from '../utils/logger';
import * as PollinationsRepository from './pollinations.repository';
import type {
  AuthStartRequest,
  WebAuthResponse,
  DeviceAuthResponse,
  DeviceAuthPollResponse,
  BalanceResponse,
  TextGenerationRequest,
  TextGenerationResponse,
} from '../types/pollinations.types';

/**
 * Pollinations API 基础 URL
 * 授权相关：enter.pollinations.ai
 * 生成相关：gen.pollinations.ai
 */
const POLLINATIONS_AUTH_BASE = 'https://enter.pollinations.ai';
const POLLINATIONS_GEN_BASE = 'https://gen.pollinations.ai';

/**
 * 请求超时时间（10 秒）
 */
const REQUEST_TIMEOUT_MS = 10000;

const DEFAULT_SCOPE = 'usage,keys';
const DEFAULT_MODELS = ['openai', 'claude', 'gemini'];
const DEFAULT_BUDGET = 5.0;
const DEFAULT_EXPIRY = 604800; // 7 天（秒）

/**
 * 启动 Web Redirect 授权流程
 * 保存 App Key 并生成授权 URL（用户跳转后回调返回 User Key）
 */
export const startWebAuth = async (
  userId: number,
  request: AuthStartRequest
): Promise<WebAuthResponse> => {
  const { app_key, redirect_uri, scope, models, budget, expiry } = request;

  // 保存 App Key 配置（授权成功后再启用）
  await PollinationsRepository.saveSettings(userId, {
    app_key,
    scope: scope || DEFAULT_SCOPE,
    models: models || DEFAULT_MODELS,
    budget: budget ?? DEFAULT_BUDGET,
    expiry: expiry ?? DEFAULT_EXPIRY,
    enabled: false,
    user_key: null,
  });

  // 构造授权 URL（expiry 转换为天数，Pollinations 文档以天为单位）
  const expiryDays = Math.ceil((expiry ?? DEFAULT_EXPIRY) / 86400);
  const params = new URLSearchParams({
    client_id: app_key,
    redirect_uri: redirect_uri || '',
    scope: scope || DEFAULT_SCOPE,
    models: (models || DEFAULT_MODELS).join(','),
    budget: String(budget ?? DEFAULT_BUDGET),
    expiry: String(expiryDays),
  });

  const authorizationUrl = `${POLLINATIONS_AUTH_BASE}/authorize?${params.toString()}`;

  logger.info('[Pollinations Service] Web Redirect 授权 URL 已生成', { userId });

  return { authorization_url: authorizationUrl };
};

/**
 * 处理 Web Redirect 授权回调
 * 回调 URL fragment 中携带的 api_key（sk_...）即为 User Key
 */
export const handleCallback = async (userId: number, apiKey: string): Promise<void> => {
  // 保存 User Key 并启用
  await PollinationsRepository.updateUserKey(userId, apiKey);
  await PollinationsRepository.saveSettings(userId, { enabled: true });

  logger.info('[Pollinations Service] Web Redirect 授权成功', { userId });
};

/**
 * 启动 Device Code 授权流程
 * 调用 Pollinations Device Flow API 获取设备码
 */
export const startDeviceAuth = async (
  userId: number,
  request: AuthStartRequest
): Promise<DeviceAuthResponse> => {
  const { app_key, scope } = request;

  // 保存 App Key 配置
  await PollinationsRepository.saveSettings(userId, {
    app_key,
    scope: scope || DEFAULT_SCOPE,
    models: request.models || DEFAULT_MODELS,
    budget: request.budget ?? DEFAULT_BUDGET,
    expiry: request.expiry ?? DEFAULT_EXPIRY,
    enabled: false,
    user_key: null,
  });

  // 调用 Device Code API
  const response = await fetch(`${POLLINATIONS_AUTH_BASE}/api/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: app_key,
      scope: scope || 'generate',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('[Pollinations Service] Device Code 请求失败', {
      userId,
      status: response.status,
      error: errorText,
    });
    throw new Error('Device Code 请求失败');
  }

  const data = await response.json();

  // 标准化响应字段
  const result: DeviceAuthResponse = {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri?.startsWith('http')
      ? data.verification_uri
      : `${POLLINATIONS_AUTH_BASE}${data.verification_uri || '/device'}`,
    expires_in: data.expires_in || 900,
    interval: data.interval || 5,
  };

  logger.info('[Pollinations Service] Device Code 已生成', {
    userId,
    userCode: result.user_code,
  });

  return result;
};

/**
 * 轮询 Device Code 授权状态
 * 授权成功后保存 User Key（access_token）
 */
export const pollDeviceAuth = async (
  userId: number,
  deviceCode: string
): Promise<DeviceAuthPollResponse> => {
  const response = await fetch(`${POLLINATIONS_AUTH_BASE}/api/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // OAuth Device Code 端点用 HTTP 400 + error 字段表示业务状态，需先解析 body
  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (parseError) {
    logger.error('[Pollinations Service] Device Token 响应解析失败', {
      userId,
      status: response.status,
      parseError: parseError instanceof Error ? parseError.message : String(parseError),
    });
    throw new Error('Device Token 响应格式无效');
  }

  // 处理已知的 OAuth Device Code 状态（可能是 HTTP 400）
  const errorMsg = typeof data.error === 'string' ? data.error : undefined;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : undefined;

  if (errorMsg === 'authorization_pending') {
    return { status: 'pending' };
  }
  if (errorMsg === 'access_denied') {
    return { status: 'denied' };
  }
  if (errorMsg === 'expired_token') {
    return { status: 'expired' };
  }

  // 未知错误或非 2xx 且无已知 error 字段
  if (!response.ok) {
    logger.error('[Pollinations Service] Device Token 轮询未知错误', {
      userId,
      status: response.status,
      error: errorMsg || JSON.stringify(data),
    });
    throw new Error(errorMsg || 'Device Token 轮询请求失败');
  }

  // 授权成功，保存 User Key
  if (accessToken) {
    await PollinationsRepository.updateUserKey(userId, accessToken);
    await PollinationsRepository.saveSettings(userId, { enabled: true });
    logger.info('[Pollinations Service] Device Code 授权成功', { userId });
    return { status: 'authorized', user_key: accessToken };
  }

  // 其他错误
  logger.error('[Pollinations Service] Device Token 轮询异常', { userId, data });
  throw new Error(errorMsg || 'Device Token 轮询失败');
};

/**
 * 撤销授权
 */
export const revokeAuth = async (userId: number): Promise<void> => {
  await PollinationsRepository.clearUserKey(userId);
  logger.info('[Pollinations Service] 授权已撤销', { userId });
};

/**
 * 查询余额
 */
export const getBalance = async (userId: number): Promise<BalanceResponse> => {
  const settings = await PollinationsRepository.getUserSettings(userId);

  if (!settings || !settings.user_key) {
    throw new Error('未授权：缺少 User Key');
  }

  const response = await fetch(`${POLLINATIONS_GEN_BASE}/account/balance`, {
    headers: { Authorization: `Bearer ${settings.user_key}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('[Pollinations Service] 余额查询失败', {
      userId,
      status: response.status,
      error: errorText,
    });
    throw new Error('余额查询失败');
  }

  const data = await response.json();

  const result: BalanceResponse = {
    balance: typeof data.balance === 'number' ? data.balance : (data.budget ?? 0),
    currency: 'pollen',
  };

  logger.info('[Pollinations Service] 余额查询成功', { userId, balance: result.balance });

  return result;
};

/**
 * 文本生成（AI 助手调用）
 * 使用 OpenAI 兼容的 Chat Completions 接口
 */
export const generateText = async (
  userId: number,
  request: TextGenerationRequest,
  traceId?: string
): Promise<TextGenerationResponse> => {
  const settings = await PollinationsRepository.getUserSettings(userId);

  if (!settings || !settings.user_key) {
    throw new Error('未授权：缺少 User Key');
  }

  if (!settings.enabled) {
    throw new Error('Pollinations 未启用');
  }

  const requestBody = {
    model: request.model || 'openai',
    messages: [{ role: 'user', content: request.prompt }],
    max_tokens: request.max_tokens ?? 2000,
    temperature: request.temperature ?? 0.7,
    stream: false,
  };

  const response = await fetch(`${POLLINATIONS_GEN_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.user_key}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('[Pollinations Service] 文本生成失败', {
      userId,
      status: response.status,
      error: errorText,
      traceId,
    });
    throw new Error('文本生成失败');
  }

  const data = await response.json();

  const result: TextGenerationResponse = {
    text: data.choices?.[0]?.message?.content ?? '',
    model: data.model || requestBody.model,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
    },
  };

  logger.info('[Pollinations Service] 文本生成成功', {
    userId,
    model: result.model,
    tokens: result.usage.total_tokens,
    traceId,
  });

  return result;
};
