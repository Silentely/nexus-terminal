import { describe, expect, it } from 'vitest';
import {
  buildDeletePasskeyResultAction,
  buildListPasskeysSuccessAction,
  buildUpdatePasskeyNameSuccessAction,
  resolveDeletePasskeyErrorAction,
  resolveUpdatePasskeyNameErrorAction,
} from './auth-passkey-management-actions.utils';

describe('auth-passkey-management-actions.utils', () => {
  const actor = {
    userId: 7,
    username: 'alice',
  };
  const credentialId = '1234567890abcdef';

  it('list 成功动作应返回 200 与 debug 日志', () => {
    const passkeys = [{ credential_id: 'cred-1' }, { credential_id: 'cred-2' }];
    const action = buildListPasskeysSuccessAction(actor, passkeys);

    expect(action.response).toEqual({
      statusCode: 200,
      body: passkeys,
    });
    expect(action.log.level).toBe('debug');
    expect(action.log.message).toContain('获取了 Passkey 列表，数量: 2');
  });

  it('delete 成功动作应返回 200 并包含删除审计/通知 sideEffects', () => {
    const action = buildDeletePasskeyResultAction(actor, credentialId, true);

    expect(action.response).toEqual({
      statusCode: 200,
      body: { message: 'Passkey 删除成功。' },
      success: true,
    });
    expect(action.log.level).toBe('info');
    expect(action.log.message).toContain('12345678***');
    expect(action.sideEffects).toEqual([
      {
        kind: 'audit',
        action: 'PASSKEY_DELETED',
        payload: {
          userId: 7,
          username: 'alice',
          credentialId,
        },
      },
      {
        kind: 'notification',
        event: 'PASSKEY_DELETED',
        payload: {
          userId: 7,
          username: 'alice',
          credentialId,
        },
      },
    ]);
  });

  it('delete 越权错误动作应返回 403 并包含越权审计 sideEffect', () => {
    const action = resolveDeletePasskeyErrorAction(
      actor,
      credentialId,
      new Error('Unauthorized to delete this passkey.'),
    );

    expect(action).toMatchObject({
      handled: true,
      response: {
        statusCode: 403,
        body: { message: '无权删除此 Passkey。' },
      },
      log: {
        level: 'error',
      },
      sideEffects: [
        {
          kind: 'audit',
          action: 'PASSKEY_DELETE_UNAUTHORIZED',
          payload: {
            userId: 7,
            username: 'alice',
            credentialIdAttempted: credentialId,
          },
        },
      ],
    });
  });

  it('delete 失败(未删除)应返回 404、warn 日志且无 sideEffect', () => {
    const action = buildDeletePasskeyResultAction(actor, credentialId, false);

    expect(action.response).toEqual({
      statusCode: 404,
      body: { message: 'Passkey 未找到或无法删除。' },
      success: false,
    });
    expect(action.log.level).toBe('warn');
    expect(action.sideEffects).toEqual([]);
  });

  it('delete 未映射错误应返回 handled=false', () => {
    const action = resolveDeletePasskeyErrorAction(actor, credentialId, new Error('unknown'));

    expect(action).toMatchObject({
      handled: false,
      log: {
        level: 'error',
      },
    });
  });

  it('update-name 成功动作应返回 200 并包含名称更新审计 sideEffect', () => {
    const action = buildUpdatePasskeyNameSuccessAction(actor, credentialId, 'Work Laptop');

    expect(action.response).toEqual({
      statusCode: 200,
      body: { message: 'Passkey 名称更新成功。' },
    });
    expect(action.log.level).toBe('info');
    expect(action.log.message).toContain('12345678***');
    expect(action.sideEffects).toEqual([
      {
        kind: 'audit',
        action: 'PASSKEY_NAME_UPDATED',
        payload: {
          userId: 7,
          username: 'alice',
          credentialId,
          newName: 'Work Laptop',
        },
      },
    ]);
  });

  it('update-name 越权错误动作应返回 403 并包含越权审计 sideEffect', () => {
    const action = resolveUpdatePasskeyNameErrorAction(
      actor,
      credentialId,
      new Error('Unauthorized to update this passkey name.'),
    );

    expect(action).toMatchObject({
      handled: true,
      response: {
        statusCode: 403,
        body: { message: '无权更新此 Passkey 名称。' },
      },
      log: {
        level: 'error',
      },
      sideEffects: [
        {
          kind: 'audit',
          action: 'PASSKEY_NAME_UPDATE_UNAUTHORIZED',
          payload: {
            userId: 7,
            username: 'alice',
            credentialIdAttempted: credentialId,
          },
        },
      ],
    });
  });

  it('update-name 未映射错误应返回 handled=false', () => {
    const action = resolveUpdatePasskeyNameErrorAction(actor, credentialId, new Error('unknown'));

    expect(action).toMatchObject({
      handled: false,
      log: {
        level: 'error',
      },
    });
  });
});
