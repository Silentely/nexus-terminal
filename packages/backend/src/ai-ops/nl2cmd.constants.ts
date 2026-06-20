/**
 * NL2CMD Shared Constants & Utilities
 * 提取自 nl2cmd.service.ts 和 nl2cmd.controller.ts 的共享代码
 */

import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * 创建 Trace ID
 */
export function createTraceId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * 安全解析整数
 */
export function parseIntOr(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 环境配置
 */
export const NL2CMD_CONFIG = {
  TIMING_LOG_ENABLED: process.env.NL2CMD_TIMING_LOG === '1',
  SLOW_THRESHOLD_MS: parseIntOr(process.env.NL2CMD_SLOW_THRESHOLD_MS, 3000),
  REQUEST_TIMEOUT_MS: parseIntOr(process.env.NL2CMD_REQUEST_TIMEOUT_MS, 30000),
  MAX_QUERY_LENGTH: 500,
  MAX_OUTPUT_TOKENS: 500,
  TEMPERATURE: 0.3,
};

/**
 * 判断是否需要记录耗时日志
 */
export function shouldLogTiming(totalMs: number): boolean {
  return NL2CMD_CONFIG.TIMING_LOG_ENABLED || totalMs >= NL2CMD_CONFIG.SLOW_THRESHOLD_MS;
}

/**
 * 安全提取 URL 主机（用于日志脱敏）
 */
export function safeBaseUrlForLog(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    return baseUrl;
  }
}
