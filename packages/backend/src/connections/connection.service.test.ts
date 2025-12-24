/**
 * Connection Service 单元测试
 * 测试连接管理的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 导入被测模块和依赖
import * as ConnectionRepository from './connection.repository';
import * as SshKeyService from '../ssh-keys/ssh-keys.service';
import { encrypt, decrypt } from '../utils/crypto';
import {
  getAllConnections,
  getConnectionById,
  createConnection,
  updateConnection,
  deleteConnection,
  getConnectionWithDecryptedCredentials,
  cloneConnection,
  addTagToConnections,
  updateConnectionTags,
} from './connection.service';

// Mock 依赖模块
vi.mock('./connection.repository', () => ({
  findAllConnectionsWithTags: vi.fn(),
  findConnectionByIdWithTags: vi.fn(),
  findFullConnectionById: vi.fn(),
  findConnectionByName: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  updateConnectionTags: vi.fn(),
  findConnectionTags: vi.fn(),
  addTagToMultipleConnections: vi.fn(),
}));

// Mock crypto utils - 直接内联定义函数
vi.mock('../utils/crypto', () => ({
  encrypt: vi.fn((value: string) => `encrypted_${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted_', '')),
}));

// Mock ssh-keys.service
vi.mock('../ssh-keys/ssh-keys.service', () => ({
  getSshKeyDbRowById: vi.fn(),
  getDecryptedSshKeyById: vi.fn(),
}));

vi.mock('../audit/audit.service', () => ({
  AuditLogService: vi.fn().mockImplementation(() => ({
    logAction: vi.fn(),
  })),
}));

describe('Connection Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 注意：不要使用 vi.resetAllMocks()，它会清除 mock 函数的实现
  // vi.clearAllMocks() 在 beforeEach 中已经足够清除调用记录

  describe('getAllConnections', () => {
    it('应返回所有连接列表', async () => {
      const mockConnections = [
        { id: 1, name: '服务器1', type: 'SSH', host: '192.168.1.1', port: 22, tag_ids: [1, 2] },
        { id: 2, name: '服务器2', type: 'RDP', host: '192.168.1.2', port: 3389, tag_ids: [] },
      ];
      (ConnectionRepository.findAllConnectionsWithTags as any).mockResolvedValue(mockConnections);

      const result = await getAllConnections();

      expect(result).toEqual(mockConnections);
      expect(ConnectionRepository.findAllConnectionsWithTags).toHaveBeenCalledTimes(1);
    });

    it('无连接时应返回空数组', async () => {
      (ConnectionRepository.findAllConnectionsWithTags as any).mockResolvedValue([]);

      const result = await getAllConnections();

      expect(result).toEqual([]);
    });
  });

  describe('getConnectionById', () => {
    it('应返回指定 ID 的连接', async () => {
      const mockConnection = {
        id: 1,
        name: '测试服务器',
        type: 'SSH',
        host: '192.168.1.1',
        port: 22,
        tag_ids: [1],
      };
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(mockConnection);

      const result = await getConnectionById(1);

      expect(result).toEqual(mockConnection);
      expect(ConnectionRepository.findConnectionByIdWithTags).toHaveBeenCalledWith(1);
    });

    it('连接不存在时应返回 null', async () => {
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(null);

      const result = await getConnectionById(999);

      expect(result).toBeNull();
    });
  });

  describe('createConnection', () => {
    describe('SSH 连接', () => {
      it('应成功创建密码认证的 SSH 连接', async () => {
        const input = {
          name: '新 SSH 服务器',
          type: 'SSH',
          host: '192.168.1.100',
          port: 22,
          username: 'admin',
          auth_method: 'password' as const,
          password: 'secret123',
        };

        (ConnectionRepository.createConnection as any).mockResolvedValue(1);
        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
          id: 1,
          ...input,
          tag_ids: [],
        });

        const result = await createConnection(input);

        expect(result.id).toBe(1);
        expect(ConnectionRepository.createConnection).toHaveBeenCalledWith(
          expect.objectContaining({
            name: '新 SSH 服务器',
            type: 'SSH',
            host: '192.168.1.100',
            auth_method: 'password',
            encrypted_password: 'encrypted_secret123',
          })
        );
      });

      it('应成功创建密钥认证的 SSH 连接（直接提供密钥）', async () => {
        const input = {
          name: '密钥服务器',
          type: 'SSH',
          host: '192.168.1.101',
          port: 22,
          username: 'deploy',
          auth_method: 'key' as const,
          private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
          passphrase: 'keypass',
        };

        (ConnectionRepository.createConnection as any).mockResolvedValue(2);
        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
          id: 2,
          ...input,
          tag_ids: [],
        });

        const result = await createConnection(input);

        expect(result.id).toBe(2);
        expect(ConnectionRepository.createConnection).toHaveBeenCalledWith(
          expect.objectContaining({
            auth_method: 'key',
            encrypted_private_key: expect.stringContaining('encrypted_'),
            encrypted_passphrase: expect.stringContaining('encrypted_'),
          })
        );
      });

      it('应成功创建使用已保存密钥的 SSH 连接', async () => {
        const input = {
          name: '使用保存密钥的服务器',
          type: 'SSH',
          host: '192.168.1.102',
          port: 22,
          username: 'deploy',
          auth_method: 'key' as const,
          ssh_key_id: 5,
        };

        (SshKeyService.getSshKeyDbRowById as any).mockResolvedValue({ id: 5, name: '我的密钥' });
        (ConnectionRepository.createConnection as any).mockResolvedValue(3);
        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
          id: 3,
          ...input,
          tag_ids: [],
        });

        const result = await createConnection(input);

        expect(result.id).toBe(3);
        expect(SshKeyService.getSshKeyDbRowById).toHaveBeenCalledWith(5);
      });

      it('SSH 密钥认证但未提供密钥或 ssh_key_id 时应抛出错误', async () => {
        const input = {
          name: '无效服务器',
          type: 'SSH',
          host: '192.168.1.103',
          username: 'user',
          auth_method: 'key' as const,
        };

        await expect(createConnection(input)).rejects.toThrow(
          'SSH 密钥认证方式需要提供 private_key 或选择一个已保存的密钥'
        );
      });

      it('同时提供 private_key 和 ssh_key_id 时应抛出错误', async () => {
        const input = {
          name: '冲突服务器',
          type: 'SSH',
          host: '192.168.1.104',
          username: 'user',
          auth_method: 'key' as const,
          private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
          ssh_key_id: 5,
        };

        await expect(createConnection(input)).rejects.toThrow(
          '不能同时提供 private_key 和 ssh_key_id'
        );
      });

      it('SSH 密码认证但未提供密码时应抛出错误', async () => {
        const input = {
          name: '无密码服务器',
          type: 'SSH',
          host: '192.168.1.105',
          username: 'user',
          auth_method: 'password' as const,
        };

        await expect(createConnection(input)).rejects.toThrow('SSH 密码认证方式需要提供 password');
      });

      it('SSH 连接未提供认证方式时应抛出错误', async () => {
        const input = {
          name: '无认证服务器',
          type: 'SSH',
          host: '192.168.1.106',
          username: 'user',
        };

        await expect(createConnection(input as any)).rejects.toThrow(
          'SSH 连接必须提供有效的认证方式'
        );
      });
    });

    describe('RDP 连接', () => {
      it('应成功创建 RDP 连接', async () => {
        const input = {
          name: 'Windows 服务器',
          type: 'RDP',
          host: '192.168.1.200',
          port: 3389,
          username: 'Administrator',
          password: 'WinPass123',
        };

        (ConnectionRepository.createConnection as any).mockResolvedValue(10);
        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
          id: 10,
          ...input,
          tag_ids: [],
        });

        const result = await createConnection(input);

        expect(result.id).toBe(10);
        expect(ConnectionRepository.createConnection).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'RDP',
            port: 3389,
            auth_method: 'password',
            encrypted_password: 'encrypted_WinPass123',
          })
        );
      });

      it('RDP 未提供密码时应抛出错误', async () => {
        const input = {
          name: '无密码 RDP',
          type: 'RDP',
          host: '192.168.1.201',
          username: 'admin',
        };

        await expect(createConnection(input as any)).rejects.toThrow('RDP 连接需要提供 password');
      });
    });

    describe('VNC 连接', () => {
      it('应成功创建 VNC 连接', async () => {
        const input = {
          name: 'VNC 桌面',
          type: 'VNC',
          host: '192.168.1.300',
          port: 5900,
          username: 'vnc_user',
          password: 'VncPass',
        };

        (ConnectionRepository.createConnection as any).mockResolvedValue(20);
        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
          id: 20,
          ...input,
          tag_ids: [],
        });

        const result = await createConnection(input);

        expect(result.id).toBe(20);
        expect(ConnectionRepository.createConnection).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'VNC',
            port: 5900,
            auth_method: 'password',
          })
        );
      });

      it('VNC 未提供密码时应抛出错误', async () => {
        const input = {
          name: '无密码 VNC',
          type: 'VNC',
          host: '192.168.1.301',
          username: 'user',
        };

        await expect(createConnection(input as any)).rejects.toThrow('VNC 连接需要提供 password');
      });

      it('VNC 使用密钥认证时应抛出错误', async () => {
        const input = {
          name: '密钥 VNC',
          type: 'VNC',
          host: '192.168.1.302',
          username: 'user',
          password: 'pass',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        };

        await expect(createConnection(input as any)).rejects.toThrow('VNC 连接不支持 SSH 密钥认证');
      });
    });

    describe('通用验证', () => {
      it('未提供连接类型时应抛出错误', async () => {
        const input = {
          name: '无类型连接',
          host: '192.168.1.1',
          username: 'user',
        };

        await expect(createConnection(input as any)).rejects.toThrow('必须提供有效的连接类型');
      });

      it('未提供 host 时应抛出错误', async () => {
        const input = {
          name: '无 host',
          type: 'SSH',
          username: 'user',
          auth_method: 'password',
          password: 'pass',
        };

        await expect(createConnection(input as any)).rejects.toThrow('缺少必要的连接信息');
      });

      it('未提供 username 时应抛出错误', async () => {
        const input = {
          name: '无用户名',
          type: 'SSH',
          host: '192.168.1.1',
          auth_method: 'password',
          password: 'pass',
        };

        await expect(createConnection(input as any)).rejects.toThrow('缺少必要的连接信息');
      });

      it('应使用默认端口当未指定时', async () => {
        const sshInput = {
          name: 'SSH 默认端口',
          type: 'SSH',
          host: '192.168.1.1',
          username: 'user',
          auth_method: 'password' as const,
          password: 'pass',
        };

        (ConnectionRepository.createConnection as any).mockResolvedValue(100);
        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
          id: 100,
          ...sshInput,
          port: 22,
          tag_ids: [],
        });

        await createConnection(sshInput);

        expect(ConnectionRepository.createConnection).toHaveBeenCalledWith(
          expect.objectContaining({ port: 22 })
        );
      });

      it('应正确处理标签', async () => {
        const input = {
          name: '带标签连接',
          type: 'SSH',
          host: '192.168.1.1',
          username: 'user',
          auth_method: 'password' as const,
          password: 'pass',
          tag_ids: [1, 2, 3],
        };

        (ConnectionRepository.createConnection as any).mockResolvedValue(101);
        (ConnectionRepository.updateConnectionTags as any).mockResolvedValue(true);
        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
          id: 101,
          ...input,
        });

        await createConnection(input);

        expect(ConnectionRepository.updateConnectionTags).toHaveBeenCalledWith(101, [1, 2, 3]);
      });
    });

    describe('jump_chain 验证', () => {
      it('应成功创建带 jump_chain 的连接', async () => {
        const jumpConnection = {
          id: 50,
          name: '跳板机',
          type: 'SSH',
          host: '10.0.0.1',
          tag_ids: [],
        };

        const input = {
          name: '目标服务器',
          type: 'SSH',
          host: '192.168.1.1',
          username: 'user',
          auth_method: 'password' as const,
          password: 'pass',
          jump_chain: [50],
        };

        (ConnectionRepository.findConnectionByIdWithTags as any)
          .mockResolvedValueOnce(jumpConnection) // 验证 jump_chain 中的连接
          .mockResolvedValueOnce({ id: 102, ...input, tag_ids: [] }); // 返回新创建的连接
        (ConnectionRepository.createConnection as any).mockResolvedValue(102);

        const result = await createConnection(input);

        expect(result.id).toBe(102);
      });

      it('jump_chain 包含不存在的连接时应抛出错误', async () => {
        const input = {
          name: '目标服务器',
          type: 'SSH',
          host: '192.168.1.1',
          username: 'user',
          auth_method: 'password' as const,
          password: 'pass',
          jump_chain: [999],
        };

        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(null);

        await expect(createConnection(input)).rejects.toThrow('jump_chain 中的连接 ID 999 未找到');
      });

      it('jump_chain 包含非 SSH 类型连接时应抛出错误', async () => {
        const rdpConnection = {
          id: 60,
          name: 'Windows',
          type: 'RDP',
          host: '10.0.0.2',
          tag_ids: [],
        };

        const input = {
          name: '目标服务器',
          type: 'SSH',
          host: '192.168.1.1',
          username: 'user',
          auth_method: 'password' as const,
          password: 'pass',
          jump_chain: [60],
        };

        (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(rdpConnection);

        await expect(createConnection(input)).rejects.toThrow(
          'jump_chain 中的连接 ID 60 (Windows) 不是 SSH 类型'
        );
      });
    });
  });

  describe('updateConnection', () => {
    const mockCurrentConnection = {
      id: 1,
      name: '原始服务器',
      type: 'SSH',
      host: '192.168.1.1',
      port: 22,
      username: 'olduser',
      auth_method: 'password',
      encrypted_password: 'encrypted_oldpass',
      encrypted_private_key: null,
      encrypted_passphrase: null,
      ssh_key_id: null,
      proxy_id: null,
      jump_chain: null,
    };

    it('应成功更新基本字段', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockCurrentConnection);
      (ConnectionRepository.updateConnection as any).mockResolvedValue(true);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        ...mockCurrentConnection,
        name: '新名称',
        tag_ids: [],
      });

      const result = await updateConnection(1, { name: '新名称' });

      expect(result?.name).toBe('新名称');
      expect(ConnectionRepository.updateConnection).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: '新名称' })
      );
    });

    it('连接不存在时应返回 null', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(null);

      const result = await updateConnection(999, { name: '新名称' });

      expect(result).toBeNull();
      expect(ConnectionRepository.updateConnection).not.toHaveBeenCalled();
    });

    it('应成功更新密码', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockCurrentConnection);
      (ConnectionRepository.updateConnection as any).mockResolvedValue(true);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        ...mockCurrentConnection,
        tag_ids: [],
      });

      await updateConnection(1, { password: 'newpassword' });

      expect(ConnectionRepository.updateConnection).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          encrypted_password: 'encrypted_newpassword',
        })
      );
    });

    it('应成功从密码认证切换到密钥认证', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockCurrentConnection);
      (ConnectionRepository.updateConnection as any).mockResolvedValue(true);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        ...mockCurrentConnection,
        auth_method: 'key',
        tag_ids: [],
      });

      await updateConnection(1, {
        auth_method: 'key',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
      });

      expect(ConnectionRepository.updateConnection).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          auth_method: 'key',
          encrypted_private_key: expect.stringContaining('encrypted_'),
          encrypted_password: null,
        })
      );
    });

    it('应成功切换到使用保存的 SSH 密钥', async () => {
      const keyAuthConnection = {
        ...mockCurrentConnection,
        auth_method: 'key',
        encrypted_private_key: 'encrypted_oldkey',
      };

      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(keyAuthConnection);
      (SshKeyService.getSshKeyDbRowById as any).mockResolvedValue({ id: 10, name: '保存的密钥' });
      (ConnectionRepository.updateConnection as any).mockResolvedValue(true);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        ...keyAuthConnection,
        ssh_key_id: 10,
        tag_ids: [],
      });

      await updateConnection(1, { ssh_key_id: 10 });

      expect(SshKeyService.getSshKeyDbRowById).toHaveBeenCalledWith(10);
      expect(ConnectionRepository.updateConnection).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          ssh_key_id: 10,
          encrypted_private_key: null,
          encrypted_passphrase: null,
        })
      );
    });

    it('无效的 ssh_key_id 应抛出错误', async () => {
      const keyAuthConnection = {
        ...mockCurrentConnection,
        auth_method: 'key',
        encrypted_private_key: 'encrypted_oldkey',
      };

      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(keyAuthConnection);
      (SshKeyService.getSshKeyDbRowById as any).mockResolvedValue(null);

      await expect(updateConnection(1, { ssh_key_id: 999 })).rejects.toThrow(
        '提供的 SSH 密钥 ID 999 无效或不存在'
      );
    });

    it('应成功更新标签', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockCurrentConnection);
      (ConnectionRepository.updateConnectionTags as any).mockResolvedValue(true);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        ...mockCurrentConnection,
        tag_ids: [1, 2],
      });

      await updateConnection(1, { tag_ids: [1, 2] });

      expect(ConnectionRepository.updateConnectionTags).toHaveBeenCalledWith(1, [1, 2]);
    });

    it('应成功更新 jump_chain', async () => {
      const jumpConnection = {
        id: 50,
        name: '跳板机',
        type: 'SSH',
        host: '10.0.0.1',
        tag_ids: [],
      };

      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockCurrentConnection);
      (ConnectionRepository.findConnectionByIdWithTags as any)
        .mockResolvedValueOnce(jumpConnection) // 验证 jump_chain
        .mockResolvedValueOnce({ ...mockCurrentConnection, jump_chain: [50], tag_ids: [] });
      (ConnectionRepository.updateConnection as any).mockResolvedValue(true);

      await updateConnection(1, { jump_chain: [50] });

      expect(ConnectionRepository.updateConnection).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          jump_chain: [50],
        })
      );
    });

    it('jump_chain 包含自身 ID 时应抛出错误', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockCurrentConnection);

      await expect(updateConnection(1, { jump_chain: [1] })).rejects.toThrow(
        'jump_chain 不能包含当前连接自身的 ID'
      );
    });
  });

  describe('deleteConnection', () => {
    it('应成功删除连接', async () => {
      (ConnectionRepository.deleteConnection as any).mockResolvedValue(true);

      const result = await deleteConnection(1);

      expect(result).toBe(true);
      expect(ConnectionRepository.deleteConnection).toHaveBeenCalledWith(1);
    });

    it('删除不存在的连接应返回 false', async () => {
      (ConnectionRepository.deleteConnection as any).mockResolvedValue(false);

      const result = await deleteConnection(999);

      expect(result).toBe(false);
    });
  });

  describe('getConnectionWithDecryptedCredentials', () => {
    it('应返回解密后的密码（密码认证）', async () => {
      const fullConnection = {
        id: 1,
        name: '服务器',
        type: 'SSH',
        host: '192.168.1.1',
        port: 22,
        username: 'user',
        auth_method: 'password',
        encrypted_password: 'encrypted_mypassword',
        encrypted_private_key: null,
        encrypted_passphrase: null,
        ssh_key_id: null,
      };

      const connectionWithTags = {
        ...fullConnection,
        tag_ids: [],
      };

      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(fullConnection);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(
        connectionWithTags
      );

      const result = await getConnectionWithDecryptedCredentials(1);

      expect(result?.decryptedPassword).toBe('mypassword');
      expect(result?.decryptedPrivateKey).toBeUndefined();
    });

    it('应返回解密后的私钥（直接密钥认证）', async () => {
      const fullConnection = {
        id: 2,
        name: '密钥服务器',
        type: 'SSH',
        host: '192.168.1.2',
        port: 22,
        username: 'user',
        auth_method: 'key',
        encrypted_password: null,
        encrypted_private_key: 'encrypted_-----BEGIN RSA-----',
        encrypted_passphrase: 'encrypted_keypass',
        ssh_key_id: null,
      };

      const connectionWithTags = {
        ...fullConnection,
        tag_ids: [],
      };

      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(fullConnection);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(
        connectionWithTags
      );

      const result = await getConnectionWithDecryptedCredentials(2);

      expect(result?.decryptedPrivateKey).toBe('-----BEGIN RSA-----');
      expect(result?.decryptedPassphrase).toBe('keypass');
      expect(result?.decryptedPassword).toBeUndefined();
    });

    it('应从保存的密钥获取解密凭证（ssh_key_id 认证）', async () => {
      const fullConnection = {
        id: 3,
        name: '保存密钥服务器',
        type: 'SSH',
        host: '192.168.1.3',
        port: 22,
        username: 'user',
        auth_method: 'key',
        encrypted_password: null,
        encrypted_private_key: null,
        encrypted_passphrase: null,
        ssh_key_id: 10,
      };

      const connectionWithTags = {
        ...fullConnection,
        tag_ids: [],
      };

      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(fullConnection);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(
        connectionWithTags
      );
      (SshKeyService.getDecryptedSshKeyById as any).mockResolvedValue({
        privateKey: '-----BEGIN RSA STORED-----',
        passphrase: 'storedkeypass',
      });

      const result = await getConnectionWithDecryptedCredentials(3);

      expect(result?.decryptedPrivateKey).toBe('-----BEGIN RSA STORED-----');
      expect(result?.decryptedPassphrase).toBe('storedkeypass');
      expect(SshKeyService.getDecryptedSshKeyById).toHaveBeenCalledWith(10);
    });

    it('ssh_key_id 引用的密钥不存在时应抛出错误', async () => {
      const fullConnection = {
        id: 4,
        name: '无效密钥服务器',
        type: 'SSH',
        host: '192.168.1.4',
        port: 22,
        username: 'user',
        auth_method: 'key',
        encrypted_password: null,
        encrypted_private_key: null,
        encrypted_passphrase: null,
        ssh_key_id: 999,
      };

      const connectionWithTags = {
        ...fullConnection,
        tag_ids: [],
      };

      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(fullConnection);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue(
        connectionWithTags
      );
      (SshKeyService.getDecryptedSshKeyById as any).mockResolvedValue(null);

      await expect(getConnectionWithDecryptedCredentials(4)).rejects.toThrow(
        '关联的 SSH 密钥 (ID: 999) 未找到'
      );
    });

    it('连接不存在时应返回 null', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(null);

      const result = await getConnectionWithDecryptedCredentials(999);

      expect(result).toBeNull();
    });
  });

  describe('cloneConnection', () => {
    const originalConnection = {
      id: 1,
      name: '原始连接',
      type: 'SSH',
      host: '192.168.1.1',
      port: 22,
      username: 'user',
      auth_method: 'password',
      encrypted_password: 'encrypted_pass',
      encrypted_private_key: null,
      encrypted_passphrase: null,
      ssh_key_id: null,
      proxy_id: null,
      proxy_type: null,
      notes: '测试备注',
      jump_chain: null,
    };

    it('应成功克隆连接', async () => {
      (ConnectionRepository.findConnectionByName as any).mockResolvedValue(null);
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(originalConnection);
      (ConnectionRepository.createConnection as any).mockResolvedValue(2);
      (ConnectionRepository.findConnectionTags as any).mockResolvedValue([
        { id: 1, name: '标签1' },
      ]);
      (ConnectionRepository.updateConnectionTags as any).mockResolvedValue(true);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        id: 2,
        name: '克隆的连接',
        type: 'SSH',
        host: '192.168.1.1',
        tag_ids: [1],
      });

      const result = await cloneConnection(1, '克隆的连接');

      expect(result.id).toBe(2);
      expect(result.name).toBe('克隆的连接');
      expect(ConnectionRepository.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '克隆的连接',
          host: '192.168.1.1',
          encrypted_password: 'encrypted_pass',
        })
      );
      expect(ConnectionRepository.updateConnectionTags).toHaveBeenCalledWith(2, [1]);
    });

    it('新名称已存在时应抛出错误', async () => {
      (ConnectionRepository.findConnectionByName as any).mockResolvedValue({
        id: 10,
        name: '已存在',
      });

      await expect(cloneConnection(1, '已存在')).rejects.toThrow('名称为 "已存在" 的连接已存在');
    });

    it('原始连接不存在时应抛出错误', async () => {
      (ConnectionRepository.findConnectionByName as any).mockResolvedValue(null);
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(null);

      await expect(cloneConnection(999, '新连接')).rejects.toThrow('ID 为 999 的原始连接未找到');
    });

    it('应正确复制 jump_chain', async () => {
      const connectionWithJumpChain = {
        ...originalConnection,
        jump_chain: '[50, 51]', // JSON string in DB
      };

      (ConnectionRepository.findConnectionByName as any).mockResolvedValue(null);
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(
        connectionWithJumpChain
      );
      (ConnectionRepository.createConnection as any).mockResolvedValue(3);
      (ConnectionRepository.findConnectionTags as any).mockResolvedValue([]);
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        id: 3,
        name: '克隆带跳板',
        tag_ids: [],
        jump_chain: [50, 51],
      });

      await cloneConnection(1, '克隆带跳板');

      expect(ConnectionRepository.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          jump_chain: [50, 51],
        })
      );
    });
  });

  describe('addTagToConnections', () => {
    it('应成功为多个连接添加标签', async () => {
      (ConnectionRepository.addTagToMultipleConnections as any).mockResolvedValue(undefined);

      await addTagToConnections([1, 2, 3], 5);

      expect(ConnectionRepository.addTagToMultipleConnections).toHaveBeenCalledWith([1, 2, 3], 5);
    });

    it('仓库层抛出错误时应传播错误', async () => {
      (ConnectionRepository.addTagToMultipleConnections as any).mockRejectedValue(
        new Error('数据库错误')
      );

      await expect(addTagToConnections([1, 2], 5)).rejects.toThrow('数据库错误');
    });
  });

  describe('updateConnectionTags', () => {
    it('应成功更新连接标签', async () => {
      (ConnectionRepository.updateConnectionTags as any).mockResolvedValue(true);

      const result = await updateConnectionTags(1, [1, 2, 3]);

      expect(result).toBe(true);
      expect(ConnectionRepository.updateConnectionTags).toHaveBeenCalledWith(1, [1, 2, 3]);
    });

    it('连接不存在时应返回 false', async () => {
      (ConnectionRepository.updateConnectionTags as any).mockResolvedValue(false);

      const result = await updateConnectionTags(999, [1]);

      expect(result).toBe(false);
    });

    it('仓库层抛出错误时应传播错误', async () => {
      (ConnectionRepository.updateConnectionTags as any).mockRejectedValue(new Error('事务失败'));

      await expect(updateConnectionTags(1, [1, 2])).rejects.toThrow('事务失败');
    });
  });
});
