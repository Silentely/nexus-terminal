import { Request } from 'express';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { syncTwoFactorSessionSecret } from './auth-two-factor-session-actions.utils';

export interface SetupPayload {
  secret: string;
  qrCodeUrl: string;
}

const buildTwoFactorOtpAuthUrl = (username: string, secret: string): string =>
  speakeasy.otpauthURL({
    secret,
    encoding: 'base32',
    label: `NexusTerminal (${username})`,
    issuer: 'NexusTerminal',
  });

export const buildTwoFactorSetupPayload = async (
  username: string,
  secret: string,
): Promise<SetupPayload> => {
  const qrCodeUrl = await qrcode.toDataURL(buildTwoFactorOtpAuthUrl(username, secret));
  return { secret, qrCodeUrl };
};

export const createTwoFactorSecret = (username: string): string => {
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `NexusTerminal (${username})`,
  });
  return secret.base32;
};

export interface TwoFactorEffectiveSecretResult {
  effectiveSecret: string;
  secretProvidedByBody: boolean;
  sessionSecretMismatched: boolean;
}

export const resolveTwoFactorEffectiveSecret = (payload: {
  req: Request;
  tempSecret: string;
  providedSecret: string;
}): TwoFactorEffectiveSecretResult => {
  const { req, tempSecret, providedSecret } = payload;
  const effectiveSecret = providedSecret || tempSecret;
  const secretProvidedByBody = Boolean(providedSecret);
  const sessionSecretMismatched =
    Boolean(providedSecret) && Boolean(tempSecret) && providedSecret !== tempSecret;

  if (providedSecret) {
    syncTwoFactorSessionSecret({ req, secret: providedSecret });
  }

  return {
    effectiveSecret,
    secretProvidedByBody,
    sessionSecretMismatched,
  };
};

export type TwoFactorTokenVerificationResult =
  | {
      status: 'verified';
      delta: number;
    }
  | {
      status: 'time_skew';
      delta: number;
      skewSeconds: number;
    }
  | {
      status: 'invalid';
    };

export const verifyTwoFactorTokenWithSkew = (payload: {
  secret: string;
  token: string;
  verifyWindow: number;
  skewDetectWindow: number;
  skewWarnThreshold: number;
}): TwoFactorTokenVerificationResult => {
  const { secret, token, verifyWindow, skewDetectWindow, skewWarnThreshold } = payload;

  const verificationDelta = speakeasy.totp.verifyDelta({
    secret,
    encoding: 'base32',
    token,
    window: verifyWindow,
  });
  if (verificationDelta !== undefined) {
    return {
      status: 'verified',
      delta: verificationDelta.delta ?? 0,
    };
  }

  const relaxedDelta = speakeasy.totp.verifyDelta({
    secret,
    encoding: 'base32',
    token,
    window: skewDetectWindow,
  });
  if (relaxedDelta && Math.abs(relaxedDelta.delta) >= skewWarnThreshold) {
    return {
      status: 'time_skew',
      delta: relaxedDelta.delta,
      skewSeconds: Math.abs(relaxedDelta.delta) * 30,
    };
  }

  return { status: 'invalid' };
};
