import { describe, expect, it } from 'vitest';
import {
  buildAuthStatusHttpResponse,
  buildInitDataBaseResponse,
  isAuthenticatedSessionSnapshot,
} from './auth-init-status-flow.utils';

describe('auth-init-status-flow.utils', () => {
  describe('isAuthenticatedSessionSnapshot', () => {
    it('未认证快照应返回 false', () => {
      expect(isAuthenticatedSessionSnapshot({ username: 'alice' })).toBe(false);
      expect(
        isAuthenticatedSessionSnapshot({
          userId: 1,
          username: 'alice',
          requiresTwoFactor: true,
        }),
      ).toBe(false);
    });

    it('已认证快照应返回 true', () => {
      expect(
        isAuthenticatedSessionSnapshot({
          userId: 2,
          username: 'bob',
          requiresTwoFactor: false,
        }),
      ).toBe(true);
    });
  });

  describe('buildAuthStatusHttpResponse', () => {
    it('未认证状态应组装为 401 + isAuthenticated=false', () => {
      const response = buildAuthStatusHttpResponse({
        isAuthenticated: false,
        user: null,
      });

      expect(response).toEqual({
        statusCode: 401,
        body: { isAuthenticated: false },
      });
    });

    it('已认证状态应组装为 200 + 用户信息', () => {
      const response = buildAuthStatusHttpResponse({
        isAuthenticated: true,
        user: {
          id: 9,
          username: 'carol',
          isTwoFactorEnabled: true,
        },
      });

      expect(response).toEqual({
        statusCode: 200,
        body: {
          isAuthenticated: true,
          user: {
            id: 9,
            username: 'carol',
            isTwoFactorEnabled: true,
          },
        },
      });
    });
  });

  describe('buildInitDataBaseResponse', () => {
    it('应组装 init-data 基础响应', () => {
      const response = buildInitDataBaseResponse({
        needsSetup: false,
        authState: {
          isAuthenticated: true,
          user: {
            id: 7,
            username: 'dave',
            isTwoFactorEnabled: false,
          },
        },
        captchaConfig: {
          enabled: true,
          provider: 'hcaptcha',
          hcaptchaSiteKey: 'site-key',
          recaptchaSiteKey: undefined,
        },
      });

      expect(response).toEqual({
        needsSetup: false,
        isAuthenticated: true,
        user: {
          id: 7,
          username: 'dave',
          isTwoFactorEnabled: false,
        },
        captchaConfig: {
          enabled: true,
          provider: 'hcaptcha',
          hcaptchaSiteKey: 'site-key',
          recaptchaSiteKey: undefined,
        },
        multiplexEnabled: false,
      });
    });

    it('multiplexEnabled 为 true 时应正确传递', () => {
      const response = buildInitDataBaseResponse({
        needsSetup: false,
        authState: {
          isAuthenticated: true,
          user: {
            id: 1,
            username: 'admin',
            isTwoFactorEnabled: false,
          },
        },
        captchaConfig: {
          enabled: false,
          provider: 'none',
          hcaptchaSiteKey: undefined,
          recaptchaSiteKey: undefined,
        },
        multiplexEnabled: true,
      });

      expect(response.multiplexEnabled).toBe(true);
    });

    it('multiplexEnabled 未传入时应默认为 false', () => {
      const response = buildInitDataBaseResponse({
        needsSetup: true,
        authState: { isAuthenticated: false, user: null },
        captchaConfig: {
          enabled: false,
          provider: 'none',
          hcaptchaSiteKey: undefined,
          recaptchaSiteKey: undefined,
        },
      });

      expect(response.multiplexEnabled).toBe(false);
    });
  });
});
