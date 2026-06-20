import type { TwoFactorTokenVerificationResult } from './auth-two-factor-flow.utils';
import {
  buildLoginTwoFactorInvalidDebugLogAction,
  buildLoginTwoFactorSkewWarnLogAction,
  buildLoginTwoFactorSkewWarnLogActionAlways,
  buildLoginTwoFactorSuccessInfoLogAction,
} from './auth-two-factor-log-actions.utils';

export type LoginTwoFactorFailureReason = 'Invalid 2FA token';

export interface LoginTwoFactorFailureAttemptPayload {
  userId: number;
  username: string;
  reason: LoginTwoFactorFailureReason;
  clientIp: string;
}

export interface LoginTwoFactorSuccessAttemptPayload {
  userId: number;
  username: string;
  clientIp: string;
  twoFactor: true;
}

export type LoginTwoFactorAttemptAction =
  | {
      kind: 'success';
      payload: LoginTwoFactorSuccessAttemptPayload;
    }
  | {
      kind: 'failure';
      payload: LoginTwoFactorFailureAttemptPayload;
    };

export interface LoginTwoFactorUserRow {
  id: number;
  username: string;
  two_factor_secret: string | null;
}

export const LOGIN_TWO_FACTOR_USER_QUERY_SQL =
  'SELECT id, username, two_factor_secret FROM users WHERE id = ?';

export const buildLoginTwoFactorUserQueryAction = (payload: {
  userId: number;
}): {
  sql: typeof LOGIN_TWO_FACTOR_USER_QUERY_SQL;
  params: [number];
} => ({
  sql: LOGIN_TWO_FACTOR_USER_QUERY_SQL,
  params: [payload.userId],
});

export type LoginTwoFactorUserLookupAction =
  | {
      ok: false;
      failureAction: ReturnType<typeof buildLoginTwoFactorMissingSecretFailureAction>;
    }
  | {
      ok: true;
      actor: {
        id: number;
        username: string;
        twoFactorSecret: string;
      };
    };

export const resolveLoginTwoFactorUserLookupAction = (payload: {
  pendingUserId: number;
  user: LoginTwoFactorUserRow | null | undefined;
}): LoginTwoFactorUserLookupAction => {
  const { pendingUserId, user } = payload;
  if (!user || !user.two_factor_secret) {
    return {
      ok: false,
      failureAction: buildLoginTwoFactorMissingSecretFailureAction({
        pendingUserId,
      }),
    };
  }

  return {
    ok: true,
    actor: {
      id: user.id,
      username: user.username,
      twoFactorSecret: user.two_factor_secret,
    },
  };
};

export type LoginTwoFactorFailureAction =
  | {
      handled: false;
    }
  | {
      handled: true;
      failureReason?: LoginTwoFactorFailureReason;
      response: {
        statusCode: 401;
        body:
          | {
              message: string;
              code: 'TIME_SKEW_DETECTED';
              skewSeconds: number;
              delta: number;
            }
          | {
              message: '验证码无效。';
            };
      };
      log: {
        level: 'warn' | 'debug';
        message: string;
      };
    };

export const resolveLoginTwoFactorFailureAction = (payload: {
  username: string;
  verificationResult: TwoFactorTokenVerificationResult;
}): LoginTwoFactorFailureAction => {
  const { username, verificationResult } = payload;

  if (verificationResult.status === 'verified') {
    return { handled: false };
  }

  if (verificationResult.status === 'time_skew') {
    return {
      handled: true,
      response: {
        statusCode: 401,
        body: {
          message: `验证码无效。检测到客户端时间与服务器存在约 ${verificationResult.skewSeconds} 秒偏差，请校准设备时间后重试。`,
          code: 'TIME_SKEW_DETECTED',
          skewSeconds: verificationResult.skewSeconds,
          delta: verificationResult.delta,
        },
      },
      log: buildLoginTwoFactorSkewWarnLogActionAlways(username, verificationResult.delta),
    };
  }

  return {
    handled: true,
    failureReason: 'Invalid 2FA token',
    response: {
      statusCode: 401,
      body: { message: '验证码无效。' },
    },
    log: buildLoginTwoFactorInvalidDebugLogAction(username),
  };
};

export const buildLoginTwoFactorSuccessLogAction = (
  username: string,
): {
  level: 'info';
  message: string;
} => buildLoginTwoFactorSuccessInfoLogAction(username);

export const buildLoginTwoFactorFailureAttemptPayload = (payload: {
  userId: number;
  username: string;
  clientIp: string;
  reason?: LoginTwoFactorFailureReason;
}): LoginTwoFactorFailureAttemptPayload => {
  const { userId, username, clientIp, reason = 'Invalid 2FA token' } = payload;

  return {
    userId,
    username,
    reason,
    clientIp,
  };
};

export const buildLoginTwoFactorSuccessAttemptAction = (payload: {
  userId: number;
  username: string;
  clientIp: string;
}): LoginTwoFactorAttemptAction => ({
  kind: 'success',
  payload: {
    userId: payload.userId,
    username: payload.username,
    clientIp: payload.clientIp,
    twoFactor: true,
  },
});

export const buildLoginTwoFactorFailureAttemptAction = (payload: {
  userId: number;
  username: string;
  clientIp: string;
  reason?: LoginTwoFactorFailureReason;
}): LoginTwoFactorAttemptAction => ({
  kind: 'failure',
  payload: buildLoginTwoFactorFailureAttemptPayload(payload),
});

export const applyLoginTwoFactorAttemptAction = (payload: {
  attemptAction?: LoginTwoFactorAttemptAction;
  onSuccess: (attempt: LoginTwoFactorSuccessAttemptPayload) => void;
  onFailure: (attempt: LoginTwoFactorFailureAttemptPayload) => void;
}): void => {
  const { attemptAction, onSuccess, onFailure } = payload;
  if (!attemptAction) {
    return;
  }

  if (attemptAction.kind === 'success') {
    onSuccess(attemptAction.payload);
    return;
  }

  onFailure(attemptAction.payload);
};

export interface LoginTwoFactorDebugLogAction {
  level: 'debug';
  message: string;
}

export const buildLoginTwoFactorDiagnosticsLogActions = (payload: {
  hasPendingAuth: boolean;
  hasTempToken: boolean;
  forwardedProto?: string;
}): LoginTwoFactorDebugLogAction[] => {
  const { hasPendingAuth, hasTempToken, forwardedProto } = payload;

  return [
    {
      level: 'debug',
      message: `[AuthController] verifyLogin2FA - Has pendingAuth: ${hasPendingAuth}`,
    },
    {
      level: 'debug',
      message: `[AuthController] verifyLogin2FA - Has tempToken: ${hasTempToken}`,
    },
    {
      level: 'debug',
      message: `[AuthController] verifyLogin2FA - X-Forwarded-Proto: ${forwardedProto ?? ''}`,
    },
  ];
};

export const buildLoginTwoFactorPendingValidationFailedDebugLogAction = (payload: {
  hasPendingAuth: boolean;
  hasTempToken: boolean;
}): LoginTwoFactorDebugLogAction => ({
  level: 'debug',
  message: `[AuthController] verifyLogin2FA - FAILED: pendingAuth=${payload.hasPendingAuth}, tempToken=${payload.hasTempToken}`,
});

export const buildLoginTwoFactorMissingSecretFailureAction = (payload: {
  pendingUserId: number;
}): {
  response: {
    statusCode: 400;
    body: {
      message: '无法验证，请重新登录。';
    };
  };
  log: {
    level: 'error';
    message: string;
  };
} => ({
  response: {
    statusCode: 400,
    body: { message: '无法验证，请重新登录。' },
  },
  log: {
    level: 'error',
    message: `2FA 验证错误: 未找到用户 ${payload.pendingUserId} 或未设置密钥。`,
  },
});

export const buildLoginTwoFactorSessionCompletionAction = (payload: {
  user: {
    id: number;
    username: string;
  };
  rememberMe?: boolean;
}): {
  user: {
    id: number;
    username: string;
  };
  rememberMe?: boolean;
  saveErrorMessage: string;
} => ({
  user: payload.user,
  rememberMe: payload.rememberMe,
  saveErrorMessage: '登录完成失败，请重试。',
});

export const buildLoginTwoFactorFallbackFailureResponseAction = (): {
  statusCode: 401;
  body: {
    message: '验证码无效。';
  };
} => ({
  statusCode: 401,
  body: { message: '验证码无效。' },
});

type LoginTwoFactorHandledFailureResponse = Extract<
  LoginTwoFactorFailureAction,
  { handled: true }
>['response'];

export type LoginTwoFactorVerifiedOutcomeAction =
  | {
      kind: 'failure';
      log?: {
        level: 'warn' | 'debug';
        message: string;
      };
      attemptAction?: LoginTwoFactorAttemptAction;
      response:
        | LoginTwoFactorHandledFailureResponse
        | ReturnType<typeof buildLoginTwoFactorFallbackFailureResponseAction>;
    }
  | {
      kind: 'success';
      logs: Array<{
        level: 'warn' | 'info';
        message: string;
      }>;
      attemptAction: LoginTwoFactorAttemptAction;
      completionAction: ReturnType<typeof buildLoginTwoFactorSessionCompletionAction>;
    };

export const resolveLoginTwoFactorVerifiedOutcomeAction = (payload: {
  userId: number;
  username: string;
  clientIp: string;
  rememberMe?: boolean;
  verificationResult: TwoFactorTokenVerificationResult;
  skewWarnThreshold: number;
}): LoginTwoFactorVerifiedOutcomeAction => {
  const { userId, username, clientIp, rememberMe, verificationResult, skewWarnThreshold } = payload;

  const verifyFailureAction = resolveLoginTwoFactorFailureAction({
    username,
    verificationResult,
  });
  if (verifyFailureAction.handled) {
    return {
      kind: 'failure',
      log: verifyFailureAction.log,
      attemptAction: verifyFailureAction.failureReason
        ? buildLoginTwoFactorFailureAttemptAction({
            userId,
            username,
            clientIp,
            reason: verifyFailureAction.failureReason,
          })
        : undefined,
      response: verifyFailureAction.response,
    };
  }

  if (verificationResult.status === 'verified') {
    const logs: Array<{ level: 'warn' | 'info'; message: string }> = [];
    const skewWarnLogAction = buildLoginTwoFactorSkewWarnLogAction({
      username,
      delta: verificationResult.delta,
      skewWarnThreshold,
    });
    if (skewWarnLogAction) {
      logs.push(skewWarnLogAction);
    }
    logs.push(buildLoginTwoFactorSuccessLogAction(username));

    return {
      kind: 'success',
      logs,
      attemptAction: buildLoginTwoFactorSuccessAttemptAction({
        userId,
        username,
        clientIp,
      }),
      completionAction: buildLoginTwoFactorSessionCompletionAction({
        user: { id: userId, username },
        rememberMe,
      }),
    };
  }

  return {
    kind: 'failure',
    response: buildLoginTwoFactorFallbackFailureResponseAction(),
  };
};
