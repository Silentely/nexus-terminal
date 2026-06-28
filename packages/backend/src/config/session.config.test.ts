import express, { type RequestHandler } from 'express';
import session from 'express-session';
import http from 'http';
import type { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';
import {
  getSessionCookieSecureAutoWarning,
  resolveSessionCookieSecure,
  type SessionCookieSecure,
} from './session.config';

type SessionWithMarker = session.Session & Partial<session.SessionData> & { marker?: string };

const closeServer = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const readSetCookieHeader = async (
  secure: SessionCookieSecure,
  forwardedProto?: string,
): Promise<string | null> => {
  const app = express();
  app.set('trust proxy', true);
  app.use(
    session({
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        httpOnly: true,
        secure,
        sameSite: 'lax',
      },
    }),
  );
  app.get('/login', ((req, res) => {
    // 修改 session 以模拟登录成功后写入用户态，从而触发 Set-Cookie。
    (req.session as SessionWithMarker).marker = 'authenticated';
    res.status(200).json({ ok: true });
  }) as RequestHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/login`, {
      headers: forwardedProto ? { 'X-Forwarded-Proto': forwardedProto } : undefined,
    });
    await response.text();
    return response.headers.get('set-cookie');
  } finally {
    await closeServer(server);
  }
};

describe('session config', () => {
  describe('resolveSessionCookieSecure', () => {
    it('未显式配置时应使用 auto，兼容 HTTP 直连和 HTTPS 反代', () => {
      expect(resolveSessionCookieSecure(undefined)).toBe('auto');
    });

    it('SESSION_COOKIE_SECURE=true 时应强制 Secure cookie', () => {
      expect(resolveSessionCookieSecure('true')).toBe(true);
    });

    it('SESSION_COOKIE_SECURE=false 时应强制非 Secure cookie', () => {
      expect(resolveSessionCookieSecure('false')).toBe(false);
    });

    it('SESSION_COOKIE_SECURE=auto 时应使用 express-session 自动策略', () => {
      expect(resolveSessionCookieSecure('auto')).toBe('auto');
    });
  });

  describe('getSessionCookieSecureAutoWarning', () => {
    it('生产环境使用 auto 策略时应提示公网 HTTP 明文会话风险', () => {
      const warning = getSessionCookieSecureAutoWarning('auto', 'production');

      expect(warning).toContain('SESSION_COOKIE_SECURE=auto');
      expect(warning).toContain('公网');
      expect(warning).toContain('SESSION_COOKIE_SECURE=true');
    });

    it('未显式配置时应按 auto 处理并提示风险', () => {
      expect(getSessionCookieSecureAutoWarning(undefined, 'production')).not.toBeNull();
    });

    it('非生产环境或显式 true/false 策略不应提示 auto 风险', () => {
      expect(getSessionCookieSecureAutoWarning('auto', 'development')).toBeNull();
      expect(getSessionCookieSecureAutoWarning('true', 'production')).toBeNull();
      expect(getSessionCookieSecureAutoWarning('false', 'production')).toBeNull();
    });
  });

  describe('express-session secure auto 回归行为', () => {
    it('auto 策略在 HTTP 直连时应设置非 Secure session cookie', async () => {
      const setCookie = await readSetCookieHeader(resolveSessionCookieSecure('auto'));

      expect(setCookie).toContain('connect.sid=');
      expect(setCookie).not.toContain('; Secure');
    });

    it('auto 策略在 HTTPS 反代时应设置 Secure session cookie', async () => {
      const setCookie = await readSetCookieHeader(resolveSessionCookieSecure('auto'), 'https');

      expect(setCookie).toContain('connect.sid=');
      expect(setCookie).toContain('; Secure');
    });

    it('false 策略在 HTTPS 反代时也应保持非 Secure session cookie', async () => {
      const setCookie = await readSetCookieHeader(resolveSessionCookieSecure('false'), 'https');

      expect(setCookie).toContain('connect.sid=');
      expect(setCookie).not.toContain('; Secure');
    });

    it('true 策略在 HTTP 直连时不应下发 session cookie', async () => {
      const setCookie = await readSetCookieHeader(resolveSessionCookieSecure('true'));

      expect(setCookie).toBeNull();
    });
  });
});
