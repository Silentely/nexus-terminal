/**
 * WebSocket 消息速率限制器
 * 使用固定窗口计数算法（Fixed Window Counter）防止恶意客户端高频消息导致 DoS
 *
 * 注意：固定窗口在窗口边界可能允许瞬时双倍流量（窗口末尾 + 新窗口开始各 maxMessages 条），
 * 对于 WebSocket 消息限流场景该精度足够。若未来需要更严格的边界控制，可升级为滑动窗口。
 */

import { logger } from '../utils/logger';

/**
 * 上传分块是数据流量，不适合用普通 WebSocket 消息频率限流。
 * 真正的上传压力由 SftpUploadManager 的每上传滑动窗口、chunk 大小校验、
 * pending buffer 与全局内存预算控制；这里豁免可避免目录/多文件上传被误伤。
 */
const PROTOCOL_MANAGED_MESSAGE_TYPES = new Set(['sftp:upload:chunk']);

/** 速率限制配置 */
interface RateLimitConfig {
  /** 窗口内最大消息数 */
  maxMessages: number;
  /** 窗口大小（毫秒） */
  windowMs: number;
}

/** 每会话速率限制状态 */
interface SessionRateState {
  /** 当前窗口内的消息计数 */
  count: number;
  /** 当前窗口起始时间戳 */
  windowStart: number;
  /** 当前窗口是否已记录过超限日志（用于日志采样，避免攻击流量刷屏） */
  limitLogged: boolean;
}

/** 默认速率限制配置（每种消息类型的限制） */
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // SSH 输入：高频但需要流畅，100 条/秒
  'ssh:input': { maxMessages: 100, windowMs: 1000 },
  'ssh:resize': { maxMessages: 10, windowMs: 1000 },
  'ssh:exec_silent': { maxMessages: 20, windowMs: 1000 },

  // SFTP 操作：涉及文件系统 I/O，限制更严格
  'sftp:readdir': { maxMessages: 20, windowMs: 1000 },
  'sftp:stat': { maxMessages: 30, windowMs: 1000 },
  'sftp:readfile': { maxMessages: 10, windowMs: 1000 },
  'sftp:writefile': { maxMessages: 10, windowMs: 1000 },
  'sftp:mkdir': { maxMessages: 10, windowMs: 1000 },
  'sftp:rmdir': { maxMessages: 10, windowMs: 1000 },
  'sftp:unlink': { maxMessages: 10, windowMs: 1000 },
  'sftp:rename': { maxMessages: 10, windowMs: 1000 },
  // 多文件/目录上传会瞬间启动多个文件任务，需避免误伤正常批量上传。
  // 真正的分块吞吐压力由 SftpUploadManager 的 per-upload sliding window 和全局缓冲上限控制。
  'sftp:upload:start': { maxMessages: 100, windowMs: 1000 },
  'sftp:upload:cancel': { maxMessages: 10, windowMs: 1000 },

  // Docker 操作：轮询 Docker API，限制严格
  'docker:get_status': { maxMessages: 5, windowMs: 1000 },
  'docker:command': { maxMessages: 10, windowMs: 1000 },

  // 批量操作：管理类操作，最严格
  'batch:create': { maxMessages: 5, windowMs: 1000 },
  'batch:cancel': { maxMessages: 5, windowMs: 1000 },

  // 默认限制：未明确分类的消息
  _default: { maxMessages: 50, windowMs: 1000 },
};

/** 每会话的速率状态 Map */
const sessionStates = new Map<string, Map<string, SessionRateState>>();

/** 会话自动过期时间（10 分钟无活动则清理） */
const SESSION_EXPIRY_MS = 10 * 60 * 1000;

/** 清理间隔（每 5 分钟执行一次） */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** 记录每个会话的最后活动时间 */
const sessionLastActivity = new Map<string, number>();

/**
 * 定期清理过期会话的速率限制状态
 * 防止长时间运行后内存泄漏
 */
const cleanupExpiredSessions = (): void => {
  const now = Date.now();
  let cleaned = 0;
  for (const [sessionId, lastActivity] of sessionLastActivity) {
    if (now - lastActivity > SESSION_EXPIRY_MS) {
      sessionStates.delete(sessionId);
      sessionLastActivity.delete(sessionId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`[RateLimiter] 已清理 ${cleaned} 个过期会话的速率限制状态`);
  }
};

// 启动定期清理定时器
const cleanupTimer = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);
// 防止定时器阻止进程退出
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * 检查消息是否超过速率限制
 * @param sessionId 会话 ID
 * @param messageType 消息类型
 * @returns true = 允许，false = 超过限制
 */
export function checkRateLimit(sessionId: string, messageType: string): boolean {
  if (PROTOCOL_MANAGED_MESSAGE_TYPES.has(messageType)) {
    sessionLastActivity.set(sessionId, Date.now());
    return true;
  }

  const config = RATE_LIMITS[messageType] || RATE_LIMITS._default;
  const now = Date.now();

  // 记录会话最后活动时间
  sessionLastActivity.set(sessionId, now);

  // 获取或创建会话状态
  let typeStates = sessionStates.get(sessionId);
  if (!typeStates) {
    typeStates = new Map();
    sessionStates.set(sessionId, typeStates);
  }

  // 获取或创建该消息类型的状态
  let state = typeStates.get(messageType);
  if (!state) {
    state = { count: 0, windowStart: now, limitLogged: false };
    typeStates.set(messageType, state);
  }

  // 固定窗口：如果当前窗口已过期，重置计数
  if (now - state.windowStart >= config.windowMs) {
    state.count = 0;
    state.windowStart = now;
    state.limitLogged = false; // 新窗口重置日志采样标志
  }

  // 检查是否超过限制
  if (state.count >= config.maxMessages) {
    // 日志采样：每个窗口只记录一次超限，避免攻击流量刷屏
    if (!state.limitLogged) {
      logger.warn(
        `[RateLimiter] 会话 ${sessionId} 消息类型 ${messageType} 超过速率限制: ${state.count}/${config.maxMessages} per ${config.windowMs}ms`,
      );
      state.limitLogged = true;
    }
    return false;
  }

  state.count++;
  return true;
}

/**
 * 清理会话的速率限制状态（在连接断开时调用）
 * @param sessionId 会话 ID
 */
export function cleanupRateLimit(sessionId: string): void {
  sessionStates.delete(sessionId);
  sessionLastActivity.delete(sessionId);
}

/**
 * 获取当前速率限制状态（用于监控和调试）
 * @param sessionId 会话 ID
 * @returns 各消息类型的当前计数
 */
export function getRateLimitStatus(
  sessionId: string,
): Record<string, { count: number; limit: number }> {
  const typeStates = sessionStates.get(sessionId);
  if (!typeStates) return {};

  const result: Record<string, { count: number; limit: number }> = {};
  for (const [type, state] of typeStates) {
    const config = RATE_LIMITS[type] || RATE_LIMITS._default;
    result[type] = { count: state.count, limit: config.maxMessages };
  }
  return result;
}
