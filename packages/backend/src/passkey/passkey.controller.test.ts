import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Mock 依赖
const mockPasskeyService = vi.hoisted(() => ({
  listPasskeysByUserId: vi.fn(),
  deletePasskey: vi.fn(),
  updatePasskeyName: vi.fn(),
  hasPasskeysConfigured: vi.fn(),
}));

const mockAuditLogService = vi.hoisted(() => ({
  logAction: vi.fn(),
}));

const mockNotificationService = vi.hoisted(() => ({
  sendNotification: vi.fn(),
}));

vi.mock('./passkey.service', () => ({
  passkeyService: mockPasskeyService,
}));

vi.mock('../audit/audit.service', () => ({
  AuditLogService: vi.fn(() => mockAuditLogService),
}));

vi.mock('../notifications/notification.service', () => ({
  NotificationService: vi.fn(() => mockNotificationService),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../utils/AppError', () => ({
  getErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

import {
  listUserPasskeys,
  deleteUserPasskey,
  updateUserPasskeyName,
  checkHasPasskeys,
} from './passkey.controller';

describe('passkey.controller', () => {
  const mockReq = (overrides: Record<string, any> = {}) =>
    ({
      session: { userId: 1, username: 'testuser' },
      params: {},
      body: {},
      query: {},
      ...overrides,
    }) as unknown as Request;

  const mockRes = () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return res;
  };

  const mockNext = vi.fn() as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listUserPasskeys', () => {
    it('未登录应返回 401', async () => {
      const req = mockReq({ session: {} });
      const res = mockRes();

      await listUserPasskeys(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: '未登录。' });
    });

    it('已登录应返回 Passkey 列表', async () => {
      const mockPasskeys = [
        { credential_id: 'cred1', name: 'Key 1' },
        { credential_id: 'cred2', name: 'Key 2' },
      ];
      mockPasskeyService.listPasskeysByUserId.mockResolvedValue(mockPasskeys);

      const req = mockReq();
      const res = mockRes();

      await listUserPasskeys(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockPasskeys);
      expect(mockPasskeyService.listPasskeysByUserId).toHaveBeenCalledWith(1);
    });

    it('服务异常应调用 next', async () => {
      mockPasskeyService.listPasskeysByUserId.mockRejectedValue(new Error('DB error'));
      const req = mockReq();
      const res = mockRes();

      await listUserPasskeys(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('deleteUserPasskey', () => {
    it('未登录应返回 401', async () => {
      const req = mockReq({ session: {}, params: { credentialID: 'cred1' } });
      const res = mockRes();

      await deleteUserPasskey(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('缺少 credentialID 参数应返回 400', async () => {
      const req = mockReq({ params: {} });
      const res = mockRes();

      await deleteUserPasskey(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: '缺少 credentialID 参数。' });
    });

    it('删除成功应返回 200', async () => {
      mockPasskeyService.deletePasskey.mockResolvedValue(true);
      const req = mockReq({ params: { credentialID: 'cred1' } });
      const res = mockRes();

      await deleteUserPasskey(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Passkey 已成功删除。' });
      expect(mockAuditLogService.logAction).toHaveBeenCalledWith('PASSKEY_DELETED', {
        userId: 1,
        credentialId: 'cred1',
      });
    });

    it('删除失败应返回 404', async () => {
      mockPasskeyService.deletePasskey.mockResolvedValue(false);
      const req = mockReq({ params: { credentialID: 'cred1' } });
      const res = mockRes();

      await deleteUserPasskey(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('权限错误应返回 403', async () => {
      mockPasskeyService.deletePasskey.mockRejectedValue(new Error('Unauthorized access'));
      const req = mockReq({ params: { credentialID: 'cred1' } });
      const res = mockRes();

      await deleteUserPasskey(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockAuditLogService.logAction).toHaveBeenCalledWith('PASSKEY_DELETE_UNAUTHORIZED', {
        userId: 1,
        username: 'testuser',
        credentialIdAttempted: 'cred1',
      });
    });
  });

  describe('updateUserPasskeyName', () => {
    it('未登录应返回 401', async () => {
      const req = mockReq({
        session: {},
        params: { credentialID: 'cred1' },
        body: { name: 'New Name' },
      });
      const res = mockRes();

      await updateUserPasskeyName(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('缺少 credentialID 应返回 400', async () => {
      const req = mockReq({ params: {}, body: { name: 'New Name' } });
      const res = mockRes();

      await updateUserPasskeyName(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('缺少 name 应返回 400', async () => {
      const req = mockReq({ params: { credentialID: 'cred1' }, body: {} });
      const res = mockRes();

      await updateUserPasskeyName(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: '请提供有效的 Passkey 名称。' });
    });

    it('name 为空字符串应返回 400', async () => {
      const req = mockReq({ params: { credentialID: 'cred1' }, body: { name: '   ' } });
      const res = mockRes();

      await updateUserPasskeyName(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Passkey 名称不能为空。' });
    });

    it('name 非字符串类型应返回 400', async () => {
      const req = mockReq({ params: { credentialID: 'cred1' }, body: { name: 123 } });
      const res = mockRes();

      await updateUserPasskeyName(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('更新成功应返回 200', async () => {
      mockPasskeyService.updatePasskeyName.mockResolvedValue(undefined);
      const req = mockReq({ params: { credentialID: 'cred1' }, body: { name: 'New Name' } });
      const res = mockRes();

      await updateUserPasskeyName(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Passkey 名称更新成功。' });
      expect(mockPasskeyService.updatePasskeyName).toHaveBeenCalledWith(1, 'cred1', 'New Name');
      expect(mockAuditLogService.logAction).toHaveBeenCalledWith('PASSKEY_NAME_UPDATED', {
        userId: 1,
        credentialId: 'cred1',
        newName: 'New Name',
      });
    });

    it('权限错误应返回 403', async () => {
      mockPasskeyService.updatePasskeyName.mockRejectedValue(new Error('Unauthorized'));
      const req = mockReq({ params: { credentialID: 'cred1' }, body: { name: 'New Name' } });
      const res = mockRes();

      await updateUserPasskeyName(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('checkHasPasskeys', () => {
    it('应返回 hasPasskeys 状态', async () => {
      mockPasskeyService.hasPasskeysConfigured.mockResolvedValue(true);
      const req = mockReq({ query: { username: 'testuser' } });
      const res = mockRes();

      await checkHasPasskeys(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ hasPasskeys: true });
    });

    it('无 username 查询参数也应正常工作', async () => {
      mockPasskeyService.hasPasskeysConfigured.mockResolvedValue(false);
      const req = mockReq({ query: {} });
      const res = mockRes();

      await checkHasPasskeys(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ hasPasskeys: false });
    });

    it('服务异常应调用 next', async () => {
      mockPasskeyService.hasPasskeysConfigured.mockRejectedValue(new Error('DB error'));
      const req = mockReq();
      const res = mockRes();

      await checkHasPasskeys(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
