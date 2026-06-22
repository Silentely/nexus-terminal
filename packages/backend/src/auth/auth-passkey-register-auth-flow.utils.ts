import { Request } from 'express';
import {
  mapPasskeyAuthenticationVerificationResult,
  mapPasskeyRegistrationVerificationResult,
  type PasskeyAuthenticationVerificationResult,
  type PasskeyRegistrationVerificationResult,
} from './auth-passkey-flow.utils';

export const resolvePasskeyRegistrationVerificationOutcome = (
  verification: unknown,
): PasskeyRegistrationVerificationResult => mapPasskeyRegistrationVerificationResult(verification);

export const resolvePasskeyAuthenticationVerificationOutcome = (
  verification: unknown,
): PasskeyAuthenticationVerificationResult =>
  mapPasskeyAuthenticationVerificationResult(verification);

export const clearPasskeyRegistrationSession = (req: Request): void => {
  delete req.session.currentChallenge;
  delete req.session.passkeyUserHandle;
};

export const clearPasskeyAuthenticationChallengeSession = (req: Request): void => {
  delete req.session.currentChallenge;
};
