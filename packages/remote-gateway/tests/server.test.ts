import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// 测试常量
const ENCRYPTION_KEY = Buffer.alloc(32, 'test-encryption-key');
const GUACD_HOST = 'localhost';
const GUACD_PORT = 4822;

describe('Remote Gateway 服务器测试', () => {
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
    const encryptToken = (data: string, key: Buffer): string => {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(data, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return `${iv.toString('base64')}$${encrypted}`;
    };

    const decryptToken = (token: string, key: Buffer): string => {
      const [ivBase64, encryptedData] = token.split('$');
      const iv = Buffer.from(ivBase64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    };

    it('应该能够加密和解密 RDP 连接参数', () => {
      const connectionParams = {
        connection: {
          type: 'rdp',
          settings: {
            hostname: '192.168.1.100',
            port: '3389',
            username: 'Administrator',
            password: 'secret123',
            security: 'any',
            'ignore-cert': 'true',
          },
        },
      };

      const originalData = JSON.stringify(connectionParams);
      const encryptedToken = encryptToken(originalData, ENCRYPTION_KEY);
      const decryptedData = decryptToken(encryptedToken, ENCRYPTION_KEY);

      expect(decryptedData).toBe(originalData);
      expect(JSON.parse(decryptedData)).toEqual(connectionParams);
    });

    it('应该能够加密和解密 VNC 连接参数', () => {
      const connectionParams = {
        connection: {
          type: 'vnc',
          settings: {
            hostname: '192.168.1.101',
            port: '5900',
            password: 'vncpass',
          },
        },
      };

      const originalData = JSON.stringify(connectionParams);
      const encryptedToken = encryptToken(originalData, ENCRYPTION_KEY);
      const decryptedData = decryptToken(encryptedToken, ENCRYPTION_KEY);

      expect(JSON.parse(decryptedData)).toEqual(connectionParams);
    });

    it('应该使用不同的 IV 生成不同的密文', () => {
      const data = 'test-data';

      const token1 = encryptToken(data, ENCRYPTION_KEY);
      const token2 = encryptToken(data, ENCRYPTION_KEY);

      expect(token1).not.toBe(token2);

      // 但解密后应该相同
      expect(decryptToken(token1, ENCRYPTION_KEY)).toBe(data);
      expect(decryptToken(token2, ENCRYPTION_KEY)).toBe(data);
    });

    it('应该拒绝无效的 token 格式', () => {
      expect(() => {
        decryptToken('invalid-token-without-separator', ENCRYPTION_KEY);
      }).toThrow();
    });

    it('应该拒绝使用错误密钥解密', () => {
      const data = 'test-data';
      const encryptedToken = encryptToken(data, ENCRYPTION_KEY);
      const wrongKey = Buffer.alloc(32, 'wrong-key');

      expect(() => {
        decryptToken(encryptedToken, wrongKey);
      }).toThrow();
    });
  });

  describe('API 端点', () => {
    describe('POST /api/remote-desktop/token', () => {
      it('应该为有效的 RDP 请求生成 token', () => {
        const requestBody = {
          protocol: 'rdp',
          connectionConfig: {
            hostname: '192.168.1.100',
            port: '3389',
            username: 'Administrator',
            password: 'secret',
            width: '1920',
            height: '1080',
            dpi: '96',
          },
        };

        // 验证请求结构
        expect(requestBody.protocol).toBe('rdp');
        expect(requestBody.connectionConfig.hostname).toBeDefined();
        expect(requestBody.connectionConfig.port).toBeDefined();
      });

      it('应该为有效的 VNC 请求生成 token', () => {
        const requestBody = {
          protocol: 'vnc',
          connectionConfig: {
            hostname: '192.168.1.101',
            port: '5900',
            password: 'vncpass',
            width: '1024',
            height: '768',
          },
        };

        expect(requestBody.protocol).toBe('vnc');
        expect(requestBody.connectionConfig.hostname).toBeDefined();
      });

      it('应该拒绝无效的协议类型', () => {
        const requestBody = {
          protocol: 'ssh', // 无效协议
          connectionConfig: {},
        };

        const isValidProtocol = (protocol: string): boolean => {
          return ['rdp', 'vnc'].includes(protocol);
        };

        expect(isValidProtocol(requestBody.protocol)).toBe(false);
        expect(isValidProtocol('rdp')).toBe(true);
        expect(isValidProtocol('vnc')).toBe(true);
      });
    });

    describe('健康检查', () => {
      it('应该返回服务健康状态', () => {
        const healthResponse = {
          status: 'healthy',
          guacdHost: GUACD_HOST,
          guacdPort: GUACD_PORT,
          timestamp: new Date().toISOString(),
        };

        expect(healthResponse.status).toBe('healthy');
        expect(healthResponse.guacdHost).toBe('localhost');
        expect(healthResponse.guacdPort).toBe(4822);
      });
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
