import { Request, Response, NextFunction } from 'express';
import path from 'path';
import * as archiver from 'archiver';
import { SFTPWrapper, Stats } from 'ssh2';
import { WebSocket } from 'ws';
import { clientStates } from '../websocket';
import { ErrorFactory, getErrorMessage } from '../utils/AppError';
import { shellEscape } from '../utils/shell-escape';
import {
  ClientState,
  AuthenticatedWebSocket,
  SftpCompressRequestPayload,
  SftpDecompressRequestPayload,
  SftpCompressSuccessPayload,
  SftpCompressErrorPayload,
  SftpDecompressSuccessPayload,
  SftpDecompressErrorPayload,
} from '../websocket/types'; // Import payload types
import { getErrorCode } from './sftp-error.utils';
import { validateSafePath } from './sftp-path.utils';
import { logger } from '../utils/logger';
import { sendWsMessage } from '../websocket/utils';

interface SftpDirectoryEntry {
  filename: string;
  attrs: Stats;
}

/**
 * 处理文件下载请求 (GET /api/v1/sftp/download)
 */
export const downloadFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { userId } = req.session;
  const connectionId = req.query.connectionId as string; // 从查询参数获取
  const sessionId = req.query.sessionId as string | undefined; // 可选：优先绑定当前前端会话
  const remotePath = req.query.remotePath as string; // 从查询参数获取

  // 参数验证
  if (!userId) {
    res.status(401).json({ message: '未授权：需要登录。' });
    return;
  }
  if (!connectionId || !remotePath) {
    res.status(400).json({ message: '缺少必要的查询参数 (connectionId, remotePath)。' });
    return;
  }

  logger.info(`SFTP 下载请求：用户 ${userId}, 连接 ${connectionId}, 路径 ${remotePath}`);

  // --- 修改：查找与 userId 和 connectionId 匹配的活动 SFTP 会话 ---
  let targetState: ClientState | null = null;
  const targetDbConnectionId = parseInt(connectionId, 10); // 将查询参数字符串转换为数字

  if (Number.isNaN(targetDbConnectionId)) {
    res.status(400).json({ message: '无效的 connectionId。' });
    return;
  }

  logger.debug(`SFTP 下载：正在查找用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的会话...`);
  if (sessionId) {
    const exactState = clientStates.get(sessionId);
    if (
      exactState &&
      exactState.ws.userId === userId &&
      exactState.dbConnectionId === targetDbConnectionId &&
      exactState.sftp
    ) {
      targetState = exactState;
      logger.debug(`SFTP 下载：按 sessionId 精确命中会话 (${sessionId})。`);
    }
  }
  if (!targetState) {
    for (const [activeSessionId, state] of clientStates.entries()) {
      // 检查 userId 和 dbConnectionId 是否都匹配，并且 sftp 实例存在
      if (
        state.ws.userId === userId &&
        state.dbConnectionId === targetDbConnectionId &&
        state.sftp
      ) {
        targetState = state;
        logger.debug(`SFTP 下载：找到匹配的会话 (Session ID: ${activeSessionId})。`);
        break;
      }
    }
  }

  if (!targetState || !targetState.sftp) {
    logger.warn(
      `SFTP 下载失败：未找到用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的活动 SFTP 会话。`,
    );
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }

  const userSftpSession = targetState.sftp; // 获取正确的 SFTP 实例

  try {
    // 获取文件状态以确定文件大小（可选，但有助于设置 Content-Length）
    const stats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      userSftpSession.lstat(
        remotePath,
        (err: Error | undefined, fileStats: import('ssh2').Stats) => {
          if (err) return reject(err);
          resolve(fileStats);
        },
      );
    });

    if (!stats.isFile()) {
      res.status(400).json({ message: '指定的路径不是一个文件。' });
      return;
    }

    // 设置响应头
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(remotePath)}"`); // 建议浏览器下载的文件名
    res.setHeader('Content-Type', 'application/octet-stream'); // 通用二进制类型
    if (stats.size) {
      res.setHeader('Content-Length', stats.size.toString());
    }

    // 创建可读流并 pipe 到响应对象
    const readStream = userSftpSession.createReadStream(remotePath);

    readStream.on('error', (err: Error) => {
      // 添加 Error 类型注解
      logger.error(`SFTP 读取流错误 (用户 ${userId}, 路径 ${remotePath}):`, err);
      // 如果响应头还没发送，可以发送错误状态码
      if (!res.headersSent) {
        res.status(500).json({ message: `读取远程文件失败: ${err.message}` });
      } else {
        // 如果头已发送，只能尝试结束响应
        res.end();
      }
    });

    readStream.pipe(res); // 将文件流直接传输给客户端

    // 监听响应对象的 close 事件，确保流被正确关闭 (虽然 pipe 通常会处理)
    res.on('close', () => {
      logger.debug(`SFTP 下载流关闭 (用户 ${userId}, 路径 ${remotePath})`);
    });

    logger.info(`SFTP 开始下载 (用户 ${userId}, 路径 ${remotePath})`);
  } catch (error: unknown) {
    logger.error(`SFTP 下载处理失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) {
      const errMsg = getErrorMessage(error);
      // 统一使用 ErrorFactory，不暴露内部错误细节
      if (errMsg?.includes('No such file')) {
        next(ErrorFactory.notFound('远程文件未找到'));
      } else {
        next(ErrorFactory.internalError('处理文件下载请求失败'));
      }
    }
  }
};

/**
 * 处理文件夹下载请求 (GET /api/v1/sftp/download-directory)
 */
export const downloadDirectory = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { userId } = req.session;
  const connectionId = req.query.connectionId as string; // 从查询参数获取
  const sessionId = req.query.sessionId as string | undefined; // 可选：优先绑定当前前端会话
  const remotePath = req.query.remotePath as string; // 从查询参数获取

  // 参数验证
  if (!userId) {
    res.status(401).json({ message: '未授权：需要登录。' });
    return;
  }
  if (!connectionId || !remotePath) {
    res.status(400).json({ message: '缺少必要的查询参数 (connectionId, remotePath)。' });
    return;
  }

  logger.info(`SFTP 文件夹下载请求：用户 ${userId}, 连接 ${connectionId}, 路径 ${remotePath}`);

  // --- 修改：查找与 userId 和 connectionId 匹配的活动 SFTP 会话 ---
  let targetState: ClientState | null = null;
  const targetDbConnectionId = parseInt(connectionId, 10); // 将查询参数字符串转换为数字

  if (Number.isNaN(targetDbConnectionId)) {
    res.status(400).json({ message: '无效的 connectionId。' });
    return;
  }

  logger.debug(
    `SFTP 文件夹下载：正在查找用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的会话...`,
  );
  if (sessionId) {
    const exactState = clientStates.get(sessionId);
    if (
      exactState &&
      exactState.ws.userId === userId &&
      exactState.dbConnectionId === targetDbConnectionId &&
      exactState.sftp
    ) {
      targetState = exactState;
      logger.debug(`SFTP 文件夹下载：按 sessionId 精确命中会话 (${sessionId})。`);
    }
  }
  if (!targetState) {
    for (const [activeSessionId, state] of clientStates.entries()) {
      // 检查 userId 和 dbConnectionId 是否都匹配，并且 sftp 实例存在
      if (
        state.ws.userId === userId &&
        state.dbConnectionId === targetDbConnectionId &&
        state.sftp
      ) {
        targetState = state;
        logger.debug(`SFTP 文件夹下载：找到匹配的会话 (Session ID: ${activeSessionId})。`);
        break;
      }
    }
  }

  if (!targetState || !targetState.sftp) {
    logger.warn(
      `SFTP 文件夹下载失败：未找到用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的活动 SFTP 会话。`,
    );
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }

  const userSftpSession = targetState.sftp; // 获取正确的 SFTP 实例

  try {
    // 1. 验证路径是否为目录
    const stats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      userSftpSession.lstat(
        remotePath,
        (err: Error | undefined, dirStats: import('ssh2').Stats) => {
          if (err) return reject(err);
          resolve(dirStats);
        },
      );
    });

    if (!stats.isDirectory()) {
      res.status(400).json({ message: '指定的路径不是一个目录。' });
      return;
    }

    // 2. 设置响应头
    // --- 修正：更健壮地生成压缩包名称 ---
    let baseName = path.basename(remotePath);
    // 处理根目录或路径以斜杠结尾的特殊情况
    if (!baseName || baseName === '/') {
      baseName = 'download'; // 如果 basename 为空或只是 '/'，使用默认名称
    }
    // 确保 basename 本身不包含尾部斜杠（尽管 path.basename 通常会处理）
    baseName = baseName.replace(/\/$/, '');
    const archiveName = `${baseName}.zip`; // 拼接 .zip 后缀
    // --- 结束修正 ---
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`); // 使用修正后的名称

    // 3. 创建 Archiver 实例
    const archive = archiver.create('zip', {
      zlib: { level: 9 }, // 设置压缩级别 (可选)
    });

    // 监听错误事件
    archive.on('warning', (err: Error) => {
      logger.warn(`Archiver warning (用户 ${userId}, 路径 ${remotePath}):`, err);
    });
    archive.on('error', (err: Error) => {
      logger.error(`Archiver error (用户 ${userId}, 路径 ${remotePath}):`, err);
      // 尝试发送错误响应，如果头还没发送
      if (!res.headersSent) {
        res.status(500).json({ message: `创建压缩文件时出错: ${err.message}` });
      } else {
        res.end(); // 否则尝试结束响应
      }
    });

    // 将 Archiver 输出流 pipe 到 HTTP 响应流
    archive.pipe(res);

    // 4. 递归添加文件/目录到 archive (核心逻辑)
    //    这部分需要一个辅助函数来处理 SFTP 递归和 Archiver 添加
    const addDirectoryToArchive = async (
      sftp: SFTPWrapper,
      dirPath: string,
      archivePath: string,
    ) => {
      // 使用局部结构类型约束 readdir 返回值，避免 any 泄漏。
      const entries = await new Promise<SftpDirectoryEntry[]>((resolve, reject) => {
        sftp.readdir(dirPath, (err: Error | undefined, list) => {
          if (err) return reject(err);
          resolve(list);
        });
      });

      for (const entry of entries) {
        const currentRemotePath = path.posix.join(dirPath, entry.filename); // 使用 posix.join 处理路径
        const currentArchivePath = path.posix.join(archivePath, entry.filename);

        if (entry.attrs.isDirectory()) {
          // 递归添加子目录
          // 使用 Buffer.from('') 代替 null
          archive.append(Buffer.from(''), { name: `${currentArchivePath}/` });
          await addDirectoryToArchive(sftp, currentRemotePath, currentArchivePath);
        } else if (entry.attrs.isFile()) {
          // 添加文件流
          const fileStream = sftp.createReadStream(currentRemotePath);
          archive.append(fileStream, { name: currentArchivePath });
          // 注意：需要处理 fileStream 的错误事件吗？Archiver 应该会处理？待验证。
          fileStream.on('error', (streamErr: Error) => {
            // 添加类型注解
            logger.error(`Error reading file stream ${currentRemotePath}:`, streamErr);
            // 如何通知 Archiver 或中断？ Archiver 的 error 事件应该会捕获？
            if (!archive.destroyed) {
              // 检查 archive 是否已被销毁
              archive.abort(); // 尝试终止 archive
            }
          });
        }
      }
    };

    // 开始添加根目录内容
    await addDirectoryToArchive(userSftpSession, remotePath, ''); // 归档路径从根开始

    // 5. 完成归档
    await archive.finalize();

    logger.info(`SFTP 文件夹下载完成 (用户 ${userId}, 路径 ${remotePath})`);
  } catch (error: unknown) {
    logger.error(`SFTP 文件夹下载处理失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) {
      const errMsg = getErrorMessage(error);
      // 统一使用 ErrorFactory，不暴露内部错误细节
      if (getErrorCode(error) === 'ENOENT' || errMsg?.includes('No such file')) {
        next(ErrorFactory.notFound('远程目录未找到'));
      } else {
        next(ErrorFactory.internalError('处理文件夹下载请求失败'));
      }
    } else {
      res.end(); // 如果头已发送，尝试结束响应
    }
  }
};

// --- WebSocket Message Handlers (to be called by WebSocket router) ---

/**
 * 发送通用 WebSocket 错误消息的辅助函数
 */
const sendWebSocketError = (
  ws: AuthenticatedWebSocket | undefined,
  type: string,
  message: string,
  requestId: string,
  details?: unknown,
  sessionId?: string,
) => {
  sendWsMessage(ws, type, { error: message, details, requestId }, sessionId, { requestId });
};

/**
 * 发送压缩错误消息
 */
const sendCompressError = (
  ws: AuthenticatedWebSocket | undefined,
  error: string,
  requestId: string,
  details?: string,
  sessionId?: string,
) => {
  const payload: SftpCompressErrorPayload = { error, requestId };
  if (details) payload.details = details;
  sendWebSocketError(ws, 'sftp:compress:error', error, requestId, payload, sessionId);
};

/**
 * 发送解压错误消息
 */
const sendDecompressError = (
  ws: AuthenticatedWebSocket | undefined,
  error: string,
  requestId: string,
  details?: string,
  sessionId?: string,
) => {
  const payload: SftpDecompressErrorPayload = { error, requestId };
  if (details) payload.details = details;
  sendWebSocketError(ws, 'sftp:decompress:error', error, requestId, payload, sessionId);
};

/**
 * 检查 stderr 输出是否包含表示错误的常见模式 (从 SftpService 复制过来)
 */
const isErrorInStdErr = (stderr: string): boolean => {
  if (!stderr || stderr.trim().length === 0) {
    return false; // 空 stderr 不是错误
  }
  const lowerStderr = stderr.toLowerCase();
  // 常见的错误关键词或模式
  const errorPatterns = [
    'error',
    'fail',
    'cannot',
    'not found',
    'no such file',
    'permission denied',
    'invalid',
    '不支持',
  ];
  // tar/zip 进度信息通常包含百分比或文件名，不应视为错误
  if (
    /[\d.]+%/.test(stderr) ||
    /adding:/.test(lowerStderr) ||
    /inflating:/.test(lowerStderr) ||
    /extracting:/.test(lowerStderr)
  ) {
    // 忽略一些明确的非错误输出
    if (errorPatterns.some((pattern) => lowerStderr.includes(pattern))) {
      // 如果进度信息中包含错误关键词，则可能真的是错误
      return true;
    }
    return false;
  }

  return errorPatterns.some((pattern) => lowerStderr.includes(pattern));
};

/**
 * 处理 'sftp:compress' WebSocket 消息
 * @param ws WebSocket 连接实例
 * @param payload 消息负载
 */
export const handleCompressRequest = async (
  ws: AuthenticatedWebSocket,
  payload: SftpCompressRequestPayload,
): Promise<void> => {
  const { sources, destinationArchiveName, format, targetDirectory, requestId } = payload;
  const { sessionId } = ws; // 从 AuthenticatedWebSocket 获取 sessionId

  if (!sessionId) {
    logger.error(
      `[WS SFTP Compress] Missing sessionId on WebSocket for request (ID: ${requestId}).`,
    );
    sendCompressError(ws, '内部错误：缺少会话 ID', requestId, undefined, sessionId);
    return;
  }

  const state = clientStates.get(sessionId);

  logger.info(`[WS SFTP Compress ${sessionId}] Received request (ID: ${requestId}).`);

  if (!state || !state.sshClient) {
    logger.warn(`[WS SFTP Compress ${sessionId}] SSH client not ready (ID: ${requestId})`);
    sendCompressError(ws, 'SSH 会话未就绪', requestId, undefined, sessionId);
    return;
  }

  logger.debug(
    `[WS SFTP Compress ${sessionId}] Processing compress request (ID: ${requestId}). Sources: ${sources.join(', ')}, Dest: ${destinationArchiveName}, Format: ${format}, Dir: ${targetDirectory}`,
  );

  // --- 路径安全验证：防止 Shell 注入 ---
  if (!validateSafePath(targetDirectory)) {
    sendCompressError(ws, '目标目录路径包含非法字符', requestId, undefined, sessionId);
    return;
  }
  if (!validateSafePath(destinationArchiveName)) {
    sendCompressError(ws, '归档文件名包含非法字符', requestId, undefined, sessionId);
    return;
  }
  for (const source of sources) {
    if (!validateSafePath(source)) {
      sendCompressError(ws, `源路径包含非法字符: ${source}`, requestId, undefined, sessionId);
      return;
    }
  }

  // --- 构建 Shell 命令 ---
  let command: string;
  // 使用单引号转义，防止 $、`、\、! 等字符被 shell 解释
  const quotedSources = sources.map((s: string) => shellEscape(s)).join(' ');
  const quotedTargetDir = shellEscape(targetDirectory);
  const quotedDestName = shellEscape(destinationArchiveName);

  const cdCommand = `cd -- ${quotedTargetDir}`;

  switch (format) {
    case 'zip':
      // zip -r [归档名] -- [源文件/目录列表]（-- 终止选项解析，防止 - 开头文件名被当作参数）
      command = `${cdCommand} && zip -qr ${quotedDestName} -- ${quotedSources}`;
      break;
    case 'targz':
      // tar -czf [归档名] -- [源文件/目录列表]
      command = `${cdCommand} && tar -czf ${quotedDestName} -- ${quotedSources}`;
      break;
    case 'tarbz2':
      // tar -cjf [归档名] -- [源文件/目录列表]
      command = `${cdCommand} && tar -cjf ${quotedDestName} -- ${quotedSources}`;
      break;
    default:
      sendCompressError(ws, `不支持的压缩格式: ${format}`, requestId, undefined, sessionId);
      return;
  }

  logger.debug(`[WS SFTP Compress ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

  // --- 执行命令 ---
  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        logger.error(
          `[WS SFTP Compress ${sessionId}] Failed to start exec (ID: ${requestId}):`,
          err,
        );
        sendCompressError(ws, `执行压缩命令失败: ${err.message}`, requestId, undefined, sessionId);
        return;
      }

      let stderrData = '';
      let _stdoutData = ''; // Capture stdout for debugging if needed
      let exitCode: number | null = null;

      stream.on('data', (data: Buffer) => {
        _stdoutData += data.toString();
        // logger.debug(`[WS SFTP Compress ${sessionId}] stdout: ${data}`);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
        logger.debug(`[WS SFTP Compress ${sessionId}] stderr: ${data}`); // Log stderr for debugging
      });

      stream.on('close', (code: number | null) => {
        exitCode = code;
        logger.debug(
          `[WS SFTP Compress ${sessionId}] Command finished with code ${exitCode} (ID: ${requestId}). Stderr length: ${stderrData.length}`,
        );
        if (exitCode === 0 && !isErrorInStdErr(stderrData)) {
          logger.info(`[WS SFTP Compress ${sessionId}] Compression successful (ID: ${requestId}).`);
          const successPayload: SftpCompressSuccessPayload = {
            message: '压缩成功',
            requestId,
            // Optionally add archive path or details here
            // archivePath: destinationArchivePath
          };
          if (ws.readyState === WebSocket.OPEN) {
            sendWsMessage(ws, 'sftp:compress:success', successPayload, sessionId);
          }
        } else {
          const errorDetails = stderrData.trim() || `压缩命令退出，代码: ${exitCode ?? 'N/A'}`;
          logger.error(
            `[WS SFTP Compress ${sessionId}] Compression failed (ID: ${requestId}): ${errorDetails}`,
          );
          sendCompressError(ws, '压缩失败', requestId, errorDetails, sessionId);
        }
      });

      stream.on('error', (streamErr: Error) => {
        logger.error(
          `[WS SFTP Compress ${sessionId}] Command stream error (ID: ${requestId}):`,
          streamErr,
        );
        // Avoid sending duplicate errors if 'close' already indicated failure
        if (exitCode === null) {
          sendCompressError(ws, '压缩命令流错误', requestId, streamErr.message, sessionId);
        }
      });
    });
  } catch (execError: unknown) {
    logger.error(
      `[WS SFTP Compress ${sessionId}] Unexpected error setting up exec (ID: ${requestId}):`,
      execError,
    );
    sendCompressError(
      ws,
      `执行压缩时发生意外错误: ${getErrorMessage(execError)}`,
      requestId,
      undefined,
      sessionId,
    );
  }
};

/**
 * 处理 'sftp:decompress' WebSocket 消息
 * @param ws WebSocket 连接实例
 * @param payload 消息负载
 */
export const handleDecompressRequest = async (
  ws: AuthenticatedWebSocket,
  payload: SftpDecompressRequestPayload,
): Promise<void> => {
  const { archivePath, requestId } = payload;
  const { sessionId } = ws;

  if (!sessionId) {
    logger.error(
      `[WS SFTP Decompress] Missing sessionId on WebSocket for request (ID: ${requestId}).`,
    );
    sendDecompressError(ws, '内部错误：缺少会话 ID', requestId, undefined, sessionId);
    return;
  }

  const state = clientStates.get(sessionId);

  logger.info(
    `[WS SFTP Decompress ${sessionId}] Received request for ${archivePath} (ID: ${requestId}).`,
  );

  if (!state || !state.sshClient) {
    logger.warn(`[WS SFTP Decompress ${sessionId}] SSH client not ready (ID: ${requestId})`);
    sendDecompressError(ws, 'SSH 会话未就绪', requestId, undefined, sessionId);
    return;
  }

  logger.debug(
    `[WS SFTP Decompress ${sessionId}] Processing decompress request for ${archivePath} (ID: ${requestId})`,
  );

  // --- 路径安全验证：防止 Shell 注入 ---
  if (!validateSafePath(archivePath)) {
    sendDecompressError(ws, '压缩包路径包含非法字符', requestId, undefined, sessionId);
    return;
  }

  const extractDir = path.posix.dirname(archivePath);
  const archiveBasename = path.posix.basename(archivePath);

  // --- 构建 Shell 命令 ---
  let command: string;
  // 使用单引号转义，防止 $、`、\、! 等字符被 shell 解释
  const quotedExtractDir = shellEscape(extractDir);
  const quotedArchiveBasename = shellEscape(archiveBasename);

  const cdCommand = `cd -- ${quotedExtractDir}`;

  const lowerArchivePath = archivePath.toLowerCase();

  if (lowerArchivePath.endsWith('.zip')) {
    // unzip -o -- [压缩包名]（-- 终止选项解析）
    command = `${cdCommand} && unzip -oq -- ${quotedArchiveBasename}`;
  } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
    // tar -xzf -- [压缩包名]
    command = `${cdCommand} && tar -xzf -- ${quotedArchiveBasename}`;
  } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
    // tar -xjf -- [压缩包名]
    command = `${cdCommand} && tar -xjf -- ${quotedArchiveBasename}`;
  } else {
    sendDecompressError(
      ws,
      `不支持的压缩文件格式: ${archivePath}`,
      requestId,
      undefined,
      sessionId,
    );
    return;
  }

  logger.debug(
    `[WS SFTP Decompress ${sessionId}] Executing command: ${command} (ID: ${requestId})`,
  );

  // --- 执行命令 ---
  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        logger.error(
          `[WS SFTP Decompress ${sessionId}] Failed to start exec (ID: ${requestId}):`,
          err,
        );
        sendDecompressError(
          ws,
          `执行解压命令失败: ${err.message}`,
          requestId,
          undefined,
          sessionId,
        );
        return;
      }

      let stderrData = '';
      let _stdoutData = '';
      let exitCode: number | null = null;

      stream.on('data', (data: Buffer) => {
        _stdoutData += data.toString();
        // logger.debug(`[WS SFTP Decompress ${sessionId}] stdout: ${data}`);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
        logger.debug(`[WS SFTP Decompress ${sessionId}] stderr: ${data}`); // Log stderr
      });

      stream.on('close', (code: number | null) => {
        exitCode = code;
        logger.debug(
          `[WS SFTP Decompress ${sessionId}] Command finished with code ${exitCode} (ID: ${requestId}). Stderr length: ${stderrData.length}`,
        );
        if (exitCode === 0 && !isErrorInStdErr(stderrData)) {
          logger.info(
            `[WS SFTP Decompress ${sessionId}] Decompression successful (ID: ${requestId}).`,
          );
          const successPayload: SftpDecompressSuccessPayload = {
            message: '解压成功',
            requestId,
            // Optionally add target directory
            // targetDirectory: extractDir
          };
          if (ws.readyState === WebSocket.OPEN) {
            sendWsMessage(ws, 'sftp:decompress:success', successPayload, sessionId);
          }
        } else {
          const errorDetails = stderrData.trim() || `解压命令退出，代码: ${exitCode ?? 'N/A'}`;
          logger.error(
            `[WS SFTP Decompress ${sessionId}] Decompression failed (ID: ${requestId}): ${errorDetails}`,
          );
          sendDecompressError(ws, '解压失败', requestId, errorDetails, sessionId);
        }
      });

      stream.on('error', (streamErr: Error) => {
        logger.error(
          `[WS SFTP Decompress ${sessionId}] Command stream error (ID: ${requestId}):`,
          streamErr,
        );
        if (exitCode === null) {
          sendDecompressError(ws, '解压命令流错误', requestId, streamErr.message, sessionId);
        }
      });
    });
  } catch (execError: unknown) {
    logger.error(
      `[WS SFTP Decompress ${sessionId}] Unexpected error setting up exec (ID: ${requestId}):`,
      execError,
    );
    sendDecompressError(
      ws,
      `执行解压时发生意外错误: ${getErrorMessage(execError)}`,
      requestId,
      undefined,
      sessionId,
    );
  }
};
