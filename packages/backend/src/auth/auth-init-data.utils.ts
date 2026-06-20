import { Database } from 'sqlite3';
import { getDb } from '../database/connection';
import { CaptchaSettings } from '../types/settings.types';

export interface InitAuthenticatedUser {
  id: number;
  username: string;
  isTwoFactorEnabled: boolean;
}

interface InitSessionSnapshot {
  userId?: number;
  username?: string;
  requiresTwoFactor?: boolean;
}

export interface InitAuthState {
  isAuthenticated: boolean;
  user: InitAuthenticatedUser | null;
}

export interface PublicCaptchaConfig {
  enabled: boolean;
  provider: CaptchaSettings['provider'];
  hcaptchaSiteKey?: string;
  recaptchaSiteKey?: string;
}

export const toPublicCaptchaConfig = (config: CaptchaSettings): PublicCaptchaConfig => {
  return {
    enabled: config.enabled,
    provider: config.provider,
    hcaptchaSiteKey: config.hcaptchaSiteKey,
    recaptchaSiteKey: config.recaptchaSiteKey,
  };
};

export const resolveRequiresSetup = async (db: Database): Promise<boolean> => {
  const userCountRow = await getDb<{ count: number }>(db, 'SELECT COUNT(*) as count FROM users');
  return userCountRow ? userCountRow.count === 0 : true;
};

export const resolveInitAuthState = async (
  db: Database,
  session: InitSessionSnapshot,
): Promise<InitAuthState> => {
  const { userId, username, requiresTwoFactor } = session;
  if (!userId || !username || requiresTwoFactor) {
    return {
      isAuthenticated: false,
      user: null,
    };
  }

  const userRow = await getDb<{ two_factor_secret: string | null }>(
    db,
    'SELECT two_factor_secret FROM users WHERE id = ?',
    [userId],
  );

  if (!userRow) {
    return {
      isAuthenticated: false,
      user: null,
    };
  }

  return {
    isAuthenticated: true,
    user: {
      id: userId,
      username,
      isTwoFactorEnabled: !!userRow.two_factor_secret,
    },
  };
};
