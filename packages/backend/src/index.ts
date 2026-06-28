import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs'; // fs is needed for early env loading if data/.env is checked

import express = require('express');
import { Request, Response, RequestHandler } from 'express';
import http from 'http';

import crypto from 'crypto';

import session from 'express-session';
import sessionFileStore from 'session-file-store';
import { settingsService } from './settings/settings.service';
import { logger, setLogLevel as setPinoLogLevel } from './utils/logger';
import { getDbInstance } from './database/connection';
import { initializeWebSocket } from './websocket';
import {
  validateEnvironment,
  printEnvironmentConfig,
  EnvironmentValidationError,
  type EnvironmentConfig,
} from './config/env.validator';
import { config, getPasskeyRelatedOriginsForRpId } from './config/app.config';
import { getHostnameFromHostHeader, getSingleHeaderToken } from './utils/url';
import {
  configureTrustProxy,
  registerSecurityMiddleware,
  createApiLimiter,
  createSettingsLimiter,
} from './config/middleware';
import {
  getSessionCookieSecureAutoWarning,
  resolveSessionCookieSecure,
} from './config/session.config';
import { registerRoutes } from './config/routes';

import eventService from './services/event.service';
import {
  loggingMiddleware,
  persistenceMiddleware,
  flushEventBuffer,
} from './services/event.middlewares';
import './notifications/notification.processor.service';
import './notifications/notification.dispatcher.service';
import { sshPoolService } from './services/ssh-pool.service';
import { cacheService } from './services/cache.service';

// 注册内置事件中间件
eventService.useEventMiddleware(loggingMiddleware);
eventService.useEventMiddleware(persistenceMiddleware);

type SwaggerConfigModule = typeof import('./config/swagger.config');

// --- 开始环境变量的早期加载 ---
// 1. 加载根目录的 .env 文件 (定义部署模式等)
// 注意: __dirname 在 dist/src 中，所以需要回退三级到项目根目录
const projectRootEnvPath = path.resolve(__dirname, '../../../.env');
const rootConfigResult = dotenv.config({ path: projectRootEnvPath });

if (rootConfigResult.error && (rootConfigResult.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  logger.warn(
    `[ENV Init Early] Warning: Could not load root .env file from ${projectRootEnvPath}. Error: ${rootConfigResult.error.message}`,
  );
} else if (!rootConfigResult.error) {
  logger.debug(
    `[ENV Init Early] Loaded environment variables from root .env file: ${projectRootEnvPath}`,
  );
} else {
  logger.debug(
    `[ENV Init Early] Root .env file not found at ${projectRootEnvPath}, proceeding without it.`,
  );
}

// 2. 加载 data/.env 文件 (定义密钥等)
import { DATA_ENV_PATH, UPLOADS_DIR, SESSIONS_DIR } from './config/paths';
const dataEnvPathGlobal = DATA_ENV_PATH;
const dataConfigResultGlobal = dotenv.config({ path: dataEnvPathGlobal }); // Renamed

if (
  dataConfigResultGlobal.error &&
  (dataConfigResultGlobal.error as NodeJS.ErrnoException).code !== 'ENOENT'
) {
  logger.warn(
    `[ENV Init Early] Warning: Could not load data .env file from ${dataEnvPathGlobal}. Error: ${dataConfigResultGlobal.error.message}`,
  );
} else if (!dataConfigResultGlobal.error) {
  logger.debug(
    `[ENV Init Early] Loaded environment variables from data .env file: ${dataEnvPathGlobal}`,
  );
}

// --- 全局错误处理 ---
// 捕获未处理的 Promise Rejection
process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  logger.error('---未处理的 Promise Rejection---');
  logger.error({ err: reason as Error }, '原因:');
});

// 捕获未捕获的同步异常
process.on('uncaughtException', (error: Error) => {
  logger.error('---未捕获的异常---');
  logger.error(error, '错误:');
});

// 进程退出时清理资源
let isShuttingDown = false;
const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return; // 防止重复触发
  isShuttingDown = true;

  logger.info(`收到 ${signal} 信号，正在优雅关闭...`);
  sshPoolService.shutdown();
  cacheService.stop();

  // 刷新事件日志缓冲区，确保数据不丢失（最多等待 8 秒）
  try {
    await Promise.race([
      flushEventBuffer(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('flush timeout')), 8000)),
    ]);
    logger.info('[Shutdown] 事件缓冲区已刷新');
  } catch (err) {
    logger.error('[Shutdown] 刷新事件缓冲区失败或超时:', err);
  }

  // 给其他清理逻辑一些时间（确保连接池清理完成）
  setTimeout(() => {
    process.exit(0);
  }, 2000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const initializeEnvironment = async () => {
  const dataEnvPath = dataEnvPathGlobal;
  let keysGenerated = false;
  let keysToAppend = '';

  // 检查 ENCRYPTION_KEY (process.env should be populated by early loading)
  if (!process.env.ENCRYPTION_KEY) {
    logger.info('[ENV Init] ENCRYPTION_KEY 未设置，正在生成...');
    const newEncryptionKey = crypto.randomBytes(32).toString('hex');
    process.env.ENCRYPTION_KEY = newEncryptionKey; // 更新当前进程环境
    keysToAppend += `\nENCRYPTION_KEY=${newEncryptionKey}`;
    keysGenerated = true;
  }

  // 3. 检查 SESSION_SECRET
  if (!process.env.SESSION_SECRET) {
    logger.info('[ENV Init] SESSION_SECRET 未设置，正在生成...');
    const newSessionSecret = crypto.randomBytes(64).toString('hex');
    process.env.SESSION_SECRET = newSessionSecret; // 更新当前进程环境
    keysToAppend += `\nSESSION_SECRET=${newSessionSecret}`;
    keysGenerated = true;
  }

  // 4. 检查 GUACD_HOST 和 GUACD_PORT
  if (!process.env.GUACD_HOST) {
    logger.warn('[ENV Init] GUACD_HOST 未设置，将使用默认值 "localhost"');
    process.env.GUACD_HOST = 'localhost';
  }
  if (!process.env.GUACD_PORT) {
    logger.warn('[ENV Init] GUACD_PORT 未设置，将使用默认值 "4822"');
    process.env.GUACD_PORT = '4822';
  }

  // 5. 如果生成了新密钥或添加了默认值，则追加到 .env 文件
  if (keysGenerated) {
    try {
      // 确保追加前有换行符 (如果文件非空) - Use dataEnvPath here
      let prefix = '';
      const fileExists = fs.existsSync(dataEnvPath);
      if (fileExists) {
        // Use dataEnvPath
        const content = fs.readFileSync(dataEnvPath, 'utf-8'); // Use dataEnvPath
        if (content.trim().length > 0 && !content.endsWith('\n')) {
          prefix = '\n';
        }
      }
      // 首次创建时以 mode 0o600 写入，确保密钥文件仅 owner 可读写
      if (!fileExists) {
        fs.writeFileSync(dataEnvPath, keysToAppend.trim(), { mode: 0o600 });
      } else {
        fs.appendFileSync(dataEnvPath, prefix + keysToAppend.trim());
        // 追加后也收紧权限，防止历史文件权限过宽（如本地开发场景）
        fs.chmodSync(dataEnvPath, 0o600);
      }
      logger.warn(`[ENV Init] 已自动生成密钥并保存到 ${dataEnvPath}`); // Use dataEnvPath
      logger.warn('[ENV Init] !!! 重要：请务必备份此 data/.env 文件，并在生产环境中妥善保管 !!!');
    } catch (error: unknown) {
      logger.error({ err: error as Error }, `[ENV Init] 无法写入密钥到 ${dataEnvPath}`); // Use dataEnvPath
      logger.error('[ENV Init] 请检查文件权限或手动创建 data/.env 文件并添加生成的密钥。');
      // 即使写入失败，密钥已在 process.env 中，程序可以继续运行本次
    }
  }

  // 5. 生产环境最终检查 (包括 Guacamole 相关)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      logger.error('错误：生产环境中 ENCRYPTION_KEY 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
      logger.error('错误：生产环境中 SESSION_SECRET 最终未能设置！');
      process.exit(1);
    }
    // Guacd host/port are less critical to halt on, defaults might work
  }
};
// --- 结束环境变量和密钥初始化 ---

// 基础 Express 应用设置
const app = express();
const server = http.createServer(app);

// --- 信任代理与安全中间件 ---
configureTrustProxy(app);
registerSecurityMiddleware(app);

// --- 限流中间件 ---
const apiLimiter = createApiLimiter();
const settingsLimiter = createSettingsLimiter();

// --- 静态文件服务 ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// 扩展 Express Request 类型
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
  }
}

const port = process.env.PORT || 3001;

const resolvePasskeyRpIdFromHost = (host: string): string | undefined => {
  const normalizedHost = getHostnameFromHostHeader(host);
  if (!normalizedHost) {
    return undefined;
  }

  const directRpIdMatch = config.passkeyRpConfigs.find((item) => item.rpId === normalizedHost);
  if (directRpIdMatch) {
    return directRpIdMatch.rpId;
  }

  const originHostMatch = config.passkeyRpConfigs.find(
    (item) => item.rpOriginHostname === normalizedHost,
  );

  return originHostMatch?.rpId;
};

// 初始化数据库
const initializeDatabase = async () => {
  try {
    const db = await getDbInstance();
    logger.debug('[Index] 正在检查用户数量...');
    const userCount = await new Promise<number>((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', (err: Error | null, row: { count: number }) => {
        if (err) {
          logger.error(err, '检查 users 表时出错');
          return reject(err);
        }
        resolve(row.count);
      });
    });
    logger.debug(`[Index] 用户数量检查完成。找到 ${userCount} 个用户。`);
  } catch (error: unknown) {
    logger.error(error as Error, '数据库初始化或检查失败');
    process.exit(1);
  }
};

// 尝试从数据库设置中加载日志等级（用于重启后保持一致）
const initializeRuntimeLogLevel = async () => {
  try {
    const level = await settingsService.getLogLevel();
    setPinoLogLevel(level);
  } catch (error: unknown) {
    logger.warn(error as Error, '[Index] 初始化日志等级失败，将使用默认日志等级。');
  }
};

// 启动服务器
const startServer = (envConfig: EnvironmentConfig) => {
  // --- 会话中间件配置 ---
  const FileStore = sessionFileStore(session);
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const isProd = process.env.NODE_ENV === 'production';
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60; // 30 天（秒）
  const thirtyDaysInMs = thirtyDaysInSeconds * 1000; // 30 天（毫秒）
  const sessionCookieSecureWarning = getSessionCookieSecureAutoWarning(
    envConfig.SESSION_COOKIE_SECURE,
    process.env.NODE_ENV,
  );
  if (sessionCookieSecureWarning) {
    logger.warn(sessionCookieSecureWarning);
  }

  const sessionMiddleware = session({
    store: new FileStore({
      path: SESSIONS_DIR,
      ttl: thirtyDaysInSeconds, // 30 天
      // logFn: console.log // 可选：启用详细日志
    }),
    // 直接从 process.env 读取，initializeEnvironment 已确保其存在
    secret: process.env.SESSION_SECRET as string,
    resave: false,
    saveUninitialized: false,
    proxy: true, // 信任反向代理设置的 X-Forwarded-Proto 头
    cookie: {
      httpOnly: true,
      secure: resolveSessionCookieSecure(envConfig.SESSION_COOKIE_SECURE),
      sameSite: 'lax', // 防止 CSRF 攻击
      maxAge: thirtyDaysInMs, // 30 天有效期
    },
  });
  app.use(sessionMiddleware);
  // --- 结束会话中间件配置 ---

  // --- WebAuthn Related Origins (.well-known/webauthn) ---
  app.get('/.well-known/webauthn', (req: Request, res: Response) => {
    const host = getSingleHeaderToken(req.get('host'));

    if (!host) {
      res.status(400).json({ origins: [] });
      return;
    }

    const rpId = resolvePasskeyRpIdFromHost(host);
    if (!rpId) {
      res.status(404).json({ origins: [] });
      return;
    }

    const origins = getPasskeyRelatedOriginsForRpId(rpId);

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({ origins });
  });

  // --- OpenAPI/Swagger 文档路由（工具链：API 文档） ---
  // 仅在非生产环境启用 Swagger 文档，避免暴露 API 结构
  // 安全要求：NODE_ENV=production 时必须禁用 Swagger，防止 API 结构泄露
  if (!isProd) {
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const swaggerUi = require('swagger-ui-express') as typeof import('swagger-ui-express');
      // eslint-disable-next-line global-require
      const swaggerConfig = require('./config/swagger.config') as SwaggerConfigModule;
      const { buildSwaggerSpec } = swaggerConfig;
      const swaggerSpec = buildSwaggerSpec();

      app.use('/api-docs', swaggerUi.serve);
      app.get(
        '/api-docs',
        swaggerUi.setup(swaggerSpec, {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: '星枢终端 API 文档',
        }),
      );
      logger.info(`[Swagger] API 文档已启用: http://localhost:${port}/api-docs`);
    } catch (error: unknown) {
      logger.warn(error as Error, '[Swagger] 文档依赖未安装，已跳过 /api-docs 挂载。');
    }
  } else {
    logger.info('[Swagger] 生产环境已禁用 API 文档');
  }
  // --- 结束 Swagger 文档路由 ---

  // --- 应用 API 路由 ---
  registerRoutes(app, apiLimiter, settingsLimiter);
  // --- 结束 API 路由 ---

  server.listen(port, () => {
    logger.info(`后端服务器正在监听 http://localhost:${port}`);
    initializeWebSocket(server, sessionMiddleware as RequestHandler); // Initialize existing WebSocket
  });
};

// --- 主程序启动流程 ---
const main = async () => {
  await initializeEnvironment(); // 首先初始化环境和密钥

  // 验证环境变量
  let envConfig: EnvironmentConfig;
  try {
    envConfig = validateEnvironment();
    printEnvironmentConfig(envConfig);
  } catch (error: unknown) {
    if (error instanceof EnvironmentValidationError) {
      logger.error('[ENV Validator] 环境变量验证失败:');
      error.errors.forEach((err) => logger.error(`  - ${err}`));
      process.exit(1);
    }
    throw error;
  }

  await initializeDatabase(); // 然后初始化数据库
  startServer(envConfig); // 优先对外提供服务
  // 非关键启动路径：异步加载运行时日志等级，避免阻塞冷启动
  void initializeRuntimeLogLevel().catch((err) => {
    logger.error('[Index] 异步初始化运行时日志等级失败（非致命）:', err);
  });
};

main().catch((error: unknown) => {
  logger.error(error, '启动过程中发生未处理的错误');
  process.exit(1);
});
