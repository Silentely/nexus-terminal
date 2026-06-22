import crypto from 'crypto';
import { Request } from 'express';

export interface PendingAuth {
  tempToken: string;
  userId: number;
  username: string;
  expiresAt: number;
}

type Login2FAFailureResponse = {
  statusCode: 400 | 401;
  body: {
    message: string;
  };
};

const INVALID_PENDING_STATE_RESPONSE: Login2FAFailureResponse = {
  statusCode: 401,
  body: { message: '无效的认证状态。' },
};

const EXPIRED_PENDING_STATE_RESPONSE: Login2FAFailureResponse = {
  statusCode: 401,
  body: { message: '认证已过期，请重新登录。' },
};

const EMPTY_TOKEN_RESPONSE: Login2FAFailureResponse = {
  statusCode: 400,
  body: { message: '验证码不能为空。' },
};

const INVALID_TOKEN_FORMAT_RESPONSE: Login2FAFailureResponse = {
  statusCode: 400,
  body: { message: '验证码格式无效。' },
};

const normalizeTotpToken = (token: unknown): string => {
  if (typeof token !== 'string') {
    return '';
  }

  return token
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '')
    .trim();
};

export const createPendingLoginTwoFactorAuthState = (payload: {
  userId: number;
  username: string;
  tempTokenLength: number;
  pendingAuthTimeoutMs: number;
  now?: number;
  randomBytesFn?: (size: number) => Buffer;
}): PendingAuth => {
  const {
    userId,
    username,
    tempTokenLength,
    pendingAuthTimeoutMs,
    now = Date.now(),
    randomBytesFn = crypto.randomBytes,
  } = payload;
  const tempToken = randomBytesFn(tempTokenLength).toString('hex');

  return {
    tempToken,
    userId,
    username,
    expiresAt: now + pendingAuthTimeoutMs,
  };
};

export type LoginPendingAuthValidationResult =
  | {
      ok: true;
      pendingAuth: PendingAuth;
    }
  | {
      ok: false;
      reason: 'invalid_state' | 'expired';
      failure: Login2FAFailureResponse;
    };

export const resolveLoginPendingAuthValidation = (payload: {
  req: Request;
  tempToken: unknown;
  now?: number;
}): LoginPendingAuthValidationResult => {
  const { req, tempToken, now = Date.now() } = payload;
  const pendingAuth = req.session.pendingAuth as PendingAuth | undefined;

  // 类型守卫：tempToken 必须为字符串，拒绝非字符串输入（防止类型放宽）
  if (!pendingAuth || typeof tempToken !== 'string' || !tempToken) {
    return {
      ok: false,
      reason: 'invalid_state',
      failure: INVALID_PENDING_STATE_RESPONSE,
    };
  }

  // 使用 timingSafeEqual 防止时序攻击侧信道泄露
  const isValidToken = (() => {
    try {
      if (Buffer.byteLength(pendingAuth.tempToken) !== Buffer.byteLength(tempToken)) {
        return false;
      }
      return crypto.timingSafeEqual(Buffer.from(pendingAuth.tempToken), Buffer.from(tempToken));
    } catch {
      return false;
    }
  })();

  if (!isValidToken) {
    return {
      ok: false,
      reason: 'invalid_state',
      failure: INVALID_PENDING_STATE_RESPONSE,
    };
  }

  if (now > pendingAuth.expiresAt) {
    delete req.session.pendingAuth;
    return {
      ok: false,
      reason: 'expired',
      failure: EXPIRED_PENDING_STATE_RESPONSE,
    };
  }

  return {
    ok: true,
    pendingAuth,
  };
};

export type Login2FATokenValidationResult =
  | {
      ok: true;
      normalizedToken: string;
    }
  | {
      ok: false;
      failure: Login2FAFailureResponse;
    };

export const resolveLogin2FATokenValidation = (token: unknown): Login2FATokenValidationResult => {
  const normalizedToken = normalizeTotpToken(token);

  if (!normalizedToken) {
    return {
      ok: false,
      failure: EMPTY_TOKEN_RESPONSE,
    };
  }

  if (!/^\d{6,8}$/.test(normalizedToken)) {
    return {
      ok: false,
      failure: INVALID_TOKEN_FORMAT_RESPONSE,
    };
  }

  return {
    ok: true,
    normalizedToken,
  };
};

export type Login2FAVerificationPrecheckResult =
  | {
      ok: true;
      pendingAuth: PendingAuth;
      normalizedToken: string;
    }
  | {
      ok: false;
      reason: 'invalid_state' | 'expired' | 'empty_token' | 'invalid_token_format';
      failure: Login2FAFailureResponse;
    };

export const resolveLogin2FAVerificationPrecheck = (payload: {
  req: Request;
  tempToken: unknown;
  token: unknown;
  now?: number;
}): Login2FAVerificationPrecheckResult => {
  const pendingValidationResult = resolveLoginPendingAuthValidation({
    req: payload.req,
    tempToken: payload.tempToken,
    now: payload.now,
  });
  if (!pendingValidationResult.ok) {
    return pendingValidationResult;
  }

  const tokenValidationResult = resolveLogin2FATokenValidation(payload.token);
  if (!tokenValidationResult.ok) {
    const reason =
      tokenValidationResult.failure.body.message === '验证码不能为空。'
        ? 'empty_token'
        : 'invalid_token_format';
    return {
      ok: false,
      reason,
      failure: tokenValidationResult.failure,
    };
  }

  return {
    ok: true,
    pendingAuth: pendingValidationResult.pendingAuth,
    normalizedToken: tokenValidationResult.normalizedToken,
  };
};

export const clearPendingLoginTwoFactorAuthState = (req: Request): boolean => {
  if (typeof req.session.pendingAuth === 'undefined') {
    return false;
  }

  delete req.session.pendingAuth;
  return true;
};
