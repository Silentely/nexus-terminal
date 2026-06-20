/**
 * SSH 输出微批处理器
 * 将 16ms 窗口内的多个 SSH 输出块合并为单个 WebSocket 帧
 *
 * 设计思路：
 * - 每个 sessionId 维护独立的批处理器
 * - 数据到达时写入 buffer：
 *   1. 小数据（< SMALL_PAYLOAD_THRESHOLD）且当前空闲 → 立即发送（击键回显零延迟）
 *   2. 大数据洪流 → 启动 16ms 定时器，合并多个块为一帧（带宽优化）
 *   3. 缓冲区超过 MAX_BATCH_SIZE → 立即发送（防止单帧过大）
 * - 16ms < 16.67ms（60fps 帧预算），洪流场景下延迟不可感知
 * - 小数据零延迟路径解决了"按键输入命令需要等待"的输入回显延迟问题
 */

import WebSocket from 'ws';
import { logger } from '../utils/logger';

/** 批处理器配置 */
const BATCH_WINDOW_MS = 16; // 16ms 批处理窗口（洪流合并窗口）
const MAX_BATCH_SIZE = 64 * 1024; // 最大 64KB 批次大小
/**
 * 小数据载荷阈值（字节）：低于此阈值的单次写入视为击键回显，
 * 在缓冲区空闲（无 pending timer）时立即发送，避免引入 16ms 延迟。
 * 256B 足以容纳常见 ANSI 转义序列 + 单字符回显 + 光标移动等组合，
 * 但小于一行命令的典型输出（80 列 + 颜色控制约 256~512B）。
 */
const SMALL_PAYLOAD_THRESHOLD = 256;

/** 批处理器状态 */
interface BatcherState {
  buffer: string[];
  bufferLength: number;
  timer: ReturnType<typeof setTimeout> | null;
  isActive: boolean;
}

/**
 * 创建 SSH 输出批处理器
 * @param ws WebSocket 连接
 * @param sessionId 会话 ID
 * @param onSend 发送回调（用于注入 sid 等额外字段）
 * @returns 批处理器控制接口
 */
export function createOutputBatcher(
  ws: WebSocket,
  sessionId: string,
  onSend?: (data: string) => void,
) {
  const state: BatcherState = {
    buffer: [],
    bufferLength: 0,
    timer: null,
    isActive: true,
  };

  /** 合并并发送缓冲区数据 */
  const flush = (): void => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.buffer.length === 0 || !state.isActive) {
      return;
    }

    const merged = state.buffer.join('');
    state.buffer = [];
    state.bufferLength = 0;

    if (ws.readyState === WebSocket.OPEN) {
      const encoded = Buffer.from(merged, 'utf8').toString('base64');
      if (onSend) {
        onSend(encoded);
      } else {
        ws.send(
          JSON.stringify({
            type: 'ssh:output',
            payload: encoded,
            encoding: 'base64',
          }),
        );
      }
    }
  };

  /** 写入数据到批处理器 */
  const write = (data: string): void => {
    if (!state.isActive) {
      return;
    }

    state.buffer.push(data);
    state.bufferLength += data.length;

    // 如果缓冲区超过最大大小，立即发送
    if (state.bufferLength >= MAX_BATCH_SIZE) {
      flush();
      return;
    }

    // 零延迟回显路径：
    // 当缓冲区无 pending timer（即此次写入是当前批次的首个数据块），
    // 且总长度低于 SMALL_PAYLOAD_THRESHOLD 时，立即 flush。
    // 这样可消除击键回显的 16ms 批处理延迟，使命令输入感受流畅。
    //
    // 冷却机制：flush 后立即启动 16ms 定时器，防止小数据洪流场景下
    // （如终端快速输出多行短文本）连续立即 flush 破坏合并窗口。
    // 冷却期内后续小数据走批处理路径正常合并，冷却结束后恢复零延迟。
    if (!state.timer && state.bufferLength < SMALL_PAYLOAD_THRESHOLD) {
      flush();
      state.timer = setTimeout(() => {
        state.timer = null;
        flush();
      }, BATCH_WINDOW_MS);
      return;
    }

    // 如果没有定时器，启动新的批处理窗口
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        flush();
      }, BATCH_WINDOW_MS);
    }
  };

  /** 销毁批处理器（先刷新再标记非活跃） */
  const destroy = (): void => {
    // 先清除定时器，阻止新的 flush 调度
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    // 先刷新剩余数据（此时 isActive 仍为 true，flush 不会跳过）
    if (state.buffer.length > 0) {
      const merged = state.buffer.join('');
      state.buffer = [];
      state.bufferLength = 0;
      if (ws.readyState === WebSocket.OPEN) {
        const encoded = Buffer.from(merged, 'utf8').toString('base64');
        if (onSend) {
          onSend(encoded);
        } else {
          ws.send(
            JSON.stringify({
              type: 'ssh:output',
              payload: encoded,
              encoding: 'base64',
              sid: sessionId,
            }),
          );
        }
      }
    }
    // 最后标记为非活跃
    state.isActive = false;
  };

  /** 获取当前缓冲区大小 */
  const getBufferLength = (): number => state.bufferLength;

  return {
    write,
    flush,
    destroy,
    getBufferLength,
  };
}

/** 批处理器实例管理 */
const batchers = new Map<string, ReturnType<typeof createOutputBatcher>>();

/**
 * 获取或创建指定会话的批处理器
 */
export function getOrCreateBatcher(
  ws: WebSocket,
  sessionId: string,
  onSend?: (data: string) => void,
): ReturnType<typeof createOutputBatcher> {
  const existing = batchers.get(sessionId);
  if (existing) {
    return existing;
  }

  const batcher = createOutputBatcher(ws, sessionId, onSend);
  batchers.set(sessionId, batcher);
  logger.debug(`[OutputBatcher] 创建批处理器: ${sessionId}`);
  return batcher;
}

/**
 * 销毁指定会话的批处理器
 */
export function destroyBatcher(sessionId: string): void {
  const batcher = batchers.get(sessionId);
  if (batcher) {
    batcher.destroy();
    batchers.delete(sessionId);
    logger.debug(`[OutputBatcher] 销毁批处理器: ${sessionId}`);
  }
}

/**
 * 刷新指定会话的批处理器
 */
export function flushBatcher(sessionId: string): void {
  const batcher = batchers.get(sessionId);
  if (batcher) {
    batcher.flush();
  }
}

/**
 * 清理所有批处理器
 */
export function cleanupAllBatchers(): void {
  batchers.forEach((batcher, sessionId) => {
    batcher.destroy();
    logger.debug(`[OutputBatcher] 清理批处理器: ${sessionId}`);
  });
  batchers.clear();
  logger.info('[OutputBatcher] 已清理所有批处理器');
}
