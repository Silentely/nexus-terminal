/**
 * 内置事件中间件
 * 提供日志记录和事件持久化功能
 *
 * 性能优化：采用批量缓冲写入，将多个事件合并为单次事务 INSERT，
 * 减少 SQLite 写入锁竞争和 fsync 次数。
 */
import { logger } from '../utils/logger';
import { getDbInstance, runDb } from '../database/connection';
import {
  type AppEventPayload,
  type AppEventType,
  type EventMiddleware,
  PERSISTENT_EVENTS,
} from '../types/event.types';

// event_logs 清理配置
const CLEANUP_THRESHOLD = 200; // 每 200 次写入触发清理
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟间隔触发清理
const RETENTION_DAYS = 30; // 保留 30 天日志

// 批量写入配置
const BATCH_SIZE = 10; // 缓冲区满 10 条触发批量写入
const BATCH_FLUSH_INTERVAL_MS = 1000; // 最多缓冲 1 秒
const MAX_BUFFER_SIZE = 5000; // 缓冲区上限，超出丢弃最旧条目防止内存无限增长

let writeCount = 0;
let lastCleanupTime = Date.now();
let cleanupInProgress = false; // 防止并发清理

/** 待写入事件缓冲条目 */
interface PendingEvent {
  eventType: AppEventType;
  userId: number | null;
  payloadJson: string;
}

/** 批量写入缓冲区 */
const eventBuffer: PendingEvent[] = [];
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;
let batchFlushInProgress = false;

/**
 * 清理过期的 event_logs 记录
 * 保留最近 RETENTION_DAYS 天的日志
 */
async function cleanupOldEventLogs(): Promise<void> {
  try {
    const db = await getDbInstance();
    const cutoffTime = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 24 * 60 * 60;
    await runDb(db, 'DELETE FROM event_logs WHERE created_at < ?', [cutoffTime]);
    logger.debug('[EventPersistence] event_logs 清理完成');
  } catch (error) {
    logger.error('[EventPersistence] event_logs 清理失败:', error);
  }
}

/**
 * 日志中间件
 * 以 debug 级别记录事件触发信息，替代 emitEvent 中原有的 info 级别日志
 * 降低日志噪音，同时保留调试能力
 */
export const loggingMiddleware: EventMiddleware = (
  eventType: AppEventType,
  _payload: AppEventPayload,
  next: () => void,
): void => {
  logger.debug(`[Event] ${eventType}`);
  next();
};

/**
 * 持久化中间件
 * 对 PERSISTENT_EVENTS 中的事件缓冲批量写入 event_logs 表
 * 采用 fire-and-forget 模式，不阻塞事件发送
 */
export const persistenceMiddleware: EventMiddleware = (
  eventType: AppEventType,
  payload: AppEventPayload,
  next: () => void,
): void => {
  // 仅持久化关键事件
  if (!PERSISTENT_EVENTS.has(eventType)) {
    next();
    return;
  }

  // 先调用 next()，确保事件先发送给监听器
  next();

  // 加入批量缓冲区（内部会自动触发批量写入）
  bufferEvent(eventType, payload);
};

/**
 * 序列化事件 payload（排除 timestamp，已在数据库列中存储）
 */
function serializePayload(eventType: AppEventType, payload: AppEventPayload): string {
  try {
    const { timestamp: _timestamp, ...rest } = payload;
    return JSON.stringify(rest);
  } catch (error) {
    logger.error('[EventPersistence] 事件 payload 序列化失败', {
      eventType,
      error: (error as Error)?.message,
    });
    return JSON.stringify({
      serializationError: (error as Error)?.message ?? 'UNKNOWN_ERROR',
      fallbackPayload: {
        userId: payload.userId ?? null,
        details: payload.details,
      },
    });
  }
}

/**
 * 将事件加入缓冲区，达到阈值或定时触发批量写入
 */
function bufferEvent(eventType: AppEventType, payload: AppEventPayload): void {
  const userId = payload.userId ?? null;
  const payloadJson = serializePayload(eventType, payload);

  // 缓冲区溢出保护：超限时丢弃最旧条目防止内存无限增长
  if (eventBuffer.length >= MAX_BUFFER_SIZE) {
    const dropped = eventBuffer.shift();
    logger.warn(`[EventPersistence] 缓冲区已满，丢弃最旧事件: ${dropped?.eventType}`);
  }

  eventBuffer.push({ eventType, userId, payloadJson });

  // 缓冲区满，立即触发批量写入
  if (eventBuffer.length >= BATCH_SIZE) {
    void flushEventBatch();
    return;
  }

  // 首条事件入队时启动定时刷新
  if (!batchFlushTimer) {
    batchFlushTimer = setTimeout(() => {
      batchFlushTimer = null;
      void flushEventBatch();
    }, BATCH_FLUSH_INTERVAL_MS);
  }
}

/**
 * 批量写入缓冲区中的事件到数据库
 * 使用事务包裹多条 INSERT，减少 fsync 次数
 */
async function flushEventBatch(): Promise<void> {
  if (eventBuffer.length === 0 || batchFlushInProgress) return;

  batchFlushInProgress = true;
  // 取出当前缓冲区所有条目
  const batch = eventBuffer.splice(0, eventBuffer.length);

  try {
    const db = await getDbInstance();

    // 使用事务批量插入
    await new Promise<void>((resolve, reject) => {
      db.run('BEGIN TRANSACTION', (beginErr) => {
        if (beginErr) return reject(beginErr);
        resolve();
      });
    });

    for (const item of batch) {
      await new Promise<void>((resolve, reject) => {
        db.run(
          `INSERT INTO event_logs (event_type, user_id, payload) VALUES (?, ?, ?)`,
          [item.eventType, item.userId, item.payloadJson],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });
    }

    await new Promise<void>((resolve, reject) => {
      db.run('COMMIT', (commitErr) => {
        if (commitErr) return reject(commitErr);
        resolve();
      });
    });

    logger.debug(`[EventPersistence] 批量写入 ${batch.length} 条事件日志`);
  } catch (error) {
    logger.error('[EventPersistence] 批量写入失败，尝试逐条回退:', error);
    // 回滚事务后逐条写入（容错）
    try {
      const db = await getDbInstance();
      await new Promise<void>((resolve) => {
        db.run('ROLLBACK', () => resolve());
      });
      for (const item of batch) {
        try {
          await new Promise<void>((resolve, reject) => {
            db.run(
              `INSERT INTO event_logs (event_type, user_id, payload) VALUES (?, ?, ?)`,
              [item.eventType, item.userId, item.payloadJson],
              (err: Error | null) => {
                if (err) reject(err);
                else resolve();
              },
            );
          });
        } catch (singleErr) {
          logger.error('[EventPersistence] 单条写入也失败:', singleErr);
        }
      }
    } catch (rollbackErr) {
      logger.error('[EventPersistence] 回滚失败:', rollbackErr);
    }
  } finally {
    batchFlushInProgress = false;

    // 重入兜底：flush 期间新入队的事件可能因 timer 已触发而残留
    // 检查 buffer 是否又积压了数据，有则继续 drain
    if (eventBuffer.length > 0 && eventBuffer.length >= BATCH_SIZE) {
      void flushEventBatch();
    }

    // 概率清理：每 200 次写入或 5 分钟间隔触发清理
    writeCount += batch.length;
    if (writeCount >= CLEANUP_THRESHOLD || Date.now() - lastCleanupTime > CLEANUP_INTERVAL_MS) {
      writeCount = 0;
      lastCleanupTime = Date.now();
      if (!cleanupInProgress) {
        cleanupInProgress = true;
        void cleanupOldEventLogs().finally(() => {
          cleanupInProgress = false;
        });
      }
    }
  }
}

/**
 * 刷新缓冲区（用于优雅关闭时确保数据不丢失）
 */
export async function flushEventBuffer(): Promise<void> {
  if (batchFlushTimer) {
    clearTimeout(batchFlushTimer);
    batchFlushTimer = null;
  }
  await flushEventBatch();
}
