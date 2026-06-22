import { Request, Response } from 'express';
import { SECURITY_CONFIG } from '../config/security.config';
import { AuditLogActionType } from '../types/audit.types';
import { NotificationEvent } from '../types/notification.types';
import { resolveRequestClientIp } from './auth-main-flow.utils';
import { lookupGeoInfo } from './ip-geo.service';
import { logger } from '../utils/logger';

interface AuthEventServices {
  auditLogService: {
    logAction: (
      action: AuditLogActionType,
      payload?: Record<string, unknown> | string | null,
    ) => Promise<void> | void;
  };
  notificationService: {
    sendNotification: (
      event: NotificationEvent,
      payload?: Record<string, unknown> | string,
    ) => Promise<void> | void;
  };
}

export const recordPasskeyAuthenticationSuccess = (
  services: AuthEventServices,
  payload: {
    req: Request;
    userId: number;
    username: string;
    credentialId: string;
  },
): void => {
  const { req, userId, username, credentialId } = payload;
  const clientIp = resolveRequestClientIp(req);
  const auditPayload: Record<string, unknown> = {
    userId,
    username,
    credentialId,
    ip: clientIp,
    method: 'Passkey',
  };

  // 非阻塞查询 IP 地理位置，失败不影响认证流程
  void lookupGeoInfo(clientIp)
    .then((geoInfo) => {
      if (geoInfo) auditPayload.geoInfo = geoInfo;
    })
    .finally(() => {
      services.auditLogService.logAction('PASSKEY_AUTH_SUCCESS', auditPayload);
      services.notificationService.sendNotification('LOGIN_SUCCESS', auditPayload);
    });
};

export const recordPasskeyAuthenticationFailure = (
  services: AuthEventServices,
  payload: {
    req: Request;
    credentialId: string;
    reason: string;
  },
): void => {
  const { req, credentialId, reason } = payload;
  const clientIp = resolveRequestClientIp(req);
  const auditPayload: Record<string, unknown> = {
    credentialId,
    reason,
    ip: clientIp,
  };

  void lookupGeoInfo(clientIp)
    .then((geoInfo) => {
      if (geoInfo) auditPayload.geoInfo = geoInfo;
    })
    .finally(() => {
      services.auditLogService.logAction('PASSKEY_AUTH_FAILURE', auditPayload);
      services.notificationService.sendNotification('PASSKEY_AUTH_FAILURE', auditPayload);
    });
};

export const completePasskeyAuthenticatedSession = (
  req: Request,
  res: Response,
  payload: {
    user: {
      id: number;
      username: string;
    };
    rememberMe?: boolean;
  },
): void => {
  const { user, rememberMe } = payload;

  req.session.regenerate((err) => {
    if (err) {
      logger.error('Passkey 认证后会话重新生成失败:', err);
      res.status(500).json({ message: 'Passkey 认证成功但会话创建失败，请重试。' });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.requiresTwoFactor = false;
    req.session.cookie.maxAge = rememberMe ? SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE : undefined;

    delete req.session.currentChallenge;
    delete req.session.passkeyUserHandle;

    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error('Passkey 认证后会话保存失败:', saveErr);
        res.status(500).json({ message: 'Passkey 认证成功但会话创建失败，请重试。' });
        return;
      }

      res.status(200).json({
        verified: true,
        message: 'Passkey 认证成功。',
        user: { id: user.id, username: user.username },
      });
    });
  });
};

export const recordTwoFactorEnabledEvent = (
  services: AuthEventServices,
  payload: {
    req: Request;
    userId: number;
  },
): void => {
  const { req, userId } = payload;
  const clientIp = resolveRequestClientIp(req);
  const eventPayload: Record<string, unknown> = { userId, ip: clientIp };
  void lookupGeoInfo(clientIp)
    .then((geoInfo) => {
      if (geoInfo) eventPayload.geoInfo = geoInfo;
    })
    .finally(() => {
      services.auditLogService.logAction('2FA_ENABLED', eventPayload);
      services.notificationService.sendNotification('2FA_ENABLED', eventPayload);
    });
};

export const recordTwoFactorDisabledEvent = (
  services: AuthEventServices,
  payload: {
    req: Request;
    userId: number;
  },
): void => {
  const { req, userId } = payload;
  const clientIp = resolveRequestClientIp(req);
  const eventPayload: Record<string, unknown> = { userId, ip: clientIp };
  void lookupGeoInfo(clientIp)
    .then((geoInfo) => {
      if (geoInfo) eventPayload.geoInfo = geoInfo;
    })
    .finally(() => {
      services.auditLogService.logAction('2FA_DISABLED', eventPayload);
      services.notificationService.sendNotification('2FA_DISABLED', eventPayload);
    });
};
