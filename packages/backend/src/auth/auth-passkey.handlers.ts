/**
 * 认证控制器 - Passkey 处理器子模块
 * 职责：Passkey 注册、认证、管理的 HTTP 请求处理
 */
import { Request, Response, NextFunction } from 'express';
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';
import { getSingleHeaderToken } from '../utils/url';
import { authFailuresTotal } from '../metrics/metrics.service';
import { passkeyService } from '../passkey/passkey.service';
import { passkeyRepository } from '../passkey/passkey.repository';
import { userRepository } from '../user/user.repository';
import { ErrorCode } from '../types/error.types';
import {
  type ChallengeData as _ChallengeData,
  persistPasskeyChallengeSession,
  resolvePasskeyAuthenticationContext,
  resolvePasskeyCredentialId,
  resolvePasskeyRegistrationContext,
} from './auth-passkey-flow.utils';
import {
  resolvePasskeyAuthenticatedActor,
  resolvePasskeyCredentialId as resolvePasskeyManagementCredentialId,
  resolvePasskeyTrimmedName,
} from './auth-passkey-management-flow.utils';
import {
  buildDeletePasskeyResultAction,
  buildListPasskeysSuccessAction,
  buildUpdatePasskeyNameSuccessAction,
  resolveDeletePasskeyErrorAction,
  resolveUpdatePasskeyNameErrorAction,
} from './auth-passkey-management-actions.utils';
import {
  clearPasskeyAuthenticationChallengeSession,
  clearPasskeyRegistrationSession,
  resolvePasskeyAuthenticationVerificationOutcome,
  resolvePasskeyRegistrationVerificationOutcome,
} from './auth-passkey-register-auth-flow.utils';
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
import {
  completePasskeyAuthenticatedSession,
  recordPasskeyAuthenticationFailure,
  recordPasskeyAuthenticationSuccess,
} from './auth-passkey-2fa-flow.utils';
import { resolveRequestClientIp as _resolveRequestClientIp } from './auth-main-flow.utils';
import { applyAuthSideEffects } from './auth-side-effects-executor.utils';
import eventService, { AppEventType } from '../services/event.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditLogService } from '../audit/audit.service';

const notificationService = new NotificationService();
const auditLogService = new AuditLogService();
const authSideEffectServices = { auditLogService, notificationService };

const getPasskeyRequestOrigin = (req: Request): string | undefined => {
  const originHeader = getSingleHeaderToken(
    typeof req.get === 'function' ? req.get('Origin') : undefined,
  );
  if (originHeader) return originHeader;

  const host = getSingleHeaderToken(typeof req.get === 'function' ? req.get('Host') : undefined);
  const protocol = req.protocol;
  if (!host || !protocol) return undefined;
  return `${protocol}://${host}`;
};

/**
 * 生成 Passkey 注册选项 (POST /api/v1/auth/passkey/registration-options)
 */
export const generatePasskeyRegistrationOptionsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username) {
    res.status(401).json({ success: false, error: '用户未认证。', code: ErrorCode.UNAUTHORIZED });
    return;
  }

  try {
    const requestOrigin = getPasskeyRequestOrigin(req);
    const options = await passkeyService.generateRegistrationOptions(
      username,
      userId,
      requestOrigin,
    );

    await persistPasskeyChallengeSession(req, {
      challenge: options.challenge,
      origin: requestOrigin,
      userHandle: userId.toString(),
    });

    const optionsLogAction = buildPasskeyRegistrationOptionsGeneratedDebugLogAction(username);
    logger[optionsLogAction.level](optionsLogAction.message);
    res.json(options);
  } catch (error: unknown) {
    const optionsErrorLogAction = buildPasskeyRegistrationOptionsErrorLogAction(username);
    logger[optionsErrorLogAction.level](optionsErrorLogAction.message, error);
    next(error);
  }
};

/**
 * 验证并保存新的 Passkey (POST /api/v1/auth/passkey/register)
 */
export const verifyPasskeyRegistrationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const registrationContext = resolvePasskeyRegistrationContext({
    req,
    registrationResponse: req.body,
    fallbackOrigin: getPasskeyRequestOrigin(req),
  });
  if (!registrationContext.ok) {
    if (registrationContext.failure.body.message === '注册质询已过期，请重新开始注册流程。') {
      clearPasskeyRegistrationSession(req);
    }
    res.status(registrationContext.failure.statusCode).json(registrationContext.failure.body);
    return;
  }

  try {
    const verification = await passkeyService.verifyRegistration(
      registrationContext.registrationResponse as Parameters<
        typeof passkeyService.verifyRegistration
      >[0],
      registrationContext.expectedChallenge,
      registrationContext.userHandle,
      registrationContext.requestOrigin,
    );
    const verificationResult = resolvePasskeyRegistrationVerificationOutcome(verification);

    if (verificationResult.status === 'verified') {
      await passkeyRepository.createPasskey(verificationResult.newPasskeyToSave);
      const userIdNum = parseInt(registrationContext.userHandle, 10);
      const registrationSuccessLogAction = buildPasskeyRegistrationSuccessInfoLogAction({
        userHandle: registrationContext.userHandle,
        credentialId: verificationResult.newPasskeyToSave.credential_id,
      });
      logger[registrationSuccessLogAction.level](registrationSuccessLogAction.message);
      auditLogService.logAction('PASSKEY_REGISTERED', {
        userId: userIdNum,
        credentialId: verificationResult.newPasskeyToSave.credential_id,
      });
      notificationService.sendNotification('PASSKEY_REGISTERED', {
        userId: userIdNum,
        username: req.session.username,
        credentialId: verificationResult.newPasskeyToSave.credential_id,
      });
      eventService.emitEvent(AppEventType.PasskeyRegistered, {
        userId: userIdNum,
        details: {
          username: req.session.username,
          credentialId: verificationResult.newPasskeyToSave.credential_id,
        },
      });

      clearPasskeyRegistrationSession(req);
      res.status(201).json({ verified: true, message: 'Passkey 注册成功。' });
    } else {
      const verificationFailedLogAction = buildPasskeyRegistrationVerificationFailedWarnLogAction(
        registrationContext.userHandle,
      );
      logger[verificationFailedLogAction.level](verificationFailedLogAction.message, verification);
      res.status(400).json(verificationResult.responseBody);
    }
  } catch (error: unknown) {
    const verificationErrorLogAction = buildPasskeyRegistrationVerificationErrorLogAction(
      registrationContext.userHandle,
    );
    logger[verificationErrorLogAction.level](verificationErrorLogAction.message, error);
    next(error);
  }
};

/**
 * 生成 Passkey 认证选项 (POST /api/v1/auth/passkey/authentication-options)
 */
export const generatePasskeyAuthenticationOptionsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { username } = req.body;

  try {
    const requestOrigin = getPasskeyRequestOrigin(req);
    const options = await passkeyService.generateAuthenticationOptions(username, requestOrigin);

    await persistPasskeyChallengeSession(req, {
      challenge: options.challenge,
      origin: requestOrigin,
      clearUserHandle: true,
    });

    const optionsLogAction = buildPasskeyAuthenticationOptionsGeneratedDebugLogAction(
      username || 'any',
    );
    logger[optionsLogAction.level](optionsLogAction.message);
    res.json(options);
  } catch (error: unknown) {
    const optionsErrorLogAction = buildPasskeyAuthenticationOptionsErrorLogAction(
      username || 'any',
    );
    logger[optionsErrorLogAction.level](optionsErrorLogAction.message, error);
    next(error);
  }
};

/**
 * 验证 Passkey 凭据并登录用户 (POST /api/v1/auth/passkey/authenticate)
 */
export const verifyPasskeyAuthenticationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { assertionResponse, rememberMe } = req.body;
  const authenticationContext = resolvePasskeyAuthenticationContext({
    req,
    assertionResponse,
    fallbackOrigin: getPasskeyRequestOrigin(req),
  });
  if (!authenticationContext.ok) {
    if (authenticationContext.failure.body.message === '认证质询已过期，请重新开始认证流程。') {
      clearPasskeyAuthenticationChallengeSession(req);
    }
    res.status(authenticationContext.failure.statusCode).json(authenticationContext.failure.body);
    return;
  }

  try {
    const verification = await passkeyService.verifyAuthentication(
      authenticationContext.authenticationResponseJSON as Parameters<
        typeof passkeyService.verifyAuthentication
      >[0],
      authenticationContext.expectedChallenge,
      authenticationContext.requestOrigin,
    );
    const verificationResult = resolvePasskeyAuthenticationVerificationOutcome(verification);

    if (verificationResult.status === 'verified') {
      const user = await userRepository.findUserById(verificationResult.userId);
      if (!user) {
        const missingUserLogAction =
          buildPasskeyAuthenticationUserNotFoundAfterVerifiedErrorLogAction(
            verificationResult.userId,
          );
        logger[missingUserLogAction.level](missingUserLogAction.message);
        recordPasskeyAuthenticationFailure(
          { auditLogService, notificationService },
          {
            req,
            credentialId: verificationResult.passkey.credential_id,
            reason: 'User not found after verification',
          },
        );
        authFailuresTotal.inc({ method: 'passkey' });
        eventService.emitEvent(AppEventType.PasskeyAuthFailure, {
          details: { reason: 'Passkey authentication failed' },
        });
        res.status(401).json({ verified: false, message: 'Passkey 认证失败：用户数据错误。' });
        return;
      }

      const authenticationSuccessLogAction = buildPasskeyAuthenticationSuccessInfoLogAction({
        username: user.username,
        userId: user.id,
        passkeyId: verificationResult.passkey.id,
      });
      logger[authenticationSuccessLogAction.level](authenticationSuccessLogAction.message);
      recordPasskeyAuthenticationSuccess(
        { auditLogService, notificationService },
        {
          req,
          userId: user.id,
          username: user.username,
          credentialId: verificationResult.passkey.credential_id,
        },
      );
      eventService.emitEvent(AppEventType.PasskeyAuthSuccess, {
        userId: user.id,
        details: { username: user.username },
      });
      completePasskeyAuthenticatedSession(req, res, {
        user: { id: user.id, username: user.username },
        rememberMe,
      });
    } else {
      const verificationFailedLogAction =
        buildPasskeyAuthenticationVerificationFailedWarnLogAction();
      logger[verificationFailedLogAction.level](verificationFailedLogAction.message, verification);
      recordPasskeyAuthenticationFailure(
        { auditLogService, notificationService },
        {
          req,
          credentialId:
            resolvePasskeyCredentialId(authenticationContext.authenticationResponseJSON) ||
            'unknown',
          reason: 'Verification failed',
        },
      );
      authFailuresTotal.inc({ method: 'passkey' });
      eventService.emitEvent(AppEventType.PasskeyAuthFailure, {
        details: { reason: 'Passkey authentication failed' },
      });
      res.status(401).json(verificationResult.responseBody);
    }
  } catch (error: unknown) {
    const verificationErrorLogAction = buildPasskeyAuthenticationVerificationErrorLogAction();
    logger[verificationErrorLogAction.level](verificationErrorLogAction.message, error);
    recordPasskeyAuthenticationFailure(
      { auditLogService, notificationService },
      {
        req,
        credentialId:
          resolvePasskeyCredentialId(authenticationContext.authenticationResponseJSON) || 'unknown',
        reason: getErrorMessage(error) || 'Unknown error',
      },
    );
    eventService.emitEvent(AppEventType.PasskeyAuthFailure, {
      details: { reason: 'Passkey authentication failed' },
    });
    next(error);
  }
};

/**
 * 获取当前认证用户的所有 Passkey (GET /api/v1/user/passkeys)
 */
export const listUserPasskeysHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const actorResult = resolvePasskeyAuthenticatedActor(req);
  if (!actorResult.ok) {
    res.status(actorResult.failure.statusCode).json(actorResult.failure.body);
    return;
  }
  const { userId, username } = actorResult.actor;

  try {
    const passkeys = await passkeyService.listPasskeysByUserId(userId);
    const listAction = buildListPasskeysSuccessAction({ userId, username }, passkeys);
    logger[listAction.log.level](listAction.log.message);
    res.status(listAction.response.statusCode).json(listAction.response.body);
  } catch (error: unknown) {
    const listErrorLogAction = buildPasskeyListErrorLogAction({ userId, username });
    logger[listErrorLogAction.level](listErrorLogAction.message, error);
    next(error);
  }
};

/**
 * 删除当前认证用户指定的 Passkey (DELETE /api/v1/user/passkeys/:credentialID)
 */
export const deleteUserPasskeyHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const actorResult = resolvePasskeyAuthenticatedActor(req);
  if (!actorResult.ok) {
    res.status(actorResult.failure.statusCode).json(actorResult.failure.body);
    return;
  }
  const { userId, username } = actorResult.actor;

  const credentialResult = resolvePasskeyManagementCredentialId(req.params.credentialID);
  if (!credentialResult.ok) {
    res.status(credentialResult.failure.statusCode).json(credentialResult.failure.body);
    return;
  }
  const { credentialId } = credentialResult;

  try {
    const wasDeleted = await passkeyService.deletePasskey(userId, credentialId);
    const deleteAction = buildDeletePasskeyResultAction(
      { userId, username },
      credentialId,
      wasDeleted,
    );
    logger[deleteAction.log.level](deleteAction.log.message);
    applyAuthSideEffects(authSideEffectServices, deleteAction.sideEffects);
    res.status(deleteAction.response.statusCode).json(deleteAction.response.body);
  } catch (error: unknown) {
    const deleteErrorAction = resolveDeletePasskeyErrorAction(
      { userId, username },
      credentialId,
      error,
    );
    logger[deleteErrorAction.log.level](
      deleteErrorAction.log.message,
      deleteErrorAction.log.errorMessage,
      deleteErrorAction.log.errorStack,
    );
    if (!deleteErrorAction.handled) {
      next(error);
      return;
    }
    applyAuthSideEffects(authSideEffectServices, deleteErrorAction.sideEffects);
    res.status(deleteErrorAction.response.statusCode).json(deleteErrorAction.response.body);
  }
};

/**
 * 更新当前认证用户指定的 Passkey 名称 (PUT /api/v1/user/passkeys/:credentialID/name)
 */
export const updateUserPasskeyNameHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const actorResult = resolvePasskeyAuthenticatedActor(req);
  if (!actorResult.ok) {
    res.status(actorResult.failure.statusCode).json(actorResult.failure.body);
    return;
  }
  const { userId, username } = actorResult.actor;

  const credentialResult = resolvePasskeyManagementCredentialId(req.params.credentialID);
  if (!credentialResult.ok) {
    res.status(credentialResult.failure.statusCode).json(credentialResult.failure.body);
    return;
  }
  const { credentialId } = credentialResult;

  const nameResult = resolvePasskeyTrimmedName(req.body?.name);
  if (!nameResult.ok) {
    res.status(nameResult.failure.statusCode).json(nameResult.failure.body);
    return;
  }
  const { trimmedName } = nameResult;

  try {
    await passkeyService.updatePasskeyName(userId, credentialId, trimmedName);
    const updateAction = buildUpdatePasskeyNameSuccessAction(
      { userId, username },
      credentialId,
      trimmedName,
    );
    logger[updateAction.log.level](updateAction.log.message);
    applyAuthSideEffects(authSideEffectServices, updateAction.sideEffects);
    res.status(updateAction.response.statusCode).json(updateAction.response.body);
  } catch (error: unknown) {
    const updateErrorAction = resolveUpdatePasskeyNameErrorAction(
      { userId, username },
      credentialId,
      error,
    );
    logger[updateErrorAction.log.level](
      updateErrorAction.log.message,
      updateErrorAction.log.errorMessage,
      updateErrorAction.log.errorStack,
    );
    if (!updateErrorAction.handled) {
      next(error);
      return;
    }
    applyAuthSideEffects(authSideEffectServices, updateErrorAction.sideEffects);
    res.status(updateErrorAction.response.statusCode).json(updateErrorAction.response.body);
  }
};

/**
 * 检查系统中是否配置了任何 Passkey (GET /api/v1/auth/passkey/has-configured)
 */
export const checkHasPasskeys = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const username = req.query.username as string | undefined;
  try {
    const hasPasskeys = await passkeyService.hasPasskeysConfigured(username);
    res.status(200).json({ hasPasskeys });
  } catch (error: unknown) {
    const checkErrorLogAction = buildPasskeyHasConfiguredCheckErrorLogAction(username || 'any');
    logger[checkErrorLogAction.level](checkErrorLogAction.message, getErrorMessage(error));
    next(error);
  }
};
