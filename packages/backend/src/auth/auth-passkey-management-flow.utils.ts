import { Request } from 'express';
import { getErrorMessage } from '../utils/AppError';
import { AuditLogActionType } from '../types/audit.types';
import { NotificationEvent } from '../types/notification.types';

interface HandlerFailure {
  statusCode: 400 | 401 | 403 | 404;
  body: {
    message: string;
  };
}

export interface PasskeyAuthenticatedActor {
  userId: number;
  username: string;
}

export const resolvePasskeyAuthenticatedActor = (
  req: Request,
):
  | {
      ok: true;
      actor: PasskeyAuthenticatedActor;
    }
  | {
      ok: false;
      failure: HandlerFailure;
    } => {
  const { userId, username } = req.session;
  if (!userId || !username) {
    return {
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证。' },
      },
    };
  }

  return {
    ok: true,
    actor: { userId, username },
  };
};

export const resolvePasskeyCredentialId = (
  credentialID: string | undefined,
):
  | {
      ok: true;
      credentialId: string;
    }
  | {
      ok: false;
      failure: HandlerFailure;
    } => {
  if (!credentialID) {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '必须提供 Passkey 的 CredentialID。' },
      },
    };
  }

  return {
    ok: true,
    credentialId: credentialID,
  };
};

export const resolvePasskeyTrimmedName = (
  name: unknown,
):
  | {
      ok: true;
      trimmedName: string;
    }
  | {
      ok: false;
      failure: HandlerFailure;
    } => {
  if (typeof name !== 'string' || name.trim() === '') {
    return {
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: 'Passkey 名称不能为空。' },
      },
    };
  }

  return {
    ok: true,
    trimmedName: name.trim(),
  };
};

export const summarizePasskeyCredentialId = (credentialID: string): string =>
  `${credentialID.substring(0, 8)}***`;

export const mapDeletePasskeyResult = (
  wasDeleted: boolean,
): {
  statusCode: 200 | 404;
  body: {
    message: string;
  };
  success: boolean;
} =>
  wasDeleted
    ? {
        statusCode: 200,
        body: { message: 'Passkey 删除成功。' },
        success: true,
      }
    : {
        statusCode: 404,
        body: { message: 'Passkey 未找到或无法删除。' },
        success: false,
      };

type HandledErrorResult = {
  handled: true;
  statusCode: 403 | 404;
  body: {
    message: string;
  };
  reason: 'not_found' | 'unauthorized';
};

type UnhandledErrorResult = {
  handled: false;
};

export type DeletePasskeyErrorResult = HandledErrorResult | UnhandledErrorResult;
export type UpdatePasskeyNameErrorResult = HandledErrorResult | UnhandledErrorResult;

export const mapDeletePasskeyError = (error: unknown): DeletePasskeyErrorResult => {
  const errorMessage = getErrorMessage(error);
  if (errorMessage === 'Passkey not found.') {
    return {
      handled: true,
      statusCode: 404,
      body: { message: '指定的 Passkey 未找到。' },
      reason: 'not_found',
    };
  }

  if (errorMessage === 'Unauthorized to delete this passkey.') {
    return {
      handled: true,
      statusCode: 403,
      body: { message: '无权删除此 Passkey。' },
      reason: 'unauthorized',
    };
  }

  return { handled: false };
};

export const mapUpdatePasskeyNameError = (error: unknown): UpdatePasskeyNameErrorResult => {
  const errorMessage = getErrorMessage(error);
  if (errorMessage === 'Passkey not found.') {
    return {
      handled: true,
      statusCode: 404,
      body: { message: '指定的 Passkey 未找到。' },
      reason: 'not_found',
    };
  }

  if (errorMessage === 'Unauthorized to update this passkey name.') {
    return {
      handled: true,
      statusCode: 403,
      body: { message: '无权更新此 Passkey 名称。' },
      reason: 'unauthorized',
    };
  }

  return { handled: false };
};

interface PasskeyManagementEventServices {
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

export const recordPasskeyDeletedEvent = (
  services: PasskeyManagementEventServices,
  payload: {
    userId: number;
    username: string;
    credentialId: string;
  },
): void => {
  const { userId, username, credentialId } = payload;
  services.auditLogService.logAction('PASSKEY_DELETED', {
    userId,
    username,
    credentialId,
  });
  services.notificationService.sendNotification('PASSKEY_DELETED', {
    userId,
    username,
    credentialId,
  });
};

export const recordPasskeyDeleteUnauthorizedEvent = (
  services: PasskeyManagementEventServices,
  payload: {
    userId: number;
    username: string;
    credentialIdAttempted: string;
  },
): void => {
  services.auditLogService.logAction('PASSKEY_DELETE_UNAUTHORIZED', payload);
};

export const recordPasskeyNameUpdatedEvent = (
  services: PasskeyManagementEventServices,
  payload: {
    userId: number;
    username: string;
    credentialId: string;
    newName: string;
  },
): void => {
  services.auditLogService.logAction('PASSKEY_NAME_UPDATED', payload);
};

export const recordPasskeyNameUpdateUnauthorizedEvent = (
  services: PasskeyManagementEventServices,
  payload: {
    userId: number;
    username: string;
    credentialIdAttempted: string;
  },
): void => {
  services.auditLogService.logAction('PASSKEY_NAME_UPDATE_UNAUTHORIZED', payload);
};
