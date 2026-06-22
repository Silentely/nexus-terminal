import { describe, expect, it } from 'vitest';
import {
  buildPasskeyAuthenticationOptionsErrorLogAction,
  buildPasskeyAuthenticationOptionsGeneratedDebugLogAction,
  buildPasskeyAuthenticationSuccessInfoLogAction,
  buildPasskeyAuthenticationUserNotFoundAfterVerifiedErrorLogAction,
  buildPasskeyAuthenticationVerificationErrorLogAction,
  buildPasskeyAuthenticationVerificationFailedWarnLogAction,
  buildPasskeyHasConfiguredCheckErrorLogAction,
  buildPasskeyListErrorLogAction,
  buildPasskeyRegistrationOptionsErrorLogAction,
  buildPasskeyRegistrationOptionsGeneratedDebugLogAction,
  buildPasskeyRegistrationSuccessInfoLogAction,
  buildPasskeyRegistrationVerificationErrorLogAction,
  buildPasskeyRegistrationVerificationFailedWarnLogAction,
} from './auth-passkey-log-actions.utils';

describe('auth-passkey-log-actions.utils', () => {
  it('应返回稳定的 Passkey 注册日志动作模板', () => {
    expect(buildPasskeyRegistrationOptionsGeneratedDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '[AuthController] Generated Passkey registration options for user alice',
    });
    expect(buildPasskeyRegistrationOptionsErrorLogAction('alice')).toEqual({
      level: 'error',
      message: '[AuthController] 生成 Passkey 注册选项时出错 (用户: alice):',
    });
    expect(
      buildPasskeyRegistrationSuccessInfoLogAction({
        userHandle: '1',
        credentialId: 'credential-123456',
      }),
    ).toEqual({
      level: 'info',
      message: '[AuthController] 用户 1 的 Passkey 注册成功并已保存。 CredentialID: credenti***',
    });
    expect(buildPasskeyRegistrationVerificationFailedWarnLogAction('1')).toEqual({
      level: 'warn',
      message: '[AuthController] Passkey 注册验证失败 (用户: 1):',
    });
    expect(buildPasskeyRegistrationVerificationErrorLogAction('1')).toEqual({
      level: 'error',
      message: '[AuthController] 验证 Passkey 注册时出错 (用户: 1):',
    });
  });

  it('应返回稳定的 Passkey 认证日志动作模板', () => {
    expect(buildPasskeyAuthenticationOptionsGeneratedDebugLogAction('any')).toEqual({
      level: 'debug',
      message: '[AuthController] Generated Passkey authentication options (username=any)',
    });
    expect(buildPasskeyAuthenticationOptionsErrorLogAction('any')).toEqual({
      level: 'error',
      message: '[AuthController] 生成 Passkey 认证选项时出错 (username=any):',
    });
    expect(buildPasskeyAuthenticationUserNotFoundAfterVerifiedErrorLogAction(12)).toEqual({
      level: 'error',
      message: '[AuthController] Passkey 认证成功但未找到用户 ID: 12',
    });
    expect(
      buildPasskeyAuthenticationSuccessInfoLogAction({
        username: 'alice',
        userId: 12,
        passkeyId: 987654,
      }),
    ).toEqual({
      level: 'info',
      message: '[AuthController] 用户 alice (ID: 12) 通过 Passkey (ID: ***7654) 认证成功。',
    });
    expect(buildPasskeyAuthenticationVerificationFailedWarnLogAction()).toEqual({
      level: 'warn',
      message: '[AuthController] Passkey 认证验证失败:',
    });
    expect(buildPasskeyAuthenticationVerificationErrorLogAction()).toEqual({
      level: 'error',
      message: '[AuthController] 验证 Passkey 认证时出错:',
    });
  });

  it('应返回稳定的 Passkey 列表异常日志动作模板', () => {
    expect(buildPasskeyListErrorLogAction({ userId: 3, username: 'alice' })).toEqual({
      level: 'error',
      message: '[AuthController] 用户 alice (ID: 3) 获取 Passkey 列表时出错:',
    });
    expect(buildPasskeyHasConfiguredCheckErrorLogAction('any')).toEqual({
      level: 'error',
      message: '[AuthController] 检查 Passkey 配置状态时出错 (username=any):',
    });
  });
});
