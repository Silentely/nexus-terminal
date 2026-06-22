import { describe, expect, it, vi } from 'vitest';
import { Request } from 'express';
import {
  mapDeletePasskeyError,
  mapDeletePasskeyResult,
  mapUpdatePasskeyNameError,
  recordPasskeyDeletedEvent,
  recordPasskeyDeleteUnauthorizedEvent,
  recordPasskeyNameUpdatedEvent,
  recordPasskeyNameUpdateUnauthorizedEvent,
  resolvePasskeyAuthenticatedActor,
  resolvePasskeyCredentialId,
  resolvePasskeyTrimmedName,
  summarizePasskeyCredentialId,
} from './auth-passkey-management-flow.utils';

describe('auth-passkey-management-flow.utils', () => {
  it('resolvePasskeyAuthenticatedActor: 未认证时返回 401', () => {
    const req = {
      session: {},
    } as unknown as Request;

    const result = resolvePasskeyAuthenticatedActor(req);
    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证。' },
      },
    });
  });

  it('resolvePasskeyAuthenticatedActor: 已认证时返回 userId/username', () => {
    const req = {
      session: {
        userId: 9,
        username: 'alice',
      },
    } as unknown as Request;

    const result = resolvePasskeyAuthenticatedActor(req);
    expect(result).toEqual({
      ok: true,
      actor: { userId: 9, username: 'alice' },
    });
  });

  it('resolvePasskeyCredentialId: 缺少 credentialID 时返回 400', () => {
    const result = resolvePasskeyCredentialId(undefined);
    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '必须提供 Passkey 的 CredentialID。' },
      },
    });
  });

  it('resolvePasskeyTrimmedName: 空白名称返回 400', () => {
    const result = resolvePasskeyTrimmedName('   ');
    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: 'Passkey 名称不能为空。' },
      },
    });
  });

  it('resolvePasskeyTrimmedName: 合法名称返回 trimmed 值', () => {
    const result = resolvePasskeyTrimmedName('  Work Laptop  ');
    expect(result).toEqual({
      ok: true,
      trimmedName: 'Work Laptop',
    });
  });

  it('mapDeletePasskeyResult: 删除成功映射 200', () => {
    const result = mapDeletePasskeyResult(true);
    expect(result).toEqual({
      statusCode: 200,
      body: { message: 'Passkey 删除成功。' },
      success: true,
    });
  });

  it('mapDeletePasskeyResult: 删除失败映射 404', () => {
    const result = mapDeletePasskeyResult(false);
    expect(result).toEqual({
      statusCode: 404,
      body: { message: 'Passkey 未找到或无法删除。' },
      success: false,
    });
  });

  it('mapDeletePasskeyError: 未找到映射 404', () => {
    const result = mapDeletePasskeyError(new Error('Passkey not found.'));
    expect(result).toEqual({
      handled: true,
      statusCode: 404,
      body: { message: '指定的 Passkey 未找到。' },
      reason: 'not_found',
    });
  });

  it('mapDeletePasskeyError: 权限不足映射 403', () => {
    const result = mapDeletePasskeyError(new Error('Unauthorized to delete this passkey.'));
    expect(result).toEqual({
      handled: true,
      statusCode: 403,
      body: { message: '无权删除此 Passkey。' },
      reason: 'unauthorized',
    });
  });

  it('mapUpdatePasskeyNameError: 未找到映射 404', () => {
    const result = mapUpdatePasskeyNameError(new Error('Passkey not found.'));
    expect(result).toEqual({
      handled: true,
      statusCode: 404,
      body: { message: '指定的 Passkey 未找到。' },
      reason: 'not_found',
    });
  });

  it('mapUpdatePasskeyNameError: 权限不足映射 403', () => {
    const result = mapUpdatePasskeyNameError(
      new Error('Unauthorized to update this passkey name.'),
    );
    expect(result).toEqual({
      handled: true,
      statusCode: 403,
      body: { message: '无权更新此 Passkey 名称。' },
      reason: 'unauthorized',
    });
  });

  it('summarizePasskeyCredentialId 应仅显示前 8 位', () => {
    expect(summarizePasskeyCredentialId('1234567890abcdef')).toBe('12345678***');
  });

  it('审计与通知事件函数应保持既有语义', () => {
    const services = {
      auditLogService: { logAction: vi.fn() },
      notificationService: { sendNotification: vi.fn() },
    };

    recordPasskeyDeletedEvent(services, {
      userId: 1,
      username: 'alice',
      credentialId: 'cred-1',
    });
    recordPasskeyDeleteUnauthorizedEvent(services, {
      userId: 1,
      username: 'alice',
      credentialIdAttempted: 'cred-2',
    });
    recordPasskeyNameUpdatedEvent(services, {
      userId: 1,
      username: 'alice',
      credentialId: 'cred-3',
      newName: 'Laptop',
    });
    recordPasskeyNameUpdateUnauthorizedEvent(services, {
      userId: 1,
      username: 'alice',
      credentialIdAttempted: 'cred-4',
    });

    expect(services.auditLogService.logAction).toHaveBeenCalledWith('PASSKEY_DELETED', {
      userId: 1,
      username: 'alice',
      credentialId: 'cred-1',
    });
    expect(services.notificationService.sendNotification).toHaveBeenCalledWith('PASSKEY_DELETED', {
      userId: 1,
      username: 'alice',
      credentialId: 'cred-1',
    });
    expect(services.auditLogService.logAction).toHaveBeenCalledWith('PASSKEY_DELETE_UNAUTHORIZED', {
      userId: 1,
      username: 'alice',
      credentialIdAttempted: 'cred-2',
    });
    expect(services.auditLogService.logAction).toHaveBeenCalledWith('PASSKEY_NAME_UPDATED', {
      userId: 1,
      username: 'alice',
      credentialId: 'cred-3',
      newName: 'Laptop',
    });
    expect(services.auditLogService.logAction).toHaveBeenCalledWith(
      'PASSKEY_NAME_UPDATE_UNAUTHORIZED',
      {
        userId: 1,
        username: 'alice',
        credentialIdAttempted: 'cred-4',
      },
    );
  });
});
