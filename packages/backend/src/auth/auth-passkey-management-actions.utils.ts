import { getErrorMessage } from '../utils/AppError';
import type { AuditLogActionType } from '../types/audit.types';
import type { NotificationEvent } from '../types/notification.types';
import {
  mapDeletePasskeyError,
  mapDeletePasskeyResult,
  mapUpdatePasskeyNameError,
  summarizePasskeyCredentialId,
} from './auth-passkey-management-flow.utils';

// 清洗日志中的 CRLF 字符，防止 Log Forge 注入
const sanitizeForLog = (value: string): string => value.replace(/[\r\n]/g, '_');

export interface PasskeyActor {
  userId: number;
  username: string;
}

type DeleteResultResponse = ReturnType<typeof mapDeletePasskeyResult>;

interface PasskeyHandledErrorResponse {
  statusCode: 403 | 404;
  body: {
    message: string;
  };
}

export interface PasskeyLogAction {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  errorMessage?: string;
  errorStack?: string;
}

export interface PasskeyAuditSideEffect {
  kind: 'audit';
  action: AuditLogActionType;
  payload: Record<string, unknown>;
}

export interface PasskeyNotificationSideEffect {
  kind: 'notification';
  event: NotificationEvent;
  payload: Record<string, unknown>;
}

export type PasskeyManagementSideEffect = PasskeyAuditSideEffect | PasskeyNotificationSideEffect;

export interface ListPasskeysSuccessAction<TPasskey> {
  response: {
    statusCode: 200;
    body: TPasskey[];
  };
  log: PasskeyLogAction;
}

export interface DeletePasskeyResultAction {
  response: DeleteResultResponse;
  log: PasskeyLogAction;
  sideEffects: PasskeyManagementSideEffect[];
}

export type DeletePasskeyErrorAction =
  | {
      handled: false;
      log: PasskeyLogAction;
    }
  | {
      handled: true;
      response: PasskeyHandledErrorResponse;
      log: PasskeyLogAction;
      sideEffects: PasskeyManagementSideEffect[];
    };

export interface UpdatePasskeyNameSuccessAction {
  response: {
    statusCode: 200;
    body: {
      message: string;
    };
  };
  log: PasskeyLogAction;
  sideEffects: PasskeyManagementSideEffect[];
}

export type UpdatePasskeyNameErrorAction =
  | {
      handled: false;
      log: PasskeyLogAction;
    }
  | {
      handled: true;
      response: PasskeyHandledErrorResponse;
      log: PasskeyLogAction;
      sideEffects: PasskeyManagementSideEffect[];
    };

export const buildListPasskeysSuccessAction = <TPasskey>(
  actor: PasskeyActor,
  passkeys: TPasskey[],
): ListPasskeysSuccessAction<TPasskey> => {
  return {
    response: {
      statusCode: 200,
      body: passkeys,
    },
    log: {
      level: 'debug',
      message: `[AuthController] 用户 ${sanitizeForLog(actor.username)} (ID: ${actor.userId}) 获取了 Passkey 列表，数量: ${passkeys.length}`,
    },
  };
};

export const buildDeletePasskeyResultAction = (
  actor: PasskeyActor,
  credentialId: string,
  wasDeleted: boolean,
): DeletePasskeyResultAction => {
  const mappedDeleteResult = mapDeletePasskeyResult(wasDeleted);
  const maskedCredentialId = summarizePasskeyCredentialId(credentialId);

  if (!mappedDeleteResult.success) {
    return {
      response: mappedDeleteResult,
      log: {
        level: 'warn',
        message: `[AuthController] 用户 ${sanitizeForLog(actor.username)} (ID: ${actor.userId}) 删除 Passkey (CredentialID: ${maskedCredentialId}) 失败，但未抛出错误。`,
      },
      sideEffects: [],
    };
  }

  return {
    response: mappedDeleteResult,
    log: {
      level: 'info',
      message: `[AuthController] 用户 ${sanitizeForLog(actor.username)} (ID: ${actor.userId}) 成功删除了 Passkey (CredentialID: ${maskedCredentialId})。`,
    },
    sideEffects: [
      {
        kind: 'audit',
        action: 'PASSKEY_DELETED',
        payload: {
          userId: actor.userId,
          username: actor.username,
          credentialId,
        },
      },
      {
        kind: 'notification',
        event: 'PASSKEY_DELETED',
        payload: {
          userId: actor.userId,
          username: actor.username,
          credentialId,
        },
      },
    ],
  };
};

export const resolveDeletePasskeyErrorAction = (
  actor: PasskeyActor,
  credentialId: string,
  error: unknown,
): DeletePasskeyErrorAction => {
  const mappedDeleteError = mapDeletePasskeyError(error);
  const maskedCredentialId = summarizePasskeyCredentialId(credentialId);
  const baseErrorLog: PasskeyLogAction = {
    level: 'error',
    message: `[AuthController] 用户 ${sanitizeForLog(actor.username)} (ID: ${actor.userId}) 删除 Passkey (CredentialID: ${maskedCredentialId}) 时出错:`,
    errorMessage: getErrorMessage(error),
    errorStack: (error as Error)?.stack,
  };

  if (!mappedDeleteError.handled) {
    return {
      handled: false,
      log: baseErrorLog,
    };
  }

  const sideEffects: PasskeyManagementSideEffect[] = [];
  if (mappedDeleteError.reason === 'unauthorized') {
    sideEffects.push({
      kind: 'audit',
      action: 'PASSKEY_DELETE_UNAUTHORIZED',
      payload: {
        userId: actor.userId,
        username: actor.username,
        credentialIdAttempted: credentialId,
      },
    });
  }

  return {
    handled: true,
    response: {
      statusCode: mappedDeleteError.statusCode,
      body: mappedDeleteError.body,
    },
    log: baseErrorLog,
    sideEffects,
  };
};

export const buildUpdatePasskeyNameSuccessAction = (
  actor: PasskeyActor,
  credentialId: string,
  trimmedName: string,
): UpdatePasskeyNameSuccessAction => {
  return {
    response: {
      statusCode: 200,
      body: {
        message: 'Passkey 名称更新成功。',
      },
    },
    log: {
      level: 'info',
      message: `[AuthController] 用户 ${sanitizeForLog(actor.username)} (ID: ${actor.userId}) 成功更新了 Passkey (CredentialID: ${summarizePasskeyCredentialId(credentialId)}) 的名称为 "${sanitizeForLog(trimmedName)}"。`,
    },
    sideEffects: [
      {
        kind: 'audit',
        action: 'PASSKEY_NAME_UPDATED',
        payload: {
          userId: actor.userId,
          username: actor.username,
          credentialId,
          newName: trimmedName,
        },
      },
    ],
  };
};

export const resolveUpdatePasskeyNameErrorAction = (
  actor: PasskeyActor,
  credentialId: string,
  error: unknown,
): UpdatePasskeyNameErrorAction => {
  const mappedUpdateError = mapUpdatePasskeyNameError(error);
  const maskedCredentialId = summarizePasskeyCredentialId(credentialId);
  const baseErrorLog: PasskeyLogAction = {
    level: 'error',
    message: `[AuthController] 用户 ${sanitizeForLog(actor.username)} (ID: ${actor.userId}) 更新 Passkey (CredentialID: ${maskedCredentialId}) 名称时出错:`,
    errorMessage: getErrorMessage(error),
    errorStack: (error as Error)?.stack,
  };

  if (!mappedUpdateError.handled) {
    return {
      handled: false,
      log: baseErrorLog,
    };
  }

  const sideEffects: PasskeyManagementSideEffect[] = [];
  if (mappedUpdateError.reason === 'unauthorized') {
    sideEffects.push({
      kind: 'audit',
      action: 'PASSKEY_NAME_UPDATE_UNAUTHORIZED',
      payload: {
        userId: actor.userId,
        username: actor.username,
        credentialIdAttempted: credentialId,
      },
    });
  }

  return {
    handled: true,
    response: {
      statusCode: mappedUpdateError.statusCode,
      body: mappedUpdateError.body,
    },
    log: baseErrorLog,
    sideEffects,
  };
};
