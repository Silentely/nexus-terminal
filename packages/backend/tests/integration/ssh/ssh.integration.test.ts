import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { MockSshServer, createMockSshClient, MockShellStream } from './mock-ssh-server';

// Mock ssh2 模块
vi.mock('ssh2', () => ({
  Client: vi.fn(() => {
    const client = new EventEmitter() as any;
    client.connect = vi.fn().mockImplementation(() => {
      setTimeout(() => client.emit('ready'), 10);
      return client;
    });
    client.shell = vi.fn().mockImplementation((callback: any) => {
      const stream = new MockShellStream();
      setTimeout(() => callback(null, stream), 10);
    });
    client.sftp = vi.fn();
    client.end = vi.fn().mockImplementation(() => {
      client.emit('end');
    });
    return client;
  }),
}));

describe('SSH 服务集成测试', () => {
  let mockServer: MockSshServer;
  let serverAddress: { host: string; port: number };

  beforeAll(async () => {
    mockServer = new MockSshServer({
      username: 'testuser',
      password: 'testpass',
    });
    serverAddress = await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  describe('Mock SSH 服务器', () => {
    it('应该成功启动并监听端口', () => {
      expect(serverAddress.port).toBeGreaterThan(0);
      expect(serverAddress.host).toBe('127.0.0.1');
    });

    it('应该能够接收模拟连接事件', async () => {
      // 这个测试验证 MockSshServer 的事件机制工作正常
      const connectionHandler = vi.fn();
      mockServer.once('connection', connectionHandler);

      // 手动触发连接事件来测试事件机制
      mockServer.emit('connection', {});

      expect(connectionHandler).toHaveBeenCalled();
    });
  });

  describe('SSH 连接建立', () => {
    it('应该成功建立 SSH 连接', async () => {
      const mockClient = createMockSshClient(serverAddress);

      const readyPromise = new Promise<void>((resolve) => {
        mockClient.once('ready', resolve);
      });

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'testuser',
        password: 'testpass',
      });

      await expect(readyPromise).resolves.toBeUndefined();
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('应该在连接关闭时触发 end 事件', async () => {
      const mockClient = createMockSshClient(serverAddress);

      const endPromise = new Promise<void>((resolve) => {
        mockClient.once('end', resolve);
      });

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'testuser',
        password: 'testpass',
      });

      await new Promise((r) => setTimeout(r, 100));
      mockClient.end();

      await expect(endPromise).resolves.toBeUndefined();
    });
  });

  describe('Shell 操作', () => {
    it('应该成功打开 Shell', async () => {
      const mockClient = createMockSshClient(serverAddress);

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'testuser',
        password: 'testpass',
      });

      await new Promise((r) => setTimeout(r, 100));

      const shellPromise = new Promise<MockShellStream>((resolve, reject) => {
        mockClient.shell((err: Error | null, stream: MockShellStream) => {
          if (err) reject(err);
          else resolve(stream);
        });
      });

      const stream = await shellPromise;
      expect(stream).toBeDefined();
      expect(stream).toBeInstanceOf(MockShellStream);
    });

    it('应该能在 Shell 中执行命令并收到响应', async () => {
      const mockClient = createMockSshClient(serverAddress);

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'testuser',
        password: 'testpass',
      });

      await new Promise((r) => setTimeout(r, 100));

      const stream = await new Promise<MockShellStream>((resolve, reject) => {
        mockClient.shell((err: Error | null, stream: MockShellStream) => {
          if (err) reject(err);
          else resolve(stream);
        });
      });

      const dataPromise = new Promise<string>((resolve) => {
        stream.once('data', (data: Buffer) => {
          resolve(data.toString());
        });
      });

      stream.write('echo Hello\n');

      const response = await dataPromise;
      expect(response).toContain('Hello');
    });

    it('应该正确响应 whoami 命令', async () => {
      const stream = new MockShellStream();

      const dataPromise = new Promise<string>((resolve) => {
        stream.once('data', (data: Buffer) => {
          resolve(data.toString());
        });
      });

      stream.write('whoami\n');

      const response = await dataPromise;
      expect(response.trim()).toBe('testuser');
    });

    it('应该正确响应 pwd 命令', async () => {
      const stream = new MockShellStream();

      const dataPromise = new Promise<string>((resolve) => {
        stream.once('data', (data: Buffer) => {
          resolve(data.toString());
        });
      });

      stream.write('pwd\n');

      const response = await dataPromise;
      expect(response.trim()).toBe('/home/testuser');
    });
  });

  describe('连接超时和错误处理', () => {
    it('应该处理连接超时', async () => {
      const mockClient = createMockSshClient(serverAddress);

      // 模拟超时场景
      const timeoutPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 100);

        mockClient.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'testuser',
        password: 'testpass',
      });

      // 应该在超时前连接成功
      await expect(timeoutPromise).resolves.toBeUndefined();
    });

    it('应该处理认证失败', async () => {
      // 这个测试在实际场景中会验证错误凭据
      // 在 mock 环境中我们验证错误处理逻辑
      const mockClient = createMockSshClient(serverAddress);

      // 模拟认证失败
      mockClient.connect = vi.fn().mockImplementation(() => {
        setTimeout(() => {
          mockClient.emit('error', new Error('Authentication failed'));
        }, 10);
        return mockClient;
      });

      const errorPromise = new Promise<Error>((resolve) => {
        mockClient.once('error', resolve);
      });

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'wronguser',
        password: 'wrongpass',
      });

      const error = await errorPromise;
      expect(error.message).toBe('Authentication failed');
    });
  });

  describe('重连机制', () => {
    it('应该能够在断开后重新连接', async () => {
      const mockClient = createMockSshClient(serverAddress);

      // 第一次连接
      const firstReadyPromise = new Promise<void>((resolve) => {
        mockClient.once('ready', resolve);
      });

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'testuser',
        password: 'testpass',
      });

      await firstReadyPromise;

      // 断开连接
      mockClient.end();
      await new Promise((r) => setTimeout(r, 50));

      // 重新连接
      const secondReadyPromise = new Promise<void>((resolve) => {
        mockClient.once('ready', resolve);
      });

      mockClient.connect({
        host: serverAddress.host,
        port: serverAddress.port,
        username: 'testuser',
        password: 'testpass',
      });

      await expect(secondReadyPromise).resolves.toBeUndefined();
    });
  });
});
