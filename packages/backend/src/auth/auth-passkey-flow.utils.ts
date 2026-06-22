import { Request } from 'express';
import { SECURITY_CONFIG } from '../config/security.config';
import { NewPasskey } from '../passkey/passkey.repository';

export interface ChallengeData {
  challenge: string;
  timestamp: number;
  origin?: string;
}

interface HandlerFailure {
  statusCode: 400;
  body: {
    message: string;
  };
}

type PasskeyRegistrationVerificationLike = {
  verified?: unknown;
  newPasskeyToSave?: unknown;
  error?: unknown;
};

type PasskeyAuthenticationVerificationLike = {
  verified?: unknown;
  userId?: unknown;
  passkey?: unknown;
};

const saveSession = async (req: Request): Promise<void> =>
  new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

const toVerificationErrorMessage = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return undefined;
  }

  const { error } = value as { error?: unknown };
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined;
  }

  const { message } = error as { message?: unknown };
  return typeof message === 'string' ? message : undefined;
};

const isExpiredChallenge = (
  challengeData: ChallengeData,
  now: number,
  timeoutMs: number,
): boolean => now - challengeData.timestamp > timeoutMs;

export const persistPasskeyChallengeSession = async (
  req: Request,
  payload: {
    challenge: string;
    origin?: string;
    userHandle?: string;
    clearUserHandle?: boolean;
    now?: number;
  },
): Promise<void> => {
  req.session.currentChallenge = {
    challenge: payload.challenge,
    timestamp: payload.now ?? Date.now(),
    origin: payload.origin,
  };

  if (payload.clearUserHandle) {
    delete req.session.passkeyUserHandle;
  } else if (payload.userHandle) {
    req.session.passkeyUserHandle = payload.userHandle;
  }

  await saveSession(req);
};

export type PasskeyRegistrationContextResult =
  | {
      ok: true;
      registrationResponse: unknown;
      expectedChallenge: string;
      requestOrigin?: string;
      userHandle: string;
    }
  | {
      ok: false;
      failure: HandlerFailure;
    };

export const resolvePasskeyRegistrationContext = (payload: {
  req: Request;
  registrationResponse: unknown;
  fallbackOrigin?: string;
  now?: number;
  challengeTimeoutMs?: number;
}): PasskeyRegistrationContextResult => {
  const {
    req,
    registrationResponse,
    fallbackOrigin,
    now = Date.now(),
    challengeTimeoutMs = SECURITY_CONFIG.CHALLENGE_TIMEOUT,
  } = payload;
  const challengeData = req.session.currentChallenge;
  const userHandle = req.session.passkeyUserHandle;

  if (!registrationResponse) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '注册响应不能为空。' },
      },
    };
  }

  if (!challengeData) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '会话中未找到质询信息，请重试注册流程。' },
      },
    };
  }

  if (!userHandle) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '会话中未找到用户句柄，请重试注册流程。' },
      },
    };
  }

  if (isExpiredChallenge(challengeData, now, challengeTimeoutMs)) {
    delete req.session.currentChallenge;
    delete req.session.passkeyUserHandle;
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '注册质询已过期，请重新开始注册流程。' },
      },
    };
  }

  return {
    ok: true,
    registrationResponse,
    expectedChallenge: challengeData.challenge,
    requestOrigin: challengeData.origin || fallbackOrigin,
    userHandle,
  };
};

export type PasskeyAuthenticationContextResult =
  | {
      ok: true;
      authenticationResponseJSON: unknown;
      expectedChallenge: string;
      requestOrigin?: string;
    }
  | {
      ok: false;
      failure: HandlerFailure;
    };

export const resolvePasskeyAuthenticationContext = (payload: {
  req: Request;
  assertionResponse: unknown;
  fallbackOrigin?: string;
  now?: number;
  challengeTimeoutMs?: number;
}): PasskeyAuthenticationContextResult => {
  const {
    req,
    assertionResponse,
    fallbackOrigin,
    now = Date.now(),
    challengeTimeoutMs = SECURITY_CONFIG.CHALLENGE_TIMEOUT,
  } = payload;
  const challengeData = req.session.currentChallenge;

  if (!assertionResponse) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '认证响应 (assertionResponse) 不能为空。' },
      },
    };
  }

  if (!challengeData) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '会话中未找到质询信息，请重试认证流程。' },
      },
    };
  }

  if (isExpiredChallenge(challengeData, now, challengeTimeoutMs)) {
    delete req.session.currentChallenge;
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '认证质询已过期，请重新开始认证流程。' },
      },
    };
  }

  return {
    ok: true,
    authenticationResponseJSON: assertionResponse,
    expectedChallenge: challengeData.challenge,
    requestOrigin: challengeData.origin || fallbackOrigin,
  };
};

export type PasskeyRegistrationVerificationResult =
  | {
      status: 'verified';
      newPasskeyToSave: NewPasskey;
    }
  | {
      status: 'failed';
      responseBody: {
        verified: false;
        message: 'Passkey 注册验证失败。';
        error: string;
      };
    };

const asNewPasskey = (value: unknown): NewPasskey | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const candidate = value as Partial<NewPasskey>;
  if (
    typeof candidate.user_id !== 'number' ||
    typeof candidate.credential_id !== 'string' ||
    typeof candidate.public_key !== 'string' ||
    typeof candidate.counter !== 'number'
  ) {
    return undefined;
  }

  return {
    user_id: candidate.user_id,
    credential_id: candidate.credential_id,
    public_key: candidate.public_key,
    counter: candidate.counter,
    transports: candidate.transports,
    name: candidate.name,
    backed_up: candidate.backed_up,
  };
};

export const mapPasskeyRegistrationVerificationResult = (
  verification: unknown,
): PasskeyRegistrationVerificationResult => {
  const value = verification as PasskeyRegistrationVerificationLike;
  const newPasskeyToSave = asNewPasskey(value?.newPasskeyToSave);

  if (value?.verified === true && newPasskeyToSave) {
    return {
      status: 'verified',
      newPasskeyToSave,
    };
  }

  return {
    status: 'failed',
    responseBody: {
      verified: false,
      message: 'Passkey 注册验证失败。',
      error: toVerificationErrorMessage(verification) || 'Unknown verification error',
    },
  };
};

export type PasskeyAuthenticationVerificationResult =
  | {
      status: 'verified';
      userId: number;
      passkey: {
        id: number;
        credential_id: string;
      };
    }
  | {
      status: 'failed';
      responseBody: {
        verified: false;
        message: 'Passkey 认证失败。';
      };
    };

const asPasskey = (
  value: unknown,
):
  | {
      id: number;
      credential_id: string;
    }
  | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const candidate = value as {
    id?: unknown;
    credential_id?: unknown;
  };
  if (typeof candidate.id !== 'number' || typeof candidate.credential_id !== 'string') {
    return undefined;
  }

  return {
    id: candidate.id,
    credential_id: candidate.credential_id,
  };
};

export const mapPasskeyAuthenticationVerificationResult = (
  verification: unknown,
): PasskeyAuthenticationVerificationResult => {
  const value = verification as PasskeyAuthenticationVerificationLike;
  const userId = typeof value?.userId === 'number' ? value.userId : undefined;
  const passkey = asPasskey(value?.passkey);

  if (value?.verified === true && userId !== undefined && passkey) {
    return {
      status: 'verified',
      userId,
      passkey,
    };
  }

  return {
    status: 'failed',
    responseBody: {
      verified: false,
      message: 'Passkey 认证失败。',
    },
  };
};

export const resolvePasskeyCredentialId = (assertionResponse: unknown): string | undefined => {
  if (typeof assertionResponse !== 'object' || assertionResponse === null) {
    return undefined;
  }

  const { id } = assertionResponse as { id?: unknown };
  return typeof id === 'string' ? id : undefined;
};
