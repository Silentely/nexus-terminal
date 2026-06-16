/**
 * 环境变量验证模块
 * 在应用启动前验证所有必需的环境变量，并提供类型安全的访问接口
 */
import { logger } from '../utils/logger';

export interface EnvironmentConfig {
  // 核心配置
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  APP_NAME: string;

  // 加密与会话
  ENCRYPTION_KEY: string;
  SESSION_SECRET: string;

  // 部署模式
  DEPLOYMENT_MODE: 'local' | 'docker';

  // Guacamole 配置
  GUACD_HOST: string;
  GUACD_PORT: number;

  // 远程网关配置
  REMOTE_GATEWAY_API_BASE_LOCAL?: string;
  REMOTE_GATEWAY_API_BASE_DOCKER?: string;
  REMOTE_GATEWAY_WS_URL_LOCAL?: string;
  REMOTE_GATEWAY_WS_URL_DOCKER?: string;

  // Passkey 配置
  RP_ID: string;
  RP_ORIGIN: string;

  // 跨域配置
  ALLOWED_ORIGINS?: string;

  // WebSocket 心跳配置
  HEARTBEAT_INTERVAL_DESKTOP?: number;
  HEARTBEAT_INTERVAL_MOBILE?: number;
  MAX_MISSED_PONGS_DESKTOP?: number;
  MAX_MISSED_PONGS_MOBILE?: number;

  // 日志配置
  LOG_LEVEL?: 'error' | 'warn' | 'info' | 'debug' | 'silent';
  LOG_PRETTY?: 'true' | 'false';
  LOG_REDACT?: 'true' | 'false';
  LOG_TZ?: string;
  TZ?: string;
  ENABLE_REQUEST_LOG?: boolean;

  // 代理配置
  TRUST_PROXY?: string;
  TRUST_PROXY_HOPS?: number;

  // AI/NL2CMD 调试配置
  NL2CMD_TIMING_LOG?: '0' | '1';
  NL2CMD_SLOW_THRESHOLD_MS?: number;
  NL2CMD_REQUEST_TIMEOUT_MS?: number;

  // WebSocket 多路复用
  ENABLE_MULTIPLEX?: boolean;
}

interface EnvVarSchema {
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'enum';
  default?: string | number | boolean;
  enum?: readonly string[];
  validator?: (value: string) => boolean;
  errorMessage?: string;
}

const RP_ID_PATTERN =
  /^(localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

const isValidRpId = (rpId: string): boolean => {
  const normalized = rpId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized.includes('://') ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes(':') ||
    normalized.endsWith('.')
  ) {
    return false;
  }

  return RP_ID_PATTERN.test(normalized);
};

const ENV_SCHEMA: Record<keyof EnvironmentConfig, EnvVarSchema> = {
  // 核心配置
  NODE_ENV: {
    required: false,
    type: 'enum',
    enum: ['development', 'production', 'test'],
    default: 'development',
  },
  PORT: {
    required: false,
    type: 'number',
    default: 3001,
    validator: (value: string) => {
      const port = parseInt(value, 10);
      return port > 0 && port <= 65535;
    },
    errorMessage: 'PORT 必须在 1-65535 之间',
  },
  APP_NAME: {
    required: false,
    type: 'string',
    default: 'Nexus Terminal',
  },

  // 加密与会话（在 initializeEnvironment 中自动生成）
  ENCRYPTION_KEY: {
    required: true,
    type: 'string',
    validator: (value: string) => {
      // 必须是 64 字符的十六进制字符串（32 字节）
      return /^[0-9a-f]{64}$/i.test(value);
    },
    errorMessage: 'ENCRYPTION_KEY 必须是 64 字符的十六进制字符串（32 字节）',
  },
  SESSION_SECRET: {
    required: true,
    type: 'string',
    validator: (value: string) => {
      // 必须是 128 字符的十六进制字符串（64 字节）
      return /^[0-9a-f]{128}$/i.test(value);
    },
    errorMessage: 'SESSION_SECRET 必须是 128 字符的十六进制字符串（64 字节）',
  },

  // 部署模式
  DEPLOYMENT_MODE: {
    required: false,
    type: 'enum',
    enum: ['local', 'docker'],
    default: 'local',
  },

  // Guacamole 配置
  GUACD_HOST: {
    required: false,
    type: 'string',
    default: 'localhost',
  },
  GUACD_PORT: {
    required: false,
    type: 'number',
    default: 4822,
    validator: (value: string) => {
      const port = parseInt(value, 10);
      return port > 0 && port <= 65535;
    },
    errorMessage: 'GUACD_PORT 必须在 1-65535 之间',
  },

  // 远程网关配置
  REMOTE_GATEWAY_API_BASE_LOCAL: {
    required: false,
    type: 'string',
    default: 'http://localhost:9090',
    validator: (value: string) => /^https?:\/\/.+/.test(value),
    errorMessage: 'REMOTE_GATEWAY_API_BASE_LOCAL 必须是有效的 HTTP/HTTPS URL',
  },
  REMOTE_GATEWAY_API_BASE_DOCKER: {
    required: false,
    type: 'string',
    default: 'http://remote-gateway:9090',
    validator: (value: string) => /^https?:\/\/.+/.test(value),
    errorMessage: 'REMOTE_GATEWAY_API_BASE_DOCKER 必须是有效的 HTTP/HTTPS URL',
  },
  REMOTE_GATEWAY_WS_URL_LOCAL: {
    required: false,
    type: 'string',
    default: 'ws://localhost:8081',
    validator: (value: string) => /^wss?:\/\/.+/.test(value),
    errorMessage: 'REMOTE_GATEWAY_WS_URL_LOCAL 必须是有效的 WS/WSS URL',
  },
  REMOTE_GATEWAY_WS_URL_DOCKER: {
    required: false,
    type: 'string',
    default: 'ws://remote-gateway:8081',
    validator: (value: string) => /^wss?:\/\/.+/.test(value),
    errorMessage: 'REMOTE_GATEWAY_WS_URL_DOCKER 必须是有效的 WS/WSS URL',
  },

  // Passkey 配置
  RP_ID: {
    required: false,
    type: 'string',
    default: 'localhost',
    validator: (value: string) => {
      const rpIds = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      return rpIds.length > 0 && rpIds.every((item) => isValidRpId(item));
    },
    errorMessage: 'RP_ID 必须是有效的域名，多个值请用逗号分隔',
  },
  RP_ORIGIN: {
    required: false,
    type: 'string',
    default: 'http://localhost:5173',
    validator: (value: string) => {
      const origins = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      return origins.length > 0 && origins.every((origin) => /^https?:\/\/.+/.test(origin));
    },
    errorMessage: 'RP_ORIGIN 必须是有效的 HTTP/HTTPS URL，多个值请用逗号分隔',
  },

  // 跨域配置
  ALLOWED_ORIGINS: {
    required: false,
    type: 'string',
    validator: (value: string) => {
      const origins = value.split(',').map((o) => o.trim());
      return origins.every((origin) => /^https?:\/\/.+/.test(origin));
    },
    errorMessage: 'ALLOWED_ORIGINS 必须是逗号分隔的 HTTP/HTTPS URL 列表',
  },

  // WebSocket 心跳配置
  HEARTBEAT_INTERVAL_DESKTOP: {
    required: false,
    type: 'number',
    default: 30000,
    validator: (value: string) => {
      const interval = parseInt(value, 10);
      return interval >= 1000 && interval <= 300000;
    },
    errorMessage: 'HEARTBEAT_INTERVAL_DESKTOP 必须在 1000-300000 毫秒之间',
  },
  HEARTBEAT_INTERVAL_MOBILE: {
    required: false,
    type: 'number',
    default: 12000,
    validator: (value: string) => {
      const interval = parseInt(value, 10);
      return interval >= 1000 && interval <= 300000;
    },
    errorMessage: 'HEARTBEAT_INTERVAL_MOBILE 必须在 1000-300000 毫秒之间',
  },
  MAX_MISSED_PONGS_DESKTOP: {
    required: false,
    type: 'number',
    default: 1,
    validator: (value: string) => {
      const count = parseInt(value, 10);
      return count >= 1 && count <= 10;
    },
    errorMessage: 'MAX_MISSED_PONGS_DESKTOP 必须在 1-10 之间',
  },
  MAX_MISSED_PONGS_MOBILE: {
    required: false,
    type: 'number',
    default: 3,
    validator: (value: string) => {
      const count = parseInt(value, 10);
      return count >= 1 && count <= 10;
    },
    errorMessage: 'MAX_MISSED_PONGS_MOBILE 必须在 1-10 之间',
  },

  // 日志配置
  LOG_LEVEL: {
    required: false,
    type: 'enum',
    enum: ['error', 'warn', 'info', 'debug', 'silent'],
    default: (process.env.NODE_ENV ?? 'development') === 'development' ? 'debug' : 'info',
  },
  LOG_PRETTY: {
    required: false,
    type: 'enum',
    enum: ['true', 'false'],
    default: (process.env.NODE_ENV ?? 'development') === 'development' ? 'true' : 'false',
  },
  LOG_REDACT: {
    required: false,
    type: 'enum',
    enum: ['true', 'false'],
    default: 'true',
  },
  LOG_TZ: {
    required: false,
    type: 'string',
  },
  ENABLE_REQUEST_LOG: {
    required: false,
    type: 'boolean',
    default: true,
  },
  TZ: {
    required: false,
    type: 'string',
    default: 'UTC',
  },

  // 代理配置
  TRUST_PROXY: {
    required: false,
    type: 'string',
    validator: (value: string) => {
      // 支持 true/false 或数字（跳数）
      return /^(true|false|\d+)$/i.test(value);
    },
    errorMessage: 'TRUST_PROXY 必须是 true/false 或数字（跳数）',
  },
  TRUST_PROXY_HOPS: {
    required: false,
    type: 'number',
    validator: (value: string) => {
      const hops = parseInt(value, 10);
      return hops >= 1 && hops <= 10;
    },
    errorMessage: 'TRUST_PROXY_HOPS 必须在 1-10 之间',
  },

  // AI/NL2CMD 调试配置
  NL2CMD_TIMING_LOG: {
    required: false,
    type: 'enum',
    enum: ['0', '1'],
    default: '0',
  },
  NL2CMD_SLOW_THRESHOLD_MS: {
    required: false,
    type: 'number',
    default: 3000,
    validator: (value: string) => {
      const ms = parseInt(value, 10);
      return ms >= 0 && ms <= 300000;
    },
    errorMessage: 'NL2CMD_SLOW_THRESHOLD_MS 必须在 0-300000 毫秒之间',
  },
  NL2CMD_REQUEST_TIMEOUT_MS: {
    required: false,
    type: 'number',
    default: 30000,
    validator: (value: string) => {
      const ms = parseInt(value, 10);
      return ms >= 1000 && ms <= 300000;
    },
    errorMessage: 'NL2CMD_REQUEST_TIMEOUT_MS 必须在 1000-300000 毫秒之间',
  },

  // WebSocket 多路复用
  ENABLE_MULTIPLEX: {
    required: false,
    type: 'boolean',
    default: false,
    validator: (value: string) => /^(true|false|1|0)$/i.test(value),
    errorMessage: 'ENABLE_MULTIPLEX 仅支持 true/false/1/0',
  },
};

export class EnvironmentValidationError extends Error {
  constructor(
    message: string,
    public errors: string[]
  ) {
    super(message);
    this.name = 'EnvironmentValidationError';
  }
}

/**
 * 验证环境变量
 * @throws {EnvironmentValidationError} 如果环境变量验证失败
 */
export function validateEnvironment(): EnvironmentConfig {
  const errors: string[] = [];
  const config: Partial<EnvironmentConfig> = {};
  const setConfigValue = <K extends keyof EnvironmentConfig>(
    key: K,
    value: EnvironmentConfig[K]
  ): void => {
    config[key] = value;
  };

  for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
    const envKey = key as keyof EnvironmentConfig;
    const rawValue = process.env[envKey];

    // 检查必需变量
    if (schema.required && !rawValue) {
      errors.push(`环境变量 ${envKey} 是必需的，但未设置`);
      continue;
    }

    // 使用默认值
    const value = rawValue || (schema.default !== undefined ? String(schema.default) : undefined);

    if (!value) {
      continue; // 可选变量且未设置
    }

    // 类型和格式验证
    if (schema.type === 'enum') {
      if (!schema.enum?.includes(value)) {
        errors.push(
          `环境变量 ${envKey} 的值 "${value}" 不在允许的值列表中: ${schema.enum?.join(', ')}`
        );
        continue;
      }
      setConfigValue(envKey, value as EnvironmentConfig[typeof envKey]);
    } else if (schema.type === 'number') {
      const numValue = parseInt(value, 10);
      if (Number.isNaN(numValue)) {
        errors.push(`环境变量 ${envKey} 必须是有效的数字，当前值: "${value}"`);
        continue;
      }

      // 自定义验证器
      if (schema.validator && !schema.validator(value)) {
        errors.push(schema.errorMessage || `环境变量 ${envKey} 验证失败`);
        continue;
      }

      setConfigValue(envKey, numValue as EnvironmentConfig[typeof envKey]);
    } else if (schema.type === 'boolean') {
      const boolValue = value === 'true' || value === '1';
      setConfigValue(envKey, boolValue as unknown as EnvironmentConfig[typeof envKey]);
    } else {
      // string 类型
      // 自定义验证器
      if (schema.validator && !schema.validator(value)) {
        errors.push(schema.errorMessage || `环境变量 ${envKey} 验证失败`);
        continue;
      }

      setConfigValue(envKey, value as EnvironmentConfig[typeof envKey]);
    }
  }

  if (errors.length > 0) {
    throw new EnvironmentValidationError(`环境变量验证失败，发现 ${errors.length} 个错误`, errors);
  }

  return config as EnvironmentConfig;
}

/**
 * 打印环境变量配置（隐藏敏感信息）
 */
export function printEnvironmentConfig(config: EnvironmentConfig): void {
  const sensitiveKeys: Set<keyof EnvironmentConfig> = new Set(['ENCRYPTION_KEY', 'SESSION_SECRET']);

  logger.info('[Env Validator] 环境变量配置:');
  for (const [key, value] of Object.entries(config)) {
    const displayValue = sensitiveKeys.has(key as keyof EnvironmentConfig)
      ? '***REDACTED***'
      : value;
    logger.info(`  ${key}: ${displayValue}`);
  }
}
