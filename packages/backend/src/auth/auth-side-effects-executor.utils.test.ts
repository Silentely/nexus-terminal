import { describe, expect, it, vi } from 'vitest';
import { applyAuthSideEffects, type AuthSideEffect } from './auth-side-effects-executor.utils';

describe('auth-side-effects-executor.utils', () => {
  it('应按顺序执行 audit 与 notification sideEffects', () => {
    const logAction = vi.fn();
    const sendNotification = vi.fn();
    const sideEffects: AuthSideEffect[] = [
      {
        kind: 'audit',
        action: 'PASSKEY_DELETED',
        payload: { userId: 1, credentialId: 'abc' },
      },
      {
        kind: 'notification',
        event: 'PASSKEY_DELETED',
        payload: { userId: 1, credentialId: 'abc' },
      },
      {
        kind: 'audit',
        action: '2FA_ENABLED',
        payload: { userId: 1, ip: '127.0.0.1' },
      },
    ];

    applyAuthSideEffects(
      {
        auditLogService: { logAction },
        notificationService: { sendNotification },
      },
      sideEffects,
    );

    expect(logAction).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenNthCalledWith(1, 'PASSKEY_DELETED', {
      userId: 1,
      credentialId: 'abc',
    });
    expect(sendNotification).toHaveBeenNthCalledWith(1, 'PASSKEY_DELETED', {
      userId: 1,
      credentialId: 'abc',
    });
    expect(logAction).toHaveBeenNthCalledWith(2, '2FA_ENABLED', {
      userId: 1,
      ip: '127.0.0.1',
    });
  });
});
