/**
 * 认证控制器 - 登录与初始化处理器子模块
 * 职责：用户登录、认证状态查询、初始设置、登出、CAPTCHA 配置
 */
import { Request, Response, NextFunction } from 'express';
import { getErrorMessage } from '../utils/AppError';
import { getDbInstance, getDb, runDb } from '../database/connection';
import { comparePassword, hashPassword } from '../utils/crypto';
import { NotificationService } from '../notifications/notification.service';
import { AuditLogService } from '../audit/audit.service';
import { ipBlacklistService } from './ip-blacklist.service';
import { captchaService } from './captcha.service';
import { settingsService } from '../settings/settings.service';
import { isMultiplexEnabled } from '../websocket/multiplex';
import { SECURITY_CONFIG } from '../config/security.config';
import { ErrorCode } from '../types/error.types';
import {
  resolveRequiresSetup,
  toPublicCaptchaConfig,
  resolveInitAuthState,
} from './auth-init-data.utils';
import {
  completeAuthenticatedSession,
  recordLoginFailureAttempt,
  recordLoginSuccessAttempt,
  resolveRequestClientIp,
  startPendingTwoFactorSession,
  destroySessionAndRespondLogout,
} from './auth-main-flow.utils';
import {
  clearPendingLoginTwoFactorAuthState,
  createPendingLoginTwoFactorAuthState,
  type PendingAuth,
  resolveLogin2FAVerificationPrecheck,
} from './auth-login-2fa-flow.utils';
import {
  buildAuthStatusHttpResponse,
  buildInitDataBaseResponse,
  isAuthenticatedSessionSnapshot,
} from './auth-init-status-flow.utils';
import {
  buildInsertAdminUserMutationAction,
  buildLoginUserByUsernameQueryAction,
  buildUsersCountQueryAction,
  buildUserTwoFactorSecretByIdQueryAction,
} from './auth-controller-sql.utils';
import {
  applyLoginTwoFactorAttemptAction,
  buildLoginTwoFactorDiagnosticsLogActions,
  buildLoginTwoFactorPendingValidationFailedDebugLogAction,
  buildLoginTwoFactorUserQueryAction,
  type LoginTwoFactorUserRow,
  resolveLoginTwoFactorUserLookupAction,
  resolveLoginTwoFactorVerifiedOutcomeAction,
} from './auth-login-two-factor-actions.utils';
import {
  buildLoginCaptchaInvalidDebugLogAction,
  buildLoginCaptchaSkippedDebugLogAction,
  buildLoginCaptchaVerificationErrorLogAction,
  buildLoginCaptchaVerifiedDebugLogAction,
  buildLoginInternalErrorLogAction,
  buildLoginInvalidPasswordDebugLogAction,
  buildLoginSuccessWithoutTwoFactorInfoLogAction,
  buildLoginTwoFactorRequiredDebugLogAction,
  buildLoginUserNotFoundDebugLogAction,
} from './auth-login-log-actions.utils';
import { verifyTwoFactorTokenWithSkew } from './auth-two-factor-flow.utils';
import { lookupGeoInfo } from './ip-geo.service';
import eventService, { AppEventType } from '../services/event.service';
import { logger } from '../utils/logger';

// 开发环境标志
const isDev = process.env.NODE_ENV !== 'production';

const notificationService = new NotificationService();
const auditLogService = new AuditLogService();

const getRequestHeaderValue = (req: Request, name: string): string | undefined => {
  const headerFromGetter = typeof req.get === 'function' ? req.get(name) : undefined;
  if (typeof headerFromGetter === 'string') {
    return headerFromGetter;
  }

  const requestHeaders = (
    req as unknown as {
      headers?: Record<string, string | string[] | undefined>;
    }
  ).headers;
  if (!requestHeaders) {
    return undefined;
  }

  const rawHeader = requestHeaders[name.toLowerCase()];
  if (Array.isArray(rawHeader)) {
    return rawHeader[0];
  }

  return typeof rawHeader === 'string' ? rawHeader : undefined;
};

export interface User {
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
 * 处理用户登录请求 (POST /api/v1/auth/login)
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { username, password, rememberMe } = req.body;

  if (!username || !password) {
    res
      .status(400)
      .json({ success: false, error: '用户名和密码不能为空。', code: ErrorCode.VALIDATION_ERROR });
    return;
  }

  try {
    // CAPTCHA 验证
    const captchaConfig = await settingsService.getCaptchaConfig();
    if (captchaConfig.enabled) {
      const { captchaToken } = req.body;
      if (!captchaToken) {
        res.status(400).json({
          success: false,
          error: '需要提供 CAPTCHA 令牌。',
          code: ErrorCode.CAPTCHA_REQUIRED,
        });
        return;
      }
      try {
        const isCaptchaValid = await captchaService.verifyToken(captchaToken);
        if (!isCaptchaValid) {
          const captchaInvalidLogAction = buildLoginCaptchaInvalidDebugLogAction(username);
          logger[captchaInvalidLogAction.level](captchaInvalidLogAction.message);
          const clientIp = resolveRequestClientIp(req);
          recordLoginFailureAttempt(
            { ipBlacklistService, auditLogService, notificationService },
            { username, reason: 'Invalid CAPTCHA token', clientIp },
          );
          eventService.emitEvent(AppEventType.LoginFailure, {
            details: { username, reason: 'Invalid CAPTCHA token', clientIp },
          });
          res
            .status(401)
            .json({ success: false, error: 'CAPTCHA 验证失败。', code: ErrorCode.CAPTCHA_INVALID });
          return;
        }
        const captchaVerifiedLogAction = buildLoginCaptchaVerifiedDebugLogAction(username);
        logger[captchaVerifiedLogAction.level](captchaVerifiedLogAction.message);
      } catch (captchaError: unknown) {
        const captchaErrorLogAction = buildLoginCaptchaVerificationErrorLogAction(username);
        logger[captchaErrorLogAction.level](
          captchaErrorLogAction.message,
          getErrorMessage(captchaError),
        );
        res.status(500).json({
          success: false,
          error: 'CAPTCHA 验证服务出错，请稍后重试或检查配置。',
          code: ErrorCode.CAPTCHA_SERVICE_ERROR,
        });
        return;
      }
    } else {
      const captchaSkippedLogAction = buildLoginCaptchaSkippedDebugLogAction(username);
      logger[captchaSkippedLogAction.level](captchaSkippedLogAction.message);
    }

    const db = await getDbInstance();
    const userQueryAction = buildLoginUserByUsernameQueryAction({ username });
    const user = await getDb<User>(db, userQueryAction.sql, userQueryAction.params);

    if (!user) {
      const userNotFoundLogAction = buildLoginUserNotFoundDebugLogAction(username);
      logger[userNotFoundLogAction.level](userNotFoundLogAction.message);
      const clientIp = resolveRequestClientIp(req);
      recordLoginFailureAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        { username, reason: 'User not found', clientIp },
      );
      eventService.emitEvent(AppEventType.LoginFailure, {
        details: { username, reason: 'User not found', clientIp },
      });
      res
        .status(401)
        .json({ success: false, error: '无效的凭据。', code: ErrorCode.INVALID_CREDENTIALS });
      return;
    }

    const isMatch = await comparePassword(password, user.hashed_password);

    if (!isMatch) {
      const passwordInvalidLogAction = buildLoginInvalidPasswordDebugLogAction(username);
      logger[passwordInvalidLogAction.level](passwordInvalidLogAction.message);
      const clientIp = resolveRequestClientIp(req);
      recordLoginFailureAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        { username, reason: 'Invalid password', clientIp },
      );
      eventService.emitEvent(AppEventType.LoginFailure, {
        details: { username, reason: 'Invalid password', clientIp },
      });
      res
        .status(401)
        .json({ success: false, error: '无效的凭据。', code: ErrorCode.INVALID_CREDENTIALS });
      return;
    }

    // 检查是否启用了 2FA
    if (user.two_factor_secret) {
      const twoFactorRequiredLogAction = buildLoginTwoFactorRequiredDebugLogAction(username);
      logger[twoFactorRequiredLogAction.level](twoFactorRequiredLogAction.message);
      const pendingAuth = createPendingLoginTwoFactorAuthState({
        userId: user.id,
        username: user.username,
        tempTokenLength: SECURITY_CONFIG.TEMP_TOKEN_LENGTH,
        pendingAuthTimeoutMs: SECURITY_CONFIG.PENDING_AUTH_TIMEOUT,
      });
      startPendingTwoFactorSession(req, res, { pendingAuth, rememberMe, isDev });
    } else {
      const loginSuccessLogAction = buildLoginSuccessWithoutTwoFactorInfoLogAction(username);
      logger[loginSuccessLogAction.level](loginSuccessLogAction.message);
      const clientIp = resolveRequestClientIp(req);
      recordLoginSuccessAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        { userId: user.id, username, clientIp },
      );
      completeAuthenticatedSession(req, res, {
        user: { id: user.id, username: user.username },
        rememberMe,
        saveErrorMessage: '登录过程中发生错误，请重试。',
      });
      eventService.emitEvent(AppEventType.LoginSuccess, {
        userId: user.id,
        details: { username: user.username, clientIp },
      });
    }
  } catch (error: unknown) {
    const loginErrorLogAction = buildLoginInternalErrorLogAction();
    logger[loginErrorLogAction.level](loginErrorLogAction.message, error);
    next(error);
  }
};

/**
 * 获取当前用户的认证状态 (GET /api/v1/auth/status)
 */
export const getAuthStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!isAuthenticatedSessionSnapshot(req.session)) {
    res.status(401).json({ isAuthenticated: false });
    return;
  }
  const authenticatedUserId = userId as number;
  const authenticatedUsername = username as string;

  try {
    const db = await getDbInstance();
    const userQueryAction = buildUserTwoFactorSecretByIdQueryAction({
      userId: authenticatedUserId,
    });
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      userQueryAction.sql,
      userQueryAction.params,
    );

    const authState = user
      ? {
          isAuthenticated: true,
          user: {
            id: authenticatedUserId,
            username: authenticatedUsername,
            isTwoFactorEnabled: !!user.two_factor_secret,
          },
        }
      : {
          isAuthenticated: false,
          user: null,
        };
    const response = buildAuthStatusHttpResponse(authState);
    res.status(response.statusCode).json(response.body);
  } catch (error: unknown) {
    logger.error(`获取用户 ${authenticatedUserId} 状态时发生内部错误:`, error);
    next(error);
  }
};

/**
 * 处理登录时的 2FA 验证 (POST /api/v1/auth/login/2fa)
 */
export const verifyLogin2FA = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token, tempToken } = req.body;
  const pendingAuthState = req.session.pendingAuth as PendingAuth | undefined;
  const loginTwoFactorSideEffectServices = {
    ipBlacklistService,
    auditLogService,
    notificationService,
  };

  if (isDev) {
    const diagnosticsLogActions = buildLoginTwoFactorDiagnosticsLogActions({
      hasPendingAuth: !!pendingAuthState,
      hasTempToken: !!tempToken,
      forwardedProto: getRequestHeaderValue(req, 'X-Forwarded-Proto'),
    });
    for (const logAction of diagnosticsLogActions) {
      logger[logAction.level](logAction.message);
    }
  }

  const verificationPrecheckAction = resolveLogin2FAVerificationPrecheck({
    req,
    tempToken,
    token,
  });
  if (!verificationPrecheckAction.ok) {
    if (isDev && !pendingAuthState) {
      const failedDebugLogAction = buildLoginTwoFactorPendingValidationFailedDebugLogAction({
        hasPendingAuth: !!pendingAuthState,
        hasTempToken: !!tempToken,
      });
      logger[failedDebugLogAction.level](failedDebugLogAction.message);
    }
    res
      .status(verificationPrecheckAction.failure.statusCode)
      .json(verificationPrecheckAction.failure.body);
    return;
  }
  const { pendingAuth: verifiedPendingAuth, normalizedToken } = verificationPrecheckAction;

  try {
    const db = await getDbInstance();
    const userQueryAction = buildLoginTwoFactorUserQueryAction({
      userId: verifiedPendingAuth.userId,
    });
    const user = await getDb<LoginTwoFactorUserRow>(
      db,
      userQueryAction.sql,
      userQueryAction.params,
    );
    const userLookupAction = resolveLoginTwoFactorUserLookupAction({
      pendingUserId: verifiedPendingAuth.userId,
      user,
    });
    if (!userLookupAction.ok) {
      logger[userLookupAction.failureAction.log.level](userLookupAction.failureAction.log.message);
      res
        .status(userLookupAction.failureAction.response.statusCode)
        .json(userLookupAction.failureAction.response.body);
      return;
    }

    const { actor } = userLookupAction;
    const verificationResult = verifyTwoFactorTokenWithSkew({
      secret: actor.twoFactorSecret,
      token: normalizedToken,
      verifyWindow: TOTP_VERIFY_WINDOW,
      skewDetectWindow: TOTP_SKEW_DETECT_WINDOW,
      skewWarnThreshold: TOTP_SKEW_WARN_THRESHOLD,
    });
    const verificationOutcomeAction = resolveLoginTwoFactorVerifiedOutcomeAction({
      userId: actor.id,
      username: actor.username,
      clientIp: resolveRequestClientIp(req),
      rememberMe: req.session.rememberMe,
      verificationResult,
      skewWarnThreshold: TOTP_SKEW_WARN_THRESHOLD,
    });
    if (verificationOutcomeAction.kind === 'failure') {
      if (verificationOutcomeAction.log) {
        logger[verificationOutcomeAction.log.level](verificationOutcomeAction.log.message);
      }
      applyLoginTwoFactorAttemptAction({
        attemptAction: verificationOutcomeAction.attemptAction,
        onSuccess: () => undefined,
        onFailure: (attempt) =>
          recordLoginFailureAttempt(loginTwoFactorSideEffectServices, {
            ...attempt,
            method: '2fa',
          }),
      });
      eventService.emitEvent(AppEventType.LoginFailure, {
        details: {
          username: verifiedPendingAuth.username,
          reason: 'Invalid 2FA code',
          clientIp: resolveRequestClientIp(req),
        },
      });
      res
        .status(verificationOutcomeAction.response.statusCode)
        .json(verificationOutcomeAction.response.body);
      return;
    }

    for (const logAction of verificationOutcomeAction.logs) {
      logger[logAction.level](logAction.message);
    }
    applyLoginTwoFactorAttemptAction({
      attemptAction: verificationOutcomeAction.attemptAction,
      onSuccess: (attempt) => recordLoginSuccessAttempt(loginTwoFactorSideEffectServices, attempt),
      onFailure: () => undefined,
    });
    clearPendingLoginTwoFactorAuthState(req);
    completeAuthenticatedSession(req, res, verificationOutcomeAction.completionAction);
    eventService.emitEvent(AppEventType.LoginSuccess, {
      userId: verifiedPendingAuth.userId,
      details: {
        username: verifiedPendingAuth.username,
        clientIp: resolveRequestClientIp(req),
        method: '2fa',
      },
    });
  } catch (error: unknown) {
    logger.error(
      `2FA 验证时发生内部错误 (用户: ${verifiedPendingAuth?.userId || 'unknown'}):`,
      error,
    );
    next(error);
  }
};

/**
 * 检查是否需要进行初始设置 (GET /api/v1/auth/needs-setup)
 */
export const needsSetup = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const db = await getDbInstance();
    const countQueryAction = buildUsersCountQueryAction();
    const row = await getDb<{ count: number }>(db, countQueryAction.sql);
    const userCount = row ? row.count : 0;

    res.status(200).json({ needsSetup: userCount === 0 });
  } catch (error: unknown) {
    logger.error('检查设置状态时发生内部错误:', error);
    next(error);
  }
};

/**
 * 处理初始账号设置请求 (POST /api/v1/auth/setup)
 */
export const setupAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { username, password, confirmPassword } = req.body;

  if (!username || !password || !confirmPassword) {
    res.status(400).json({
      success: false,
      error: '用户名、密码和确认密码不能为空。',
      code: ErrorCode.VALIDATION_ERROR,
    });
    return;
  }
  // Codex 审查：类型收敛，防止非字符串输入导致 500
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    typeof confirmPassword !== 'string'
  ) {
    res.status(400).json({
      success: false,
      error: '用户名、密码和确认密码必须是字符串类型。',
      code: ErrorCode.VALIDATION_ERROR,
    });
    return;
  }
  // M-28: 用户名长度与格式验证
  if (username.length < 3 || username.length > 64) {
    res.status(400).json({
      success: false,
      error: '用户名长度必须在 3 到 64 个字符之间。',
      code: ErrorCode.VALIDATION_ERROR,
    });
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    res.status(400).json({
      success: false,
      error: '用户名只能包含字母、数字、下划线和连字符。',
      code: ErrorCode.VALIDATION_ERROR,
    });
    return;
  }
  if (password !== confirmPassword) {
    res
      .status(400)
      .json({ success: false, error: '两次输入的密码不匹配。', code: ErrorCode.PASSWORD_MISMATCH });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({
      success: false,
      error: '密码长度至少需要 8 位。',
      code: ErrorCode.PASSWORD_TOO_SHORT,
    });
    return;
  }
  // M-28: 密码复杂度验证（至少包含字母和数字）
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    res.status(400).json({
      success: false,
      error: '密码必须同时包含字母和数字。',
      code: ErrorCode.VALIDATION_ERROR,
    });
    return;
  }

  try {
    const db = await getDbInstance();
    const countQueryAction = buildUsersCountQueryAction();
    const row = await getDb<{ count: number }>(db, countQueryAction.sql);
    const userCount = row ? row.count : 0;

    if (userCount > 0) {
      logger.warn('尝试在已有用户的情况下执行初始设置。');
      res.status(403).json({
        success: false,
        error: '设置已完成，无法重复执行。',
        code: ErrorCode.SETUP_ALREADY_COMPLETE,
      });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const insertAction = buildInsertAdminUserMutationAction({
      username,
      hashedPassword,
    });
    const result = await runDb(db, insertAction.sql, insertAction.params);

    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      logger.error('创建初始账号后未能获取有效的 lastID。可能原因：用户名已存在或其他数据库错误。');
      throw new Error('创建初始账号失败，可能用户名已存在。');
    }
    const newUser = { id: result.lastID };

    logger.info(`初始账号 '${username}' (ID: ${newUser.id}) 已成功创建。`);
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const setupPayload: Record<string, unknown> = {
      userId: newUser.id,
      username,
      ip: clientIp,
    };
    void lookupGeoInfo(clientIp)
      .then((geoInfo) => {
        if (geoInfo) setupPayload.geoInfo = geoInfo;
      })
      .finally(() => {
        auditLogService.logAction('ADMIN_SETUP_COMPLETE', setupPayload);
        notificationService.sendNotification('ADMIN_SETUP_COMPLETE', setupPayload);
      });

    res.status(201).json({ message: '初始账号创建成功！' });
  } catch (error: unknown) {
    logger.error('初始设置过程中发生内部错误:', error);
    next(error);
  }
};

/**
 * 处理用户登出请求 (POST /api/v1/auth/logout)
 */
export const logout = (req: Request, res: Response): void => {
  const { userId } = req.session;
  const { username } = req.session;
  destroySessionAndRespondLogout(req, res, {
    userId,
    username,
    onLogoutSuccess: (clientIp) => {
      const logoutPayload: Record<string, unknown> = { userId, username, ip: clientIp };
      void lookupGeoInfo(clientIp)
        .then((geoInfo) => {
          if (geoInfo) logoutPayload.geoInfo = geoInfo;
        })
        .finally(() => {
          auditLogService.logAction('LOGOUT', logoutPayload);
          notificationService.sendNotification('LOGOUT', logoutPayload);
        });
      if (userId != null) {
        eventService.emitEvent(AppEventType.Logout, {
          userId: userId as number,
          details: { username: username as string },
        });
      }
    },
  });
};

/**
 * 获取公共 CAPTCHA 配置 (GET /api/v1/auth/captcha/config)
 */
export const getPublicCaptchaConfig = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    logger.debug('[AuthController] Received request for public CAPTCHA config.');
    const fullConfig = await settingsService.getCaptchaConfig();
    const publicConfig = toPublicCaptchaConfig(fullConfig);

    logger.debug('[AuthController] Sending public CAPTCHA config to client:', publicConfig);
    res.status(200).json(publicConfig);
  } catch (error: unknown) {
    logger.error('[AuthController] 获取公共 CAPTCHA 配置时出错:', error);
    next(error);
  }
};

/**
 * 统一初始化端点 (GET /api/v1/auth/init)
 */
export const getInitData = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const db = await getDbInstance();

    const requiresSetup = await resolveRequiresSetup(db);
    const authState = await resolveInitAuthState(db, req.session);
    const fullCaptchaConfig = await settingsService.getCaptchaConfig();
    const captchaConfig = toPublicCaptchaConfig(fullCaptchaConfig);

    res.status(200).json(
      buildInitDataBaseResponse({
        needsSetup: requiresSetup,
        authState,
        captchaConfig,
        multiplexEnabled: isMultiplexEnabled(),
      }),
    );

    logger.debug(
      `[AuthController] 初始化数据已发送: needsSetup=${requiresSetup}, isAuthenticated=${authState.isAuthenticated}`,
    );
  } catch (error: unknown) {
    logger.error('[AuthController] 获取初始化数据时出错:', error);
    next(error);
  }
};
