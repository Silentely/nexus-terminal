/**
 * 认证控制器 - 2FA 与密码管理处理器子模块
 * 职责：2FA 设置/验证/禁用、修改密码
 */
import { Request, Response, NextFunction } from 'express';
import { getDbInstance, getDb, runDb } from '../database/connection';
import { hashPassword, comparePassword } from '../utils/crypto';
import { NotificationService } from '../notifications/notification.service';
import { AuditLogService } from '../audit/audit.service';
import { ErrorCode as _ErrorCode } from '../types/error.types';
import {
  resolveTwoFactorEffectiveSecret,
  verifyTwoFactorTokenWithSkew,
} from './auth-two-factor-flow.utils';
import {
  resolveTwoFactorSetupRequestValidation,
  resolveTwoFactorVerifyRequestValidation,
} from './auth-2fa-state-flow.utils';
import {
  resolveChangePasswordAccessValidation,
  resolveChangePasswordInputValidation,
  resolveCurrentPasswordMatchValidation,
  resolveDisable2FAAccessValidation,
  resolveDisable2FAInputValidation,
  resolveMutationChangesValidation,
  resolvePasswordActionUserValidation,
} from './auth-password-disable2fa-flow.utils';
import {
  buildChangePasswordSuccessAction,
  buildDisableTwoFactorSuccessAction,
} from './auth-password-security-actions.utils';
import {
  buildDisableTwoFactorMutation,
  resolveTwoFactorMutationChangesValidation,
} from './auth-2fa-mutation-flow.utils';
import { executeTwoFactorSetupAction } from './auth-two-factor-setup-actions.utils';
import { applyAuthSideEffects } from './auth-side-effects-executor.utils';
import { resolveTwoFactorVerifyFailureAction } from './auth-two-factor-verify-failure-actions.utils';
import {
  buildTwoFactorVerifySessionMismatchWarnLogAction,
  buildTwoFactorVerifySessionSyncedDebugLogAction,
  buildTwoFactorVerifySkewWarnLogAction,
} from './auth-two-factor-log-actions.utils';
import {
  buildTwoFactorVerifySuccessMutationAction,
  resolveTwoFactorVerifySuccessMutationResultAction,
} from './auth-two-factor-verify-success-actions.utils';
import { clearTwoFactorSessionSecret } from './auth-two-factor-session-actions.utils';
import {
  buildUpdateUserPasswordMutationAction,
  buildUserPasswordByIdQueryAction,
  buildUserTwoFactorSecretByIdQueryAction,
} from './auth-controller-sql.utils';
import { resolveRequestClientIp } from './auth-main-flow.utils';
import eventService, { AppEventType } from '../services/event.service';
import { logger } from '../utils/logger';

const notificationService = new NotificationService();
const auditLogService = new AuditLogService();
const authSideEffectServices = { auditLogService, notificationService };

interface User {
  id: number;
  username: string;
  hashed_password: string;
  two_factor_secret?: string | null;
}

// 安全收紧：仅允许 ±30 秒时间窗口
const TOTP_VERIFY_WINDOW = 1;
const TOTP_SKEW_DETECT_WINDOW = 20;
const TOTP_SKEW_WARN_THRESHOLD = 2;

/**
 * 规范化 TOTP 验证码输入
 */
const normalizeTotpToken = (token: unknown): string => {
  if (typeof token !== 'string') return '';
  return token
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '')
    .trim();
};

const normalizeBase32Secret = (secret: unknown): string => {
  if (typeof secret !== 'string') return '';
  return secret.replace(/[\s-]/g, '').trim().toUpperCase();
};

/**
 * 开始 2FA 设置流程 (POST /api/v1/auth/2fa/setup)
 */
export const setup2FA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  try {
    const db = await getDbInstance();
    const userQueryAction = buildUserTwoFactorSecretByIdQueryAction({ userId });
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      userQueryAction.sql,
      userQueryAction.params,
    );
    const existingSecret = user ? user.two_factor_secret : null;
    const setupValidation = resolveTwoFactorSetupRequestValidation({
      userId,
      username,
      requiresTwoFactor: req.session.requiresTwoFactor,
      existingSecret,
    });
    if (!setupValidation.ok) {
      res.status(setupValidation.failure.statusCode).json(setupValidation.failure.body);
      return;
    }
    const { userId: validatedUserId, username: validatedUsername } = setupValidation.actor;

    const setupAction = await executeTwoFactorSetupAction({
      req,
      userId: validatedUserId,
      username: validatedUsername,
    });
    logger[setupAction.log.level](setupAction.log.message);
    if (!setupAction.ok) {
      res.status(setupAction.failure.statusCode).json(setupAction.failure.body);
      return;
    }

    res.status(setupAction.response.statusCode).json(setupAction.response.body);
  } catch (error: unknown) {
    logger.error(`用户 ${userId} 设置 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 验证并激活 2FA (POST /api/v1/auth/2fa/verify)
 */
export const verifyAndActivate2FA = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, secret: secretFromBody } = req.body as { token?: unknown; secret?: unknown };
  const { userId } = req.session;
  const tempSecret = normalizeBase32Secret(req.session.tempTwoFactorSecret);
  const providedSecret = normalizeBase32Secret(secretFromBody);
  const normalizedToken = normalizeTotpToken(token);

  const { effectiveSecret, secretProvidedByBody, sessionSecretMismatched } =
    resolveTwoFactorEffectiveSecret({
      req,
      tempSecret,
      providedSecret,
    });
  const verifyValidation = resolveTwoFactorVerifyRequestValidation({
    userId,
    requiresTwoFactor: req.session.requiresTwoFactor,
    effectiveSecret,
    normalizedToken,
  });
  if (!verifyValidation.ok) {
    res.status(verifyValidation.failure.statusCode).json(verifyValidation.failure.body);
    return;
  }
  const { userId: validatedUserId } = verifyValidation.actor;

  try {
    if (sessionSecretMismatched) {
      const mismatchLogAction = buildTwoFactorVerifySessionMismatchWarnLogAction(validatedUserId);
      logger[mismatchLogAction.level](mismatchLogAction.message);
    }

    if (secretProvidedByBody && sessionSecretMismatched) {
      const syncedLogAction = buildTwoFactorVerifySessionSyncedDebugLogAction(validatedUserId);
      logger[syncedLogAction.level](syncedLogAction.message);
    }

    const db = await getDbInstance();
    const verificationResult = verifyTwoFactorTokenWithSkew({
      secret: effectiveSecret,
      token: normalizedToken,
      verifyWindow: TOTP_VERIFY_WINDOW,
      skewDetectWindow: TOTP_SKEW_DETECT_WINDOW,
      skewWarnThreshold: TOTP_SKEW_WARN_THRESHOLD,
    });

    const verifyFailureAction = resolveTwoFactorVerifyFailureAction({
      userId: validatedUserId,
      verificationResult,
    });
    if (verifyFailureAction.handled) {
      logger[verifyFailureAction.log.level](verifyFailureAction.log.message);
      res.status(verifyFailureAction.response.statusCode).json(verifyFailureAction.response.body);
      return;
    }

    if (verificationResult.status === 'verified') {
      const skewWarnLogAction = buildTwoFactorVerifySkewWarnLogAction({
        userId: validatedUserId,
        delta: verificationResult.delta,
        skewWarnThreshold: TOTP_SKEW_WARN_THRESHOLD,
      });
      if (skewWarnLogAction) {
        logger[skewWarnLogAction.level](skewWarnLogAction.message);
      }

      const mutationAction = buildTwoFactorVerifySuccessMutationAction({
        secret: effectiveSecret,
        userId: validatedUserId,
      });
      const result = await runDb(db, mutationAction.sql, mutationAction.params);
      const successMutationAction = resolveTwoFactorVerifySuccessMutationResultAction({
        changes: result.changes,
        userId: validatedUserId,
        clientIp: resolveRequestClientIp(req),
      });
      if (!successMutationAction.ok) {
        logger[successMutationAction.log.level](successMutationAction.log.message);
        throw successMutationAction.error;
      }

      const successAction = successMutationAction.successAction;
      logger[successAction.log.level](successAction.log.message);
      applyAuthSideEffects(authSideEffectServices, successAction.sideEffects);
      eventService.emitEvent(AppEventType.TwoFactorEnabled, {
        userId: validatedUserId,
        details: { username: req.session.username },
      });

      clearTwoFactorSessionSecret(req);

      res.status(successAction.response.statusCode).json(successAction.response.body);
      return;
    }
  } catch (error: unknown) {
    logger.error(`用户 ${validatedUserId} 验证并激活 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 禁用 2FA (DELETE /api/v1/auth/2fa)
 */
export const disable2FA = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const accessValidation = resolveDisable2FAAccessValidation({
    userId: req.session.userId,
    requiresTwoFactor: req.session.requiresTwoFactor,
  });
  if (!accessValidation.ok) {
    res.status(accessValidation.failure.statusCode).json(accessValidation.failure.body);
    return;
  }

  const inputValidation = resolveDisable2FAInputValidation({
    password: req.body?.password,
  });
  if (!inputValidation.ok) {
    res.status(inputValidation.failure.statusCode).json(inputValidation.failure.body);
    return;
  }
  const { userId } = accessValidation.actor;
  const { password } = inputValidation.input;

  try {
    const db = await getDbInstance();
    const userQueryAction = buildUserPasswordByIdQueryAction({ userId });
    const user = await getDb<User>(db, userQueryAction.sql, userQueryAction.params);

    const userValidation = resolvePasswordActionUserValidation({ user });
    if (!userValidation.ok) {
      res.status(userValidation.failure.statusCode).json(userValidation.failure.body);
      return;
    }
    const isMatch = await comparePassword(password, userValidation.user.hashed_password);
    const matchValidation = resolveCurrentPasswordMatchValidation({ isMatch });
    if (!matchValidation.ok) {
      res.status(matchValidation.failure.statusCode).json(matchValidation.failure.body);
      return;
    }

    const disableMutation = buildDisableTwoFactorMutation({
      userId,
    });
    const result = await runDb(db, disableMutation.sql, disableMutation.params);

    const changeValidation = resolveTwoFactorMutationChangesValidation({ changes: result.changes });
    if (!changeValidation.ok) {
      logger.error(`禁用 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw changeValidation.error;
    }

    const clientIp = resolveRequestClientIp(req);
    const successAction = buildDisableTwoFactorSuccessAction({ userId, clientIp });
    logger[successAction.log.level](successAction.log.message);
    applyAuthSideEffects(authSideEffectServices, successAction.sideEffects);
    eventService.emitEvent(AppEventType.TwoFactorDisabled, {
      userId,
      details: { username: req.session.username },
    });

    clearTwoFactorSessionSecret(req);

    res.status(successAction.response.statusCode).json(successAction.response.body);
  } catch (error: unknown) {
    logger.error(`用户 ${userId} 禁用 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 处理修改密码请求 (PUT /api/v1/auth/password)
 */
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const accessValidation = resolveChangePasswordAccessValidation({
    userId: req.session.userId,
    requiresTwoFactor: req.session.requiresTwoFactor,
  });
  if (!accessValidation.ok) {
    res.status(accessValidation.failure.statusCode).json(accessValidation.failure.body);
    return;
  }

  const inputValidation = resolveChangePasswordInputValidation({
    currentPassword: req.body?.currentPassword,
    newPassword: req.body?.newPassword,
  });
  if (!inputValidation.ok) {
    res.status(inputValidation.failure.statusCode).json(inputValidation.failure.body);
    return;
  }
  const { userId } = accessValidation.actor;
  const { currentPassword, newPassword } = inputValidation.input;

  try {
    const db = await getDbInstance();
    const userQueryAction = buildUserPasswordByIdQueryAction({ userId });
    const user = await getDb<User>(db, userQueryAction.sql, userQueryAction.params);

    const userValidation = resolvePasswordActionUserValidation({ user });
    if (!userValidation.ok) {
      logger.error(`修改密码错误: 未找到 ID 为 ${userId} 的用户。`);
      res.status(userValidation.failure.statusCode).json(userValidation.failure.body);
      return;
    }

    const isMatch = await comparePassword(currentPassword, userValidation.user.hashed_password);
    const matchValidation = resolveCurrentPasswordMatchValidation({ isMatch });
    if (!matchValidation.ok) {
      logger.debug(`修改密码尝试失败: 当前密码错误 - 用户 ID ${userId}`);
      res.status(matchValidation.failure.statusCode).json(matchValidation.failure.body);
      return;
    }

    const newHashedPassword = await hashPassword(newPassword);
    const passwordMutationAction = buildUpdateUserPasswordMutationAction({
      hashedPassword: newHashedPassword,
      userId,
    });
    const result = await runDb(db, passwordMutationAction.sql, passwordMutationAction.params);

    const changeValidation = resolveMutationChangesValidation({ changes: result.changes });
    if (!changeValidation.ok) {
      logger.error(`修改密码错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw changeValidation.error;
    }

    const clientIp = resolveRequestClientIp(req);
    const successAction = buildChangePasswordSuccessAction({ userId, clientIp });
    logger[successAction.log.level](successAction.log.message);
    applyAuthSideEffects(authSideEffectServices, successAction.sideEffects);
    eventService.emitEvent(AppEventType.PasswordChanged, {
      userId,
      details: { username: req.session.username },
    });
    res.status(successAction.response.statusCode).json(successAction.response.body);
  } catch (error: unknown) {
    logger.error(`修改用户 ${userId} 密码时发生内部错误:`, error);
    next(error);
  }
};
