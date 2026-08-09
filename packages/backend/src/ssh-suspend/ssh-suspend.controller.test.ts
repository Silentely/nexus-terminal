/**
 * ssh-suspend/ssh-suspend.controller 单元测试
 * 覆盖挂起会话控制器的鉴权、委托与错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockService = vi.hoisted(() => ({
  listSuspendedSessions: vi.fn(),
  terminateSuspendedSession: vi.fn(),
  removeDisconnectedSessionEntry: vi.fn(),
  editSuspendedSessionName: vi.fn(),
  getSessionLogContent: vi.fn(),
}));

vi.mock('./ssh-suspend.service', () => ({
  sshSuspendService: mockService,
}));

import { SshSuspendController } from './ssh-suspend.controller';

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    session: { userId: 1 } as Request['session'],
    body: {},
    params: {},
    ...overrides,
  } as Request;
}

function createRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
  return res as Response;
}

describe('SshSuspendController', () => {
  let controller: SshSuspendController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SshSuspendController();
  });

  describe('getSuspendedSshSessions', () => {
    it('未授权应返回 401', async () => {
      const req = createReq({ session: {} as Request['session'] });
      const res = createRes();

      await controller.getSuspendedSshSessions(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('应返回挂起会话列表', async () => {
      mockService.listSuspendedSessions.mockResolvedValue([{ id: 's1' }]);
      const req = createReq();
      const res = createRes();

      await controller.getSuspendedSshSessions(req, res);

      expect(mockService.listSuspendedSessions).toHaveBeenCalledWith(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('service 抛错应返回 500', async () => {
      mockService.listSuspendedSessions.mockRejectedValue(new Error('boom'));
      const req = createReq();
      const res = createRes();

      await controller.getSuspendedSshSessions(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('terminateAndRemoveSession', () => {
    it('应委托 terminateSuspendedSession', async () => {
      mockService.terminateSuspendedSession.mockResolvedValue(true);
      const req = createReq({ params: { suspendSessionId: 's1' } });
      const res = createRes();

      await controller.terminateAndRemoveSession(req, res);
      expect(mockService.terminateSuspendedSession).toHaveBeenCalledWith(1, 's1');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('removeSessionEntry', () => {
    it('应委托 removeDisconnectedSessionEntry', async () => {
      mockService.removeDisconnectedSessionEntry.mockResolvedValue(true);
      const req = createReq({ params: { suspendSessionId: 's2' } });
      const res = createRes();

      await controller.removeSessionEntry(req, res);
      expect(mockService.removeDisconnectedSessionEntry).toHaveBeenCalledWith(1, 's2');
    });
  });

  describe('editSessionNameHttp', () => {
    it('应委托 editSuspendedSessionName', async () => {
      mockService.editSuspendedSessionName.mockResolvedValue(true);
      const req = createReq({
        params: { suspendSessionId: 's3' },
        body: { customName: '重命名' },
      });
      const res = createRes();

      await controller.editSessionNameHttp(req, res);
      expect(mockService.editSuspendedSessionName).toHaveBeenCalledWith(1, 's3', '重命名');
    });
  });
});
