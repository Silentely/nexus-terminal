import type { AuditLogActionType } from '../types/audit.types';
import type { NotificationEvent } from '../types/notification.types';

interface AuthSideEffectServices {
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

export type AuthAuditSideEffect = {
  kind: 'audit';
  action: AuditLogActionType;
  payload: Record<string, unknown>;
};

export type AuthNotificationSideEffect = {
  kind: 'notification';
  event: NotificationEvent;
  payload: Record<string, unknown>;
};

export type AuthSideEffect = AuthAuditSideEffect | AuthNotificationSideEffect;

export const applyAuthSideEffects = (
  services: AuthSideEffectServices,
  sideEffects: AuthSideEffect[],
): void => {
  for (const sideEffect of sideEffects) {
    if (sideEffect.kind === 'audit') {
      services.auditLogService.logAction(sideEffect.action, sideEffect.payload);
      continue;
    }

    services.notificationService.sendNotification(sideEffect.event, sideEffect.payload);
  }
};
