import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs'; // fs is needed for early env loading if data/.env is checked

import express = require('express');
import { Request, Response, NextFunction, RequestHandler } from 'express';
import http from 'http';

import crypto from 'crypto';

import session from 'express-session';
import sessionFileStore from 'session-file-store';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { settingsService } from './settings/settings.service';
import {
  installConsoleLogging,
  setLogLevel as setRuntimeLogLevel,
  type LogLevel,
} from './logging/logger';
import { getDbInstance } from './database/connection';
import authRouter from './auth/auth.routes';
import connectionsRouter from './connections/connections.routes';
import sftpRouter from './sftp/sftp.routes';
import proxyRoutes from './proxies/proxies.routes';
import tagsRouter from './tags/tags.routes';
import settingsRoutes from './settings/settings.routes';
import notificationRoutes from './notifications/notification.routes';
import auditRoutes from './audit/audit.routes';
import commandHistoryRoutes from './command-history/command-history.routes';
import quickCommandsRoutes from './quick-commands/quick-commands.routes';
import terminalThemeRoutes from './terminal-themes/terminal-theme.routes';
import appearanceRoutes from './appearance/appearance.routes';
import sshKeysRouter from './ssh-keys/ssh-keys.routes';
import quickCommandTagRoutes from './quick-command-tags/quick-command-tag.routes';
import sshSuspendRouter from './ssh-suspend/ssh-suspend.routes';
import { transfersRoutes } from './transfers/transfers.routes';
import pathHistoryRoutes from './path-history/path-history.routes';
import favoritePathsRouter from './favorite-paths/favorite-paths.routes';
import batchRoutes from './batch/batch.routes';
import aiRoutes from './ai-ops/ai.routes';
import dashboardRoutes from './services/dashboard.routes';
import { initializeWebSocket } from './websocket';
import { ipWhitelistMiddleware } from './auth/ipWhitelist.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.config';
import {
  validateEnvironment,
  printEnvironmentConfig,
  EnvironmentValidationError,
} from './config/env.validator';

import './services/event.service';
import './notifications/notification.processor.service';
import './notifications/notification.dispatcher.service';

// 统一安装 console 时间戳前缀 + 日志等级过滤（尽量早执行）
installConsoleLogging();

// --- 开始环境变量的早期加载 ---
// 1. 加载根目录的 .env 文件 (定义部署模式等)
// 注意: __dirname 在 dist/src 中，所以需要回退三级到项目根目录
const projectRootEnvPath = path.resolve(__dirname, '../../../.env');
const rootConfigResult = dotenv.config({ path: projectRootEnvPath });

if (rootConfigResult.error && (rootConfigResult.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  console.warn(
    `[ENV Init Early] Warning: Could not load root .env file from ${projectRootEnvPath}. Error: ${rootConfigResult.error.message}`
  );
} else if (!rootConfigResult.error) {
  console.log(
    `[ENV Init Early] Loaded environment variables from root .env file: ${projectRootEnvPath}`
  );
} else {
  console.log(
    `[ENV Init Early] Root .env file not found at ${projectRootEnvPath}, proceeding without it.`
  );
}

// 2. 加载 data/.env 文件 (定义密钥等)
// 注意: 这个路径是相对于编译后的 dist/src/index.js
const dataEnvPathGlobal = path.resolve(__dirname, '../data/.env'); // Renamed to avoid conflict if 'dataEnvPath' is used later
const dataConfigResultGlobal = dotenv.config({ path: dataEnvPathGlobal }); // Renamed

if (
  dataConfigResultGlobal.error &&
  (dataConfigResultGlobal.error as NodeJS.ErrnoException).code !== 'ENOENT'
) {
  console.warn(
    `[ENV Init Early] Warning: Could not load data .env file from ${dataEnvPathGlobal}. Error: ${dataConfigResultGlobal.error.message}`
  );
} else if (!dataConfigResultGlobal.error) {
  console.log(
    `[ENV Init Early] Loaded environment variables from data .env file: ${dataEnvPathGlobal}`
  );
}

// --- 全局错误处理 ---
// 捕获未处理的 Promise Rejection
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('---未处理的 Promise Rejection---');
  console.error('原因:', reason);
});

// 捕获未捕获的同步异常
process.on('uncaughtException', (error: Error) => {
  console.error('---未捕获的异常---');
  console.error('错误:', error);
});

const initializeEnvironment = async () => {
  const dataEnvPath = dataEnvPathGlobal;
  let keysGenerated = false;
  let keysToAppend = '';

  // 检查 ENCRYPTION_KEY (process.env should be populated by early loading)
  if (!process.env.ENCRYPTION_KEY) {
    console.log('[ENV Init] ENCRYPTION_KEY 未设置，正在生成...');
    const newEncryptionKey = crypto.randomBytes(32).toString('hex');
    process.env.ENCRYPTION_KEY = newEncryptionKey; // 更新当前进程环境
    keysToAppend += `\nENCRYPTION_KEY=${newEncryptionKey}`;
    keysGenerated = true;
  }

  // 3. 检查 SESSION_SECRET
  if (!process.env.SESSION_SECRET) {
    console.log('[ENV Init] SESSION_SECRET 未设置，正在生成...');
    const newSessionSecret = crypto.randomBytes(64).toString('hex');
    process.env.SESSION_SECRET = newSessionSecret; // 更新当前进程环境
    keysToAppend += `\nSESSION_SECRET=${newSessionSecret}`;
    keysGenerated = true;
  }

  // 4. 检查 GUACD_HOST 和 GUACD_PORT
  if (!process.env.GUACD_HOST) {
    console.warn('[ENV Init] GUACD_HOST 未设置，将使用默认值 "localhost"');
    process.env.GUACD_HOST = 'localhost';
  }
  if (!process.env.GUACD_PORT) {
    console.warn('[ENV Init] GUACD_PORT 未设置，将使用默认值 "4822"');
    process.env.GUACD_PORT = '4822';
  }

  // 5. 如果生成了新密钥或添加了默认值，则追加到 .env 文件
  if (keysGenerated) {
    try {
      // 确保追加前有换行符 (如果文件非空) - Use dataEnvPath here
      let prefix = '';
      if (fs.existsSync(dataEnvPath)) {
        // Use dataEnvPath
        const content = fs.readFileSync(dataEnvPath, 'utf-8'); // Use dataEnvPath
        if (content.trim().length > 0 && !content.endsWith('\n')) {
          prefix = '\n';
        }
      }
      fs.appendFileSync(dataEnvPath, prefix + keysToAppend.trim()); // Use dataEnvPath, trim() 移除开头的换行符
      console.warn(`[ENV Init] 已自动生成密钥并保存到 ${dataEnvPath}`); // Use dataEnvPath
      console.warn('[ENV Init] !!! 重要：请务必备份此 data/.env 文件，并在生产环境中妥善保管 !!!');
    } catch (error) {
      console.error(`[ENV Init] 无法写入密钥到 ${dataEnvPath}:`, error); // Use dataEnvPath
      console.error('[ENV Init] 请检查文件权限或手动创建 data/.env 文件并添加生成的密钥。');
      // 即使写入失败，密钥已在 process.env 中，程序可以继续运行本次
    }
  }

  // 5. 生产环境最终检查 (虽然理论上已被覆盖，但作为保险)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      console.error('错误：生产环境中 ENCRYPTION_KEY 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
      console.error('错误：生产环境中 SESSION_SECRET 最终未能设置！');
      process.exit(1);
    }
  }

  // 6. 最终检查 (包括 Guacamole 相关)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      console.error('错误：生产环境中 ENCRYPTION_KEY 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
      console.error('错误：生产环境中 SESSION_SECRET 最终未能设置！');
      process.exit(1);
    }
    // Guacd host/port are less critical to halt on, defaults might work
  }
};
// --- 结束环境变量和密钥初始化 ---

// 基础 Express 应用设置
const app = express();
const server = http.createServer(app);

// --- 信任代理设置 ---
// 仅在生产环境启用（通常在反向代理如 Nginx 后运行）
// 使用明确的 hop 数而非 boolean true，以限制可信代理层级
// 默认信任 1 层代理（通常是 Nginx），可通过 TRUST_PROXY_HOPS 环境变量自定义
const isProduction = process.env.NODE_ENV === 'production';
const trustProxyHops = process.env.TRUST_PROXY_HOPS
  ? parseInt(process.env.TRUST_PROXY_HOPS, 10)
  : 1;
app.set('trust proxy', isProduction ? trustProxyHops : false);

// --- 安全中间件 ---
// 1. Helmet - 设置 HTTP 安全头
app.use(
  helmet({
    contentSecurityPolicy: false, // 由前端处理 CSP
    crossOriginEmbedderPolicy: false, // 允许跨域资源
  })
);

// 2. CORS - 跨域资源共享配置
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:18111'];

app.use(
  cors({
    origin: (origin, callback) => {
      // 允许没有 origin 的请求（如 Postman、curl）
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // 返回 false 触发 CORS 错误（403），而非 Error（500）
      return callback(null, false);
    },
    credentials: true, // 允许携带 Cookie
  })
);

// 3. Rate Limiting - 限流配置
// 登录端点严格限流（防止暴力破解）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 5, // 最多 5 次尝试
  message: '登录尝试次数过多，请 15 分钟后再试',
  standardHeaders: true,
  legacyHeaders: false,
});

// 一般 API 宽松限流
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 最多 100 次请求
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
});

// --- 其他中间件 ---
app.use(ipWhitelistMiddleware as RequestHandler);
app.use(express.json());

// --- 静态文件服务 ---
const uploadsPath = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsPath)) {
  // 确保 uploads 目录存在
  fs.mkdirSync(uploadsPath, { recursive: true });
}
// app.use('/uploads', express.static(uploadsPath)); // 不再需要，文件通过 API 提供

// 扩展 Express Request 类型
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
  }
}

const port = process.env.PORT || 3001;

// 初始化数据库
const initializeDatabase = async () => {
  try {
    const db = await getDbInstance();
    console.log('[Index] 正在检查用户数量...');
    const userCount = await new Promise<number>((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', (err: Error | null, row: { count: number }) => {
        if (err) {
          console.error('检查 users 表时出错:', err.message);
          return reject(err);
        }
        resolve(row.count);
      });
    });
    console.log(`[Index] 用户数量检查完成。找到 ${userCount} 个用户。`);
  } catch (error) {
    console.error('数据库初始化或检查失败:', error);
    process.exit(1);
  }
};

// 尝试从数据库设置中加载日志等级（用于重启后保持一致）
const initializeRuntimeLogLevel = async () => {
  try {
    const level = await settingsService.getLogLevel();
    setRuntimeLogLevel(level as LogLevel);
  } catch (error) {
    console.warn('[Index] 初始化日志等级失败，将使用默认日志等级。', error);
  }
};

// 启动服务器
const startServer = () => {
  // --- 会话中间件配置 ---
  const FileStore = sessionFileStore(session);
  // 修改路径以匹配 Docker volume 挂载点 /app/data
  const sessionsPath = path.join('/app/data', 'sessions');
  if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath, { recursive: true });
  }

  const isProd = process.env.NODE_ENV === 'production';
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60; // 30 天（秒）
  const thirtyDaysInMs = thirtyDaysInSeconds * 1000; // 30 天（毫秒）

  const sessionMiddleware = session({
    store: new FileStore({
      path: sessionsPath,
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
      secure: isProd, // 生产环境强制 HTTPS
      sameSite: 'lax', // 防止 CSRF 攻击
      maxAge: thirtyDaysInMs, // 30 天有效期
    },
  });
  app.use(sessionMiddleware);
  // --- 结束会话中间件配置 ---

  // --- OpenAPI/Swagger 文档路由（工具链：API 文档） ---
  // 仅在非生产环境启用 Swagger 文档，避免暴露 API 结构
  if (!isProd) {
    app.use('/api-docs', swaggerUi.serve);
    app.get(
      '/api-docs',
      swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: '星枢终端 API 文档',
      })
    );
    console.log(`[Swagger] API 文档已启用: http://localhost:${port}/api-docs`);
  } else {
    console.log('[Swagger] 生产环境已禁用 API 文档');
  }
  // --- 结束 Swagger 文档路由 ---

  // --- 应用 API 路由 ---
  // 认证路由（严格限流）
  app.use('/api/v1/auth', authLimiter, authRouter);

  // 一般 API 路由（宽松限流）
  app.use('/api/v1/connections', apiLimiter, connectionsRouter);
  app.use('/api/v1/sftp', apiLimiter, sftpRouter);
  app.use('/api/v1/proxies', apiLimiter, proxyRoutes);
  app.use('/api/v1/tags', apiLimiter, tagsRouter);
  app.use('/api/v1/settings', apiLimiter, settingsRoutes);
  app.use('/api/v1/notifications', apiLimiter, notificationRoutes);
  app.use('/api/v1/audit-logs', apiLimiter, auditRoutes);
  app.use('/api/v1/command-history', apiLimiter, commandHistoryRoutes);
  app.use('/api/v1/quick-commands', apiLimiter, quickCommandsRoutes);
  app.use('/api/v1/terminal-themes', apiLimiter, terminalThemeRoutes);
  app.use('/api/v1/appearance', apiLimiter, appearanceRoutes);
  app.use('/api/v1/ssh-keys', apiLimiter, sshKeysRouter);
  app.use('/api/v1/quick-command-tags', apiLimiter, quickCommandTagRoutes);
  app.use('/api/v1/ssh-suspend', apiLimiter, sshSuspendRouter);
  app.use('/api/v1/transfers', apiLimiter, transfersRoutes());
  app.use('/api/v1/path-history', apiLimiter, pathHistoryRoutes);
  app.use('/api/v1/favorite-paths', apiLimiter, favoritePathsRouter);
  app.use('/api/v1/batch', apiLimiter, batchRoutes);
  app.use('/api/v1/ai', apiLimiter, aiRoutes);
  app.use('/api/v1/dashboard', apiLimiter, dashboardRoutes);

  // 状态检查接口
  app.get('/api/v1/status', (req: Request, res: Response) => {
    res.json({ status: '后端服务运行中！' });
  });
  // --- 结束 API 路由 ---

  // --- P1-6: 全局错误处理中间件（必须在所有路由之后） ---
  app.use(notFoundHandler); // 404 处理
  app.use(errorHandler); // 错误处理
  // --- 结束错误处理中间件 ---

  server.listen(port, () => {
    console.log(`后端服务器正在监听 http://localhost:${port}`);
    initializeWebSocket(server, sessionMiddleware as RequestHandler); // Initialize existing WebSocket
  });
};

// --- 主程序启动流程 ---
const main = async () => {
  await initializeEnvironment(); // 首先初始化环境和密钥

  // 验证环境变量
  try {
    const envConfig = validateEnvironment();
    printEnvironmentConfig(envConfig);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      console.error('[ENV Validator] 环境变量验证失败:');
      error.errors.forEach((err) => console.error(`  - ${err}`));
      process.exit(1);
    }
    throw error;
  }

  await initializeDatabase(); // 然后初始化数据库
  await initializeRuntimeLogLevel(); // 再从设置中初始化运行时日志等级
  startServer(); // 最后启动服务器
};

main().catch((error) => {
  console.error('启动过程中发生未处理的错误:', error);
  process.exit(1);
});
