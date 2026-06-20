import { describe, expect, it, vi } from 'vitest';
import {
  LOGIN_TWO_FACTOR_USER_QUERY_SQL,
  applyLoginTwoFactorAttemptAction,
  buildLoginTwoFactorDiagnosticsLogActions,
  buildLoginTwoFactorFallbackFailureResponseAction,
  buildLoginTwoFactorFailureAttemptAction,
  buildLoginTwoFactorFailureAttemptPayload,
  buildLoginTwoFactorMissingSecretFailureAction,
  buildLoginTwoFactorPendingValidationFailedDebugLogAction,
  buildLoginTwoFactorSessionCompletionAction,
  buildLoginTwoFactorSuccessAttemptAction,
  buildLoginTwoFactorSuccessLogAction,
  buildLoginTwoFactorUserQueryAction,
  resolveLoginTwoFactorFailureAction,
  resolveLoginTwoFactorUserLookupAction,
  resolveLoginTwoFactorVerifiedOutcomeAction,
} from './auth-login-two-factor-actions.utils';

describe('auth-login-two-factor-actions.utils', () => {
  it('time_skew 应返回 401 与 TIME_SKEW_DETECTED 响应', () => {
    const action = resolveLoginTwoFactorFailureAction({
      username: 'alice',
      verificationResult: {
        status: 'time_skew',
        delta: 3,
        skewSeconds: 90,
      },
    });

    expect(action).toEqual({
      handled: true,
      response: {
        statusCode: 401,
        body: {
          message: '验证码无效。检测到客户端时间与服务器存在约 90 秒偏差，请校准设备时间后重试。',
          code: 'TIME_SKEW_DETECTED',
          skewSeconds: 90,
          delta: 3,
        },
      },
      log: {
        level: 'warn',
        message:
          '[AuthController] 用户 alice 的 2FA 登录验证码存在明显时间偏差（delta=3），建议校准客户端时间。',
      },
    });
  });

  it('invalid 应返回 401 与验证码无效响应', () => {
    const action = resolveLoginTwoFactorFailureAction({
      username: 'alice',
      verificationResult: { status: 'invalid' },
    });

    expect(action).toEqual({
      handled: true,
      failureReason: 'Invalid 2FA token',
      response: {
        statusCode: 401,
        body: { message: '验证码无效。' },
      },
      log: {
        level: 'debug',
        message: '用户 alice 2FA 验证失败: 验证码错误。',
      },
    });
  });

  it('verified 应返回 handled=false，成功日志动作保持稳定', () => {
    const failureAction = resolveLoginTwoFactorFailureAction({
      username: 'alice',
      verificationResult: { status: 'verified', delta: 0 },
    });
    expect(failureAction).toEqual({ handled: false });

    expect(buildLoginTwoFactorSuccessLogAction('alice')).toEqual({
      level: 'info',
      message: '用户 alice 2FA 验证成功。',
    });
  });

  it('应构建登录 2FA 失败尝试参数与调试日志动作', () => {
    expect(
      buildLoginTwoFactorFailureAttemptPayload({
        userId: 7,
        username: 'alice',
        clientIp: '127.0.0.1',
      }),
    ).toEqual({
      userId: 7,
      username: 'alice',
      reason: 'Invalid 2FA token',
      clientIp: '127.0.0.1',
    });

    expect(
      buildLoginTwoFactorDiagnosticsLogActions({
        hasPendingAuth: true,
        hasTempToken: false,
        forwardedProto: 'https',
      }),
    ).toEqual([
      {
        level: 'debug',
        message: '[AuthController] verifyLogin2FA - Has pendingAuth: true',
      },
      {
        level: 'debug',
        message: '[AuthController] verifyLogin2FA - Has tempToken: false',
      },
      {
        level: 'debug',
        message: '[AuthController] verifyLogin2FA - X-Forwarded-Proto: https',
      },
    ]);

    expect(
      buildLoginTwoFactorPendingValidationFailedDebugLogAction({
        hasPendingAuth: false,
        hasTempToken: true,
      }),
    ).toEqual({
      level: 'debug',
      message: '[AuthController] verifyLogin2FA - FAILED: pendingAuth=false, tempToken=true',
    });
  });

  it('应构建 success/failure attempt 动作与通用响应动作', () => {
    expect(
      buildLoginTwoFactorSuccessAttemptAction({
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.1',
      }),
    ).toEqual({
      kind: 'success',
      payload: {
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.1',
        twoFactor: true,
      },
    });

    expect(
      buildLoginTwoFactorFailureAttemptAction({
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.2',
      }),
    ).toEqual({
      kind: 'failure',
      payload: {
        userId: 1,
        username: 'alice',
        reason: 'Invalid 2FA token',
        clientIp: '10.0.0.2',
      },
    });

    expect(
      buildLoginTwoFactorSessionCompletionAction({
        user: { id: 1, username: 'alice' },
        rememberMe: true,
      }),
    ).toEqual({
      user: { id: 1, username: 'alice' },
      rememberMe: true,
      saveErrorMessage: '登录完成失败，请重试。',
    });

    expect(
      buildLoginTwoFactorMissingSecretFailureAction({
        pendingUserId: 9,
      }),
    ).toEqual({
      response: {
        statusCode: 400,
        body: { message: '无法验证，请重新登录。' },
      },
      log: {
        level: 'error',
        message: '2FA 验证错误: 未找到用户 9 或未设置密钥。',
      },
    });

    expect(buildLoginTwoFactorFallbackFailureResponseAction()).toEqual({
      statusCode: 401,
      body: { message: '验证码无效。' },
    });
  });

  it('应构建登录 2FA 用户查询动作并完成用户查找校验动作', () => {
    expect(buildLoginTwoFactorUserQueryAction({ userId: 18 })).toEqual({
      sql: LOGIN_TWO_FACTOR_USER_QUERY_SQL,
      params: [18],
    });

    expect(
      resolveLoginTwoFactorUserLookupAction({
        pendingUserId: 18,
        user: null,
      }),
    ).toEqual({
      ok: false,
      failureAction: {
        response: {
          statusCode: 400,
          body: { message: '无法验证，请重新登录。' },
        },
        log: {
          level: 'error',
          message: '2FA 验证错误: 未找到用户 18 或未设置密钥。',
        },
      },
    });

    expect(
      resolveLoginTwoFactorUserLookupAction({
        pendingUserId: 18,
        user: {
          id: 18,
          username: 'alice',
          two_factor_secret: 'JBSWY3DPEHPK3PXP',
        },
      }),
    ).toEqual({
      ok: true,
      actor: {
        id: 18,
        username: 'alice',
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      },
    });
  });

  it('应根据 verify 结果解析登录 2FA outcome 动作', () => {
    const invalidOutcome = resolveLoginTwoFactorVerifiedOutcomeAction({
      userId: 1,
      username: 'alice',
      clientIp: '127.0.0.1',
      verificationResult: { status: 'invalid' },
      skewWarnThreshold: 2,
    });
    expect(invalidOutcome).toEqual({
      kind: 'failure',
      log: {
        level: 'debug',
        message: '用户 alice 2FA 验证失败: 验证码错误。',
      },
      attemptAction: {
        kind: 'failure',
        payload: {
          userId: 1,
          username: 'alice',
          reason: 'Invalid 2FA token',
          clientIp: '127.0.0.1',
        },
      },
      response: {
        statusCode: 401,
        body: { message: '验证码无效。' },
      },
    });

    const skewOutcome = resolveLoginTwoFactorVerifiedOutcomeAction({
      userId: 1,
      username: 'alice',
      clientIp: '127.0.0.1',
      verificationResult: {
        status: 'time_skew',
        delta: 3,
        skewSeconds: 90,
      },
      skewWarnThreshold: 2,
    });
    expect(skewOutcome).toEqual({
      kind: 'failure',
      log: {
        level: 'warn',
        message:
          '[AuthController] 用户 alice 的 2FA 登录验证码存在明显时间偏差（delta=3），建议校准客户端时间。',
      },
      attemptAction: undefined,
      response: {
        statusCode: 401,
        body: {
          message: '验证码无效。检测到客户端时间与服务器存在约 90 秒偏差，请校准设备时间后重试。',
          code: 'TIME_SKEW_DETECTED',
          skewSeconds: 90,
          delta: 3,
        },
      },
    });

    const verifiedOutcome = resolveLoginTwoFactorVerifiedOutcomeAction({
      userId: 1,
      username: 'alice',
      clientIp: '127.0.0.1',
      rememberMe: true,
      verificationResult: {
        status: 'verified',
        delta: 3,
      },
      skewWarnThreshold: 2,
    });
    expect(verifiedOutcome).toEqual({
      kind: 'success',
      logs: [
        {
          level: 'warn',
          message:
            '[AuthController] 用户 alice 的 2FA 登录验证码存在明显时间偏差（delta=3），建议校准客户端时间。',
        },
        {
          level: 'info',
          message: '用户 alice 2FA 验证成功。',
        },
      ],
      attemptAction: {
        kind: 'success',
        payload: {
          userId: 1,
          username: 'alice',
          clientIp: '127.0.0.1',
          twoFactor: true,
        },
      },
      completionAction: {
        user: { id: 1, username: 'alice' },
        rememberMe: true,
        saveErrorMessage: '登录完成失败，请重试。',
      },
    });
  });

  it('应通过 attempt 执行器按 kind 分发成功/失败回调', () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    applyLoginTwoFactorAttemptAction({
      attemptAction: {
        kind: 'success',
        payload: {
          userId: 1,
          username: 'alice',
          clientIp: '127.0.0.1',
          twoFactor: true,
        },
      },
      onSuccess,
      onFailure,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();

    applyLoginTwoFactorAttemptAction({
      attemptAction: {
        kind: 'failure',
        payload: {
          userId: 1,
          username: 'alice',
          reason: 'Invalid 2FA token',
          clientIp: '127.0.0.1',
        },
      },
      onSuccess,
      onFailure,
    });
    expect(onFailure).toHaveBeenCalledTimes(1);

    applyLoginTwoFactorAttemptAction({
      onSuccess,
      onFailure,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
