/**
 * 跨主机传输纯函数工具测试
 */
import { describe, it, expect } from 'vitest';
import type { Client } from 'ssh2';
import {
  buildSshConnectConfig,
  buildTransferCommandString,
  escapeShellArg,
  hasOpenClientSocket,
} from './transfers.utils';
import type { ConnectionWithTags, DecryptedConnectionCredentials } from '../types/connection.types';

function makeConnection(overrides: Partial<ConnectionWithTags> = {}): ConnectionWithTags {
  return {
    id: 1,
    name: 'src',
    type: 'SSH',
    host: '10.0.0.1',
    port: 22,
    username: 'user',
    auth_method: 'password',
    ...overrides,
  } as ConnectionWithTags;
}

describe('transfers.utils', () => {
  describe('escapeShellArg', () => {
    it('应以单引号包裹普通路径', () => {
      expect(escapeShellArg('/tmp/file.txt')).toBe("'/tmp/file.txt'");
    });

    it('应正确转义内嵌单引号', () => {
      expect(escapeShellArg("it's")).toBe("'it'\\''s'");
    });
  });

  describe('hasOpenClientSocket', () => {
    it('socket 存在且未销毁时应为 true', () => {
      const client = { _sock: { destroyed: false } } as unknown as Client;
      expect(hasOpenClientSocket(client)).toBe(true);
    });

    it('socket 已销毁或缺失时应为 false', () => {
      expect(hasOpenClientSocket({ _sock: { destroyed: true } } as unknown as Client)).toBe(false);
      expect(hasOpenClientSocket({} as Client)).toBe(false);
    });
  });

  describe('buildSshConnectConfig', () => {
    it('密码认证应写入 password', () => {
      const config = buildSshConnectConfig(makeConnection({ auth_method: 'password' }), {
        decryptedPassword: 'secret',
        decryptedPrivateKey: null,
        decryptedPassphrase: null,
      } as DecryptedConnectionCredentials);

      expect(config.host).toBe('10.0.0.1');
      expect(config.port).toBe(22);
      expect(config.username).toBe('user');
      expect(config.password).toBe('secret');
      expect(config.privateKey).toBeUndefined();
    });

    it('密钥认证应写入 privateKey 与可选 passphrase', () => {
      const config = buildSshConnectConfig(makeConnection({ auth_method: 'key' }), {
        decryptedPassword: null,
        decryptedPrivateKey: 'KEYDATA',
        decryptedPassphrase: 'phrase',
      } as DecryptedConnectionCredentials);

      expect(config.privateKey).toBe('KEYDATA');
      expect(config.passphrase).toBe('phrase');
      expect(config.password).toBeUndefined();
    });
  });

  describe('buildTransferCommandString', () => {
    it('应构建 rsync 命令（含 -e ssh）', () => {
      const cmd = buildTransferCommandString(
        '/data/app',
        true,
        '/remote/dest',
        '/usr/bin/rsync',
        'rsync',
        {
          targetUserAndHost: 'user@10.0.0.2',
          sshPortOption: '-p 2222',
        },
      );

      expect(cmd).toContain('/usr/bin/rsync');
      expect(cmd).toContain('-avz --progress');
      expect(cmd).toContain('-e "ssh');
      expect(cmd).toContain('-p 2222');
      expect(cmd).toContain("user@10.0.0.2:'/remote/dest/'");
    });

    it('应构建 scp 命令（目录加 -r）', () => {
      const cmd = buildTransferCommandString('/tmp/file.txt', false, '/opt/files', 'scp', 'scp', {
        targetUserAndHost: 'root@host',
        sshPortOption: '-P 22',
        sshIdentityFileOption: '-i /tmp/key',
      });

      expect(cmd.startsWith('scp ')).toBe(true);
      expect(cmd).toContain('-o StrictHostKeyChecking=no');
      expect(cmd).toContain('-P 22');
      expect(cmd).toContain('-i /tmp/key');
      expect(cmd).not.toContain(' -r ');
    });

    it('scp 目录应包含 -r', () => {
      const cmd = buildTransferCommandString('/tmp/dir', true, '/opt/', 'scp', 'scp', {
        targetUserAndHost: 'u@h',
      });
      expect(cmd).toContain(' -r ');
    });
  });
});
