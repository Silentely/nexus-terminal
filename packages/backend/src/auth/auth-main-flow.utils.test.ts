import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { SECURITY_CONFIG } from '../config/security.config';

// Mock 地理定位服务，使 lookupGeoInfo 立即返回 null 避免异步延迟
vi.mock('./ip-geo.service', () => ({
  lookupGeoInfo: vi.fn().mockResolvedValue(null),
}));

import {
  completeAuthenticatedSession,
  destroySessionAndRespondLogout,
  recordLoginFailureAttempt,
  recordLoginSuccessAttempt,
  resolveRequestClientIp,
  startPendingTwoFactorSession,
  type PendingAuthPayload,
} from './auth-main-flow.utils';

describe('auth-main-flow.utils', () => {
  describe('resolveRequestClientIp', () => {
    it('优先返回 req.ip', () => {
      const req = {
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.2' },
      } as unknown as Request;
      expect(resolveRequestClientIp(req)).toBe('10.0.0.1');
    });

    it('req.ip 缺失时回退 socket.remoteAddress', () => {
      const req = {
        ip: '',
        socket: { remoteAddress: '10.0.0.2' },
      } as unknown as Request;
      expect(resolveRequestClientIp(req)).toBe('10.0.0.2');
    });

    it('均缺失时返回 unknown', () => {
      const req = { ip: '' } as unknown as Request;
      expect(resolveRequestClientIp(req)).toBe('unknown');
    });
  });

  describe('recordLoginFailureAttempt', () => {
    it('应写入失败次数、审计与通知', async () => {
      const services = {
        ipBlacklistService: { recordFailedAttempt: vi.fn() },
        auditLogService: { logAction: vi.fn() },
        notificationService: { sendNotification: vi.fn() },
      };

      recordLoginFailureAttempt(services, {
        username: 'alice',
        reason: 'Invalid password',
        clientIp: '10.0.0.1',
        userId: 7,
      });
      await new Promise(process.nextTick);

      expect(services.ipBlacklistService.recordFailedAttempt).toHaveBeenCalledWith(
        '10.0.0.1',
        undefined,
      );
      expect(services.auditLogService.logAction).toHaveBeenCalledWith('LOGIN_FAILURE', {
        username: 'alice',
        reason: 'Invalid password',
        ip: '10.0.0.1',
        userId: 7,
      });
      expect(services.notificationService.sendNotification).toHaveBeenCalledWith('LOGIN_FAILURE', {
        username: 'alice',
        reason: 'Invalid password',
        ip: '10.0.0.1',
        userId: 7,
      });
    });

    it('未提供 userId 时不应写入 userId 字段', async () => {
      const services = {
        ipBlacklistService: { recordFailedAttempt: vi.fn() },
        auditLogService: { logAction: vi.fn() },
        notificationService: { sendNotification: vi.fn() },
      };

      recordLoginFailureAttempt(services, {
        username: 'bob',
        reason: 'User not found',
        clientIp: '10.0.0.2',
      });
      await new Promise(process.nextTick);

      expect(services.auditLogService.logAction).toHaveBeenCalledWith('LOGIN_FAILURE', {
        username: 'bob',
        reason: 'User not found',
        ip: '10.0.0.2',
      });
    });
  });

  describe('recordLoginSuccessAttempt', () => {
    it('应重置失败次数并记录成功审计/通知', async () => {
      const services = {
        ipBlacklistService: { resetAttempts: vi.fn() },
        auditLogService: { logAction: vi.fn() },
        notificationService: { sendNotification: vi.fn() },
      };

      recordLoginSuccessAttempt(services, {
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.1',
      });
      await new Promise(process.nextTick);

      expect(services.ipBlacklistService.resetAttempts).toHaveBeenCalledWith('10.0.0.1');
      expect(services.auditLogService.logAction).toHaveBeenCalledWith('LOGIN_SUCCESS', {
        userId: 1,
        username: 'alice',
        ip: '10.0.0.1',
      });
      expect(services.notificationService.sendNotification).toHaveBeenCalledWith('LOGIN_SUCCESS', {
        userId: 1,
        username: 'alice',
        ip: '10.0.0.1',
      });
    });

    it('twoFactor=true 时应携带 twoFactor 标记', async () => {
      const services = {
        ipBlacklistService: { resetAttempts: vi.fn() },
        auditLogService: { logAction: vi.fn() },
        notificationService: { sendNotification: vi.fn() },
      };

      recordLoginSuccessAttempt(services, {
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.1',
        twoFactor: true,
      });
      await new Promise(process.nextTick);

      expect(services.auditLogService.logAction).toHaveBeenCalledWith('LOGIN_SUCCESS', {
        userId: 1,
        username: 'alice',
        ip: '10.0.0.1',
        twoFactor: true,
      });
    });
  });

  describe('startPendingTwoFactorSession', () => {
    const pendingAuth: PendingAuthPayload = {
      tempToken: 'token-123',
      userId: 1,
      username: 'alice',
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    it('regenerate 失败时返回 500', () => {
      const req = {
        session: {
          regenerate: vi.fn((callback: (err?: Error) => void) =>
            callback(new Error('regenerate failed')),
          ),
          save: vi.fn(),
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      startPendingTwoFactorSession(req, res, { pendingAuth, rememberMe: true, isDev: false });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: '登录过程中发生错误，请重试。' });
    });

    it('save 失败时返回 500', () => {
      const req = {
        session: {
          regenerate: vi.fn((callback: (err?: Error) => void) => callback()),
          save: vi.fn((callback: (err?: Error) => void) => callback(new Error('save failed'))),
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      startPendingTwoFactorSession(req, res, { pendingAuth, rememberMe: true, isDev: false });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: '登录过程中发生错误，请重试。' });
    });

    it('成功时应写入 pendingAuth 并返回 requiresTwoFactor', () => {
      const session = {
        regenerate: vi.fn((callback: (err?: Error) => void) => callback()),
        save: vi.fn((callback: (err?: Error) => void) => callback()),
      };
      const req = { session } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      startPendingTwoFactorSession(req, res, { pendingAuth, rememberMe: true, isDev: false });

      expect((req.session as unknown as { pendingAuth: PendingAuthPayload }).pendingAuth).toEqual(
        pendingAuth,
      );
      expect((req.session as unknown as { rememberMe?: boolean }).rememberMe).toBe(true);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: '需要进行两步验证。',
        requiresTwoFactor: true,
        tempToken: 'token-123',
      });
    });
  });

  describe('completeAuthenticatedSession', () => {
    it('regenerate 失败时返回 500', () => {
      const req = {
        session: {
          regenerate: vi.fn((callback: (err?: Error) => void) =>
            callback(new Error('regenerate failed')),
          ),
          cookie: {},
          save: vi.fn(),
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      completeAuthenticatedSession(req, res, {
        user: { id: 1, username: 'alice' },
        saveErrorMessage: '登录失败',
      });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: '登录失败' });
    });

    it('save 失败时返回 500', () => {
      const req = {
        session: {
          regenerate: vi.fn((callback: (err?: Error) => void) => callback()),
          save: vi.fn((callback: (err?: Error) => void) => callback(new Error('save failed'))),
          cookie: {},
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      completeAuthenticatedSession(req, res, {
        user: { id: 1, username: 'alice' },
        saveErrorMessage: '登录失败',
      });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: '登录失败' });
    });

    it('成功时应写入登录态并返回用户信息', () => {
      const req = {
        session: {
          regenerate: vi.fn((callback: (err?: Error) => void) => callback()),
          save: vi.fn((callback: (err?: Error) => void) => callback()),
          cookie: {},
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      completeAuthenticatedSession(req, res, {
        user: { id: 1, username: 'alice' },
        rememberMe: true,
        saveErrorMessage: '登录失败',
      });

      expect((req.session as unknown as { userId?: number }).userId).toBe(1);
      expect((req.session as unknown as { username?: string }).username).toBe('alice');
      expect((req.session as unknown as { requiresTwoFactor?: boolean }).requiresTwoFactor).toBe(
        false,
      );
      expect((req.session as unknown as { cookie: { maxAge?: number } }).cookie.maxAge).toBe(
        SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: '登录成功。',
        user: { id: 1, username: 'alice' },
      });
    });
  });

  describe('destroySessionAndRespondLogout', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('destroy 失败时返回 500', () => {
      const req = {
        session: {
          destroy: vi.fn((callback: (err?: Error) => void) =>
            callback(new Error('destroy failed')),
          ),
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      } as unknown as Response;

      destroySessionAndRespondLogout(req, res, { userId: 1, username: 'alice' });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: '登出时发生服务器内部错误。' });
    });

    it('成功时应清理 Cookie 并触发回调', () => {
      const req = {
        ip: '10.0.0.10',
        socket: { remoteAddress: '10.0.0.11' },
        session: {
          destroy: vi.fn((callback: (err?: Error) => void) => callback()),
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      } as unknown as Response;
      const onLogoutSuccess = vi.fn();

      destroySessionAndRespondLogout(req, res, {
        userId: 1,
        username: 'alice',
        onLogoutSuccess,
      });

      expect(res.clearCookie).toHaveBeenCalledWith('connect.sid');
      expect(onLogoutSuccess).toHaveBeenCalledWith('10.0.0.10');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '已成功登出。' });
    });

    it('userId 缺失时不触发回调', () => {
      const req = {
        session: {
          destroy: vi.fn((callback: (err?: Error) => void) => callback()),
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      } as unknown as Response;
      const onLogoutSuccess = vi.fn();

      destroySessionAndRespondLogout(req, res, { username: 'alice', onLogoutSuccess });

      expect(onLogoutSuccess).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
