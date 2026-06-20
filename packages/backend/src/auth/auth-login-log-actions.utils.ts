// 清洗日志中的 CRLF 字符，防止 Log Forge 注入
const sanitizeForLog = (value: string): string => value.replace(/[\r\n]/g, '_');

export const buildLoginCaptchaInvalidDebugLogAction = (
  username: string,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `[AuthController] 登录尝试失败: CAPTCHA 验证失败 - ${sanitizeForLog(username)}`,
});

export const buildLoginCaptchaVerifiedDebugLogAction = (
  username: string,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `[AuthController] CAPTCHA 验证成功 - ${sanitizeForLog(username)}`,
});

export const buildLoginCaptchaVerificationErrorLogAction = (
  username: string,
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] CAPTCHA 验证过程中出错 (${sanitizeForLog(username)}):`,
});

export const buildLoginCaptchaSkippedDebugLogAction = (
  username: string,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `[AuthController] CAPTCHA 未启用，跳过验证 - ${sanitizeForLog(username)}`,
});

export const buildLoginUserNotFoundDebugLogAction = (
  username: string,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `登录尝试失败: 用户未找到 - ${sanitizeForLog(username)}`,
});

export const buildLoginInvalidPasswordDebugLogAction = (
  username: string,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `登录尝试失败: 密码错误 - ${sanitizeForLog(username)}`,
});

export const buildLoginTwoFactorRequiredDebugLogAction = (
  username: string,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `用户 ${sanitizeForLog(username)} 已启用 2FA，需要进行二次验证。`,
});

export const buildLoginSuccessWithoutTwoFactorInfoLogAction = (
  username: string,
): {
  level: 'info';
  message: string;
} => ({
  level: 'info',
  message: `登录成功 (无 2FA): ${sanitizeForLog(username)}`,
});

export const buildLoginInternalErrorLogAction = (): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: '登录时出错:',
});
