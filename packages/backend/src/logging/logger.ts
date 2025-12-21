import { formatInTimeZone } from 'date-fns-tz';

// --- 容器日志等级控制 ---
// 日志等级: debug < info < warn < error < silent
// 说明：
// 1) 该模块只负责“日志等级状态 + console 覆写安装”，不依赖 index.ts，避免循环依赖。
// 2) 运行时可通过 setLogLevel 动态调整过滤级别。
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

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
    if (lower === 'debug' || lower === 'info' || lower === 'warn' || lower === 'error' || lower === 'silent') {
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
        debug: (console.debug ? console.debug.bind(console) : console.log.bind(console)),
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

    // 重写 console 方法，添加日志等级过滤
    console.debug = (...args: any[]) => {
        if (shouldLog('debug')) originalConsole.debug(formatTimestamp(), '[DEBUG]', ...args);
    };
    console.log = (...args: any[]) => {
        if (shouldLog('info')) originalConsole.log(formatTimestamp(), ...args);
    };
    console.info = (...args: any[]) => {
        if (shouldLog('info')) originalConsole.info(formatTimestamp(), '[INFO]', ...args);
    };
    console.warn = (...args: any[]) => {
        if (shouldLog('warn')) originalConsole.warn(formatTimestamp(), '[WARN]', ...args);
    };
    console.error = (...args: any[]) => {
        if (shouldLog('error')) originalConsole.error(formatTimestamp(), '[ERROR]', ...args);
    };
};

