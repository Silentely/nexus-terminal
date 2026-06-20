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
    details?: string,
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
 * 从 unknown 类型的错误中安全提取错误消息
 * 用于替代 catch (error: unknown) 模式
 * @param error - 捕获的错误（类型为 unknown）
 * @returns 错误消息字符串
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '未知错误';
}

/**
 * 类型守卫：检查 unknown 类型是否为带有 message 属性的 Error
 * @param error - 捕获的错误
 * @returns 是否为 Error 实例
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * 类型守卫：检查 unknown 类型是否为带有 code 属性的 Node.js 系统错误
 * @param error - 捕获的错误
 * @returns 是否为带有 code 的 NodeJS.ErrnoException
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * 类型守卫：检查 unknown 类型是否为带有 response 属性的 Axios 错误形态
 * 注意：这不等同于 axios.isAxiosError()，仅用于简单的结构检查
 * @param error - 捕获的错误
 * @returns 是否具有 response 属性
 */
export function hasResponse(
  error: unknown,
): error is Error & { response?: { data?: unknown; status?: number } } {
  return error instanceof Error && 'response' in error;
}

/**
 * 检查错误是否为 AppError 实例
 * @param error - 捕获的错误
 * @returns 是否为 AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
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
      details,
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
      details,
    );
  }
}
