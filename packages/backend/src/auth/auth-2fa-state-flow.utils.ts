import { Request } from 'express';
import { TwoFactorTokenVerificationResult } from './auth-two-factor-flow.utils';
import { setTwoFactorSessionSecret } from './auth-two-factor-session-actions.utils';

type TwoFactorFailureResponse =
  | {
      statusCode: 400;
      body: {
        message: string;
      };
    }
  | {
      statusCode: 401;
      body: {
        message: string;
      };
    }
  | {
      statusCode: 500;
      body: {
        message: string;
      };
    };

export const resolveTwoFactorSetupRequestValidation = (payload: {
  userId?: number;
  username?: string;
  requiresTwoFactor?: boolean;
  existingSecret?: string | null;
}):
  | {
      ok: true;
      actor: {
        userId: number;
        username: string;
      };
    }
  | {
      ok: false;
      failure: TwoFactorFailureResponse;
    } => {
  const { userId, username, requiresTwoFactor, existingSecret } = payload;

  if (!userId || !username || requiresTwoFactor) {
    return {
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证或认证未完成。' },
      },
    };
  }

  if (existingSecret) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '两步验证已启用。如需重置，请先禁用。' },
      },
    };
  }

  return {
    ok: true,
    actor: { userId, username },
  };
};

export const saveTwoFactorSetupSessionSecret = async (
  req: Request,
  secret: string,
): Promise<
  | { ok: true }
  | {
      ok: false;
      failure: TwoFactorFailureResponse;
    }
> => {
  setTwoFactorSessionSecret(req, secret);

  return new Promise((resolve) => {
    req.session.save((saveErr) => {
      if (saveErr) {
        resolve({
          ok: false,
          failure: {
            statusCode: 500,
            body: { message: '保存两步验证状态失败，请重试。' },
          },
        });
        return;
      }

      resolve({ ok: true });
    });
  });
};

export const resolveTwoFactorVerifyRequestValidation = (payload: {
  userId?: number;
  requiresTwoFactor?: boolean;
  effectiveSecret: string;
  normalizedToken: string;
}):
  | {
      ok: true;
      actor: {
        userId: number;
      };
    }
  | {
      ok: false;
      failure: TwoFactorFailureResponse;
    } => {
  const { userId, requiresTwoFactor, effectiveSecret, normalizedToken } = payload;

  if (!userId || requiresTwoFactor) {
    return {
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证或认证未完成。' },
      },
    };
  }

  if (!effectiveSecret) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '未找到临时密钥，请重新开始设置流程。' },
      },
    };
  }

  if (!normalizedToken) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '验证码不能为空。' },
      },
    };
  }

  if (!/^\d{6,8}$/.test(normalizedToken)) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '验证码格式无效。' },
      },
    };
  }

  return {
    ok: true,
    actor: { userId },
  };
};

export type TwoFactorVerifyFailureMapping =
  | {
      kind: 'time_skew';
      statusCode: 400;
      body: {
        message: string;
        code: 'TIME_SKEW_DETECTED';
        skewSeconds: number;
        delta: number;
      };
    }
  | {
      kind: 'invalid';
      statusCode: 400;
      body: {
        message: '验证码无效。';
      };
    };

export const mapTwoFactorVerifyFailure = (
  verificationResult: TwoFactorTokenVerificationResult,
): TwoFactorVerifyFailureMapping | null => {
  if (verificationResult.status === 'verified') {
    return null;
  }

  if (verificationResult.status === 'time_skew') {
    return {
      kind: 'time_skew',
      statusCode: 400,
      body: {
        message: `验证码无效。检测到客户端时间与服务器存在约 ${verificationResult.skewSeconds} 秒偏差，请校准设备时间后重试。`,
        code: 'TIME_SKEW_DETECTED',
        skewSeconds: verificationResult.skewSeconds,
        delta: verificationResult.delta,
      },
    };
  }

  return {
    kind: 'invalid',
    statusCode: 400,
    body: { message: '验证码无效。' },
  };
};
