import type session from 'express-session';

export const SESSION_COOKIE_SECURE_VALUES = ['auto', 'true', 'false'] as const;
export type SessionCookieSecureEnv = (typeof SESSION_COOKIE_SECURE_VALUES)[number];
export type SessionCookieSecure = NonNullable<session.CookieOptions['secure']>;

/**
 * 解析会话 Cookie 的 Secure 策略。
 *
 * 默认使用 express-session 的 auto 策略：HTTPS 请求设置 Secure，HTTP 直连不设置 Secure。
 * 这样既兼容学习/内网 HTTP 直连，也兼容生产 HTTPS 反代。
 */
export const resolveSessionCookieSecure = (
  rawValue: SessionCookieSecureEnv | undefined,
): SessionCookieSecure => {
  if (!rawValue || rawValue === 'auto') {
    return 'auto';
  }

  return rawValue === 'true';
};

/**
 * 生产环境默认 auto 会兼容 HTTP 直连，但公网 HTTP 会明文传输登录凭据和会话 Cookie。
 * 返回 warning 文案供启动阶段记录，避免在 session 配置里混入日志副作用。
 */
export const getSessionCookieSecureAutoWarning = (
  rawValue: SessionCookieSecureEnv | undefined,
  nodeEnv: string | undefined,
): string | null => {
  if (nodeEnv !== 'production' || (rawValue && rawValue !== 'auto')) {
    return null;
  }

  return [
    'SESSION_COOKIE_SECURE=auto 会在 HTTP 直连时下发非 Secure 会话 Cookie。',
    '该模式仅适合内网学习、测试或首次验证；公网环境请使用 HTTPS 反向代理，',
    '或设置 SESSION_COOKIE_SECURE=true 强制仅允许 HTTPS 会话。',
  ].join('');
};
