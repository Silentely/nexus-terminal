/**
 * Repository 基类
 * 提供统一的错误处理、时间戳管理和事务操作工具
 */

import sqlite3 from 'sqlite3';
import { AppError, ErrorFactory, getErrorMessage, isAppError } from '../utils/AppError';
import { getDbInstance, runDb, getDb, allDb } from './connection';
import { logger } from '../utils/logger';

/** 数据库运行结果 */
export interface RunResult {
  lastID: number;
  changes: number;
}

/**
 * Repository 工具类
 * 提供静态方法供所有 Repository 使用
 */
export class RepositoryUtils {
  /**
   * 获取当前 Unix 时间戳（秒）
   */
  static getNow(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * 验证 INSERT 操作返回的 lastID 是否有效
   * @param result - runDb 返回的结果
   * @param errorMessage - 验证失败时的错误消息
   * @returns 有效的 lastID
   * @throws AppError 当 lastID 无效时
   */
  static validateLastId(result: RunResult, errorMessage: string = '插入操作未返回有效ID'): number {
    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      throw ErrorFactory.databaseError(errorMessage, `无效的 lastID: ${result.lastID}`);
    }
    return result.lastID;
  }

  /**
   * 检查 UPDATE/DELETE 操作是否影响了记录
   * @param result - runDb 返回的结果
   * @returns 是否有记录被修改
   */
  static hasChanges(result: RunResult): boolean {
    return result.changes > 0;
  }

  /**
   * 统一的错误处理包装器
   * 执行数据库操作并统一处理错误
   * @param operation - 要执行的异步操作
   * @param context - 错误上下文描述（用于日志）
   * @param userMessage - 用户友好的错误消息
   * @param errorHandler - 可选的自定义错误处理函数
   */
  static async executeWithErrorHandling<T>(
    operation: () => Promise<T>,
    context: string,
    userMessage: string,
    errorHandler?: (err: unknown, errMsg: string) => AppError | null,
  ): Promise<T> {
    try {
      return await operation();
    } catch (err: unknown) {
      // 如果已经是 AppError，直接重新抛出
      if (isAppError(err)) {
        throw err;
      }

      const errMsg = getErrorMessage(err);
      logger.error(`[仓库] ${context}:`, errMsg);

      // 如果提供了自定义错误处理器，尝试使用它
      if (errorHandler) {
        const customError = errorHandler(err, errMsg);
        if (customError) {
          throw customError;
        }
      }

      // 默认抛出数据库错误
      throw ErrorFactory.databaseError(userMessage, `${userMessage}: ${errMsg}`);
    }
  }

  /**
   * 在事务中执行操作
   * 自动处理 BEGIN/COMMIT/ROLLBACK
   * @param operation - 要在事务中执行的操作，接收 db 实例
   * @param context - 错误上下文描述
   * @param userMessage - 用户友好的错误消息
   */
  static async executeInTransaction<T>(
    operation: (db: sqlite3.Database) => Promise<T>,
    context: string,
    userMessage: string,
  ): Promise<T> {
    const db = await getDbInstance();

    await runDb(db, 'BEGIN TRANSACTION');

    try {
      const result = await operation(db);
      await runDb(db, 'COMMIT');
      return result;
    } catch (err: unknown) {
      // 回滚事务
      try {
        await runDb(db, 'ROLLBACK');
      } catch (rollbackErr: unknown) {
        logger.error(`[仓库] ${context} 回滚事务失败:`, getErrorMessage(rollbackErr));
      }

      // 如果已经是 AppError，直接重新抛出
      if (isAppError(err)) {
        throw err;
      }

      const errMsg = getErrorMessage(err);
      logger.error(`[仓库] ${context}:`, errMsg);
      throw ErrorFactory.databaseError(userMessage, `${userMessage}: ${errMsg}`);
    }
  }

  /**
   * 创建 UNIQUE 约束冲突的错误处理器
   * @param fieldName - 字段名称
   * @param fieldValue - 字段值
   * @param displayName - 显示名称（如"标签名称"）
   */
  static createUniqueConstraintHandler(
    fieldName: string,
    fieldValue: string,
    displayName: string,
  ): (err: unknown, errMsg: string) => AppError | null {
    return (_err: unknown, errMsg: string) => {
      if (errMsg.includes('UNIQUE constraint failed')) {
        return ErrorFactory.validationError(
          `${displayName} "${fieldValue}" 已存在`,
          `field: ${fieldName}, value: ${fieldValue}`,
        );
      }
      return null;
    };
  }
}

// 导出常用的数据库操作函数，方便 Repository 直接引用
export { getDbInstance, runDb, getDb, allDb };
export { AppError, ErrorFactory, getErrorMessage, isAppError };
