import pino from 'pino';
import { redactSensitiveData } from '../logging/redaction';
import { getLogContext } from '../middleware/log-context.middleware';

// 环境感知配置：延迟求值，确保 dotenv.config() 已加载 .env 文件
// index.ts 在模块导入时触发 logger 模块求值，但 dotenv 在 main() 中才加载，
// 因此不能在模块顶层读取 process.env.NODE_ENV（此时永远是 undefined）。
// 解决方案：所有环境变量读取推迟到首次日志调用时执行（Lazy Initialization）。

/**
 * 日志脱敏开关：延迟求值，避免模块加载时 dotenv 尚未就绪
 * 使用 getter 确保每次日志调用时读取最新的环境变量
 */
const isLogRedactEnabled = () => process.env.LOG_REDACT !== 'false'; // 默认开启脱敏

// 持有 pino 实例的引用，供 setLogLevel / getLogLevel 访问
// createLogger() 首次调用时自动填充
let _pinoRef: pino.Logger | null = null;

/**
 * 创建 pino 日志实例（延迟调用，确保 dotenv 已加载）
 *
 * 调用时机：首次日志输出时自动触发，此时 process.env 已包含 .env 中的值。
 * - dev 模式：pino-pretty 彩色格式化输出
 * - prod 模式：JSON 静默输出
 * - 通过 LOG_LEVEL / LOG_PRETTY / LOG_REDACT / LOG_TZ 环境变量控制
 * - 支持运行时通过 setLogLevel() 动态调整
 * - 所有日志参数经 redactSensitiveData 脱敏处理
 */
function createPinoInstance(): pino.Logger {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  const isProd = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';
  const isDev = !isProd && !isTest;

  // LOG_LEVEL 由 env.validator.ts 在启动时严格校验，此处直接使用
  // dev 模式默认 debug，test/prod 模式默认 info
  const logLevel = (process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')).toLowerCase();

  const logPretty =
    process.env.LOG_PRETTY === 'true' || (isDev && process.env.LOG_PRETTY !== 'false');

  // 自定义 timestamp：支持 LOG_TZ 环境变量
  const logTz = process.env.LOG_TZ || process.env.TZ || 'UTC';
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: logTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    // 不能使用 logger，此时 logger 尚未初始化会导致无限递归
    // 时区无效时回退到 ISO 格式
  }

  const timestamp = () => {
    const time = new Date();
    if (formatter) {
      return `,"time":"${formatter.format(time)}.${String(time.getMilliseconds()).padStart(3, '0')}"`;
    }
    return `,"time":"${time.toISOString()}"`;
  };

  try {
    return pino({
      level: logLevel,
      timestamp,
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      base: {},
      // NODE_ENV=production 时强制忽略 LOG_PRETTY，避免生产镜像缺少 pino-pretty 导致崩溃
      transport:
        logPretty && !isProd
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    });
  } catch {
    // 不能使用 logger，此时 logger 尚未初始化会导致无限递归
    // LOG_LEVEL 非法值（如 verbose）会导致 pino 崩溃，回退到 info 级别
    return pino({ level: 'info', timestamp });
  }
}

/**
 * 包装函数：在 pino 调用前执行脱敏 + 参数归一化
 *
 * pino 的结构化日志要求 merge 对象放在第一个参数：
 *   logger.info({ key: val }, 'message')  ← 正确，字段被合并到 JSON 记录
 *   logger.info('message', { key: val })  ← 丢失，对象被当作 printf 参数丢弃
 *
 * 但大量业务代码使用 Node.js/console 风格 logger.info('msg', obj)，
 * 因此在 wrapper 层做自动归一化：当第一个参数是字符串、后续有对象参数时，
 * 将所有非 Error 对象合并到一个 merge 对象中，Error 放入 err 属性，
 * 重组为 pino 期望的 mergeObject + message 格式。
 */
function createLogger() {
  // 延迟初始化 pino 实例，确保 dotenv.config() 已执行
  const getPino = () => {
    if (!_pinoRef) _pinoRef = createPinoInstance();
    return _pinoRef;
  };

  const wrap =
    (methodGetter: () => (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      // 自动注入 AsyncLocalStorage 中的日志上下文（requestId、userId、protocol 等）
      const ctx = getLogContext();
      const hasLogContext = Object.keys(ctx).length > 0;

      let normalizedArgs = args;

      if (args.length >= 2 && typeof args[0] === 'string') {
        const mergeObj: Record<string, unknown> = {};
        let hasMergeFields = false;

        const extras: unknown[] = [];

        for (let i = 1; i < args.length; i++) {
          const arg = args[i];
          if (arg instanceof Error) {
            mergeObj.err = arg;
            hasMergeFields = true;
          } else if (arg !== null && typeof arg === 'object' && !Array.isArray(arg)) {
            Object.assign(mergeObj, arg);
            hasMergeFields = true;
          } else if (arg !== undefined && arg !== null) {
            // 收集原始类型（number/boolean/string），避免被静默丢弃
            extras.push(arg);
          }
        }

        // 仅当存在可合并的结构化字段时才重组参数顺序
        if (hasMergeFields) {
          if (extras.length > 0) mergeObj._extra = extras;
          normalizedArgs = [mergeObj, args[0]];
        } else if (args.length >= 2) {
          // 所有额外参数均为字符串且无对象参数时，追加到消息中
          // pino 的 quick-format-unescaped 在无 %s 占位符时静默丢弃额外字符串参数
          const extraStrings = args.slice(1).filter((a) => typeof a === 'string');
          if (extraStrings.length > 0) {
            normalizedArgs = [args[0] + ' ' + extraStrings.join(' ')];
          }
        }
      }

      // 将日志上下文字段合并到 mergeObject 中（仅存在上下文时）
      if (hasLogContext && normalizedArgs.length >= 1) {
        const first = normalizedArgs[0];
        if (first instanceof Error) {
          // Error 对象：将 err 放入合并对象，保留 Error 语义（pino 会序列化 err.*）
          normalizedArgs = [{ ...ctx, err: first }, ...normalizedArgs.slice(1)];
        } else if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
          // 普通对象：合并上下文字段
          normalizedArgs = [{ ...ctx, ...first }, ...normalizedArgs.slice(1)];
        } else {
          // 原始类型：上下文作为第一个参数插入
          normalizedArgs = [ctx, ...normalizedArgs];
        }
      }

      if (isLogRedactEnabled()) {
        const redactedArgs = normalizedArgs.map((a) => redactSensitiveData(a));
        methodGetter()(redactedArgs[0], ...(redactedArgs.slice(1) as []));
      } else {
        methodGetter()(normalizedArgs[0], ...(normalizedArgs.slice(1) as []));
      }
    };

  return {
    info: wrap(() => getPino().info.bind(getPino())),
    warn: wrap(() => getPino().warn.bind(getPino())),
    error: wrap(() => getPino().error.bind(getPino())),
    debug: wrap(() => getPino().debug.bind(getPino())),
  };
}

/**
 * 运行时动态调整 pino 日志级别
 * 与 logging/logger.ts 的 setLogLevel 保持同步，
 * 确保通过 API 修改日志等级后，使用 utils/logger 的模块也能立即响应。
 *
 * @param level 目标日志级别
 */
export const setLogLevel = (level: string): void => {
  process.env.LOG_LEVEL = level;
  if (_pinoRef) {
    _pinoRef.level = level;
  }
};

/**
 * 获取当前 pino 日志级别
 */
export const getLogLevel = (): string => _pinoRef?.level || process.env.LOG_LEVEL || 'info';

/**
 * 统一日志工具
 * 导出 info / warn / error / debug 四个方法，可在任意模块中直接引用。
 *
 * 使用示例：
 *   import { logger } from '../utils/logger';
 *   logger.info('服务启动完成');
 *   logger.warn({ port }, '端口已被占用');
 *   logger.error(err, '数据库连接失败');
 *   logger.debug({ query }, '执行 SQL 查询');
 */
export const logger = createLogger();
