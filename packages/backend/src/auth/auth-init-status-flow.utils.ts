import type {
  InitAuthState,
  InitAuthenticatedUser,
  PublicCaptchaConfig,
} from './auth-init-data.utils';

interface SessionAuthSnapshot {
  userId?: number;
  username?: string;
  requiresTwoFactor?: boolean;
}

export interface AuthStatusUnauthenticatedBody {
  isAuthenticated: false;
}

export interface AuthStatusAuthenticatedBody {
  isAuthenticated: true;
  user: InitAuthenticatedUser;
}

export type AuthStatusBody = AuthStatusUnauthenticatedBody | AuthStatusAuthenticatedBody;

export interface AuthStatusHttpResponse {
  statusCode: 200 | 401;
  body: AuthStatusBody;
}

export interface InitDataBaseResponse {
  needsSetup: boolean;
  isAuthenticated: boolean;
  user: InitAuthenticatedUser | null;
  captchaConfig: PublicCaptchaConfig;
  multiplexEnabled: boolean;
}

export const isAuthenticatedSessionSnapshot = (session: SessionAuthSnapshot): boolean => {
  return Boolean(session.userId && session.username && !session.requiresTwoFactor);
};

export const buildAuthStatusHttpResponse = (authState: InitAuthState): AuthStatusHttpResponse => {
  if (!authState.isAuthenticated || !authState.user) {
    return {
      statusCode: 401,
      body: { isAuthenticated: false },
    };
  }

  return {
    statusCode: 200,
    body: {
      isAuthenticated: true,
      user: authState.user,
    },
  };
};

export const buildInitDataBaseResponse = (params: {
  needsSetup: boolean;
  authState: InitAuthState;
  captchaConfig: PublicCaptchaConfig;
  multiplexEnabled?: boolean;
}): InitDataBaseResponse => {
  const { needsSetup, authState, captchaConfig, multiplexEnabled = false } = params;

  return {
    needsSetup,
    isAuthenticated: authState.isAuthenticated,
    user: authState.user,
    captchaConfig,
    multiplexEnabled,
  };
};
