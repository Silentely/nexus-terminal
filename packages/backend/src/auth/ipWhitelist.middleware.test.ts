/**
 * IP Whitelist Middleware 单元测试
 * 测试 IP 白名单中间件的请求拦截逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import { ipWhitelistMiddleware, clearWhitelistCache } from './ipWhitelist.middleware';
import { settingsService } from '../settings/settings.service';
import { logger } from '../utils/logger';

// Mock settings.service
vi.mock('../settings/settings.service', () => ({
  settingsService: {
    getSetting: vi.fn(),
  },
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 创建 mock Request
function createMockRequest(ip: string | undefined, path?: string): Partial<Request> {
  return {
    ip,
    path: path || '/',
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

describe('IP Whitelist Middleware', () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    clearWhitelistCache();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('ipWhitelistMiddleware', () => {
    describe('IP 获取', () => {
      it('无法获取 IP 地址时应返回 403', async () => {
        const mockReq = createMockRequest(undefined);

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: '禁止访问：无法识别来源 IP。',
          code: 'IP_UNRECOGNIZABLE',
        });
      });

      it('应使用 socket.remoteAddress 作为备用 IP 来源', async () => {
        const mockReq = createMockRequestWithRemoteAddress('192.168.1.50');
        vi.mocked(settingsService.getSetting).mockResolvedValue('192.168.1.50');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('本地开发环境', () => {
      it('127.0.0.1 应始终允许访问', async () => {
        const mockReq = createMockRequest('127.0.0.1');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(settingsService.getSetting).not.toHaveBeenCalled();
      });

      it('::1 (IPv6 本地回环) 应始终允许访问', async () => {
        const mockReq = createMockRequest('::1');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('localhost 应始终允许访问', async () => {
        const mockReq = createMockRequest('localhost');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('本地 IP 访问非 health 路径应输出 debug 日志', async () => {
        const mockReq = createMockRequest('::1', '/api/v1/connections');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('允许来自本地开发环境'));
      });

      it('本地 IP 访问 health 路径不应输出日志', async () => {
        const mockReq = createMockRequest('::1', '/api/v1/health');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(logger.debug).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
      });

      it('本地 IP 访问 metrics 路径不应输出日志', async () => {
        const mockReq = createMockRequest('127.0.0.1', '/api/v1/metrics');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(logger.debug).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
      });
    });

    describe('白名单未设置', () => {
      it('白名单功能显式禁用时应允许所有请求', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        // 缓存未命中时 Promise.all 同时查询 enabled 和 whitelist
        vi.mocked(settingsService.getSetting).mockImplementation(async (key: string) => {
          return key === 'ipWhitelistEnabled' ? 'false' : '';
        });

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(settingsService.getSetting).toHaveBeenCalledTimes(2);
      });

      it('白名单为 null 时应允许所有请求', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockResolvedValue(null);

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('白名单为空字符串时应允许所有请求', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockResolvedValue('');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('白名单仅包含空格时应允许所有请求', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockResolvedValue('   ');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('解析后白名单为空时应允许所有请求并警告', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        // 多个分隔符但无有效条目
        vi.mocked(settingsService.getSetting).mockResolvedValue(',,,\n\n');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('单个 IP 匹配', () => {
      it('IP 在白名单中应允许访问', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockResolvedValue('192.168.1.100');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('IP 不在白名单中应返回 403', async () => {
        const mockReq = createMockRequest('192.168.1.200');
        vi.mocked(settingsService.getSetting).mockResolvedValue('192.168.1.100');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: '禁止访问：您的 IP 地址不在允许列表中。',
          code: 'IP_NOT_ALLOWED',
        });
      });

      it('多个 IP 使用换行符分隔应正确匹配', async () => {
        const mockReq = createMockRequest('10.0.0.5');
        vi.mocked(settingsService.getSetting).mockResolvedValue(
          '192.168.1.100\n10.0.0.5\n172.16.0.1',
        );

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('多个 IP 使用逗号分隔应正确匹配', async () => {
        const mockReq = createMockRequest('172.16.0.1');
        vi.mocked(settingsService.getSetting).mockResolvedValue(
          '192.168.1.100, 10.0.0.5, 172.16.0.1',
        );

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('IPv6 地址应正确匹配', async () => {
        const mockReq = createMockRequest('2001:db8::1');
        vi.mocked(settingsService.getSetting).mockResolvedValue('2001:db8::1');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('CIDR 范围匹配', () => {
      it('IP 在 CIDR 范围内应允许访问', async () => {
        const mockReq = createMockRequest('192.168.1.50');
        vi.mocked(settingsService.getSetting).mockResolvedValue('192.168.1.0/24');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('IP 不在 CIDR 范围内应返回 403', async () => {
        const mockReq = createMockRequest('192.168.2.50');
        vi.mocked(settingsService.getSetting).mockResolvedValue('192.168.1.0/24');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
      });

      it('/32 CIDR 应精确匹配单个 IP', async () => {
        const mockReq = createMockRequest('10.0.0.1');
        vi.mocked(settingsService.getSetting).mockResolvedValue('10.0.0.1/32');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('/16 CIDR 应匹配整个 B 类子网', async () => {
        const mockReq = createMockRequest('172.16.255.255');
        vi.mocked(settingsService.getSetting).mockResolvedValue('172.16.0.0/16');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('IPv6 CIDR 范围应正确匹配', async () => {
        const mockReq = createMockRequest('2001:db8::ffff');
        vi.mocked(settingsService.getSetting).mockResolvedValue('2001:db8::/32');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('混合 IP 和 CIDR 白名单应正确工作', async () => {
        const mockReq = createMockRequest('10.10.10.10');
        vi.mocked(settingsService.getSetting).mockResolvedValue(
          '192.168.1.100\n10.10.0.0/16\n172.16.0.1',
        );

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('无效条目处理', () => {
      it('无效的白名单条目应被忽略', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        // 包含无效条目 "invalid-ip" 但也有有效 IP
        vi.mocked(settingsService.getSetting).mockResolvedValue('invalid-ip,192.168.1.100');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('全部无效条目时应拒绝非本地 IP', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockResolvedValue('not-an-ip,also-invalid');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
      });

      it('请求 IP 格式无效时应返回 403', async () => {
        const mockReq = createMockRequest('not-a-valid-ip');
        vi.mocked(settingsService.getSetting).mockResolvedValue('192.168.1.0/24');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: '禁止访问：无效的来源 IP 格式。',
          code: 'INVALID_IP_FORMAT',
        });
      });
    });

    describe('错误处理', () => {
      it('getSetting 抛出异常时应返回 500', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockRejectedValue(new Error('Database error'));

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: '服务器内部错误 (IP 校验失败)。',
          code: 'INTERNAL_ERROR',
        });
      });
    });

    describe('IPv4/IPv6 类型不匹配', () => {
      it('IPv4 请求与 IPv6 白名单不应匹配', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockResolvedValue('2001:db8::1');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
      });

      it('IPv6 请求与 IPv4 白名单不应匹配', async () => {
        const mockReq = createMockRequest('2001:db8::1');
        vi.mocked(settingsService.getSetting).mockResolvedValue('192.168.1.100');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
      });

      it('IPv4 请求与 IPv6 CIDR 不应匹配', async () => {
        const mockReq = createMockRequest('192.168.1.100');
        vi.mocked(settingsService.getSetting).mockResolvedValue('2001:db8::/32');

        await ipWhitelistMiddleware(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
      });
    });
  });
});
