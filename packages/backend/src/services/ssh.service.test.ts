/**
 * SSH Service 单元测试
 * 测试 SSH 连接管理的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { Client } from 'ssh2';
import { SocksClient } from 'socks';
import http from 'http';
import {
  getConnectionDetails,
  establishSshConnection,
  openShell,
  testConnection,
  testUnsavedConnection,
  DecryptedConnectionDetails,
} from './ssh.service';
import * as ConnectionRepository from '../connections/connection.repository';
import * as ProxyRepository from '../proxies/proxy.repository';
import * as SshKeyService from '../ssh-keys/ssh-keys.service';
import { decrypt } from '../utils/crypto';

// Mock ssh2 Client
class MockSshClient extends EventEmitter {
  connect = vi.fn();
  end = vi.fn();
  shell = vi.fn();
  forwardOut = vi.fn();
}

vi.mock('ssh2', () => ({
  Client: vi.fn(() => new MockSshClient()),
}));

// Mock SocksClient
vi.mock('socks', () => ({
  SocksClient: {
    createConnection: vi.fn(),
  },
}));

// Mock http module
vi.mock('http', () => ({
  default: {
    request: vi.fn(),
  },
}));

// Mock connection repository
vi.mock('../connections/connection.repository', () => ({
  findFullConnectionById: vi.fn(),
  updateLastConnected: vi.fn(),
}));

// Mock proxy repository
vi.mock('../proxies/proxy.repository', () => ({
  findProxyById: vi.fn(),
}));

// Mock crypto
vi.mock('../utils/crypto', () => ({
  decrypt: vi.fn((value: string) => value.replace('encrypted_', '')),
}));

// Mock SSH key service
vi.mock('../ssh-keys/ssh-keys.service', () => ({
  getDecryptedSshKeyById: vi.fn(),
}));

describe('SSH Service', () => {
  let mockClient: MockSshClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new MockSshClient();
    (Client as any).mockImplementation(() => mockClient);
  });

  afterEach(() => {
    // 注意：不要使用 vi.resetAllMocks()，它会清除 mock 函数的实现
    // vi.clearAllMocks() 已在 beforeEach 中执行，用于清除调用记录
  });

  describe('getConnectionDetails', () => {
    const baseRawConnection = {
      id: 1,
      name: '测试服务器',
      host: '192.168.1.1',
      port: 22,
      username: 'testuser',
      auth_method: 'password',
      encrypted_password: 'encrypted_testpass',
      encrypted_private_key: null,
      encrypted_passphrase: null,
      ssh_key_id: null,
      proxy_db_id: null,
      jump_chain: null,
      proxy_type: null,
    };

    it('应成功获取密码认证的连接详情', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(baseRawConnection);

      const result = await getConnectionDetails(1);

      expect(result.id).toBe(1);
      expect(result.name).toBe('测试服务器');
      expect(result.host).toBe('192.168.1.1');
      expect(result.port).toBe(22);
      expect(result.username).toBe('testuser');
      expect(result.auth_method).toBe('password');
      expect(result.password).toBe('testpass');
      expect(result.privateKey).toBeUndefined();
    });

    it('应成功获取直接密钥认证的连接详情', async () => {
      const keyConnection = {
        ...baseRawConnection,
        auth_method: 'key',
        encrypted_password: null,
        encrypted_private_key: 'encrypted_-----BEGIN RSA-----',
        encrypted_passphrase: 'encrypted_keypass',
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(keyConnection);

      const result = await getConnectionDetails(1);

      expect(result.auth_method).toBe('key');
      expect(result.privateKey).toBe('-----BEGIN RSA-----');
      expect(result.passphrase).toBe('keypass');
      expect(result.password).toBeUndefined();
    });

    it('应成功获取使用保存密钥的连接详情', async () => {
      const savedKeyConnection = {
        ...baseRawConnection,
        auth_method: 'key',
        encrypted_password: null,
        ssh_key_id: 10,
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(savedKeyConnection);
      (SshKeyService.getDecryptedSshKeyById as any).mockResolvedValue({
        privateKey: '-----BEGIN RSA STORED-----',
        passphrase: 'storedpass',
      });

      const result = await getConnectionDetails(1);

      expect(result.privateKey).toBe('-----BEGIN RSA STORED-----');
      expect(result.passphrase).toBe('storedpass');
      expect(SshKeyService.getDecryptedSshKeyById).toHaveBeenCalledWith(10);
    });

    it('保存的密钥不存在时应抛出错误', async () => {
      const savedKeyConnection = {
        ...baseRawConnection,
        auth_method: 'key',
        ssh_key_id: 999,
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(savedKeyConnection);
      (SshKeyService.getDecryptedSshKeyById as any).mockResolvedValue(null);

      await expect(getConnectionDetails(1)).rejects.toThrow('关联的 SSH 密钥 (ID: 999) 未找到');
    });

    it('连接不存在时应抛出错误', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(null);

      await expect(getConnectionDetails(999)).rejects.toThrow('连接配置 ID 999 未找到');
    });

    it('应正确处理代理配置', async () => {
      const proxyConnection = {
        ...baseRawConnection,
        proxy_db_id: 5,
        proxy_name: '代理服务器',
        actual_proxy_server_type: 'SOCKS5',
        proxy_host: '10.0.0.1',
        proxy_port: 1080,
        proxy_username: 'proxyuser',
        proxy_encrypted_password: 'encrypted_proxypass',
        proxy_type: 'proxy',
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(proxyConnection);

      const result = await getConnectionDetails(1);

      expect(result.proxy).not.toBeNull();
      expect(result.proxy?.id).toBe(5);
      expect(result.proxy?.name).toBe('代理服务器');
      expect(result.proxy?.type).toBe('SOCKS5');
      expect(result.proxy?.host).toBe('10.0.0.1');
      expect(result.proxy?.port).toBe(1080);
      expect(result.proxy?.username).toBe('proxyuser');
      expect(result.proxy?.password).toBe('proxypass');
      expect(result.connection_proxy_setting).toBe('proxy');
    });

    it('应正确处理 HTTP 代理配置', async () => {
      const httpProxyConnection = {
        ...baseRawConnection,
        proxy_db_id: 6,
        proxy_name: 'HTTP 代理',
        actual_proxy_server_type: 'HTTP',
        proxy_host: '10.0.0.2',
        proxy_port: 8080,
        proxy_username: null,
        proxy_encrypted_password: null,
        proxy_type: 'proxy',
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(httpProxyConnection);

      const result = await getConnectionDetails(1);

      expect(result.proxy?.type).toBe('HTTP');
      expect(result.proxy?.username).toBeUndefined();
      expect(result.proxy?.password).toBeUndefined();
    });

    it('应正确处理跳板机链配置', async () => {
      const jumpConnection = {
        ...baseRawConnection,
        jump_chain: '[50]',
        proxy_type: 'jump',
      };
      const jumpHostConnection = {
        ...baseRawConnection,
        id: 50,
        name: '跳板机',
        host: '10.0.0.50',
      };

      (ConnectionRepository.findFullConnectionById as any)
        .mockResolvedValueOnce(jumpConnection) // 主连接
        .mockResolvedValueOnce(jumpHostConnection); // 跳板机

      const result = await getConnectionDetails(1);

      expect(result.connection_proxy_setting).toBe('jump');
      expect(result.jump_chain).toHaveLength(1);
      expect(result.jump_chain?.[0].host).toBe('10.0.0.50');
      expect(result.jump_chain?.[0].name).toBe('跳板机');
    });

    it('跳板机链包含自身 ID 时应抛出错误', async () => {
      const selfRefConnection = {
        ...baseRawConnection,
        jump_chain: '[1]',
        proxy_type: 'jump',
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(selfRefConnection);

      await expect(getConnectionDetails(1)).rejects.toThrow('解析或处理跳板机配置失败');
    });

    it('跳板机链 JSON 格式错误时应抛出错误', async () => {
      const invalidJsonConnection = {
        ...baseRawConnection,
        jump_chain: 'invalid json',
        proxy_type: 'jump',
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(invalidJsonConnection);

      await expect(getConnectionDetails(1)).rejects.toThrow('解析或处理跳板机配置失败');
    });

    it('必要字段为 null 时应抛出错误', async () => {
      const nullHostConnection = {
        ...baseRawConnection,
        host: null,
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(nullHostConnection);

      await expect(getConnectionDetails(1)).rejects.toThrow('处理凭证或配置失败');
    });
  });

  describe('establishSshConnection', () => {
    const baseConnDetails: DecryptedConnectionDetails = {
      id: 1,
      name: '测试服务器',
      host: '192.168.1.1',
      port: 22,
      username: 'testuser',
      auth_method: 'password',
      password: 'testpass',
      proxy: null,
      connection_proxy_setting: null,
    };

    it('应成功建立直接 SSH 连接', async () => {
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      const connectionPromise = establishSshConnection(baseConnDetails);

      const client = await connectionPromise;

      expect(client).toBe(mockClient);
      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '192.168.1.1',
          port: 22,
          username: 'testuser',
          password: 'testpass',
        })
      );
      expect(ConnectionRepository.updateLastConnected).toHaveBeenCalled();
    });

    it('应成功建立密钥认证的 SSH 连接', async () => {
      const keyConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        auth_method: 'key',
        password: undefined,
        privateKey: '-----BEGIN RSA-----',
        passphrase: 'keypass',
      };

      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await establishSshConnection(keyConnDetails);

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: '-----BEGIN RSA-----',
          passphrase: 'keypass',
        })
      );
    });

    it('连接错误时应拒绝 Promise', async () => {
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('error', new Error('Connection refused')), 10);
      });

      await expect(establishSshConnection(baseConnDetails)).rejects.toThrow('Connection refused');
    });

    it('应通过 SOCKS5 代理建立连接', async () => {
      const proxyConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'proxy',
        proxy: {
          id: 5,
          name: 'SOCKS5 代理',
          type: 'SOCKS5',
          host: '10.0.0.1',
          port: 1080,
          username: 'proxyuser',
          password: 'proxypass',
        },
      };

      const mockSocket = new EventEmitter();
      (SocksClient.createConnection as any).mockResolvedValue({ socket: mockSocket });
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await establishSshConnection(proxyConnDetails);

      expect(SocksClient.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          proxy: expect.objectContaining({
            host: '10.0.0.1',
            port: 1080,
            type: 5,
            userId: 'proxyuser',
            password: 'proxypass',
          }),
          destination: { host: '192.168.1.1', port: 22 },
        })
      );
      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          sock: mockSocket,
        })
      );
    });

    it('SOCKS5 代理连接失败时应抛出错误', async () => {
      const proxyConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'proxy',
        proxy: {
          id: 5,
          name: 'SOCKS5 代理',
          type: 'SOCKS5',
          host: '10.0.0.1',
          port: 1080,
        },
      };

      (SocksClient.createConnection as any).mockRejectedValue(new Error('Proxy timeout'));

      await expect(establishSshConnection(proxyConnDetails)).rejects.toThrow(
        'SOCKS5 proxy 10.0.0.1:1080 connection failed'
      );
    });

    it('应通过 HTTP 代理建立连接', async () => {
      const httpProxyConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'proxy',
        proxy: {
          id: 6,
          name: 'HTTP 代理',
          type: 'HTTP',
          host: '10.0.0.2',
          port: 8080,
        },
      };

      const mockSocket = new EventEmitter();
      const mockRequest = new EventEmitter() as any;
      mockRequest.end = vi.fn();
      mockRequest.destroy = vi.fn();

      (http.request as any).mockReturnValue(mockRequest);
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      const connectionPromise = establishSshConnection(httpProxyConnDetails);

      // 模拟 HTTP CONNECT 成功
      setTimeout(() => {
        mockRequest.emit('connect', { statusCode: 200 }, mockSocket, Buffer.alloc(0));
      }, 5);

      await connectionPromise;

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'CONNECT',
          host: '10.0.0.2',
          port: 8080,
          path: '192.168.1.1:22',
        })
      );
    });

    it('HTTP 代理返回非 200 状态码时应抛出错误', async () => {
      const httpProxyConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'proxy',
        proxy: {
          id: 6,
          name: 'HTTP 代理',
          type: 'HTTP',
          host: '10.0.0.2',
          port: 8080,
        },
      };

      const mockSocket = { destroy: vi.fn() };
      const mockRequest = new EventEmitter() as any;
      mockRequest.end = vi.fn();

      (http.request as any).mockReturnValue(mockRequest);

      const connectionPromise = establishSshConnection(httpProxyConnDetails);

      setTimeout(() => {
        mockRequest.emit('connect', { statusCode: 407 }, mockSocket, Buffer.alloc(0));
      }, 5);

      await expect(connectionPromise).rejects.toThrow('HTTP proxy 10.0.0.2:8080 connection failed');
    });

    it('HTTP 代理请求错误时应抛出错误', async () => {
      const httpProxyConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'proxy',
        proxy: {
          id: 6,
          name: 'HTTP 代理',
          type: 'HTTP',
          host: '10.0.0.2',
          port: 8080,
        },
      };

      const mockRequest = new EventEmitter() as any;
      mockRequest.end = vi.fn();

      (http.request as any).mockReturnValue(mockRequest);

      const connectionPromise = establishSshConnection(httpProxyConnDetails);

      setTimeout(() => {
        mockRequest.emit('error', new Error('Network error'));
      }, 5);

      await expect(connectionPromise).rejects.toThrow('HTTP proxy 10.0.0.2:8080 request error');
    });

    it('设置为 proxy 但没有代理配置时应回退到直连', async () => {
      const noProxyConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'proxy',
        proxy: null,
      };

      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await establishSshConnection(noProxyConnDetails);

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '192.168.1.1',
          port: 22,
        })
      );
    });

    it('设置为 jump 但没有跳板机链时应回退到直连', async () => {
      const noJumpConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'jump',
        jump_chain: undefined,
      };

      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await establishSshConnection(noJumpConnDetails);

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '192.168.1.1',
        })
      );
    });

    it('应正确处理跳板机链连接', async () => {
      const jumpConnDetails: DecryptedConnectionDetails = {
        ...baseConnDetails,
        connection_proxy_setting: 'jump',
        jump_chain: [
          {
            id: 'hop-1',
            name: '跳板机1',
            host: '10.0.0.50',
            port: 22,
            username: 'jumpuser',
            auth_method: 'password',
            password: 'jumppass',
          },
        ],
      };

      const mockStream = new EventEmitter();
      let clientCount = 0;

      // 需要两个 Client：一个用于跳板机，一个用于最终目标
      (Client as any).mockImplementation(() => {
        clientCount++;
        const client = new MockSshClient();

        if (clientCount === 1) {
          // 跳板机客户端
          client.connect.mockImplementation(function (this: MockSshClient) {
            setTimeout(() => this.emit('ready'), 10);
          });
          client.forwardOut.mockImplementation((srcHost, srcPort, dstHost, dstPort, callback) => {
            setTimeout(() => callback(null, mockStream), 10);
          });
        } else {
          // 最终目标客户端
          client.connect.mockImplementation(function (this: MockSshClient) {
            setTimeout(() => this.emit('ready'), 10);
          });
        }

        return client;
      });

      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      const result = await establishSshConnection(jumpConnDetails);

      expect(result).toBeDefined();
      expect(clientCount).toBe(2);
    });
  });

  describe('openShell', () => {
    it('应成功打开 Shell 通道', async () => {
      const mockStream = new EventEmitter();
      mockClient.shell.mockImplementation((callback: any) => {
        callback(null, mockStream);
      });

      const result = await openShell(mockClient as any);

      expect(result).toBe(mockStream);
      expect(mockClient.shell).toHaveBeenCalled();
    });

    it('打开 Shell 失败时应抛出错误', async () => {
      mockClient.shell.mockImplementation((callback: any) => {
        callback(new Error('Shell error'));
      });

      await expect(openShell(mockClient as any)).rejects.toThrow('打开 Shell 失败: Shell error');
    });
  });

  describe('testConnection', () => {
    const mockRawConnection = {
      id: 1,
      name: '测试服务器',
      host: '192.168.1.1',
      port: 22,
      username: 'testuser',
      auth_method: 'password',
      encrypted_password: 'encrypted_testpass',
      encrypted_private_key: null,
      encrypted_passphrase: null,
      ssh_key_id: null,
      proxy_db_id: null,
      jump_chain: null,
      proxy_type: null,
    };

    it('应成功测试连接并返回延迟', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockRawConnection);
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 50);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      const result = await testConnection(1);

      expect(result.latency).toBeGreaterThanOrEqual(50);
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('测试连接失败时应抛出错误', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(mockRawConnection);
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('error', new Error('Connection refused')), 10);
      });

      await expect(testConnection(1)).rejects.toThrow();
    });

    it('连接配置不存在时应抛出错误', async () => {
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(null);

      await expect(testConnection(999)).rejects.toThrow('连接配置 ID 999 未找到');
    });
  });

  describe('testUnsavedConnection', () => {
    it('应成功测试密码认证的未保存连接', async () => {
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 30);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      const result = await testUnsavedConnection({
        host: '192.168.1.100',
        port: 22,
        username: 'admin',
        auth_method: 'password',
        password: 'adminpass',
      });

      expect(result.latency).toBeGreaterThanOrEqual(30);
      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '192.168.1.100',
          port: 22,
          username: 'admin',
          password: 'adminpass',
        })
      );
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('应成功测试密钥认证的未保存连接', async () => {
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 20);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      const result = await testUnsavedConnection({
        host: '192.168.1.101',
        port: 22,
        username: 'deploy',
        auth_method: 'key',
        private_key: '-----BEGIN RSA-----',
        passphrase: 'keypass',
      });

      expect(result.latency).toBeGreaterThanOrEqual(20);
      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: '-----BEGIN RSA-----',
          passphrase: 'keypass',
        })
      );
    });

    it('应成功测试使用保存密钥的未保存连接', async () => {
      (SshKeyService.getDecryptedSshKeyById as any).mockResolvedValue({
        privateKey: '-----BEGIN RSA STORED-----',
        passphrase: 'storedpass',
      });
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 20);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await testUnsavedConnection({
        host: '192.168.1.102',
        port: 22,
        username: 'deploy',
        auth_method: 'key',
        ssh_key_id: 10,
      });

      expect(SshKeyService.getDecryptedSshKeyById).toHaveBeenCalledWith(10);
      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: '-----BEGIN RSA STORED-----',
          passphrase: 'storedpass',
        })
      );
    });

    it('保存的 SSH 密钥不存在时应抛出错误', async () => {
      (SshKeyService.getDecryptedSshKeyById as any).mockResolvedValue(null);

      await expect(
        testUnsavedConnection({
          host: '192.168.1.103',
          port: 22,
          username: 'deploy',
          auth_method: 'key',
          ssh_key_id: 999,
        })
      ).rejects.toThrow('选择的 SSH 密钥 (ID: 999) 未找到');
    });

    it('应成功测试带代理的未保存连接', async () => {
      const mockProxy = {
        id: 5,
        name: '代理服务器',
        type: 'SOCKS5',
        host: '10.0.0.1',
        port: 1080,
        username: 'proxyuser',
        encrypted_password: 'encrypted_proxypass',
      };
      (ProxyRepository.findProxyById as any).mockResolvedValue(mockProxy);

      const mockSocket = new EventEmitter();
      (SocksClient.createConnection as any).mockResolvedValue({ socket: mockSocket });
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 20);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await testUnsavedConnection({
        host: '192.168.1.104',
        port: 22,
        username: 'admin',
        auth_method: 'password',
        password: 'adminpass',
        proxy_id: 5,
      });

      expect(ProxyRepository.findProxyById).toHaveBeenCalledWith(5);
      expect(SocksClient.createConnection).toHaveBeenCalled();
    });

    it('代理不存在时应抛出错误', async () => {
      (ProxyRepository.findProxyById as any).mockResolvedValue(null);

      await expect(
        testUnsavedConnection({
          host: '192.168.1.105',
          port: 22,
          username: 'admin',
          auth_method: 'password',
          password: 'adminpass',
          proxy_id: 999,
        })
      ).rejects.toThrow('代理 ID 999 未找到');
    });

    it('代理类型无效时应抛出错误', async () => {
      const invalidProxy = {
        id: 7,
        name: '无效代理',
        type: 'INVALID',
        host: '10.0.0.3',
        port: 1080,
      };
      (ProxyRepository.findProxyById as any).mockResolvedValue(invalidProxy);

      await expect(
        testUnsavedConnection({
          host: '192.168.1.106',
          port: 22,
          username: 'admin',
          auth_method: 'password',
          password: 'adminpass',
          proxy_id: 7,
        })
      ).rejects.toThrow('Proxy ID 7 has invalid type: INVALID');
    });

    it('连接失败时应抛出错误并清理连接', async () => {
      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('error', new Error('Auth failed')), 10);
      });

      await expect(
        testUnsavedConnection({
          host: '192.168.1.107',
          port: 22,
          username: 'admin',
          auth_method: 'password',
          password: 'wrongpass',
        })
      ).rejects.toThrow();

      // 连接应该被清理
      expect(mockClient.end).toHaveBeenCalled();
    });
  });

  describe('边界条件与错误恢复', () => {
    it('自定义超时时间应被正确使用', async () => {
      const connDetails: DecryptedConnectionDetails = {
        id: 1,
        name: '测试服务器',
        host: '192.168.1.1',
        port: 22,
        username: 'testuser',
        auth_method: 'password',
        password: 'testpass',
        proxy: null,
        connection_proxy_setting: null,
      };

      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await establishSshConnection(connDetails, 30000);

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          readyTimeout: 30000,
        })
      );
    });

    it('updateLastConnected 失败不应影响连接成功', async () => {
      const connDetails: DecryptedConnectionDetails = {
        id: 1,
        name: '测试服务器',
        host: '192.168.1.1',
        port: 22,
        username: 'testuser',
        auth_method: 'password',
        password: 'testpass',
        proxy: null,
        connection_proxy_setting: null,
      };

      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockRejectedValue(new Error('DB error'));

      // 应该仍然成功
      const client = await establishSshConnection(connDetails);

      expect(client).toBe(mockClient);
    });

    it('应正确设置 keepalive 参数', async () => {
      const connDetails: DecryptedConnectionDetails = {
        id: 1,
        name: '测试服务器',
        host: '192.168.1.1',
        port: 22,
        username: 'testuser',
        auth_method: 'password',
        password: 'testpass',
        proxy: null,
        connection_proxy_setting: null,
      };

      mockClient.connect.mockImplementation(function (this: MockSshClient) {
        setTimeout(() => this.emit('ready'), 10);
      });
      (ConnectionRepository.updateLastConnected as any).mockResolvedValue(undefined);

      await establishSshConnection(connDetails);

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          keepaliveInterval: 5000,
          keepaliveCountMax: 10,
        })
      );
    });

    it('密钥认证但无密钥时应仍尝试连接', async () => {
      const noKeyConnection = {
        id: 1,
        name: '测试服务器',
        host: '192.168.1.1',
        port: 22,
        username: 'testuser',
        auth_method: 'key',
        encrypted_password: null,
        encrypted_private_key: null,
        encrypted_passphrase: null,
        ssh_key_id: null,
        proxy_db_id: null,
        jump_chain: null,
        proxy_type: null,
      };
      (ConnectionRepository.findFullConnectionById as any).mockResolvedValue(noKeyConnection);

      const result = await getConnectionDetails(1);

      expect(result.privateKey).toBeUndefined();
      expect(result.passphrase).toBeUndefined();
    });
  });
});
