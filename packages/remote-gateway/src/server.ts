import GuacamoleLite from 'guacamole-lite';
import http from 'http';
import crypto from 'crypto';
import pino from 'pino';
import { createRemoteGatewayApiApp } from './api';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  base: { module: 'remote-gateway' },
});

// --- 配置 ---
const REMOTE_GATEWAY_WS_PORT = process.env.REMOTE_GATEWAY_WS_PORT || 8081; // 统一端口，或按需分开
const REMOTE_GATEWAY_API_PORT = process.env.REMOTE_GATEWAY_API_PORT || 9090;
const GUACD_HOST = process.env.GUACD_HOST || 'localhost';
const GUACD_PORT = parseInt(process.env.GUACD_PORT || '4822', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const MAIN_BACKEND_URL = process.env.MAIN_BACKEND_URL || 'http://localhost:3001';

// CORS 配置：支持环境变量配置额外的允许来源（逗号分隔）
const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS || '';
const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === 'true'; // 开发模式可设置为 true

// Remote Gateway API 访问令牌（可选但强烈推荐）
// 若设置 REMOTE_GATEWAY_API_TOKEN，则 /api/remote-desktop/token 必须携带请求头：
//   X-Remote-Gateway-Token: <REMOTE_GATEWAY_API_TOKEN>
const REMOTE_GATEWAY_API_TOKEN = (process.env.REMOTE_GATEWAY_API_TOKEN || '').trim();

// --- 启动时生成内存加密密钥 ---
logger.info('正在为此会话生成新的内存加密密钥');
const ENCRYPTION_KEY_STRING = crypto.randomBytes(32).toString('hex');
const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY_STRING, 'hex');
logger.info('内存加密密钥已生成');

// 构建 CORS 允许的来源列表
const allowedOrigins: string[] = [FRONTEND_URL, MAIN_BACKEND_URL];

// 添加环境变量中配置的额外来源
if (CORS_ALLOWED_ORIGINS) {
  const additionalOrigins = CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  allowedOrigins.push(...additionalOrigins);
}

if (CORS_ALLOW_ALL) {
  logger.warn('CORS 允许所有来源（开发模式）');
} else {
  logger.info({ origins: allowedOrigins }, 'CORS 允许的来源');
}

if (process.env.NODE_ENV === 'production' && !REMOTE_GATEWAY_API_TOKEN) {
  logger.warn('REMOTE_GATEWAY_API_TOKEN 未设置：生产环境建议配置共享令牌');
}

const app = createRemoteGatewayApiApp({
  encryptionKeyBuffer: ENCRYPTION_KEY_BUFFER,
  allowedOrigins,
  corsAllowAll: CORS_ALLOW_ALL,
  apiToken: REMOTE_GATEWAY_API_TOKEN,
});

const apiServer = http.createServer(app);

const guacdOptions = {
  host: GUACD_HOST,
  port: GUACD_PORT,
};

const websocketOptions = {
  port: REMOTE_GATEWAY_WS_PORT,
  host: '0.0.0.0', // 监听所有接口
};

const clientOptions = {
  crypt: {
    key: ENCRYPTION_KEY_BUFFER,
    cypher: 'aes-256-cbc',
  },
  // 默认连接设置将根据协议动态调整
  connectionDefaultSettings: {},
};

type UnknownEventHandler = (...args: unknown[]) => void;

interface GuacServerLike {
  on?: (event: string, handler: UnknownEventHandler) => void;
  close?: (callback: () => void) => void;
}

interface GuacClientLike {
  id?: string;
  on?: (event: string, handler: UnknownEventHandler) => void;
}

const isGuacClientLike = (value: unknown): value is GuacClientLike =>
  typeof value === 'object' && value !== null;

let guacServer: GuacServerLike | null = null;

try {
  logger.info(
    { wsPort: websocketOptions.port, guacdHost: guacdOptions.host, guacdPort: guacdOptions.port },
    '正在初始化 GuacamoleLite',
  );
  const server = new GuacamoleLite(websocketOptions, guacdOptions, clientOptions) as GuacServerLike;
  guacServer = server;
  logger.info('GuacamoleLite 初始化成功');

  if (server.on) {
    server.on('error', (error: unknown) => {
      logger.error({ err: error }, 'GuacamoleLite 服务器错误');
    });
    server.on('connection', (client: unknown) => {
      const safeClient = isGuacClientLike(client) ? client : undefined;
      const clientId = typeof safeClient?.id === 'string' ? safeClient.id : '未知';
      logger.info({ clientId }, 'Guacd 连接事件触发');

      if (safeClient && typeof safeClient.on === 'function') {
        safeClient.on('disconnect', (reason: unknown) => {
          const reasonText = typeof reason === 'string' ? reason : '未知';
          logger.info({ clientId, reason: reasonText }, 'Guacd 连接断开');
        });
        safeClient.on('error', (err: unknown) => {
          logger.error({ clientId, err }, 'Guacd 客户端错误');
        });
      }
    });
  }
} catch (error: unknown) {
  logger.error({ err: error }, '初始化 GuacamoleLite 失败');
  process.exit(1);
}

apiServer.listen(REMOTE_GATEWAY_API_PORT, () => {
  logger.info({ port: REMOTE_GATEWAY_API_PORT }, 'API 服务器正在监听');
  logger.info({ wsPort: REMOTE_GATEWAY_WS_PORT }, 'Guacamole WebSocket 服务器端口');
});

const gracefulShutdown = (signal: string) => {
  logger.info({ signal }, '收到关闭信号，正在优雅地关闭');

  let guacClosed = false;
  let apiClosed = false;

  const tryExit = () => {
    if (guacClosed && apiClosed) {
      logger.info('所有服务器已关闭，正在退出');
      process.exit(0);
    }
  };

  apiServer.close((err) => {
    if (err) {
      logger.error({ err }, '关闭 API 服务器时出错');
    } else {
      logger.info('API 服务器已关闭');
    }
    apiClosed = true;
    tryExit();
  });

  if (typeof guacServer !== 'undefined' && guacServer && typeof guacServer.close === 'function') {
    logger.info('正在关闭 Guacamole 服务器');
    guacServer.close(() => {
      logger.info('Guacamole 服务器已关闭');
      guacClosed = true;
      tryExit();
    });
  } else {
    logger.info('Guacamole 服务器未运行或不支持 close() 方法');
    guacClosed = true;
    tryExit();
  }

  setTimeout(() => {
    logger.error('关闭超时，强制退出');
    process.exit(1);
  }, 10000); // 10 秒超时
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => {
  gracefulShutdown('SIGUSR2 (nodemon restart)');
});
