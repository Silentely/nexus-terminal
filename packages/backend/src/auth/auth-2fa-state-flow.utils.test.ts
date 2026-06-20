import { describe, expect, it, vi } from 'vitest';
import { Request } from 'express';
import {
  mapTwoFactorVerifyFailure,
  resolveTwoFactorSetupRequestValidation,
  resolveTwoFactorVerifyRequestValidation,
  saveTwoFactorSetupSessionSecret,
} from './auth-2fa-state-flow.utils';

describe('auth-2fa-state-flow.utils', () => {
  it('secret 缺失时应返回 400', () => {
    const result = resolveTwoFactorVerifyRequestValidation({
      userId: 1,
      requiresTwoFactor: false,
      effectiveSecret: '',
      normalizedToken: '123456',
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '未找到临时密钥，请重新开始设置流程。' },
      },
    });
  });

  it('保存失败时应返回 500', async () => {
    const req = {
      session: {
        save: vi.fn((callback: (err?: Error) => void) => callback(new Error('save failed'))),
      },
    } as unknown as Request;

    const result = await saveTwoFactorSetupSessionSecret(req, 'SECRET');

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 500,
        body: { message: '保存两步验证状态失败，请重试。' },
      },
    });
  });

  it('verify 失败映射应返回 验证码无效', () => {
    const result = mapTwoFactorVerifyFailure({ status: 'invalid' });
    expect(result).toEqual({
      kind: 'invalid',
      statusCode: 400,
      body: { message: '验证码无效。' },
    });
  });

  it('成功路径：setup 校验通过', () => {
    const result = resolveTwoFactorSetupRequestValidation({
      userId: 2,
      username: 'alice',
      requiresTwoFactor: false,
      existingSecret: null,
    });

    expect(result).toEqual({
      ok: true,
      actor: { userId: 2, username: 'alice' },
    });
  });

  it('成功路径：verify 校验通过', () => {
    const result = resolveTwoFactorVerifyRequestValidation({
      userId: 2,
      requiresTwoFactor: false,
      effectiveSecret: 'BASE32SECRET',
      normalizedToken: '123456',
    });

    expect(result).toEqual({
      ok: true,
      actor: { userId: 2 },
    });
  });

  it('成功路径：session 保存成功', async () => {
    const req = {
      session: {
        save: vi.fn((callback: (err?: Error) => void) => callback()),
      },
    } as unknown as Request;

    const result = await saveTwoFactorSetupSessionSecret(req, 'SECRET');

    expect((req.session as unknown as { tempTwoFactorSecret?: string }).tempTwoFactorSecret).toBe(
      'SECRET',
    );
    expect(result).toEqual({ ok: true });
  });
});
