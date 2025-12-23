/**
 * P1-6: 全局错误处理中间件
 * 捕获所有错误并转换为标准化的错误响应
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { ErrorResponse, ErrorCode, ErrorSeverity } from '../types/error.types';
import crypto from 'crypto';

/**
 * 全局错误处理中间件
 * 必须是 Express 中间件链的最后一个
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // 如果响应头已发送,委托给 Express 默认错误处理器
  // 避免尝试修改已发送的响应导致崩溃
  if (res.headersSent) {
    return next(err);
  }

  // 生成请求追踪 ID
  const requestId = crypto.randomBytes(8).toString('hex');

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

  // 记录错误日志（已经过 P1-5 敏感信息脱敏）
  if (severity === ErrorSeverity.HIGH || severity === ErrorSeverity.CRITICAL) {
    console.error(`[ErrorHandler] [${severity.toUpperCase()}] Request ID: ${requestId}`);
    console.error(`[ErrorHandler] Path: ${req.method} ${req.path}`);
    console.error(`[ErrorHandler] User: ${(req.session as any)?.username || 'anonymous'}`);
    console.error(`[ErrorHandler] Error Code: ${errorCode}`);
    console.error(`[ErrorHandler] Message: ${userMessage}`);
    if (technicalDetails) {
      console.error(`[ErrorHandler] Technical Details: ${technicalDetails}`);
    }
    if (err.stack) {
      console.error(`[ErrorHandler] Stack Trace:\n${err.stack}`);
    }
  } else {
    console.warn(`[ErrorHandler] [${severity.toUpperCase()}] Request ID: ${requestId}`);
    console.warn(`[ErrorHandler] Path: ${req.method} ${req.path}`);
    console.warn(`[ErrorHandler] Error Code: ${errorCode} - ${userMessage}`);
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
  const error = new AppError(
    `路由未找到: ${req.method} ${req.path}`,
    ErrorCode.NOT_FOUND,
    404,
    ErrorSeverity.LOW,
    true,
    `Requested URL: ${req.originalUrl}`
  );
  next(error);
};
