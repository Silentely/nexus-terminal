import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepositoryUtils, RunResult } from './base.repository';
import { ErrorFactory, AppError } from '../utils/AppError';
import { ErrorCode } from '../types/error.types';

// Mock database connection
// Logger mock for console replacement migration
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ logger: mockLogger }));

vi.mock('./connection', () => ({
  getDbInstance: vi.fn(),
  runDb: vi.fn(),
  getDb: vi.fn(),
  allDb: vi.fn(),
}));

describe('RepositoryUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getNow', () => {
    it('应该返回当前 Unix 时间戳（秒）', () => {
      const before = Math.floor(Date.now() / 1000);
      const result = RepositoryUtils.getNow();
      const after = Math.floor(Date.now() / 1000);

      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe('validateLastId', () => {
    it('应该返回有效的 lastID', () => {
      const result: RunResult = { lastID: 42, changes: 1 };
      expect(RepositoryUtils.validateLastId(result)).toBe(42);
    });

    it('应该在 lastID 为 0 时抛出错误', () => {
      const result: RunResult = { lastID: 0, changes: 0 };
      expect(() => RepositoryUtils.validateLastId(result)).toThrow(AppError);
    });

    it('应该在 lastID 为负数时抛出错误', () => {
      const result: RunResult = { lastID: -1, changes: 0 };
      expect(() => RepositoryUtils.validateLastId(result)).toThrow(AppError);
    });

    it('应该在 lastID 不是数字时抛出错误', () => {
      const result = { lastID: 'invalid' as unknown as number, changes: 0 };
      expect(() => RepositoryUtils.validateLastId(result)).toThrow(AppError);
    });

    it('应该使用自定义错误消息', () => {
      const result: RunResult = { lastID: 0, changes: 0 };
      try {
        RepositoryUtils.validateLastId(result, '自定义错误');
        expect.fail('应该抛出错误');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).message).toBe('自定义错误');
      }
    });
  });

  describe('hasChanges', () => {
    it('应该在 changes > 0 时返回 true', () => {
      expect(RepositoryUtils.hasChanges({ lastID: 1, changes: 1 })).toBe(true);
      expect(RepositoryUtils.hasChanges({ lastID: 1, changes: 5 })).toBe(true);
    });

    it('应该在 changes === 0 时返回 false', () => {
      expect(RepositoryUtils.hasChanges({ lastID: 0, changes: 0 })).toBe(false);
    });
  });

  describe('executeWithErrorHandling', () => {
    it('应该在操作成功时返回结果', async () => {
      const result = await RepositoryUtils.executeWithErrorHandling(
        async () => 'success',
        '测试上下文',
        '测试错误消息',
      );
      expect(result).toBe('success');
    });

    it('应该在操作抛出普通错误时包装为 AppError', async () => {
      // console spy removed (was: error);

      await expect(
        RepositoryUtils.executeWithErrorHandling(
          async () => {
            throw new Error('原始错误');
          },
          '测试上下文',
          '用户友好消息',
        ),
      ).rejects.toThrow(AppError);

      expect(mockLogger.error).toHaveBeenCalledWith('[仓库] 测试上下文:', '原始错误');
    });

    it('应该直接重新抛出 AppError', async () => {
      const appError = ErrorFactory.notFound('资源未找到');

      await expect(
        RepositoryUtils.executeWithErrorHandling(
          async () => {
            throw appError;
          },
          '测试上下文',
          '用户友好消息',
        ),
      ).rejects.toBe(appError);
    });

    it('应该使用自定义错误处理器', async () => {
      // console spy removed (was: error);

      const customHandler = vi.fn().mockReturnValue(ErrorFactory.validationError('自定义验证错误'));

      await expect(
        RepositoryUtils.executeWithErrorHandling(
          async () => {
            throw new Error('UNIQUE constraint failed');
          },
          '测试上下文',
          '用户友好消息',
          customHandler,
        ),
      ).rejects.toThrow('自定义验证错误');

      expect(customHandler).toHaveBeenCalled();
    });

    it('应该在自定义处理器返回 null 时使用默认处理', async () => {
      // console spy removed (was: error);

      const customHandler = vi.fn().mockReturnValue(null);

      try {
        await RepositoryUtils.executeWithErrorHandling(
          async () => {
            throw new Error('未知错误');
          },
          '测试上下文',
          '用户友好消息',
          customHandler,
        );
        expect.fail('应该抛出错误');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.DATABASE_ERROR);
      }
    });
  });

  describe('executeInTransaction', () => {
    it('应该在成功时提交事务', async () => {
      const { runDb, getDbInstance } = await import('./connection');
      const mockDb = {} as any;
      vi.mocked(getDbInstance).mockResolvedValue(mockDb);
      vi.mocked(runDb).mockResolvedValue({ lastID: 0, changes: 0 });

      const result = await RepositoryUtils.executeInTransaction(
        async () => 'transaction result',
        '测试事务',
        '事务失败',
      );

      expect(result).toBe('transaction result');
      expect(runDb).toHaveBeenCalledWith(mockDb, 'BEGIN TRANSACTION');
      expect(runDb).toHaveBeenCalledWith(mockDb, 'COMMIT');
    });

    it('应该在失败时回滚事务', async () => {
      // console spy removed (was: error);
      const { runDb, getDbInstance } = await import('./connection');
      const mockDb = {} as any;
      vi.mocked(getDbInstance).mockResolvedValue(mockDb);
      vi.mocked(runDb).mockResolvedValue({ lastID: 0, changes: 0 });

      await expect(
        RepositoryUtils.executeInTransaction(
          async () => {
            throw new Error('操作失败');
          },
          '测试事务',
          '事务失败',
        ),
      ).rejects.toThrow(AppError);

      expect(runDb).toHaveBeenCalledWith(mockDb, 'BEGIN TRANSACTION');
      expect(runDb).toHaveBeenCalledWith(mockDb, 'ROLLBACK');
    });

    it('应该在操作抛出 AppError 时保留原始错误', async () => {
      const { runDb, getDbInstance } = await import('./connection');
      const mockDb = {} as any;
      vi.mocked(getDbInstance).mockResolvedValue(mockDb);
      vi.mocked(runDb).mockResolvedValue({ lastID: 0, changes: 0 });

      const appError = ErrorFactory.validationError('验证失败');

      await expect(
        RepositoryUtils.executeInTransaction(
          async () => {
            throw appError;
          },
          '测试事务',
          '事务失败',
        ),
      ).rejects.toBe(appError);
    });
  });

  describe('createUniqueConstraintHandler', () => {
    it('应该在遇到 UNIQUE 约束错误时返回验证错误', () => {
      const handler = RepositoryUtils.createUniqueConstraintHandler('name', 'test', '名称');
      const result = handler(new Error('UNIQUE constraint failed'), 'UNIQUE constraint failed');

      expect(result).toBeInstanceOf(AppError);
      expect(result?.message).toBe('名称 "test" 已存在');
    });

    it('应该在非 UNIQUE 错误时返回 null', () => {
      const handler = RepositoryUtils.createUniqueConstraintHandler('name', 'test', '名称');
      const result = handler(new Error('其他错误'), '其他错误');

      expect(result).toBeNull();
    });
  });
});
