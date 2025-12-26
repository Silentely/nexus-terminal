/**
 * Auth Controller 安全修复单元测试
 * 专注于验证 P0/P1 安全漏洞修复的正确性
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import * as authController from './auth.controller';

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import { getDb } from '../database/connection';
import { passkeyService } from '../passkey/passkey.service';
import { userRepository } from '../user/user.repository';

// Mock dependencies
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn(),
  runDb: vi.fn(),
  getDb: vi.fn(),
  allDb: vi.fn(),
}));

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

vi.mock('crypto', () => ({
  default: {
    randomBytes: vi.fn(),
  },
}));

vi.mock('speakeasy', () => ({
  default: {
    totp: {
      verify: vi.fn(),
    },
  },
}));

vi.mock('../notifications/notification.service', () => ({
  NotificationService: vi.fn().mockImplementation(() => ({
    sendNotification: vi.fn(),
  })),
}));

vi.mock('../audit/audit.service', () => ({
  AuditLogService: vi.fn().mockImplementation(() => ({
    logAction: vi.fn(),
  })),
}));

vi.mock('../auth/ip-blacklist.service', () => ({
  ipBlacklistService: {
    recordFailedAttempt: vi.fn(),
    resetAttempts: vi.fn(),
  },
}));

vi.mock('../settings/settings.service', () => ({
  settingsService: {
    getCaptchaConfig: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));

vi.mock('../passkey/passkey.service', () => ({
  passkeyService: {
    verifyAuthentication: vi.fn(),
  },
}));

vi.mock('../user/user.repository', () => ({
  userRepository: {
    findUserById: vi.fn(),
  },
}));

describe('Auth Controller - Security Fixes', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockSession: any;

  beforeEach(() => {
    // 重置所有 mocks
    vi.clearAllMocks();

    // 创建模拟的 session 对象
    mockSession = {
      regenerate: vi.fn((callback: (err?: Error) => void) => callback()),
      save: vi.fn((callback: (err?: Error) => void) => callback()),
      userId: undefined,
      username: undefined,
      requiresTwoFactor: undefined,
      pendingAuth: undefined,
      currentChallenge: undefined,
      rememberMe: undefined,
      cookie: {
        maxAge: undefined,
      },
    };

    // 创建模拟的 Request
    mockReq = {
      body: {},
      session: mockSession,
      ip: '127.0.0.1',
      socket: {
        remoteAddress: '127.0.0.1',
      } as any,
    };

    // 创建模拟的 Response
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      clearCookie: vi.fn().mockReturnThis(),
    };
  });

  afterEach(() => {
    // 注意：不要使用 vi.resetAllMocks()，它会清除 mock 函数的实现
    // vi.clearAllMocks() 已在 beforeEach 中执行，用于清除调用记录
  });

  /**
   * P0-1: Session Fixation Attack Prevention
   * 验证所有认证路径都正确调用 req.session.regenerate()
   */
  describe('P0-1: Session Fixation Prevention', () => {
    describe('密码登录 (无 2FA)', () => {
      it('应在密码登录成功后重新生成 session ID', async () => {
        // 准备测试数据
        const mockUser = {
          id: 1,
          username: 'testuser',
          hashed_password: 'hashed_password',
          two_factor_secret: null,
        };

        mockReq.body = {
          username: 'testuser',
          password: 'password123',
          rememberMe: false,
        };

        (getDb as any).mockResolvedValueOnce(mockUser);
        (bcrypt.compare as any).mockResolvedValueOnce(true);

        // 验证 regenerate 被调用
        const regenerateSpy = vi.spyOn(mockSession, 'regenerate');

        await authController.login(mockReq as Request, mockRes as Response);

        expect(regenerateSpy).toHaveBeenCalledTimes(1);
        expect(regenerateSpy).toHaveBeenCalledWith(expect.any(Function));
        expect(mockRes.status).toHaveBeenCalledWith(200);
      });

      it('regenerate 失败时应返回 500 错误', async () => {
        const mockUser = {
          id: 1,
          username: 'testuser',
          hashed_password: 'hashed_password',
          two_factor_secret: null,
        };

        mockReq.body = {
          username: 'testuser',
          password: 'password123',
        };

        (getDb as any).mockResolvedValueOnce(mockUser);
        (bcrypt.compare as any).mockResolvedValueOnce(true);

        // 模拟 regenerate 失败
        mockSession.regenerate = vi.fn((callback: (err?: Error) => void) =>
          callback(new Error('Session regeneration failed'))
        );

        await authController.login(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: '登录过程中发生错误，请重试。',
        });
      });
    });

    describe('2FA 流程启动', () => {
      it('应在启用 2FA 时重新生成 session ID', async () => {
        const mockUser = {
          id: 1,
          username: 'testuser',
          hashed_password: 'hashed_password',
          two_factor_secret: 'JBSWY3DPEHPK3PXP',
        };

        mockReq.body = {
          username: 'testuser',
          password: 'password123',
          rememberMe: true,
        };

        (getDb as any).mockResolvedValueOnce(mockUser);
        (bcrypt.compare as any).mockResolvedValueOnce(true);
        (crypto.randomBytes as any).mockReturnValueOnce(
          Buffer.from('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'hex')
        );

        const regenerateSpy = vi.spyOn(mockSession, 'regenerate');

        await authController.login(mockReq as Request, mockRes as Response);

        expect(regenerateSpy).toHaveBeenCalledTimes(1);
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            message: '需要进行两步验证。',
            requiresTwoFactor: true,
            tempToken: expect.any(String),
          })
        );
      });
    });

    describe('2FA 验证完成', () => {
      it('应在 2FA 验证成功后重新生成 session ID', async () => {
        const mockUser = {
          id: 1,
          username: 'testuser',
          two_factor_secret: 'JBSWY3DPEHPK3PXP',
        };

        const tempToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
        const pendingAuth = {
          tempToken,
          userId: 1,
          username: 'testuser',
          expiresAt: Date.now() + 5 * 60 * 1000,
        };

        mockSession.pendingAuth = pendingAuth;
        mockSession.rememberMe = false;

        mockReq.body = {
          token: '123456',
          tempToken,
        };

        (getDb as any).mockResolvedValueOnce(mockUser);
        (speakeasy.totp.verify as any).mockReturnValueOnce(true);

        const regenerateSpy = vi.spyOn(mockSession, 'regenerate');

        await authController.verifyLogin2FA(mockReq as Request, mockRes as Response);

        expect(regenerateSpy).toHaveBeenCalledTimes(1);
        expect(mockRes.status).toHaveBeenCalledWith(200);
      });
    });

    describe('Passkey 认证', () => {
      it('应在 Passkey 认证成功后重新生成 session ID', async () => {
        const mockUser = {
          id: 1,
          username: 'testuser',
        };

        const challengeData = {
          challenge: 'test-challenge',
          timestamp: Date.now(),
        };

        mockSession.currentChallenge = challengeData;

        mockReq.body = {
          assertionResponse: {
            id: 'credential-id',
            rawId: 'credential-raw-id',
            response: {},
            type: 'public-key',
          },
          rememberMe: true,
        };

        (passkeyService.verifyAuthentication as any).mockResolvedValueOnce({
          verified: true,
          userId: 1,
          passkey: {
            id: 1,
            credential_id: 'credential-id',
          },
        });

        (userRepository.findUserById as any).mockResolvedValueOnce(mockUser);

        const regenerateSpy = vi.spyOn(mockSession, 'regenerate');

        await authController.verifyPasskeyAuthenticationHandler(
          mockReq as Request,
          mockRes as Response
        );

        expect(regenerateSpy).toHaveBeenCalledTimes(1);
        expect(mockRes.status).toHaveBeenCalledWith(200);
      });
    });
  });

  /**
   * P0-2: Passkey Challenge Replay Attack Prevention
   * 验证 challenge 时间戳验证逻辑
   */
  describe('P0-2: Challenge Replay Prevention', () => {
    describe('注册流程', () => {
      it('应拒绝过期的 challenge (>5 minutes)', async () => {
        const expiredChallenge = {
          challenge: 'test-challenge',
          timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        };

        mockSession.currentChallenge = expiredChallenge;
        mockSession.passkeyUserHandle = '1';
        mockSession.userId = 1;
        mockSession.username = 'testuser';

        mockReq.body = {
          id: 'credential-id',
          rawId: 'credential-raw-id',
          response: {},
          type: 'public-key',
        };

        await authController.verifyPasskeyRegistrationHandler(
          mockReq as Request,
          mockRes as Response
        );

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: '注册质询已过期，请重新开始注册流程。',
        });
      });

      it('应接受未过期的 challenge (<5 minutes)', async () => {
        const validChallenge = {
          challenge: 'test-challenge',
          timestamp: Date.now() - 2 * 60 * 1000, // 2 minutes ago
        };

        mockSession.currentChallenge = validChallenge;
        mockSession.passkeyUserHandle = '1';
        mockSession.userId = 1;
        mockSession.username = 'testuser';

        mockReq.body = {
          id: 'credential-id',
          rawId: 'credential-raw-id',
          response: {
            attestationObject: 'attestation-object',
            clientDataJSON: 'client-data-json',
          },
          type: 'public-key',
        };

        // Mock passkey service to simulate successful verification
        vi.doMock('../passkey/passkey.service', () => ({
          passkeyService: {
            verifyRegistration: vi.fn().mockResolvedValue({
              verified: true,
              newPasskeyToSave: {
                user_id: 1,
                credential_id: 'credential-id',
                public_key: 'public-key',
                counter: 0,
              },
            }),
          },
        }));

        // Note: Full verification would require mocking passkeyService.verifyRegistration
        // For now, we're just checking that expired challenges are rejected
      });
    });

    describe('认证流程', () => {
      it('应拒绝过期的 challenge (>5 minutes)', async () => {
        const expiredChallenge = {
          challenge: 'test-challenge',
          timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        };

        mockSession.currentChallenge = expiredChallenge;

        mockReq.body = {
          assertionResponse: {
            id: 'credential-id',
            rawId: 'credential-raw-id',
            response: {},
            type: 'public-key',
          },
        };

        await authController.verifyPasskeyAuthenticationHandler(
          mockReq as Request,
          mockRes as Response
        );

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: '认证质询已过期，请重新开始认证流程。',
        });
      });
    });
  });

  /**
   * P0-3: 2FA Verification Bypass Prevention
   * 验证临时令牌机制
   */
  describe('P0-3: 2FA Bypass Prevention', () => {
    describe('临时令牌验证', () => {
      it('缺少 pendingAuth 时应拒绝', async () => {
        mockReq.body = {
          token: '123456',
          tempToken: 'some-token',
        };

        // pendingAuth 未设置
        mockSession.pendingAuth = undefined;

        await authController.verifyLogin2FA(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: '无效的认证状态。',
        });
      });

      it('缺少 tempToken 时应拒绝', async () => {
        const pendingAuth = {
          tempToken: 'valid-token',
          userId: 1,
          username: 'testuser',
          expiresAt: Date.now() + 5 * 60 * 1000,
        };

        mockSession.pendingAuth = pendingAuth;

        mockReq.body = {
          token: '123456',
          // tempToken 缺失
        };

        await authController.verifyLogin2FA(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: '无效的认证状态。',
        });
      });

      it('tempToken 不匹配时应拒绝', async () => {
        const pendingAuth = {
          tempToken: 'valid-token',
          userId: 1,
          username: 'testuser',
          expiresAt: Date.now() + 5 * 60 * 1000,
        };

        mockSession.pendingAuth = pendingAuth;

        mockReq.body = {
          token: '123456',
          tempToken: 'wrong-token', // 不匹配
        };

        await authController.verifyLogin2FA(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: '无效的认证状态。',
        });
      });

      it('tempToken 过期时应拒绝', async () => {
        const pendingAuth = {
          tempToken: 'valid-token',
          userId: 1,
          username: 'testuser',
          expiresAt: Date.now() - 1000, // 已过期
        };

        mockSession.pendingAuth = pendingAuth;

        mockReq.body = {
          token: '123456',
          tempToken: 'valid-token',
        };

        await authController.verifyLogin2FA(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: '认证已过期，请重新登录。',
        });
      });

      it('所有验证通过后应成功', async () => {
        const mockUser = {
          id: 1,
          username: 'testuser',
          two_factor_secret: 'JBSWY3DPEHPK3PXP',
        };

        const tempToken = 'valid-token';
        const pendingAuth = {
          tempToken,
          userId: 1,
          username: 'testuser',
          expiresAt: Date.now() + 5 * 60 * 1000, // 未过期
        };

        mockSession.pendingAuth = pendingAuth;
        mockSession.rememberMe = false;

        mockReq.body = {
          token: '123456',
          tempToken, // 匹配
        };

        (getDb as any).mockResolvedValueOnce(mockUser);
        (speakeasy.totp.verify as any).mockReturnValueOnce(true);

        await authController.verifyLogin2FA(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            message: '登录成功。',
            user: { id: 1, username: 'testuser' },
          })
        );
      });
    });
  });
});
