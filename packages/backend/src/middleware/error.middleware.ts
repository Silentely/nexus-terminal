/**
 * P1-6: 全局错误处理中间件
 * 捕获所有错误并转换为标准化的错误响应
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { ErrorResponse, ErrorCode, ErrorSeverity } from '../types/error.types';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * 全局错误处理中间件
 * 必须是 Express 中间件链的最后一个
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // 如果响应头已发送,委托给 Express 默认错误处理器
  // 避免尝试修改已发送的响应导致崩溃
  if (res.headersSent) {
    return next(err);
  }

  // 使用请求级 requestId（由 request-logger 中间件注入）
  const requestId = req.requestId || crypto.randomBytes(8).toString('hex');

  // 判断是否是 AppError
  const isAppError = err instanceof AppError;

  // 确定状态码
  const statusCode = isAppError ? err.statusCode : 500;

  // 确定错误代码
  const errorCode = isAppError ? err.code : ErrorCode.INTERNAL_SERVER_ERROR;

  // 确定错误严重级别
  const severity = isAppError ? err.severity : ErrorSeverity.HIGH;

  // 用户友好的错误消息（避免泄露技术细节）
  const userMessage = isAppError ? err.message : '服务器内部错误，请稍后重试或联系管理员。';

  // 技术细节（仅记录到日志，不返回给客户端）
  const technicalDetails = isAppError ? err.details : err.message;
  type SessionWithUsername = Request['session'] & { username?: string };
  const session = req.session as SessionWithUsername | undefined;

  // 记录错误日志（已经过 P1-5 敏感信息脱敏）
  const logContext = {
    requestId,
    path: `${req.method} ${req.path}`,
    user: session?.username || 'anonymous',
    errorCode,
    message: userMessage,
  };

  if (severity === ErrorSeverity.HIGH || severity === ErrorSeverity.CRITICAL) {
    logger.error(
      { ...logContext, err, technicalDetails },
      `[ErrorHandler] ${severity.toUpperCase()}`,
    );
  } else {
    logger.warn({ ...logContext }, `[ErrorHandler] ${severity.toUpperCase()}`);
  }

  // 构建标准化错误响应
  const errorResponse: ErrorResponse = {
    success: false,
    error: {
      code: errorCode,
      message: userMessage,
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  // 仅在开发环境返回技术细节
  if (process.env.NODE_ENV === 'development' && technicalDetails) {
    errorResponse.error.details = technicalDetails;
  }

  // 返回错误响应
  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found 处理中间件
 * 用于处理未匹配到任何路由的请求
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  // 生产环境仅返回通用消息，避免泄露内部路由结构；开发环境保留完整路径便于调试
  const detail =
    process.env.NODE_ENV === 'production'
      ? '请求的资源不存在'
      : `路由未找到: ${req.method} ${req.path}`;
  const error = new AppError(
    detail,
    ErrorCode.NOT_FOUND,
    404,
    ErrorSeverity.LOW,
    true,
    `Requested URL: ${req.originalUrl}`,
  );
  next(error);
};
