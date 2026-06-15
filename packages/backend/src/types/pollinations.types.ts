// packages/backend/src/types/pollinations.types.ts

/**
 * Pollinations 配置表数据结构（数据库存储）
 */
export interface PollinationsSettings {
  user_id: number;
  encrypted_app_key: string;
  encrypted_user_key: string | null;
  scope: string;
  models: string;
  budget: number;
  expiry: number;
  enabled: number; // SQLite boolean: 1=启用, 0=禁用
  created_at: number;
  updated_at: number;
}

/**
 * 解密后的配置数据（业务逻辑使用）
 */
export interface DecryptedSettings {
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
  user_key?: string;
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
  stream?: boolean;
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

/**
 * Pollinations API 错误响应
 */
export interface PollinationsErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}
