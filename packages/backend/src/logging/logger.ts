import { formatInTimeZone } from 'date-fns-tz';

// --- 容器日志等级控制 ---
// 日志等级: debug < info < warn < error < silent
// 说明：
// 1) 该模块只负责"日志等级状态 + console 覆写安装"，不依赖 index.ts，避免循环依赖。
// 2) 运行时可通过 setLogLevel 动态调整过滤级别。
// 3) P1-5: 实现敏感信息自动脱敏（redact）功能。
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

// --- P1-5: 敏感信息脱敏配置 ---
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passwd/i,
  /pwd/i,
  /token/i,
  /secret/i,
  /key/i,
  /auth/i,
  /authorization/i,
  /credential/i,
  /passphrase/i,
  /private/i,
  /cookie/i,
  /session/i,
  /apikey/i,
  /api_key/i,
];

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * P1-5+: 增强的敏感信息脱敏函数
 * 支持：1) 对象 key 脱敏 2) 字符串内容脱敏 3) 循环引用保护 4) 深度限制 5) 大小限制
 */
function redactSensitiveData(value: any, depth = 0, seen = new WeakSet()): any {
  // 深度限制（防止栈溢出）
  const MAX_DEPTH = 10;
  const MAX_KEYS = 100;

  // 处理 null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // 处理字符串：对敏感模式进行脱敏（Critical 修复：支持字符串脱敏）
  if (typeof value === 'string') {
    let redactedStr = value;
    // 脱敏常见的敏感模式（如 cookie=xxx, token=xxx, Authorization: Bearer xxx）
    redactedStr = redactedStr.replace(
      /(\b(?:cookie|authorization|token|api[-_]?key|password|secret|passwd|pwd)\s*[:=]\s*)([^\s;,&"']+)/gi,
      '$1[REDACTED]'
    );
    // 脱敏 Bearer token
    redactedStr = redactedStr.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [REDACTED]');
    return redactedStr;
  }

  // 处理其他原始类型
  if (typeof value !== 'object') {
    return value;
  }

  // 循环引用检测（防止无限递归）
  if (seen.has(value)) {
    return '[Circular Reference]';
  }

  // 深度限制（防止过深对象导致性能问题）
  if (depth >= MAX_DEPTH) {
    return '[Max Depth Exceeded]';
  }

  // 处理数组
  if (Array.isArray(value)) {
    seen.add(value);
    try {
      return value.map((item) => redactSensitiveData(item, depth + 1, seen));
    } catch (err) {
      return '[Array Processing Error]';
    }
  }

  // 处理对象（包括 null-prototype 对象）
  const isPlainObject =
    value.constructor === Object ||
    value.constructor === undefined || // null-prototype 对象 (Object.create(null))
    (value.constructor && value.constructor.name === 'Object');

  if (isPlainObject) {
    seen.add(value);
    const redacted: any = {};
    try {
      const keys = Object.keys(value);
      // 大小限制（防止超大对象）
      const processKeys = keys.slice(0, MAX_KEYS);
      if (keys.length > MAX_KEYS) {
        redacted['[truncated]'] = `${keys.length - MAX_KEYS} more keys...`;
      }

      for (const key of processKeys) {
        try {
          // 检查字段名是否匹配敏感模式
          const isSensitive = SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key));
          if (isSensitive) {
            redacted[key] = REDACTED_PLACEHOLDER;
          } else {
            redacted[key] = redactSensitiveData(value[key], depth + 1, seen);
          }
        } catch (err) {
          // Getter 异常保护
          redacted[key] = '[Access Error]';
        }
      }
      return redacted;
    } catch (err) {
      return '[Object Processing Error]';
    }
  }

  // 处理 Error 对象
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  // 其他对象类型（如 Date, RegExp 等）保持原样
  return value;
}

/**
 * P1-5: 脱敏所有日志参数
 */
function redactLogArgs(args: any[]): any[] {
  return args.map((arg) => redactSensitiveData(arg));
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const normalizeLogLevel = (value: unknown): LogLevel | null => {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (
    lower === 'debug' ||
    lower === 'info' ||
    lower === 'warn' ||
    lower === 'error' ||
    lower === 'silent'
  ) {
    return lower;
  }
  return null;
};

// 全局日志等级状态（可动态修改）
let currentLogLevel: LogLevel = normalizeLogLevel(process.env.LOG_LEVEL) ?? 'info';

export const getLogLevel = (): LogLevel => currentLogLevel;

export const setLogLevel = (level: LogLevel): void => {
  if (LOG_LEVEL_PRIORITY[level] === undefined) return;
  currentLogLevel = level;
  // 使用 console.info（若已安装过滤且设置为 silent，则这条提示也会被过滤掉）
  console.info(`[日志等级] 已设置为: ${level}`);
};

let installed = false;

/**
 * 安装统一的 console 时间戳前缀 + 日志等级过滤。
 * 该方法应只调用一次（通常在 index.ts 最顶部）。
 */
export const installConsoleLogging = (): void => {
  if (installed) return;
  installed = true;

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  };

  const formatTimestamp = () => {
    const tz = process.env.LOG_TZ || process.env.TZ || 'UTC';
    try {
      return `[${formatInTimeZone(new Date(), tz, 'yyyy-MM-dd HH:mm:ss XXX')}]`;
    } catch {
      // 回退到 ISO 时间，避免时区配置错误导致崩溃
      return `[${new Date().toISOString()}]`;
    }
  };

  const shouldLog = (method: 'debug' | 'info' | 'warn' | 'error'): boolean => {
    const methodLevel = LOG_LEVEL_PRIORITY[method];
    const currentLevel = LOG_LEVEL_PRIORITY[currentLogLevel];
    return methodLevel >= currentLevel;
  };

  // P1-5: 重写 console 方法，添加日志等级过滤 + 敏感信息脱敏
  console.debug = (...args: any[]) => {
    if (shouldLog('debug')) {
      const redactedArgs = redactLogArgs(args);
      originalConsole.debug(formatTimestamp(), '[DEBUG]', ...redactedArgs);
    }
  };
  console.log = (...args: any[]) => {
    if (shouldLog('info')) {
      const redactedArgs = redactLogArgs(args);
      originalConsole.log(formatTimestamp(), ...redactedArgs);
    }
  };
  console.info = (...args: any[]) => {
    if (shouldLog('info')) {
      const redactedArgs = redactLogArgs(args);
      originalConsole.info(formatTimestamp(), '[INFO]', ...redactedArgs);
    }
  };
  console.warn = (...args: any[]) => {
    if (shouldLog('warn')) {
      const redactedArgs = redactLogArgs(args);
      originalConsole.warn(formatTimestamp(), '[WARN]', ...redactedArgs);
    }
  };
  console.error = (...args: any[]) => {
    if (shouldLog('error')) {
      const redactedArgs = redactLogArgs(args);
      originalConsole.error(formatTimestamp(), '[ERROR]', ...redactedArgs);
    }
  };
};
