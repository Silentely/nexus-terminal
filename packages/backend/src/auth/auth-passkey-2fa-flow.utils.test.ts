import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';
import { SECURITY_CONFIG } from '../config/security.config';

// Mock 地理定位服务，使 lookupGeoInfo 立即返回 null 避免异步延迟
vi.mock('./ip-geo.service', () => ({
  lookupGeoInfo: vi.fn().mockResolvedValue(null),
}));

import {
  completePasskeyAuthenticatedSession,
  recordPasskeyAuthenticationFailure,
  recordPasskeyAuthenticationSuccess,
  recordTwoFactorDisabledEvent,
  recordTwoFactorEnabledEvent,
} from './auth-passkey-2fa-flow.utils';

const createServices = () => ({
  auditLogService: {
    logAction: vi.fn(),
  },
  notificationService: {
    sendNotification: vi.fn(),
  },
});

describe('auth-passkey-2fa-flow.utils', () => {
  it('recordPasskeyAuthenticationSuccess 应记录审计与登录通知', async () => {
    const services = createServices();
    const req = {
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.2' },
    } as unknown as Request;

    recordPasskeyAuthenticationSuccess(services, {
      req,
      userId: 7,
      username: 'alice',
      credentialId: 'cred-1',
    });
    await new Promise(process.nextTick);

    expect(services.auditLogService.logAction).toHaveBeenCalledWith('PASSKEY_AUTH_SUCCESS', {
      userId: 7,
      username: 'alice',
      credentialId: 'cred-1',
      ip: '10.0.0.1',
      method: 'Passkey',
    });
    expect(services.notificationService.sendNotification).toHaveBeenCalledWith('LOGIN_SUCCESS', {
      userId: 7,
      username: 'alice',
      credentialId: 'cred-1',
      ip: '10.0.0.1',
      method: 'Passkey',
    });
  });

  it('recordPasskeyAuthenticationFailure 应记录失败审计与失败通知', async () => {
    const services = createServices();
    const req = {
      ip: '',
      socket: { remoteAddress: '10.0.0.3' },
    } as unknown as Request;

    recordPasskeyAuthenticationFailure(services, {
      req,
      credentialId: 'cred-2',
      reason: 'Verification failed',
    });
    await new Promise(process.nextTick);

    expect(services.auditLogService.logAction).toHaveBeenCalledWith('PASSKEY_AUTH_FAILURE', {
      credentialId: 'cred-2',
      reason: 'Verification failed',
      ip: '10.0.0.3',
    });
    expect(services.notificationService.sendNotification).toHaveBeenCalledWith(
      'PASSKEY_AUTH_FAILURE',
      {
        credentialId: 'cred-2',
        reason: 'Verification failed',
        ip: '10.0.0.3',
      },
    );
  });

  describe('completePasskeyAuthenticatedSession', () => {
    it('regenerate 失败时应返回 500', () => {
      const req = {
        session: {
          regenerate: vi.fn((callback: (err?: Error) => void) =>
            callback(new Error('regenerate failed')),
          ),
          save: vi.fn(),
          cookie: {},
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      completePasskeyAuthenticatedSession(req, res, {
        user: { id: 1, username: 'alice' },
        rememberMe: true,
      });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Passkey 认证成功但会话创建失败，请重试。',
      });
    });

    it('save 失败时应返回 500', () => {
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

      completePasskeyAuthenticatedSession(req, res, {
        user: { id: 1, username: 'alice' },
      });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Passkey 认证成功但会话创建失败，请重试。',
      });
    });

    it('成功时应写入会话并返回 verified=true', () => {
      const req = {
        session: {
          regenerate: vi.fn((callback: (err?: Error) => void) => callback()),
          save: vi.fn((callback: (err?: Error) => void) => callback()),
          cookie: {},
          currentChallenge: { challenge: 'abc', timestamp: Date.now() },
          passkeyUserHandle: '1',
        },
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;

      completePasskeyAuthenticatedSession(req, res, {
        user: { id: 1, username: 'alice' },
        rememberMe: true,
      });

      const session = req.session as unknown as {
        userId?: number;
        username?: string;
        requiresTwoFactor?: boolean;
        cookie: { maxAge?: number };
        currentChallenge?: unknown;
        passkeyUserHandle?: string;
      };
      expect(session.userId).toBe(1);
      expect(session.username).toBe('alice');
      expect(session.requiresTwoFactor).toBe(false);
      expect(session.cookie.maxAge).toBe(SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE);
      expect(session.currentChallenge).toBeUndefined();
      expect(session.passkeyUserHandle).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        verified: true,
        message: 'Passkey 认证成功。',
        user: { id: 1, username: 'alice' },
      });
    });
  });

  it('recordTwoFactorEnabledEvent 应写入启用事件', async () => {
    const services = createServices();
    const req = {
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.2' },
    } as unknown as Request;

    recordTwoFactorEnabledEvent(services, { req, userId: 9 });
    await new Promise(process.nextTick);

    expect(services.auditLogService.logAction).toHaveBeenCalledWith('2FA_ENABLED', {
      userId: 9,
      ip: '10.0.0.1',
    });
    expect(services.notificationService.sendNotification).toHaveBeenCalledWith('2FA_ENABLED', {
      userId: 9,
      ip: '10.0.0.1',
    });
  });

  it('recordTwoFactorDisabledEvent 应写入禁用事件', async () => {
    const services = createServices();
    const req = {
      ip: '10.0.0.4',
    } as unknown as Request;

    recordTwoFactorDisabledEvent(services, { req, userId: 12 });
    await new Promise(process.nextTick);

    expect(services.auditLogService.logAction).toHaveBeenCalledWith('2FA_DISABLED', {
      userId: 12,
      ip: '10.0.0.4',
    });
    expect(services.notificationService.sendNotification).toHaveBeenCalledWith('2FA_DISABLED', {
      userId: 12,
      ip: '10.0.0.4',
    });
  });
});
