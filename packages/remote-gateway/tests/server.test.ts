import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import http, { type Server } from 'http';
import { createRemoteGatewayApiApp } from '../src/api';

// 测试常量
const ENCRYPTION_KEY = Buffer.alloc(32, 'test-encryption-key');
const GUACD_HOST = 'localhost';
const GUACD_PORT = 4822;

describe('Remote Gateway 服务器测试', () => {
  const API_TOKEN = 'test-api-token';

  describe('服务器配置', () => {
    it('应该使用正确的默认配置', () => {
      const config = {
        wsPort: process.env.REMOTE_GATEWAY_WS_PORT || 8080,
        apiPort: process.env.REMOTE_GATEWAY_API_PORT || 9090,
        guacdHost: process.env.GUACD_HOST || 'localhost',
        guacdPort: parseInt(process.env.GUACD_PORT || '4822', 10),
      };

      expect(config.wsPort).toBe(8080);
      expect(config.apiPort).toBe(9090);
      expect(config.guacdHost).toBe('localhost');
      expect(config.guacdPort).toBe(4822);
    });

    it('应该正确解析环境变量', () => {
      // 模拟环境变量
      process.env.REMOTE_GATEWAY_WS_PORT = '8081';
      process.env.REMOTE_GATEWAY_API_PORT = '9091';

      const wsPort = process.env.REMOTE_GATEWAY_WS_PORT || 8080;
      const apiPort = process.env.REMOTE_GATEWAY_API_PORT || 9090;

      expect(wsPort).toBe('8081');
      expect(apiPort).toBe('9091');

      // 清理
      delete process.env.REMOTE_GATEWAY_WS_PORT;
      delete process.env.REMOTE_GATEWAY_API_PORT;
    });
  });

  describe('Token 加密解密', () => {
    const decryptToken = (token: string, key: Buffer): string => {
      const jsonString = Buffer.from(token, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonString) as { iv: string; value: string };

      const iv = Buffer.from(parsed.iv, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(parsed.value, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    };

    it('应该拒绝无效的 token 格式', () => {
      expect(() => decryptToken('invalid-token', ENCRYPTION_KEY)).toThrow();
    });
  });

  describe('API 端点（真实 HTTP 集成测试）', () => {
    let server: Server | undefined;
    let baseUrl: string | undefined;

    const startServer = async (): Promise<string> => {
      const app = createRemoteGatewayApiApp({
        encryptionKeyBuffer: ENCRYPTION_KEY,
        allowedOrigins: ['http://localhost:5173', 'http://localhost:3000'],
        corsAllowAll: true,
        apiToken: API_TOKEN,
      });

      server = http.createServer(app);
      await new Promise<void>((resolve) => {
        server!.listen(0, '127.0.0.1', () => resolve());
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind an ephemeral port for test server');
      }
      return `http://127.0.0.1:${address.port}`;
    };

    const stopServer = async (): Promise<void> => {
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      server = undefined;
    };

    const decryptToken = (token: string, key: Buffer): string => {
      const jsonString = Buffer.from(token, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonString) as { iv: string; value: string };
      const iv = Buffer.from(parsed.iv, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(parsed.value, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    };

    beforeEach(async () => {
      baseUrl = await startServer();
    });

    afterEach(async () => {
      await stopServer();
      baseUrl = undefined;
    });

    it('当配置 REMOTE_GATEWAY_API_TOKEN 时，缺少 token header 应返回 401', async () => {
      const resp = await fetch(`${baseUrl}/api/remote-desktop/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 'rdp',
          connectionConfig: { hostname: '192.168.1.100', port: 3389, username: 'u', password: 'p' },
        }),
      });

      expect(resp.status).toBe(401);
      const body = await resp.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('应返回 400：缺少必需参数', async () => {
      const resp = await fetch(`${baseUrl}/api/remote-desktop/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-remote-gateway-token': API_TOKEN,
        },
        body: JSON.stringify({}),
      });

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body).toEqual({ error: '缺少必需的参数 (protocol, connectionConfig)' });
    });

    it('应返回 400：无效协议', async () => {
      const resp = await fetch(`${baseUrl}/api/remote-desktop/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-remote-gateway-token': API_TOKEN,
        },
        body: JSON.stringify({
          protocol: 'ssh',
          connectionConfig: { hostname: 'example.com', port: 22 },
        }),
      });

      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body).toEqual({ error: '无效的协议类型。支持 "rdp" 或 "vnc"。' });
    });

    it('应为 RDP 请求返回可解密的 token（验证 payload 内容）', async () => {
      const resp = await fetch(`${baseUrl}/api/remote-desktop/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-remote-gateway-token': API_TOKEN,
        },
        body: JSON.stringify({
          protocol: 'rdp',
          connectionConfig: {
            hostname: '192.168.1.100',
            port: 3389,
            username: 'Administrator',
            password: 'secret',
            width: 1920,
            height: 1080,
            dpi: 96,
            security: 'any',
            ignoreCert: true,
          },
        }),
      });

      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { token: string };
      expect(typeof body.token).toBe('string');

      const plaintext = decryptToken(body.token, ENCRYPTION_KEY);
      const parsed = JSON.parse(plaintext) as any;

      expect(parsed.connection.type).toBe('rdp');
      expect(parsed.connection.settings.hostname).toBe('192.168.1.100');
      expect(parsed.connection.settings.port).toBe('3389');
      expect(parsed.connection.settings.username).toBe('Administrator');
      expect(parsed.connection.settings.password).toBe('secret');
      expect(parsed.connection.settings.width).toBe('1920');
      expect(parsed.connection.settings.height).toBe('1080');
      expect(parsed.connection.settings.dpi).toBe('96');
      expect(parsed.connection.settings.security).toBe('any');
      expect(parsed.connection.settings['ignore-cert']).toBe('true');
    });

    it('应为 VNC 请求返回可解密的 token（验证默认分辨率）', async () => {
      const resp = await fetch(`${baseUrl}/api/remote-desktop/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-remote-gateway-token': API_TOKEN,
        },
        body: JSON.stringify({
          protocol: 'vnc',
          connectionConfig: {
            hostname: '192.168.1.101',
            port: '5900',
            password: 'vncpass',
          },
        }),
      });

      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { token: string };

      const plaintext = decryptToken(body.token, ENCRYPTION_KEY);
      const parsed = JSON.parse(plaintext) as any;

      expect(parsed.connection.type).toBe('vnc');
      expect(parsed.connection.settings.hostname).toBe('192.168.1.101');
      expect(parsed.connection.settings.port).toBe('5900');
      expect(parsed.connection.settings.password).toBe('vncpass');
      expect(parsed.connection.settings.width).toBe('1024');
      expect(parsed.connection.settings.height).toBe('768');
    });
  });

  describe('CORS 配置', () => {
    it('应该允许配置的源访问', () => {
      const allowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];

      const checkCors = (origin: string): boolean => {
        return allowedOrigins.includes(origin);
      };

      expect(checkCors('http://localhost:5173')).toBe(true);
      expect(checkCors('http://localhost:3000')).toBe(true);
      expect(checkCors('http://malicious.com')).toBe(false);
    });
  });

  describe('Guacamole 连接设置', () => {
    it('应该正确构建 RDP 连接设置', () => {
      const buildRdpSettings = (config: any): Record<string, string> => {
        return {
          hostname: config.hostname,
          port: config.port || '3389',
          username: config.username || '',
          password: config.password || '',
          security: config.security || 'any',
          'ignore-cert': config.ignoreCert || 'true',
          width: config.width || '1024',
          height: config.height || '768',
          dpi: config.dpi || '96',
        };
      };

      const settings = buildRdpSettings({
        hostname: '192.168.1.100',
        username: 'admin',
        password: 'pass',
        width: '1920',
        height: '1080',
      });

      expect(settings.hostname).toBe('192.168.1.100');
      expect(settings.port).toBe('3389');
      expect(settings.security).toBe('any');
      expect(settings['ignore-cert']).toBe('true');
    });

    it('应该正确构建 VNC 连接设置', () => {
      const buildVncSettings = (config: any): Record<string, string> => {
        const settings: Record<string, string> = {
          hostname: config.hostname,
          port: config.port || '5900',
          password: config.password || '',
          width: config.width || '1024',
          height: config.height || '768',
        };

        if (config.username) {
          settings.username = config.username;
        }

        return settings;
      };

      const settings = buildVncSettings({
        hostname: '192.168.1.101',
        password: 'vncpass',
      });

      expect(settings.hostname).toBe('192.168.1.101');
      expect(settings.port).toBe('5900');
      expect(settings.password).toBe('vncpass');
      expect(settings.username).toBeUndefined();
    });
  });
});
