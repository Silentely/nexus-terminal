import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { errorHandler, notFoundHandler } from './error.middleware';
import { AppError } from '../utils/AppError';
import { ErrorCode, ErrorSeverity } from '../types/error.types';

describe('error.middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = {
      method: 'GET',
      path: '/test',
      originalUrl: '/test',
      session: { username: 'testuser' } as any,
    };
    mockRes = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  describe('errorHandler', () => {
    it('应该处理 AppError 并返回对应状态码', () => {
      const error = new AppError('测试错误', ErrorCode.NOT_FOUND, 404, ErrorSeverity.LOW, true);

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: ErrorCode.NOT_FOUND,
            message: '测试错误',
          }),
        }),
      );
    });

    it('应该处理普通 Error 并返回 500', () => {
      const error = new Error('内部错误');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: '服务器内部错误，请稍后重试或联系管理员。',
          }),
        }),
      );
    });

    it('应该在 headersSent 时委托给 next', () => {
      mockRes.headersSent = true;
      const error = new Error('测试错误');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('应该生成 requestId', () => {
      const error = new Error('测试错误');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      const jsonCall = vi.mocked(mockRes.json).mock.calls[0][0] as any;
      expect(jsonCall.error.requestId).toBeDefined();
      expect(typeof jsonCall.error.requestId).toBe('string');
    });

    it('应该包含 timestamp', () => {
      const error = new Error('测试错误');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      const jsonCall = vi.mocked(mockRes.json).mock.calls[0][0] as any;
      expect(jsonCall.error.timestamp).toBeDefined();
    });
  });

  describe('notFoundHandler', () => {
    it('应该创建 404 AppError 并调用 next', () => {
      notFoundHandler(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = vi.mocked(mockNext).mock.calls[0][0] as AppError;
      expect(error.statusCode).toBe(404);
    });

    it('生产环境应该返回通用消息', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      notFoundHandler(mockReq as Request, mockRes as Response, mockNext);

      const error = vi.mocked(mockNext).mock.calls[0][0] as AppError;
      expect(error.message).toBe('请求的资源不存在');

      process.env.NODE_ENV = originalEnv;
    });

    it('开发环境应该返回详细路径', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      notFoundHandler(mockReq as Request, mockRes as Response, mockNext);

      const error = vi.mocked(mockNext).mock.calls[0][0] as AppError;
      expect(error.message).toContain('GET /test');

      process.env.NODE_ENV = originalEnv;
    });
  });
});
