import { Request, Response } from 'express';
import path from 'path';
import * as archiver from 'archiver';
import { SFTPWrapper, Stats } from 'ssh2';
import { WebSocket } from 'ws';
import { clientStates } from '../websocket';
import { ClientState, AuthenticatedWebSocket } from '../websocket/types';
import {
  SftpCompressRequestPayload,
  SftpDecompressRequestPayload,
  SftpCompressSuccessPayload,
  SftpCompressErrorPayload,
  SftpDecompressSuccessPayload,
  SftpDecompressErrorPayload,
} from '../websocket/types'; // Import payload types
/**
 * 处理文件下载请求 (GET /api/v1/sftp/download)
 */
export const downloadFile = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.session;
  const connectionId = req.query.connectionId as string; // 从查询参数获取
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

  console.log(`SFTP 下载请求：用户 ${userId}, 连接 ${connectionId}, 路径 ${remotePath}`);

  // --- 修改：查找与 userId 和 connectionId 匹配的活动 SFTP 会话 ---
  let targetState: ClientState | null = null;
  const targetDbConnectionId = parseInt(connectionId, 10); // 将查询参数字符串转换为数字

  if (isNaN(targetDbConnectionId)) {
    res.status(400).json({ message: '无效的 connectionId。' });
    return;
  }

  console.log(`SFTP 下载：正在查找用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的会话...`);
  for (const [sessionId, state] of clientStates.entries()) {
    // 检查 userId 和 dbConnectionId 是否都匹配，并且 sftp 实例存在
    if (state.ws.userId === userId && state.dbConnectionId === targetDbConnectionId && state.sftp) {
      targetState = state;
      console.log(`SFTP 下载：找到匹配的会话 (Session ID: ${sessionId})。`);
      break;
    }
  }

  if (!targetState || !targetState.sftp) {
    console.warn(
      `SFTP 下载失败：未找到用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的活动 SFTP 会话。`
    );
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }

  const userSftpSession = targetState.sftp; // 获取正确的 SFTP 实例

  try {
    // 获取文件状态以确定文件大小（可选，但有助于设置 Content-Length）
    const stats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      // +++ 修正类型注解 +++
      userSftpSession!.lstat(remotePath, (err: Error | undefined, stats: import('ssh2').Stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
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
      console.error(`SFTP 读取流错误 (用户 ${userId}, 路径 ${remotePath}):`, err);
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
      console.log(`SFTP 下载流关闭 (用户 ${userId}, 路径 ${remotePath})`);
    });

    console.log(`SFTP 开始下载 (用户 ${userId}, 路径 ${remotePath})`);
  } catch (error: any) {
    console.error(`SFTP 下载处理失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) {
      if (error.message?.includes('No such file')) {
        res.status(404).json({ message: '远程文件未找到。' });
      } else {
        res.status(500).json({ message: `处理下载请求时出错: ${error.message}` });
      }
    }
  }
};

/**
 * 处理文件夹下载请求 (GET /api/v1/sftp/download-directory)
 */
export const downloadDirectory = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.session;
  const connectionId = req.query.connectionId as string; // 从查询参数获取
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

  console.log(`SFTP 文件夹下载请求：用户 ${userId}, 连接 ${connectionId}, 路径 ${remotePath}`);

  // --- 修改：查找与 userId 和 connectionId 匹配的活动 SFTP 会话 ---
  let targetState: ClientState | null = null;
  const targetDbConnectionId = parseInt(connectionId, 10); // 将查询参数字符串转换为数字

  if (isNaN(targetDbConnectionId)) {
    res.status(400).json({ message: '无效的 connectionId。' });
    return;
  }

  console.log(
    `SFTP 文件夹下载：正在查找用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的会话...`
  );
  for (const [sessionId, state] of clientStates.entries()) {
    // 检查 userId 和 dbConnectionId 是否都匹配，并且 sftp 实例存在
    if (state.ws.userId === userId && state.dbConnectionId === targetDbConnectionId && state.sftp) {
      targetState = state;
      console.log(`SFTP 文件夹下载：找到匹配的会话 (Session ID: ${sessionId})。`);
      break;
    }
  }

  if (!targetState || !targetState.sftp) {
    console.warn(
      `SFTP 文件夹下载失败：未找到用户 ${userId} 且连接 ID 为 ${targetDbConnectionId} 的活动 SFTP 会话。`
    );
    res.status(404).json({ message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。' });
    return;
  }

  const userSftpSession = targetState.sftp; // 获取正确的 SFTP 实例

  try {
    // 1. 验证路径是否为目录
    const stats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      // +++ 修正类型注解 +++
      userSftpSession!.lstat(remotePath, (err: Error | undefined, stats: import('ssh2').Stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
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
      console.warn(`Archiver warning (用户 ${userId}, 路径 ${remotePath}):`, err);
    });
    archive.on('error', (err: Error) => {
      console.error(`Archiver error (用户 ${userId}, 路径 ${remotePath}):`, err);
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
      archivePath: string
    ) => {
      // 使用导入的 SFTPWrapper
      // 移除 list 的显式类型注解 FileEntry[]，让 TypeScript 推断
      const entries = await new Promise<any[]>((resolve, reject) => {
        // 使用 any[] 作为 Promise 类型，或更具体的推断类型
        sftp.readdir(dirPath, (err: Error | undefined, list) => {
          // 移除 list 的类型注解
          if (err) return reject(err);
          // 可以在这里检查 list 的结构，但暂时依赖推断
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
            console.error(`Error reading file stream ${currentRemotePath}:`, streamErr);
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

    console.log(`SFTP 文件夹下载完成 (用户 ${userId}, 路径 ${remotePath})`);
  } catch (error: any) {
    console.error(`SFTP 文件夹下载处理失败 (用户 ${userId}, 路径 ${remotePath}):`, error);
    if (!res.headersSent) {
      if (error.code === 'ENOENT' || error.message?.includes('No such file')) {
        // 检查 SFTP 错误码或消息
        res.status(404).json({ message: '远程目录未找到。' });
      } else {
        res.status(500).json({ message: `处理文件夹下载请求时出错: ${error.message}` });
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
  details?: any
) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload: { error: message, details, requestId } }));
  } else {
    console.warn(
      `WebSocket closed or invalid, cannot send error for request ${requestId}. Type: ${type}, Message: ${message}`
    );
  }
};

/**
 * 发送压缩错误消息
 */
const sendCompressError = (
  ws: AuthenticatedWebSocket | undefined,
  error: string,
  requestId: string,
  details?: string
) => {
  const payload: SftpCompressErrorPayload = { error, requestId };
  if (details) payload.details = details;
  sendWebSocketError(ws, 'sftp:compress:error', error, requestId, payload);
};

/**
 * 发送解压错误消息
 */
const sendDecompressError = (
  ws: AuthenticatedWebSocket | undefined,
  error: string,
  requestId: string,
  details?: string
) => {
  const payload: SftpDecompressErrorPayload = { error, requestId };
  if (details) payload.details = details;
  sendWebSocketError(ws, 'sftp:decompress:error', error, requestId, payload);
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
  payload: SftpCompressRequestPayload
): Promise<void> => {
  const { sources, destinationArchiveName, format, targetDirectory, requestId } = payload;
  const { sessionId } = ws; // 从 AuthenticatedWebSocket 获取 sessionId

  if (!sessionId) {
    console.error(
      `[WS SFTP Compress] Missing sessionId on WebSocket for request (ID: ${requestId}).`
    );
    sendCompressError(ws, '内部错误：缺少会话 ID', requestId);
    return;
  }

  const state = clientStates.get(sessionId);

  console.log(`[WS SFTP Compress ${sessionId}] Received request (ID: ${requestId}).`);

  if (!state || !state.sshClient) {
    console.warn(`[WS SFTP Compress ${sessionId}] SSH client not ready (ID: ${requestId})`);
    sendCompressError(ws, 'SSH 会话未就绪', requestId);
    return;
  }

  console.debug(
    `[WS SFTP Compress ${sessionId}] Processing compress request (ID: ${requestId}). Sources: ${sources.join(', ')}, Dest: ${destinationArchiveName}, Format: ${format}, Dir: ${targetDirectory}`
  );

  // 构建目标压缩包的完整路径 (使用 posix 风格)
  const destinationArchivePath = path.posix.join(targetDirectory, destinationArchiveName);

  // --- 构建 Shell 命令 ---
  let command: string;
  // 确保源路径被正确引用，特别是包含空格或特殊字符时
  // 注意：源路径是相对于 targetDirectory 的
  const quotedSources = sources.map((s: string) => `"${s.replace(/"/g, '\\"')}"`).join(' ');
  // 确保目标目录和压缩包名称被正确引用
  const quotedTargetDir = `"${targetDirectory.replace(/"/g, '\\"')}"`;
  const quotedDestName = `"${destinationArchiveName.replace(/"/g, '\\"')}"`;

  const cdCommand = `cd ${quotedTargetDir}`;

  switch (format) {
    case 'zip':
      // zip -r [归档名] [源文件/目录列表]
      command = `${cdCommand} && zip -qr ${quotedDestName} ${quotedSources}`; // -q for quiet to reduce stderr noise
      break;
    case 'targz':
      // tar -czvf [归档名] [源文件/目录列表]
      command = `${cdCommand} && tar -czf ${quotedDestName} ${quotedSources}`; // removed -v for less noise
      break;
    case 'tarbz2':
      // tar -cjvf [归档名] [源文件/目录列表]
      command = `${cdCommand} && tar -cjf ${quotedDestName} ${quotedSources}`; // removed -v for less noise
      break;
    default:
      sendCompressError(ws, `不支持的压缩格式: ${format}`, requestId);
      return;
  }

  console.log(`[WS SFTP Compress ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

  // --- 执行命令 ---
  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        console.error(
          `[WS SFTP Compress ${sessionId}] Failed to start exec (ID: ${requestId}):`,
          err
        );
        sendCompressError(ws, `执行压缩命令失败: ${err.message}`, requestId);
        return;
      }

      let stderrData = '';
      let stdoutData = ''; // Capture stdout for debugging if needed
      let exitCode: number | null = null;

      stream.on('data', (data: Buffer) => {
        stdoutData += data.toString();
        // console.debug(`[WS SFTP Compress ${sessionId}] stdout: ${data}`);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
        console.debug(`[WS SFTP Compress ${sessionId}] stderr: ${data}`); // Log stderr for debugging
      });

      stream.on('close', (code: number | null) => {
        exitCode = code;
        console.log(
          `[WS SFTP Compress ${sessionId}] Command finished with code ${exitCode} (ID: ${requestId}). Stderr length: ${stderrData.length}`
        );
        if (exitCode === 0 && !isErrorInStdErr(stderrData)) {
          console.log(`[WS SFTP Compress ${sessionId}] Compression successful (ID: ${requestId}).`);
          const successPayload: SftpCompressSuccessPayload = {
            message: '压缩成功',
            requestId,
            // Optionally add archive path or details here
            // archivePath: destinationArchivePath
          };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sftp:compress:success', payload: successPayload }));
          }
        } else {
          const errorDetails = stderrData.trim() || `压缩命令退出，代码: ${exitCode ?? 'N/A'}`;
          console.error(
            `[WS SFTP Compress ${sessionId}] Compression failed (ID: ${requestId}): ${errorDetails}`
          );
          sendCompressError(ws, '压缩失败', requestId, errorDetails);
        }
      });

      stream.on('error', (streamErr: Error) => {
        console.error(
          `[WS SFTP Compress ${sessionId}] Command stream error (ID: ${requestId}):`,
          streamErr
        );
        // Avoid sending duplicate errors if 'close' already indicated failure
        if (exitCode === null) {
          sendCompressError(ws, '压缩命令流错误', requestId, streamErr.message);
        }
      });
    });
  } catch (execError: any) {
    console.error(
      `[WS SFTP Compress ${sessionId}] Unexpected error setting up exec (ID: ${requestId}):`,
      execError
    );
    sendCompressError(ws, `执行压缩时发生意外错误: ${execError.message}`, requestId);
  }
};

/**
 * 处理 'sftp:decompress' WebSocket 消息
 * @param ws WebSocket 连接实例
 * @param payload 消息负载
 */
export const handleDecompressRequest = async (
  ws: AuthenticatedWebSocket,
  payload: SftpDecompressRequestPayload
): Promise<void> => {
  const { archivePath, requestId } = payload;
  const { sessionId } = ws;

  if (!sessionId) {
    console.error(
      `[WS SFTP Decompress] Missing sessionId on WebSocket for request (ID: ${requestId}).`
    );
    sendDecompressError(ws, '内部错误：缺少会话 ID', requestId);
    return;
  }

  const state = clientStates.get(sessionId);

  console.log(
    `[WS SFTP Decompress ${sessionId}] Received request for ${archivePath} (ID: ${requestId}).`
  );

  if (!state || !state.sshClient) {
    console.warn(`[WS SFTP Decompress ${sessionId}] SSH client not ready (ID: ${requestId})`);
    sendDecompressError(ws, 'SSH 会话未就绪', requestId);
    return;
  }

  console.debug(
    `[WS SFTP Decompress ${sessionId}] Processing decompress request for ${archivePath} (ID: ${requestId})`
  );

  const extractDir = path.posix.dirname(archivePath);
  const archiveBasename = path.posix.basename(archivePath);

  // --- 构建 Shell 命令 ---
  let command: string;
  // 确保路径被正确引用
  const quotedExtractDir = `"${extractDir.replace(/"/g, '\\"')}"`;
  const quotedArchiveBasename = `"${archiveBasename.replace(/"/g, '\\"')}"`;

  const cdCommand = `cd ${quotedExtractDir}`;

  const lowerArchivePath = archivePath.toLowerCase();

  if (lowerArchivePath.endsWith('.zip')) {
    // unzip -o [压缩包名]
    command = `${cdCommand} && unzip -oq ${quotedArchiveBasename}`; // -o: overwrite, -q: quiet
  } else if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
    // tar -xzvf [压缩包名]
    command = `${cdCommand} && tar -xzf ${quotedArchiveBasename}`; // removed -v
  } else if (lowerArchivePath.endsWith('.tar.bz2') || lowerArchivePath.endsWith('.tbz2')) {
    // tar -xjvf [压缩包名]
    command = `${cdCommand} && tar -xjf ${quotedArchiveBasename}`; // removed -v
  } else {
    sendDecompressError(ws, `不支持的压缩文件格式: ${archivePath}`, requestId);
    return;
  }

  console.log(`[WS SFTP Decompress ${sessionId}] Executing command: ${command} (ID: ${requestId})`);

  // --- 执行命令 ---
  try {
    state.sshClient.exec(command, (err, stream) => {
      if (err) {
        console.error(
          `[WS SFTP Decompress ${sessionId}] Failed to start exec (ID: ${requestId}):`,
          err
        );
        sendDecompressError(ws, `执行解压命令失败: ${err.message}`, requestId);
        return;
      }

      let stderrData = '';
      let stdoutData = '';
      let exitCode: number | null = null;

      stream.on('data', (data: Buffer) => {
        stdoutData += data.toString();
        // console.debug(`[WS SFTP Decompress ${sessionId}] stdout: ${data}`);
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString();
        console.debug(`[WS SFTP Decompress ${sessionId}] stderr: ${data}`); // Log stderr
      });

      stream.on('close', (code: number | null) => {
        exitCode = code;
        console.log(
          `[WS SFTP Decompress ${sessionId}] Command finished with code ${exitCode} (ID: ${requestId}). Stderr length: ${stderrData.length}`
        );
        if (exitCode === 0 && !isErrorInStdErr(stderrData)) {
          console.log(
            `[WS SFTP Decompress ${sessionId}] Decompression successful (ID: ${requestId}).`
          );
          const successPayload: SftpDecompressSuccessPayload = {
            message: '解压成功',
            requestId,
            // Optionally add target directory
            // targetDirectory: extractDir
          };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sftp:decompress:success', payload: successPayload }));
          }
        } else {
          const errorDetails = stderrData.trim() || `解压命令退出，代码: ${exitCode ?? 'N/A'}`;
          console.error(
            `[WS SFTP Decompress ${sessionId}] Decompression failed (ID: ${requestId}): ${errorDetails}`
          );
          sendDecompressError(ws, '解压失败', requestId, errorDetails);
        }
      });

      stream.on('error', (streamErr: Error) => {
        console.error(
          `[WS SFTP Decompress ${sessionId}] Command stream error (ID: ${requestId}):`,
          streamErr
        );
        if (exitCode === null) {
          sendDecompressError(ws, '解压命令流错误', requestId, streamErr.message);
        }
      });
    });
  } catch (execError: any) {
    console.error(
      `[WS SFTP Decompress ${sessionId}] Unexpected error setting up exec (ID: ${requestId}):`,
      execError
    );
    sendDecompressError(ws, `执行解压时发生意外错误: ${execError.message}`, requestId);
  }
};
