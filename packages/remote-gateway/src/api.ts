import crypto from 'crypto';
import cors from 'cors';
import express, { Request, Response } from 'express';

type CreateRemoteGatewayApiAppOptions = {
  encryptionKeyBuffer: Buffer;
  allowedOrigins: string[];
  corsAllowAll: boolean;
  apiToken?: string;
};

export function createRemoteGatewayApiApp(options: CreateRemoteGatewayApiAppOptions) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  if (options.corsAllowAll) {
    app.use(cors({ origin: true, credentials: true }));
  } else {
    app.use(
      cors({
        origin: options.allowedOrigins,
        credentials: true,
      })
    );
  }

  const apiToken = (options.apiToken || '').trim();

  const requireRemoteGatewayApiToken = (req: Request, res: Response, next: () => void): void => {
    if (!apiToken) return next();

    const provided = (req.header('x-remote-gateway-token') || '').trim();
    if (!provided || provided !== apiToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };

  const encryptToken = (data: string): string => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', options.encryptionKeyBuffer, iv);
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const output = {
      iv: iv.toString('base64'),
      value: encrypted,
    };
    return Buffer.from(JSON.stringify(output)).toString('base64');
  };

  app.post(
    '/api/remote-desktop/token',
    requireRemoteGatewayApiToken,
    (req: Request, res: Response) => {
      const { protocol, connectionConfig } = req.body ?? {};

      if (!protocol || !connectionConfig) {
        res.status(400).json({ error: '缺少必需的参数 (protocol, connectionConfig)' });
        return;
      }

      if (protocol !== 'rdp' && protocol !== 'vnc') {
        res.status(400).json({ error: '无效的协议类型。支持 "rdp" 或 "vnc"。' });
        return;
      }

      const { hostname, port, username, password, width, height, dpi, security, ignoreCert } =
        connectionConfig;

      if (hostname === undefined || hostname === null || hostname === '') {
        res.status(400).json({ error: '缺少必需的连接参数 (hostname, port)' });
        return;
      }
      if (port === undefined || port === null || port === '') {
        res.status(400).json({ error: '缺少必需的连接参数 (hostname, port)' });
        return;
      }

      const settings: Record<string, string> = {
        hostname: String(hostname),
        port: String(port),
        width: String(width || '1024'),
        height: String(height || '768'),
      };

      if (protocol === 'rdp') {
        if (typeof username === 'undefined' || typeof password === 'undefined') {
          res.status(400).json({ error: 'RDP 连接缺少 username 或 password' });
          return;
        }
        settings.username = String(username);
        settings.password = String(password);
        settings.security = String(security || 'any');
        settings['ignore-cert'] = String(ignoreCert || 'true');
        settings.dpi = String(dpi || '96');
      } else if (protocol === 'vnc') {
        if (typeof password === 'undefined') {
          res.status(400).json({ error: 'VNC 连接缺少 password' });
          return;
        }
        settings.password = String(password);
        if (username) {
          settings.username = String(username);
        }
      }

      const connectionParams = {
        connection: {
          type: protocol,
          settings,
        },
      };

      try {
        const tokenData = JSON.stringify(connectionParams);
        res.json({ token: encryptToken(tokenData) });
      } catch (error) {
        console.error('[Remote Gateway] /api/remote-desktop/token 接口出错:', error);
        res.status(500).json({ error: '生成令牌失败' });
      }
    }
  );

  return app;
}
