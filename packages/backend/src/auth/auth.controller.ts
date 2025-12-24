import { Request, Response, NextFunction } from 'express';
import { ErrorFactory } from '../utils/AppError';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import { hashPassword, comparePassword } from '../utils/crypto';
import { NotificationService } from '../notifications/notification.service';
import { AuditLogService } from '../audit/audit.service';
import { ipBlacklistService } from './ip-blacklist.service';
import { captchaService } from './captcha.service';
import { settingsService } from '../settings/settings.service';
import { passkeyService } from '../passkey/passkey.service'; // +++ Passkey Service
import { passkeyRepository } from '../passkey/passkey.repository'; // +++ Passkey Repository
import { userRepository } from '../user/user.repository'; // For passkey auth success
import { SECURITY_CONFIG } from '../config/security.config';

const notificationService = new NotificationService();
const auditLogService = new AuditLogService();

export interface User {
  id: number;
  username: string;
  hashed_password: string;
  two_factor_secret?: string | null;
}

// +++ Challenge Data with Timestamp for Replay Attack Prevention
interface ChallengeData {
  challenge: string;
  timestamp: number;
}

// +++ Pending Authentication for 2FA Bypass Prevention
interface PendingAuth {
  tempToken: string;
  userId: number;
  username: string;
  expiresAt: number;
}

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    tempTwoFactorSecret?: string;
    requiresTwoFactor?: boolean;
    currentChallenge?: ChallengeData; // +++ Modified: Now stores challenge with timestamp
    passkeyUserHandle?: string; // +++ For Passkey user handle (user ID as string)
    rememberMe?: boolean;
    pendingAuth?: PendingAuth; // +++ For 2FA temporary authentication token
  }
}

// --- Passkey Controller Methods ---

/**
 * 生成 Passkey 注册选项 (POST /api/v1/auth/passkey/registration-options)
 */
export const generatePasskeyRegistrationOptionsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  try {
    // PasskeyService's generateRegistrationOptions expects userId as number
    const options = await passkeyService.generateRegistrationOptions(username, userId);

    // +++ Store challenge with timestamp for replay attack prevention
    req.session.currentChallenge = {
      challenge: options.challenge,
      timestamp: Date.now(),
    };
    // The user.id from options is a Uint8Array. We need to store the original string userId for userHandle.
    req.session.passkeyUserHandle = userId.toString();

    console.log(`[AuthController] Generated Passkey registration options for user ${username}`);
    res.json(options);
  } catch (error) {
    console.error(`[AuthController] 生成 Passkey 注册选项时出错 (用户: ${username}):`, error);
    next(error);
  }
};

/**
 * 验证并保存新的 Passkey (POST /api/v1/auth/passkey/register)
 */
export const verifyPasskeyRegistrationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const registrationResponse = req.body; // The whole body is the response from @simplewebauthn/browser
  const challengeData = req.session.currentChallenge;
  const userHandle = req.session.passkeyUserHandle;

  if (!registrationResponse) {
    res.status(400).json({ message: '注册响应不能为空。' });
    return;
  }
  if (!challengeData) {
    res.status(400).json({ message: '会话中未找到质询信息，请重试注册流程。' });
    return;
  }
  if (!userHandle) {
    res.status(400).json({ message: '会话中未找到用户句柄，请重试注册流程。' });
    return;
  }

  // +++ Verify challenge timestamp (5 minutes validity)
  if (Date.now() - challengeData.timestamp > SECURITY_CONFIG.CHALLENGE_TIMEOUT) {
    delete req.session.currentChallenge;
    delete req.session.passkeyUserHandle;
    res.status(400).json({ message: '注册质询已过期，请重新开始注册流程。' });
    return;
  }

  const expectedChallenge = challengeData.challenge;

  try {
    const verification = await passkeyService.verifyRegistration(
      registrationResponse,
      expectedChallenge,
      userHandle // userHandle is userId as string
    );

    if (verification.verified && verification.newPasskeyToSave) {
      await passkeyRepository.createPasskey(verification.newPasskeyToSave);
      const userIdNum = parseInt(userHandle, 10);
      console.log(
        `[AuthController] 用户 ${userHandle} 的 Passkey 注册成功并已保存。 CredentialID: ${verification.newPasskeyToSave.credential_id.substring(0, 8)}***`
      );
      auditLogService.logAction('PASSKEY_REGISTERED', {
        userId: userIdNum,
        credentialId: verification.newPasskeyToSave.credential_id,
      });
      notificationService.sendNotification('PASSKEY_REGISTERED', {
        userId: userIdNum,
        username: req.session.username,
        credentialId: verification.newPasskeyToSave.credential_id,
      });

      delete req.session.currentChallenge;
      delete req.session.passkeyUserHandle;
      res.status(201).json({ verified: true, message: 'Passkey 注册成功。' });
    } else {
      console.warn(`[AuthController] Passkey 注册验证失败 (用户: ${userHandle}):`, verification);
      res.status(400).json({
        verified: false,
        message: 'Passkey 注册验证失败。',
        error: (verification as any).error?.message || 'Unknown verification error',
      });
    }
  } catch (error) {
    console.error(`[AuthController] 验证 Passkey 注册时出错 (用户: ${userHandle}):`, error);
    next(error);
  }
};

/**
 * 生成 Passkey 认证选项 (POST /api/v1/auth/passkey/authentication-options)
 */
export const generatePasskeyAuthenticationOptionsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { username } = req.body; // Can be initiated by username (if not logged in) or for currently logged-in user

  try {
    // PasskeyService's generateAuthenticationOptions can optionally take a username
    const options = await passkeyService.generateAuthenticationOptions(username);

    // +++ Store challenge with timestamp for replay attack prevention
    req.session.currentChallenge = {
      challenge: options.challenge,
      timestamp: Date.now(),
    };
    // For authentication, userHandle is not strictly needed in session beforehand if RP ID is specific enough
    // or if allowCredentials is used. We'll clear any old one just in case.
    delete req.session.passkeyUserHandle;

    console.log(
      `[AuthController] Generated Passkey authentication options (username: ${username || 'any'})`
    );
    res.json(options);
  } catch (error) {
    console.error(
      `[AuthController] 生成 Passkey 认证选项时出错 (username: ${username || 'any'}):`,
      error
    );
    next(error);
  }
};

/**
 * 验证 Passkey 凭据并登录用户 (POST /api/v1/auth/passkey/authenticate)
 */
export const verifyPasskeyAuthenticationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Extract assertionResponse and rememberMe from the request body
  const { assertionResponse, rememberMe } = req.body;
  const challengeData = req.session.currentChallenge;

  // Rename assertionResponse to authenticationResponseJSON for clarity within this scope
  const authenticationResponseJSON = assertionResponse;

  if (!authenticationResponseJSON) {
    res.status(400).json({ message: '认证响应 (assertionResponse) 不能为空。' });
    return;
  }
  if (!challengeData) {
    res.status(400).json({ message: '会话中未找到质询信息，请重试认证流程。' });
    return;
  }

  // +++ Verify challenge timestamp (5 minutes validity)
  if (Date.now() - challengeData.timestamp > SECURITY_CONFIG.CHALLENGE_TIMEOUT) {
    delete req.session.currentChallenge;
    res.status(400).json({ message: '认证质询已过期，请重新开始认证流程。' });
    return;
  }

  const expectedChallenge = challengeData.challenge;

  try {
    // Pass the extracted authenticationResponseJSON to the service
    const verification = await passkeyService.verifyAuthentication(
      authenticationResponseJSON,
      expectedChallenge
    );

    if (verification.verified && verification.userId && verification.passkey) {
      const user = await userRepository.findUserById(verification.userId);
      if (!user) {
        // This should ideally not happen if passkey verification was successful
        console.error(`[AuthController] Passkey 认证成功但未找到用户 ID: ${verification.userId}`);
        auditLogService.logAction('PASSKEY_AUTH_FAILURE', {
          credentialId: verification.passkey.credential_id,
          reason: 'User not found after verification',
        });
        res.status(401).json({ verified: false, message: 'Passkey 认证失败：用户数据错误。' });
        return;
      }

      console.log(
        `[AuthController] 用户 ${user.username} (ID: ${user.id}) 通过 Passkey (ID: ***${verification.passkey.id.toString().substring(verification.passkey.id.toString().length - 4)}) 认证成功。`
      );

      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      auditLogService.logAction('PASSKEY_AUTH_SUCCESS', {
        userId: user.id,
        username: user.username,
        credentialId: verification.passkey.credential_id,
        ip: clientIp,
      });
      notificationService.sendNotification('LOGIN_SUCCESS', {
        userId: user.id,
        username: user.username,
        ip: clientIp,
        method: 'Passkey',
      });

      // 重新生成 Session ID 防止会话固定攻击
      req.session.regenerate((err) => {
        if (err) {
          console.error('Passkey 认证后会话重新生成失败:', err);
          res.status(500).json({ message: 'Passkey 认证成功但会话创建失败，请重试。' });
          return;
        }

        // Setup session similar to password login
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.requiresTwoFactor = false; // Passkey implies 2FA characteristics

        if (rememberMe) {
          req.session.cookie.maxAge = SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE;
        } else {
          req.session.cookie.maxAge = undefined; // Session cookie
        }

        delete req.session.currentChallenge;
        delete req.session.passkeyUserHandle;

        res.status(200).json({
          verified: true,
          message: 'Passkey 认证成功。',
          user: { id: user.id, username: user.username },
        });
      });
    } else {
      console.warn(`[AuthController] Passkey 认证验证失败:`, verification);
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      auditLogService.logAction('PASSKEY_AUTH_FAILURE', {
        credentialId: authenticationResponseJSON?.id || 'unknown', // Use the extracted object
        reason: 'Verification failed',
        ip: clientIp,
      });
      notificationService.sendNotification('PASSKEY_AUTH_FAILURE', {
        credentialId: authenticationResponseJSON?.id || 'unknown',
        reason: 'Verification failed',
        ip: clientIp,
      });
      res.status(401).json({ verified: false, message: 'Passkey 认证失败。' });
    }
  } catch (error: any) {
    console.error(`[AuthController] 验证 Passkey 认证时出错:`, error);
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    auditLogService.logAction('PASSKEY_AUTH_FAILURE', {
      credentialId: authenticationResponseJSON?.id || 'unknown',
      reason: error.message || 'Unknown error',
      ip: clientIp,
    });
    notificationService.sendNotification('PASSKEY_AUTH_FAILURE', {
      credentialId: authenticationResponseJSON?.id || 'unknown',
      reason: error.message || 'Unknown error',
      ip: clientIp,
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
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  try {
    const passkeys = await passkeyService.listPasskeysByUserId(userId);
    console.log(
      `[AuthController] 用户 ${username} (ID: ${userId}) 获取了 Passkey 列表，数量: ${passkeys.length}`
    );
    res.status(200).json(passkeys);
  } catch (error) {
    console.error(
      `[AuthController] 用户 ${username} (ID: ${userId}) 获取 Passkey 列表时出错:`,
      error
    );
    next(error);
  }
};

/**
 * 删除当前认证用户指定的 Passkey (DELETE /api/v1/user/passkeys/:credentialID)
 */
export const deleteUserPasskeyHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;
  const { credentialID } = req.params;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  if (!credentialID) {
    res.status(400).json({ message: '必须提供 Passkey 的 CredentialID。' });
    return;
  }

  try {
    const wasDeleted = await passkeyService.deletePasskey(userId, credentialID);
    if (wasDeleted) {
      console.log(
        `[AuthController] 用户 ${username} (ID: ${userId}) 成功删除了 Passkey (CredentialID: ${credentialID.substring(0, 8)}***)。`
      );
      auditLogService.logAction('PASSKEY_DELETED', {
        userId,
        username,
        credentialId: credentialID,
      });
      notificationService.sendNotification('PASSKEY_DELETED', {
        userId,
        username,
        credentialId: credentialID,
      });
      res.status(200).json({ message: 'Passkey 删除成功。' });
    } else {
      // 这通常不应该发生，因为 service 层会在找不到或权限不足时抛出错误
      console.warn(
        `[AuthController] 用户 ${username} (ID: ${userId}) 删除 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 失败，但未抛出错误。`
      );
      res.status(404).json({ message: 'Passkey 未找到或无法删除。' });
    }
  } catch (error: any) {
    console.error(
      `[AuthController] 用户 ${username} (ID: ${userId}) 删除 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 时出错:`,
      error.message,
      error.stack
    );
    if (error.message === 'Passkey not found.') {
      res.status(404).json({ message: '指定的 Passkey 未找到。' });
    } else if (error.message === 'Unauthorized to delete this passkey.') {
      auditLogService.logAction('PASSKEY_DELETE_UNAUTHORIZED', {
        userId,
        username,
        credentialIdAttempted: credentialID,
      });
      res.status(403).json({ message: '无权删除此 Passkey。' });
    } else {
      next(error);
    }
  }
};

/**
 * 更新当前认证用户指定的 Passkey 名称 (PUT /api/v1/user/passkeys/:credentialID/name)
 */
export const updateUserPasskeyNameHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;
  const { credentialID } = req.params;
  const { name } = req.body;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  if (!credentialID) {
    res.status(400).json({ message: '必须提供 Passkey 的 CredentialID。' });
    return;
  }

  if (typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ message: 'Passkey 名称不能为空。' });
    return;
  }

  const trimmedName = name.trim();

  try {
    await passkeyService.updatePasskeyName(userId, credentialID, trimmedName);
    console.log(
      `[AuthController] 用户 ${username} (ID: ${userId}) 成功更新了 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 的名称为 "${trimmedName}"。`
    );
    auditLogService.logAction('PASSKEY_NAME_UPDATED', {
      userId,
      username,
      credentialId: credentialID,
      newName: trimmedName,
    });
    // Optionally send a notification if desired
    // notificationService.sendNotification('PASSKEY_NAME_UPDATED', { userId, username, credentialId: credentialID, newName: trimmedName });
    res.status(200).json({ message: 'Passkey 名称更新成功。' });
  } catch (error: any) {
    console.error(
      `[AuthController] 用户 ${username} (ID: ${userId}) 更新 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 名称时出错:`,
      error.message,
      error.stack
    );
    if (error.message === 'Passkey not found.') {
      res.status(404).json({ message: '指定的 Passkey 未找到。' });
    } else if (error.message === 'Unauthorized to update this passkey name.') {
      auditLogService.logAction('PASSKEY_NAME_UPDATE_UNAUTHORIZED', {
        userId,
        username,
        credentialIdAttempted: credentialID,
      });
      res.status(403).json({ message: '无权更新此 Passkey 名称。' });
    } else {
      next(error);
    }
  }
};

/**
 * 处理用户登录请求 (POST /api/v1/auth/login)
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // 从请求体中解构 username, password 和可选的 rememberMe
  const { username, password, rememberMe } = req.body;

  if (!username || !password) {
    res.status(400).json({ message: '用户名和密码不能为空。' });
    return;
  }

  try {
    // --- CAPTCHA Verification Step ---
    const captchaConfig = await settingsService.getCaptchaConfig();
    if (captchaConfig.enabled) {
      const { captchaToken } = req.body;
      if (!captchaToken) {
        res.status(400).json({ message: '需要提供 CAPTCHA 令牌。' });
        return;
      }
      try {
        const isCaptchaValid = await captchaService.verifyToken(captchaToken);
        if (!isCaptchaValid) {
          console.log(`[AuthController] 登录尝试失败: CAPTCHA 验证失败 - ${username}`);
          const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
          ipBlacklistService.recordFailedAttempt(clientIp);
          auditLogService.logAction('LOGIN_FAILURE', {
            username,
            reason: 'Invalid CAPTCHA token',
            ip: clientIp,
          });
          notificationService.sendNotification('LOGIN_FAILURE', {
            username,
            reason: 'Invalid CAPTCHA token',
            ip: clientIp,
          });
          res.status(401).json({ message: 'CAPTCHA 验证失败。' });
          return;
        }
        console.log(`[AuthController] CAPTCHA 验证成功 - ${username}`);
      } catch (captchaError: any) {
        console.error(
          `[AuthController] CAPTCHA 验证过程中出错 (${username}):`,
          captchaError.message
        );
        res.status(500).json({ message: 'CAPTCHA 验证服务出错，请稍后重试或检查配置。' });
        return;
      }
    } else {
      console.log(`[AuthController] CAPTCHA 未启用，跳过验证 - ${username}`);
    }

    const db = await getDbInstance();
    const user = await getDb<User>(
      db,
      'SELECT id, username, hashed_password, two_factor_secret FROM users WHERE username = ?',
      [username]
    );

    if (!user) {
      console.log(`登录尝试失败: 用户未找到 - ${username}`);
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      ipBlacklistService.recordFailedAttempt(clientIp);
      auditLogService.logAction('LOGIN_FAILURE', {
        username,
        reason: 'User not found',
        ip: clientIp,
      });
      notificationService.sendNotification('LOGIN_FAILURE', {
        username,
        reason: 'User not found',
        ip: clientIp,
      });
      res.status(401).json({ message: '无效的凭据。' });
      return;
    }

    const isMatch = await comparePassword(password, user.hashed_password);

    if (!isMatch) {
      console.log(`登录尝试失败: 密码错误 - ${username}`);
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      ipBlacklistService.recordFailedAttempt(clientIp);
      auditLogService.logAction('LOGIN_FAILURE', {
        username,
        reason: 'Invalid password',
        ip: clientIp,
      });
      notificationService.sendNotification('LOGIN_FAILURE', {
        username,
        reason: 'Invalid password',
        ip: clientIp,
      });
      res.status(401).json({ message: '无效的凭据。' });
      return;
    }

    // 检查是否启用了 2FA
    if (user.two_factor_secret) {
      console.log(`用户 ${username} 已启用 2FA，需要进行二次验证。`);
      // +++ Generate temporary token for 2FA verification
      const tempToken = crypto.randomBytes(SECURITY_CONFIG.TEMP_TOKEN_LENGTH).toString('hex');
      const pendingAuth: PendingAuth = {
        tempToken,
        userId: user.id,
        username: user.username,
        expiresAt: Date.now() + SECURITY_CONFIG.PENDING_AUTH_TIMEOUT,
      };

      // 重新生成 Session ID 防止会话固定攻击
      req.session.regenerate((err) => {
        if (err) {
          console.error('会话重新生成失败:', err);
          res.status(500).json({ message: '登录过程中发生错误，请重试。' });
          return;
        }
        req.session.pendingAuth = pendingAuth;
        req.session.rememberMe = rememberMe;
        res.status(200).json({
          message: '需要进行两步验证。',
          requiresTwoFactor: true,
          tempToken, // Frontend must include this in 2FA request
        });
      });
    } else {
      console.log(`登录成功 (无 2FA): ${username}`);
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      ipBlacklistService.resetAttempts(clientIp);
      auditLogService.logAction('LOGIN_SUCCESS', { userId: user.id, username, ip: clientIp });
      notificationService.sendNotification('LOGIN_SUCCESS', {
        userId: user.id,
        username,
        ip: clientIp,
      });

      // 重新生成 Session ID 防止会话固定攻击
      req.session.regenerate((err) => {
        if (err) {
          console.error('会话重新生成失败:', err);
          res.status(500).json({ message: '登录过程中发生错误，请重试。' });
          return;
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.requiresTwoFactor = false;

        if (rememberMe) {
          req.session.cookie.maxAge = SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE;
        } else {
          req.session.cookie.maxAge = undefined;
        }

        res.status(200).json({
          message: '登录成功。',
          user: { id: user.id, username: user.username },
        });
      });
    }
  } catch (error) {
    console.error('登录时出错:', error);
    next(error);
  }
};

/**
 * 获取当前用户的认证状态 (GET /api/v1/auth/status)
 */
export const getAuthStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username || req.session.requiresTwoFactor) {
    res.status(401).json({ isAuthenticated: false });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      'SELECT two_factor_secret FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      res.status(401).json({ isAuthenticated: false });
      return;
    }

    res.status(200).json({
      isAuthenticated: true,
      user: {
        id: userId,
        username,
        isTwoFactorEnabled: !!user.two_factor_secret,
      },
    });
  } catch (error) {
    console.error(`获取用户 ${userId} 状态时发生内部错误:`, error);
    next(error);
  }
};
/**
 * 处理登录时的 2FA 验证 (POST /api/v1/auth/login/2fa)
 */
export const verifyLogin2FA = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { token, tempToken } = req.body; // +++ Accept tempToken from frontend
  const pendingAuth = req.session.pendingAuth as PendingAuth | undefined;

  // +++ Validate pending authentication state and tempToken
  if (!pendingAuth || !tempToken) {
    res.status(401).json({ message: '无效的认证状态。' });
    return;
  }

  if (pendingAuth.tempToken !== tempToken) {
    res.status(401).json({ message: '无效的认证状态。' });
    return;
  }

  // +++ Verify tempToken hasn't expired (5 minutes)
  if (Date.now() > pendingAuth.expiresAt) {
    delete req.session.pendingAuth;
    res.status(401).json({ message: '认证已过期，请重新登录。' });
    return;
  }

  if (!token) {
    res.status(400).json({ message: '验证码不能为空。' });
    return;
  }

  try {
    const db = await getDbInstance();
    // +++ Use pendingAuth.userId instead of session.userId
    const user = await getDb<User>(
      db,
      'SELECT id, username, two_factor_secret FROM users WHERE id = ?',
      [pendingAuth.userId]
    );

    if (!user || !user.two_factor_secret) {
      console.error(`2FA 验证错误: 未找到用户 ${pendingAuth.userId} 或未设置密钥。`);
      res.status(400).json({ message: '无法验证，请重新登录。' });
      return;
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (verified) {
      console.log(`用户 ${user.username} 2FA 验证成功。`);
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      ipBlacklistService.resetAttempts(clientIp);
      auditLogService.logAction('LOGIN_SUCCESS', {
        userId: user.id,
        username: user.username,
        ip: clientIp,
        twoFactor: true,
      });
      notificationService.sendNotification('LOGIN_SUCCESS', {
        userId: user.id,
        username: user.username,
        ip: clientIp,
        twoFactor: true,
      });

      // 保存 rememberMe 状态，因为 regenerate 会清空 session
      const { rememberMe } = req.session;

      // +++ Clear pending authentication after successful verification
      delete req.session.pendingAuth;

      // 重新生成 Session ID 防止会话固定攻击
      req.session.regenerate((err) => {
        if (err) {
          console.error('2FA 验证后会话重新生成失败:', err);
          res.status(500).json({ message: '登录完成失败，请重试。' });
          return;
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.requiresTwoFactor = false;

        if (rememberMe) {
          req.session.cookie.maxAge = SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE;
        } else {
          req.session.cookie.maxAge = undefined;
        }

        res.status(200).json({
          message: '登录成功。',
          user: { id: user.id, username: user.username },
        });
      });
    } else {
      console.log(`用户 ${user.username} 2FA 验证失败: 验证码错误。`);
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      ipBlacklistService.recordFailedAttempt(clientIp);
      auditLogService.logAction('LOGIN_FAILURE', {
        userId: user.id,
        username: user.username,
        reason: 'Invalid 2FA token',
        ip: clientIp,
      });
      notificationService.sendNotification('LOGIN_FAILURE', {
        userId: user.id,
        username: user.username,
        reason: 'Invalid 2FA token',
        ip: clientIp,
      });
      res.status(401).json({ message: '验证码无效。' });
    }
  } catch (error) {
    console.error(`2FA 验证时发生内部错误 (用户: ${pendingAuth?.userId || 'unknown'}):`, error);
    next(error);
  }
};

/**
 * 处理修改密码请求 (PUT /api/v1/auth/password)
 */
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  const { userId } = req.session;

  if (!userId || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成，请先登录。' });
    return;
  }

  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: '当前密码和新密码不能为空。' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ message: '新密码长度至少需要 8 位。' });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ message: '新密码不能与当前密码相同。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [
      userId,
    ]);

    if (!user) {
      console.error(`修改密码错误: 未找到 ID 为 ${userId} 的用户。`);
      res.status(404).json({ message: '用户不存在。' });
      return;
    }

    const isMatch = await comparePassword(currentPassword, user.hashed_password);
    if (!isMatch) {
      console.log(`修改密码尝试失败: 当前密码错误 - 用户 ID ${userId}`);
      res.status(400).json({ message: '当前密码不正确。' });
      return;
    }

    const newHashedPassword = await hashPassword(newPassword);
    const now = Math.floor(Date.now() / 1000);

    const result = await runDb(
      db,
      'UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?',
      [newHashedPassword, now, userId]
    );

    if (result.changes === 0) {
      console.error(`修改密码错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw new Error('未找到要更新的用户');
    }

    console.log(`用户 ${userId} 密码已成功修改。`);
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    auditLogService.logAction('PASSWORD_CHANGED', { userId, ip: clientIp });
    notificationService.sendNotification('PASSWORD_CHANGED', { userId, ip: clientIp });

    res.status(200).json({ message: '密码已成功修改。' });
  } catch (error) {
    console.error(`修改用户 ${userId} 密码时发生内部错误:`, error);
    next(error);
  }
};

/**
 * 开始 2FA 设置流程 (POST /api/v1/auth/2fa/setup)
 * 生成临时密钥和二维码
 */
export const setup2FA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      'SELECT two_factor_secret FROM users WHERE id = ?',
      [userId]
    );
    const existingSecret = user ? user.two_factor_secret : null;

    if (existingSecret) {
      res.status(400).json({ message: '两步验证已启用。如需重置，请先禁用。' });
      return;
    }

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `NexusTerminal (${username})`,
    });

    req.session.tempTwoFactorSecret = secret.base32;

    if (!secret.otpauth_url) {
      throw new Error('无法生成 OTP Auth URL');
    }

    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) {
        console.error('生成二维码时出错:', err);
        throw new Error('生成二维码失败');
      }
      res.json({
        secret: secret.base32,
        qrCodeUrl: data_url,
      });
    });
  } catch (error: any) {
    console.error(`用户 ${userId} 设置 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 验证并激活 2FA (POST /api/v1/auth/2fa/verify)
 */
export const verifyAndActivate2FA = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { token } = req.body;
  const { userId } = req.session;
  const tempSecret = req.session.tempTwoFactorSecret;

  if (!userId || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成。' });
    return;
  }

  if (!tempSecret) {
    res.status(400).json({ message: '未找到临时密钥，请重新开始设置流程。' });
    return;
  }

  if (!token) {
    res.status(400).json({ message: '验证码不能为空。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const verified = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (verified) {
      const now = Math.floor(Date.now() / 1000);
      const result = await runDb(
        db,
        'UPDATE users SET two_factor_secret = ?, updated_at = ? WHERE id = ?',
        [tempSecret, now, userId]
      );

      if (result.changes === 0) {
        console.error(`激活 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`);
        throw new Error('未找到要更新的用户');
      }

      console.log(`用户 ${userId} 已成功激活两步验证。`);
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      auditLogService.logAction('2FA_ENABLED', { userId, ip: clientIp });
      notificationService.sendNotification('2FA_ENABLED', { userId, ip: clientIp });

      delete req.session.tempTwoFactorSecret;

      res.status(200).json({ message: '两步验证已成功激活！' });
    } else {
      console.log(`用户 ${userId} 2FA 激活失败: 验证码错误。`);
      res.status(400).json({ message: '验证码无效。' });
    }
  } catch (error: any) {
    console.error(`用户 ${userId} 验证并激活 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 禁用 2FA (DELETE /api/v1/auth/2fa)
 */
export const disable2FA = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { password } = req.body;

  if (!userId || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成。' });
    return;
  }

  if (!password) {
    res.status(400).json({ message: '需要提供当前密码才能禁用两步验证。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [
      userId,
    ]);

    if (!user) {
      res.status(404).json({ message: '用户不存在。' });
      return;
    }
    const isMatch = await comparePassword(password, user.hashed_password);
    if (!isMatch) {
      res.status(400).json({ message: '当前密码不正确。' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const result = await runDb(
      db,
      'UPDATE users SET two_factor_secret = NULL, updated_at = ? WHERE id = ?',
      [now, userId]
    );

    if (result.changes === 0) {
      console.error(`禁用 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw new Error('未找到要更新的用户');
    }

    console.log(`用户 ${userId} 已成功禁用两步验证。`);
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    auditLogService.logAction('2FA_DISABLED', { userId, ip: clientIp });
    notificationService.sendNotification('2FA_DISABLED', { userId, ip: clientIp });

    res.status(200).json({ message: '两步验证已成功禁用。' });
  } catch (error: any) {
    console.error(`用户 ${userId} 禁用 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 检查是否需要进行初始设置 (GET /api/v1/auth/needs-setup)
 * 如果数据库中没有用户，则需要设置。
 */
export const needsSetup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = await getDbInstance();
    const row = await getDb<{ count: number }>(db, 'SELECT COUNT(*) as count FROM users');
    const userCount = row ? row.count : 0;

    res.status(200).json({ needsSetup: userCount === 0 });
  } catch (error) {
    console.error('检查设置状态时发生内部错误:', error);
    next(error);
  }
};

/**
 * 处理初始账号设置请求 (POST /api/v1/auth/setup)
 */
export const setupAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { username, password, confirmPassword } = req.body;

  if (!username || !password || !confirmPassword) {
    res.status(400).json({ message: '用户名、密码和确认密码不能为空。' });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ message: '两次输入的密码不匹配。' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ message: '密码长度至少需要 8 位。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const row = await getDb<{ count: number }>(db, 'SELECT COUNT(*) as count FROM users');
    const userCount = row ? row.count : 0;

    if (userCount > 0) {
      console.warn('尝试在已有用户的情况下执行初始设置。');
      res.status(403).json({ message: '设置已完成，无法重复执行。' });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const now = Math.floor(Date.now() / 1000);

    const result = await runDb(
      db,
      `INSERT INTO users (username, hashed_password, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
      [username, hashedPassword, now, now]
    );

    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      console.error(
        '创建初始账号后未能获取有效的 lastID。可能原因：用户名已存在或其他数据库错误。'
      );
      throw new Error('创建初始账号失败，可能用户名已存在。');
    }
    const newUser = { id: result.lastID };

    console.log(`初始账号 '${username}' (ID: ${newUser.id}) 已成功创建。`);
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    auditLogService.logAction('ADMIN_SETUP_COMPLETE', {
      userId: newUser.id,
      username,
      ip: clientIp,
    });
    notificationService.sendNotification('ADMIN_SETUP_COMPLETE', {
      userId: newUser.id,
      username,
      ip: clientIp,
    });

    res.status(201).json({ message: '初始账号创建成功！' });
  } catch (error: any) {
    console.error('初始设置过程中发生内部错误:', error);
    next(error);
  }
};

/**
 * 处理用户登出请求 (POST /api/v1/auth/logout)
 */
export const logout = (req: Request, res: Response): void => {
  const { userId } = req.session;
  const { username } = req.session;

  req.session.destroy((err) => {
    if (err) {
      console.error(`销毁用户 ${userId} (${username}) 的会话时出错:`, err);
      res.status(500).json({ message: '登出时发生服务器内部错误。' });
    } else {
      console.log(`用户 ${userId} (${username}) 已成功登出。`);
      res.clearCookie('connect.sid');
      if (userId) {
        const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
        auditLogService.logAction('LOGOUT', { userId, username, ip: clientIp });
        notificationService.sendNotification('LOGOUT', { userId, username, ip: clientIp });
      }
      res.status(200).json({ message: '已成功登出。' });
    }
  });
};

/**
 * 获取公共 CAPTCHA 配置 (GET /api/v1/auth/captcha/config)
 * 返回给前端用于显示 CAPTCHA 小部件所需的信息 (不含密钥)。
 */
export const getPublicCaptchaConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log('[AuthController] Received request for public CAPTCHA config.');
    const fullConfig = await settingsService.getCaptchaConfig();

    const publicConfig = {
      enabled: fullConfig.enabled,
      provider: fullConfig.provider,
      hcaptchaSiteKey: fullConfig.hcaptchaSiteKey,
      recaptchaSiteKey: fullConfig.recaptchaSiteKey,
    };

    console.log('[AuthController] Sending public CAPTCHA config to client:', publicConfig);
    res.status(200).json(publicConfig);
  } catch (error: any) {
    console.error('[AuthController] 获取公共 CAPTCHA 配置时出错:', error);
    next(error);
  }
};

/**
 * 检查系统中是否配置了任何 Passkey (GET /api/v1/auth/passkey/has-configured)
 * 或者特定用户是否配置了 Passkey (GET /api/v1/auth/passkey/has-configured?username=xxx)
 * 公开访问，用于登录页面判断是否显示 Passkey 登录按钮。
 */
export const checkHasPasskeys = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const username = req.query.username as string | undefined;
  try {
    const hasPasskeys = await passkeyService.hasPasskeysConfigured(username);
    res.status(200).json({ hasPasskeys });
  } catch (error: any) {
    console.error(
      `[AuthController] 检查 Passkey 配置状态时出错 (username: ${username || 'any'}):`,
      error.message
    );
    next(error);
  }
};
