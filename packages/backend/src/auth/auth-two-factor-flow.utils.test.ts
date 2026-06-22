import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import speakeasy from 'speakeasy';
import {
  createTwoFactorSecret,
  resolveTwoFactorEffectiveSecret,
  verifyTwoFactorTokenWithSkew,
} from './auth-two-factor-flow.utils';

vi.mock('speakeasy', () => ({
  default: {
    generateSecret: vi.fn(() => ({ base32: 'MOCK_BASE32_SECRET' })),
    otpauthURL: vi.fn(() => 'otpauth://mock-url'),
    totp: {
      verifyDelta: vi.fn(),
    },
  },
}));

describe('auth-two-factor-flow.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createTwoFactorSecret 应返回 base32 密钥', () => {
    const result = createTwoFactorSecret('alice');
    expect(result).toBe('MOCK_BASE32_SECRET');
    expect(vi.mocked(speakeasy.generateSecret)).toHaveBeenCalled();
  });

  it('resolveTwoFactorEffectiveSecret 应优先采用 providedSecret 并同步 session', () => {
    const req = {
      session: {
        tempTwoFactorSecret: 'SESSION_SECRET',
      },
    } as unknown as Request;

    const result = resolveTwoFactorEffectiveSecret({
      req,
      tempSecret: 'SESSION_SECRET',
      providedSecret: 'PROVIDED_SECRET',
    });

    expect(result).toEqual({
      effectiveSecret: 'PROVIDED_SECRET',
      secretProvidedByBody: true,
      sessionSecretMismatched: true,
    });
    expect((req.session as unknown as { tempTwoFactorSecret?: string }).tempTwoFactorSecret).toBe(
      'PROVIDED_SECRET',
    );
  });

  describe('verifyTwoFactorTokenWithSkew', () => {
    it('strict 验证成功时返回 verified', () => {
      vi.mocked(speakeasy.totp.verifyDelta).mockReturnValueOnce({ delta: 1 });

      const result = verifyTwoFactorTokenWithSkew({
        secret: 'SECRET',
        token: '123456',
        verifyWindow: 1,
        skewDetectWindow: 20,
        skewWarnThreshold: 2,
      });

      expect(result).toEqual({ status: 'verified', delta: 1 });
    });

    it('strict 失败且 relaxed 偏差较大时返回 time_skew', () => {
      vi.mocked(speakeasy.totp.verifyDelta)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ delta: 3 });

      const result = verifyTwoFactorTokenWithSkew({
        secret: 'SECRET',
        token: '123456',
        verifyWindow: 1,
        skewDetectWindow: 20,
        skewWarnThreshold: 2,
      });

      expect(result).toEqual({ status: 'time_skew', delta: 3, skewSeconds: 90 });
    });

    it('两次验证都失败时返回 invalid', () => {
      vi.mocked(speakeasy.totp.verifyDelta)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);

      const result = verifyTwoFactorTokenWithSkew({
        secret: 'SECRET',
        token: '123456',
        verifyWindow: 1,
        skewDetectWindow: 20,
        skewWarnThreshold: 2,
      });

      expect(result).toEqual({ status: 'invalid' });
    });
  });
});
