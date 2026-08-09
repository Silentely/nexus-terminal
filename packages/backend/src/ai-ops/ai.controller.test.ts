/**
 * ai-ops/ai.controller 单元测试
 * 覆盖 AI 控制器各端点的参数校验、鉴权与 service 委托
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockService = vi.hoisted(() => ({
  processQuery: vi.fn(),
  getUserSessions: vi.fn(),
  getSessionDetails: vi.fn(),
  deleteSession: vi.fn(),
  getSystemHealthSummary: vi.fn(),
  analyzeCommandPatterns: vi.fn(),
  cleanupUserSessions: vi.fn(),
}));

vi.mock('./ai.service', () => mockService);

import {
  processQuery,
  getSessions,
  getSessionDetails,
  deleteSession,
  getHealthSummary,
  getCommandPatterns,
  cleanupSessions,
} from './ai.controller';

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    session: { userId: 1 } as Request['session'],
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as Request;
}

function createRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('ai.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processQuery', () => {
    it('未授权应返回 401', async () => {
      const req = createReq({ session: {} as Request['session'] });
      const res = createRes();

      await processQuery(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    });

    it('空查询应返回 400', async () => {
      const req = createReq({ body: { query: '   ' } });
      const res = createRes();

      await processQuery(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('查询超过 2000 字符应返回 400', async () => {
      const req = createReq({ body: { query: 'a'.repeat(2001) } });
      const res = createRes();

      await processQuery(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('合法查询应委托 service 并返回 200', async () => {
      mockService.processQuery.mockResolvedValue({ success: true, result: 'ls -la' });
      const req = createReq({ body: { query: '列出目录' } });
      const res = createRes();

      await processQuery(req, res);

      expect(mockService.processQuery).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ query: '列出目录' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, result: 'ls -la' });
    });

    it('service 抛错应返回 500', async () => {
      mockService.processQuery.mockRejectedValue(new Error('boom'));
      const req = createReq({ body: { query: '测试' } });
      const res = createRes();

      await processQuery(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    });
  });

  describe('getSessions', () => {
    it('未授权应返回 401', async () => {
      const req = createReq({ session: {} as Request['session'] });
      const res = createRes();

      await getSessions(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('应委托 service 并限制 limit/offset 范围', async () => {
      mockService.getUserSessions.mockResolvedValue([]);
      const req = createReq({ query: { limit: '500', offset: '-5' } });
      const res = createRes();

      await getSessions(req, res);

      // limit 限制到 100，offset 归零
      expect(mockService.getUserSessions).toHaveBeenCalledWith(1, 100, 0);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getSessionDetails', () => {
    it('无效 sessionId 应返回 400', async () => {
      const req = createReq({ params: {} });
      const res = createRes();

      await getSessionDetails(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('会话不存在应返回 404', async () => {
      mockService.getSessionDetails.mockResolvedValue(null);
      const req = createReq({ params: { sessionId: 's1' } });
      const res = createRes();

      await getSessionDetails(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('会话存在应返回 200', async () => {
      mockService.getSessionDetails.mockResolvedValue({ id: 's1', messages: [] });
      const req = createReq({ params: { sessionId: 's1' } });
      const res = createRes();

      await getSessionDetails(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteSession', () => {
    it('未授权应返回 401', async () => {
      const req = createReq({ session: {} as Request['session'] });
      const res = createRes();

      await deleteSession(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('删除成功应返回 200', async () => {
      mockService.deleteSession.mockResolvedValue(true);
      const req = createReq({ params: { sessionId: 's1' } });
      const res = createRes();

      await deleteSession(req, res);
      expect(mockService.deleteSession).toHaveBeenCalledWith('s1', 1);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getHealthSummary / getCommandPatterns / cleanupSessions', () => {
    it('getHealthSummary 应委托 service', async () => {
      mockService.getSystemHealthSummary.mockResolvedValue({ total: 5 });
      const req = createReq();
      const res = createRes();

      await getHealthSummary(req, res);
      expect(mockService.getSystemHealthSummary).toHaveBeenCalledWith(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('getCommandPatterns 应委托 service', async () => {
      mockService.analyzeCommandPatterns.mockResolvedValue([]);
      const req = createReq();
      const res = createRes();

      await getCommandPatterns(req, res);
      expect(mockService.analyzeCommandPatterns).toHaveBeenCalledWith(1);
    });

    it('cleanupSessions 应委托 service 并限制 keepCount', async () => {
      mockService.cleanupUserSessions.mockResolvedValue(3);
      const req = createReq({ body: { keepCount: '500' } });
      const res = createRes();

      await cleanupSessions(req, res);
      // keepCount 500 限制到 200
      expect(mockService.cleanupUserSessions).toHaveBeenCalledWith(1, 200);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
