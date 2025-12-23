/**
 * P1-6: 自定义应用错误类
 * 统一的错误包装类，避免泄露敏感技术细节
 */

import { ErrorCode, ErrorSeverity } from '../types/error.types';

/**
 * 应用错误类
 * 用于在应用内部抛出标准化的错误
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly severity: ErrorSeverity;
  public readonly isOperational: boolean; // 是否是预期内的错误
  public readonly details?: string; // 技术细节（不会返回给客户端）

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
    statusCode: number = 500,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    isOperational: boolean = true,
    details?: string
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.severity = severity;
    this.isOperational = isOperational;
    this.details = details;

    // 保持正确的堆栈跟踪（仅用于内部日志）
    Error.captureStackTrace(this, this.constructor);

    // 设置 prototype 以支持 instanceof 检查
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * 常用错误工厂函数
 */
export class ErrorFactory {
  static badRequest(message: string, details?: string): AppError {
    return new AppError(message, ErrorCode.BAD_REQUEST, 400, ErrorSeverity.LOW, true, details);
  }

  static unauthorized(message: string = '未授权', details?: string): AppError {
    return new AppError(message, ErrorCode.UNAUTHORIZED, 401, ErrorSeverity.MEDIUM, true, details);
  }

  static forbidden(message: string = '禁止访问', details?: string): AppError {
    return new AppError(message, ErrorCode.FORBIDDEN, 403, ErrorSeverity.MEDIUM, true, details);
  }

  static notFound(message: string, details?: string): AppError {
    return new AppError(message, ErrorCode.NOT_FOUND, 404, ErrorSeverity.LOW, true, details);
  }

  static validationError(message: string, details?: string): AppError {
    return new AppError(message, ErrorCode.VALIDATION_ERROR, 422, ErrorSeverity.LOW, true, details);
  }

  static internalError(message: string = '服务器内部错误', details?: string): AppError {
    return new AppError(
      message,
      ErrorCode.INTERNAL_SERVER_ERROR,
      500,
      ErrorSeverity.HIGH,
      false,
      details
    );
  }

  static databaseError(message: string = '数据库操作失败', details?: string): AppError {
    return new AppError(message, ErrorCode.DATABASE_ERROR, 500, ErrorSeverity.HIGH, false, details);
  }

  static serviceUnavailable(message: string = '服务暂时不可用', details?: string): AppError {
    return new AppError(
      message,
      ErrorCode.SERVICE_UNAVAILABLE,
      503,
      ErrorSeverity.HIGH,
      true,
      details
    );
  }
}
