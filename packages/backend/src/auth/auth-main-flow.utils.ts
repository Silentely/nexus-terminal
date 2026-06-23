import { Request, Response } from 'express';
import { SECURITY_CONFIG } from '../config/security.config';
import { AuditLogActionType } from '../types/audit.types';
import { NotificationEvent } from '../types/notification.types';
import { lookupGeoInfo } from './ip-geo.service';
import { logger } from '../utils/logger';

interface AuthEventServices {
  auditLogService: {
    logAction: (
      action: AuditLogActionType,
      payload: Record<string, unknown>,
    ) => Promise<void> | void;
  };
  notificationService: {
    sendNotification: (
      event: NotificationEvent,
      payload: Record<string, unknown>,
    ) => Promise<void> | void;
  };
}

interface LoginFailureServices extends AuthEventServices {
  ipBlacklistService: {
    recordFailedAttempt: (ip: string, method?: 'password' | '2fa') => void;
  };
}

interface LoginSuccessServices extends AuthEventServices {
  ipBlacklistService: {
    resetAttempts: (ip: string) => void;
  };
}

interface AuthenticatedUserPayload {
  id: number;
  username: string;
}

export interface PendingAuthPayload {
  tempToken: string;
  userId: number;
  username: string;
  expiresAt: number;
}

export const resolveRequestClientIp = (req: Request): string => {
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

export const recordLoginFailureAttempt = (
  services: LoginFailureServices,
  payload: {
    username: string;
    reason: string;
    clientIp: string;
    userId?: number;
    method?: 'password' | '2fa';
  },
): void => {
  const { username, reason, clientIp, userId, method } = payload;
  services.ipBlacklistService.recordFailedAttempt(clientIp, method);
  const eventPayload: Record<string, unknown> = {
    username,
    reason,
    ip: clientIp,
  };
  if (typeof userId === 'number') {
    eventPayload.userId = userId;
  }

  // 非阻塞查询 IP 地理位置，失败不影响登录流程
  void lookupGeoInfo(clientIp)
    .then((geoInfo) => {
      if (geoInfo) eventPayload.geoInfo = geoInfo;
    })
    .finally(() => {
      services.auditLogService.logAction('LOGIN_FAILURE', eventPayload);
      services.notificationService.sendNotification('LOGIN_FAILURE', eventPayload);
    });
};

export const recordLoginSuccessAttempt = (
  services: LoginSuccessServices,
  payload: {
    userId: number;
    username: string;
    clientIp: string;
    twoFactor?: boolean;
  },
): void => {
  const { userId, username, clientIp, twoFactor } = payload;
  services.ipBlacklistService.resetAttempts(clientIp);
  const eventPayload: Record<string, unknown> = {
    userId,
    username,
    ip: clientIp,
  };
  if (twoFactor) {
    eventPayload.twoFactor = true;
  }

  // 非阻塞查询 IP 地理位置，失败不影响登录流程
  void lookupGeoInfo(clientIp)
    .then((geoInfo) => {
      if (geoInfo) eventPayload.geoInfo = geoInfo;
    })
    .finally(() => {
      services.auditLogService.logAction('LOGIN_SUCCESS', eventPayload);
      services.notificationService.sendNotification('LOGIN_SUCCESS', eventPayload);
    });
};

export const startPendingTwoFactorSession = (
  req: Request,
  res: Response,
  payload: {
    pendingAuth: PendingAuthPayload;
    rememberMe?: boolean;
    isDev: boolean;
  },
): void => {
  const { pendingAuth, rememberMe, isDev } = payload;
  req.session.regenerate((err) => {
    if (err) {
      logger.error('会话重新生成失败:', err);
      res.status(500).json({ message: '登录过程中发生错误，请重试。' });
      return;
    }

    req.session.pendingAuth = pendingAuth;
    req.session.rememberMe = rememberMe;

    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error('[AuthController] 2FA 认证状态保存失败:', saveErr);
        res.status(500).json({ message: '登录过程中发生错误，请重试。' });
        return;
      }

      if (isDev) {
        logger.debug('[AuthController] 2FA pendingAuth 已保存到 session');
      }
      res.status(200).json({
        message: '需要进行两步验证。',
        requiresTwoFactor: true,
        tempToken: pendingAuth.tempToken,
      });
    });
  });
};

export const completeAuthenticatedSession = (
  req: Request,
  res: Response,
  payload: {
    user: AuthenticatedUserPayload;
    rememberMe?: boolean;
    saveErrorMessage: string;
  },
): void => {
  const { user, rememberMe, saveErrorMessage } = payload;
  req.session.regenerate((err) => {
    if (err) {
      logger.error('会话重新生成失败:', err);
      res.status(500).json({ message: saveErrorMessage });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.requiresTwoFactor = false;
    req.session.cookie.maxAge = rememberMe ? SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE : undefined;

    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error('[AuthController] 登录后会话保存失败:', saveErr);
        res.status(500).json({ message: saveErrorMessage });
        return;
      }

      res.status(200).json({
        message: '登录成功。',
        user: { id: user.id, username: user.username },
      });
    });
  });
};

export const destroySessionAndRespondLogout = (
  req: Request,
  res: Response,
  payload: {
    userId?: number;
    username?: string;
    onLogoutSuccess?: (clientIp: string) => void;
  },
): void => {
  const { userId, username, onLogoutSuccess } = payload;
  req.session.destroy((err) => {
    if (err) {
      logger.error(`销毁用户 ${userId} (${username}) 的会话时出错:`, err);
      res.status(500).json({ message: '登出时发生服务器内部错误。' });
      return;
    }

    if (userId != null && username) {
      logger.info(`用户 ${userId} (${username}) 已成功登出。`);
    } else {
      logger.debug('登出请求处理完成（无有效会话，可能为过期 session 清理）。');
    }
    res.clearCookie('connect.sid');
    if (userId) {
      onLogoutSuccess?.(resolveRequestClientIp(req));
    }
    res.status(200).json({ message: '已成功登出。' });
  });
};
