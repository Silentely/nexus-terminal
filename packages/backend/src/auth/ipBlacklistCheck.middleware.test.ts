/**
 * IP Blacklist Check Middleware 单元测试
 * 测试 IP 黑名单检查中间件的请求拦截逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import { ipBlacklistCheckMiddleware } from './ipBlacklistCheck.middleware';
import { ipBlacklistService } from './ip-blacklist.service';
import { settingsService } from '../settings/settings.service';

// Mock ip-blacklist.service
vi.mock('./ip-blacklist.service', () => ({
  ipBlacklistService: {
    isBlocked: vi.fn(),
  },
}));

// Mock settings.service
vi.mock('../settings/settings.service', () => ({
  settingsService: {
    isIpBlacklistEnabled: vi.fn(),
  },
}));

// 创建 mock Request
function createMockRequest(ip: string | undefined): Partial<Request> {
  return {
    ip,
    socket: ip ? undefined : { remoteAddress: undefined },
  } as Partial<Request>;
}

// 创建带 remoteAddress 的 mock Request
function createMockRequestWithRemoteAddress(remoteAddress: string | undefined): Partial<Request> {
  return {
    ip: undefined,
    socket: { remoteAddress } as any,
  };
}

// 创建 mock Response
function createMockResponse(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('IP Blacklist Check Middleware', () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('ipBlacklistCheckMiddleware', () => {
    it('无法获取 IP 地址时应返回 403', async () => {
      const mockReq = createMockRequest(undefined);

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '禁止访问：无法识别来源 IP。' });
    });

    it('IP 黑名单功能禁用时应调用 next()', async () => {
      const mockReq = createMockRequest('192.168.1.100');
      vi.mocked(settingsService.isIpBlacklistEnabled).mockResolvedValue(false);

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(ipBlacklistService.isBlocked).not.toHaveBeenCalled();
    });

    it('IP 被封禁时应返回 403', async () => {
      const mockReq = createMockRequest('192.168.1.100');
      vi.mocked(settingsService.isIpBlacklistEnabled).mockResolvedValue(true);
      vi.mocked(ipBlacklistService.isBlocked).mockResolvedValue(true);

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '访问被拒绝。' });
    });

    it('IP 未被封禁时应调用 next()', async () => {
      const mockReq = createMockRequest('192.168.1.100');
      vi.mocked(settingsService.isIpBlacklistEnabled).mockResolvedValue(true);
      vi.mocked(ipBlacklistService.isBlocked).mockResolvedValue(false);

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('isBlocked 抛出异常时应返回 500', async () => {
      const mockReq = createMockRequest('192.168.1.100');
      vi.mocked(settingsService.isIpBlacklistEnabled).mockResolvedValue(true);
      vi.mocked(ipBlacklistService.isBlocked).mockRejectedValue(new Error('Database error'));

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: '服务器内部错误 (IP 黑名单检查失败)。',
      });
    });

    it('isIpBlacklistEnabled 抛出异常时应返回 500', async () => {
      const mockReq = createMockRequest('192.168.1.100');
      vi.mocked(settingsService.isIpBlacklistEnabled).mockRejectedValue(
        new Error('Settings error'),
      );

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('应使用 socket.remoteAddress 作为备用 IP 来源', async () => {
      const mockReq = createMockRequestWithRemoteAddress('10.0.0.1');
      vi.mocked(settingsService.isIpBlacklistEnabled).mockResolvedValue(true);
      vi.mocked(ipBlacklistService.isBlocked).mockResolvedValue(false);

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(ipBlacklistService.isBlocked).toHaveBeenCalledWith('10.0.0.1');
    });

    it('IPv6 地址应正常处理', async () => {
      const mockReq = createMockRequest('::1');
      vi.mocked(settingsService.isIpBlacklistEnabled).mockResolvedValue(true);
      vi.mocked(ipBlacklistService.isBlocked).mockResolvedValue(false);

      await ipBlacklistCheckMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(ipBlacklistService.isBlocked).toHaveBeenCalledWith('::1');
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
