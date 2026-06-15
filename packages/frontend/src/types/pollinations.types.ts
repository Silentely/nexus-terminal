// packages/frontend/src/types/pollinations.types.ts

/**
 * Pollinations 配置数据（前端使用）
 */
export interface PollinationsSettings {
  app_key: string;
  user_key: string | null;
  scope: string;
  models: string[];
  budget: number;
  expiry: number;
  enabled: boolean;
}

/**
 * 授权流程类型
 */
export type AuthFlowType = 'web_redirect' | 'device_code';

/**
 * 授权状态
 */
export interface AuthStatus {
  hasUserKey: boolean;
  balance: number | null;
  expiry: number | null;
  enabled: boolean;
  userKey: string | null; // 部分遮蔽后的 User Key
}

/**
 * 启动授权请求参数
 */
export interface AuthStartRequest {
  app_key: string;
  redirect_uri?: string; // Web Redirect 专用
  scope?: string;
  models?: string[];
  budget?: number;
  expiry?: number;
}

/**
 * Web Redirect 授权响应
 */
export interface WebAuthResponse {
  authorization_url: string;
}

/**
 * Device Code 授权响应
 */
export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Device Code 轮询响应
 */
export interface DeviceAuthPollResponse {
  status: 'pending' | 'authorized' | 'expired' | 'denied';
}

/**
 * 余额查询响应
 */
export interface BalanceResponse {
  balance: number;
  currency: string;
}

/**
 * 文本生成请求参数
 */
export interface TextGenerationRequest {
  prompt: string;
  model?: 'openai' | 'claude' | 'gemini';
  max_tokens?: number;
  temperature?: number;
}

/**
 * 文本生成响应
 */
export interface TextGenerationResponse {
  text: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
