export const buildTwoFactorSetupReuseLogAction = (
  userId: number,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `[AuthController] 用户 ${userId} 复用已存在的临时 2FA 密钥，直接返回 setup payload。`,
});

export const buildTwoFactorSetupSaveFailedLogAction = (
  userId: number,
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `[AuthController] 用户 ${userId} 保存临时 2FA 密钥到 session 失败`,
});

export const buildTwoFactorSetupGeneratedLogAction = (
  userId: number,
): {
  level: 'info';
  message: string;
} => ({
  level: 'info',
  message: `[AuthController] 用户 ${userId} 生成新的临时 2FA 密钥并返回 setup payload。`,
});

export const buildTwoFactorVerifySessionMismatchWarnLogAction = (
  userId: number,
): {
  level: 'warn';
  message: string;
} => ({
  level: 'warn',
  message: `[AuthController] 用户 ${userId} 的 2FA 临时密钥与前端提交密钥不一致，优先使用前端提交密钥进行校验。`,
});

export const buildTwoFactorVerifySessionSyncedDebugLogAction = (
  userId: number,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `[AuthController] 用户 ${userId} 的会话临时 2FA 密钥已同步为前端提交值。`,
});

export const buildTwoFactorVerifySkewWarnLogAction = (payload: {
  userId: number;
  delta: number;
  skewWarnThreshold: number;
}): {
  level: 'warn';
  message: string;
} | null => {
  const { userId, delta, skewWarnThreshold } = payload;
  if (Math.abs(delta) <= skewWarnThreshold) {
    return null;
  }

  return {
    level: 'warn',
    message: buildTwoFactorVerifySkewWarnMessage(userId, delta),
  };
};

export const buildTwoFactorVerifyInvalidDebugLogAction = (
  userId: number,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `用户 ${userId} 2FA 激活失败: 验证码错误。`,
});

export const buildTwoFactorVerifySkewWarnMessage = (userId: number, delta: number): string =>
  `[AuthController] 用户 ${userId} 的 2FA 激活验证码存在明显时间偏差（delta=${delta}），建议校准客户端时间。`;

export const buildTwoFactorVerifySkewWarnLogActionAlways = (
  userId: number,
  delta: number,
): {
  level: 'warn';
  message: string;
} => ({
  level: 'warn',
  message: buildTwoFactorVerifySkewWarnMessage(userId, delta),
});

// 清洗日志中的 CRLF 字符，防止 Log Forge 注入
const sanitizeForLog = (value: string): string => value.replace(/[\r\n]/g, '_');

export const buildLoginTwoFactorSkewWarnMessage = (username: string, delta: number): string =>
  `[AuthController] 用户 ${sanitizeForLog(username)} 的 2FA 登录验证码存在明显时间偏差（delta=${delta}），建议校准客户端时间。`;

export const buildLoginTwoFactorSkewWarnLogAction = (payload: {
  username: string;
  delta: number;
  skewWarnThreshold: number;
}): {
  level: 'warn';
  message: string;
} | null => {
  const { username, delta, skewWarnThreshold } = payload;
  if (Math.abs(delta) <= skewWarnThreshold) {
    return null;
  }

  return {
    level: 'warn',
    message: buildLoginTwoFactorSkewWarnMessage(username, delta),
  };
};

export const buildLoginTwoFactorSkewWarnLogActionAlways = (
  username: string,
  delta: number,
): {
  level: 'warn';
  message: string;
} => ({
  level: 'warn',
  message: buildLoginTwoFactorSkewWarnMessage(username, delta),
});

export const buildLoginTwoFactorSuccessInfoLogAction = (
  username: string,
): {
  level: 'info';
  message: string;
} => ({
  level: 'info',
  message: `用户 ${sanitizeForLog(username)} 2FA 验证成功。`,
});

export const buildLoginTwoFactorInvalidDebugLogAction = (
  username: string,
): {
  level: 'debug';
  message: string;
} => ({
  level: 'debug',
  message: `用户 ${sanitizeForLog(username)} 2FA 验证失败: 验证码错误。`,
});

export const buildVerifyLoginTwoFactorInternalErrorLogAction = (
  userId: number | 'unknown',
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `2FA 验证时发生内部错误 (用户: ${userId}):`,
});

export const buildTwoFactorSetupErrorLogAction = (
  userId: number | undefined,
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `用户 ${userId} 设置 2FA 时出错:`,
});

export const buildTwoFactorVerifyActivateErrorLogAction = (
  userId: number,
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `用户 ${userId} 验证并激活 2FA 时出错:`,
});

export const buildDisableTwoFactorMutationNoChangeErrorLogAction = (
  userId: number,
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `禁用 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`,
});

export const buildDisableTwoFactorErrorLogAction = (
  userId: number,
): {
  level: 'error';
  message: string;
} => ({
  level: 'error',
  message: `用户 ${userId} 禁用 2FA 时出错:`,
});
