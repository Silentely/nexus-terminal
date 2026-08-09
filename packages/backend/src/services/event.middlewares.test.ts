/**
 * services/event.middlewares 单元测试
 * 覆盖日志中间件与事件持久化中间件的批量缓冲逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as loggerModule from '../utils/logger';
import * as dbModule from '../database/connection';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockDb = vi.hoisted(() => ({
  run: vi.fn((_sql: string, _params: unknown, cb?: (err: Error | null) => void) => {
    // 模拟 sqlite3 回调风格：无错误时调用回调
    if (typeof cb === 'function') cb(null);
  }),
}));
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue(mockDb),
  runDb: vi.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
}));

import { AppEventType } from '../types/event.types';

const next = vi.fn();

describe('event.middlewares', () => {
  let mod: typeof import('./event.middlewares');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.resetModules();
    mod = await import('./event.middlewares');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loggingMiddleware', () => {
    it('应记录日志并调用 next', () => {
      mod.loggingMiddleware(AppEventType.LoginSuccess, { userId: 1 } as never, next);

      expect(loggerModule.logger.debug).toHaveBeenCalledWith('[Event] LOGIN_SUCCESS');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('persistenceMiddleware', () => {
    it('非持久事件应只调用 next 不入缓冲', () => {
      // 使用一个非持久事件类型（如 terminal 相关）
      mod.persistenceMiddleware('terminal:input' as never, { sessionId: 's1' } as never, next);
      expect(next).toHaveBeenCalled();
      // 不触发定时器（缓冲区为空）
      vi.advanceTimersByTime(2000);
      expect(dbModule.runDb).not.toHaveBeenCalled();
      expect(mockDb.run).not.toHaveBeenCalled();
    });

    it('持久事件应入缓冲并在定时器触发时批量写入', async () => {
      mod.persistenceMiddleware(AppEventType.LoginSuccess, { userId: 1 } as never, next);
      expect(next).toHaveBeenCalled();

      // 推进定时刷新并等待异步 flush 完成
      await vi.advanceTimersByTimeAsync(1100);

      // 批量写入通过 db.run 执行（事务 + INSERT + COMMIT）
      expect(dbModule.getDbInstance).toHaveBeenCalled();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('缓冲区满 10 条后 flushEventBuffer 应批量写入', async () => {
      // 手动触发多次持久事件，然后显式 flush
      for (let i = 0; i < 10; i++) {
        mod.persistenceMiddleware(AppEventType.LoginSuccess, { userId: i } as never, next);
      }
      // 等待内部 fire-and-forget 的 flush 或定时器完成
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
      await mod.flushEventBuffer();

      expect(mockDb.run).toHaveBeenCalled();
    });
  });

  describe('flushEventBuffer', () => {
    it('空缓冲区时应静默返回', async () => {
      await mod.flushEventBuffer();
      expect(dbModule.runDb).not.toHaveBeenCalled();
    });
  });
});
