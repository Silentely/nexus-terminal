import {
  AuthenticatedWebSocket,
  SftpCompressRequestPayload,
  SftpDecompressRequestPayload,
} from '../types';
import { clientStates, sftpService } from '../state';
import { getErrorMessage } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { sendWsMessage } from '../utils';
import { validateSafePath } from '../../sftp/sftp-path.utils';

type SftpOperationPayload = {
  path?: string;
  encoding?: string;
  content?: string;
  data?: string;
  oldPath?: string;
  newPath?: string;
  mode?: number;
  sources?: string[];
  destination?: string;
  format?: 'zip' | 'targz' | 'tarbz2';
  source?: string;
};

type SftpUploadStartPayload = {
  uploadId?: string;
  remotePath?: string;
  size?: number;
  relativePath?: string;
};

type SftpUploadChunkPayload = {
  uploadId?: string;
  chunkIndex?: number;
  data?: string;
  isLast?: boolean;
};

type SftpUploadCancelPayload = {
  uploadId?: string;
};

export async function handleSftpOperation(
  ws: AuthenticatedWebSocket,
  type: string,
  payload: SftpOperationPayload,
  requestId?: string,
  overrideSessionId?: string,
): Promise<void> {
  const sessionId = overrideSessionId ?? ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;

  if (!sessionId || !state) {
    logger.warn({ username: ws.username, type }, 'WebSocket: SFTP 请求收到但无活动会话');
    const errPayload: { message: string; requestId?: string } = { message: '无效的会话' };
    if (requestId) errPayload.requestId = requestId;
    sendWsMessage(ws, 'sftp_error', errPayload, sessionId);
    return;
  }
  if (!requestId) {
    logger.error(
      { username: ws.username, sessionId, type },
      'WebSocket: SFTP 请求收到但缺少 requestId',
    );
    sendWsMessage(ws, 'sftp_error', { message: `SFTP 操作 ${type} 缺少 requestId` }, sessionId);
    return;
  }

  try {
    switch (type) {
      case 'sftp:readdir':
        if (payload?.path && validateSafePath(payload.path))
          sftpService.readdir(sessionId, payload.path, requestId);
        else throw new Error("Missing or unsafe 'path' in payload for readdir");
        break;
      case 'sftp:stat':
        if (payload?.path && validateSafePath(payload.path))
          sftpService.stat(sessionId, payload.path, requestId);
        else throw new Error("Missing or unsafe 'path' in payload for stat");
        break;
      case 'sftp:readfile':
        if (payload?.path && validateSafePath(payload.path)) {
          const requestedEncoding = payload?.encoding;
          sftpService.readFile(sessionId, payload.path, requestId, requestedEncoding);
        } else {
          throw new Error("Missing or unsafe 'path' in payload for readfile");
        }
        break;
      case 'sftp:writefile':
        const fileContent = payload?.content ?? payload?.data;
        const encoding = payload?.encoding;
        if (payload?.path && validateSafePath(payload.path)) {
          if (fileContent === undefined || fileContent === null) {
            throw new Error("Missing 'content' or 'data' in payload for writefile");
          }
          const dataToSend = typeof fileContent === 'string' ? fileContent : String(fileContent);
          await sftpService.writefile(sessionId, payload.path, dataToSend, requestId, encoding);
        } else throw new Error("Missing or unsafe 'path' in payload for writefile");
        break;
      case 'sftp:mkdir':
        if (payload?.path && validateSafePath(payload.path))
          sftpService.mkdir(sessionId, payload.path, requestId);
        else throw new Error("Missing or unsafe 'path' in payload for mkdir");
        break;
      case 'sftp:rmdir':
        if (payload?.path && validateSafePath(payload.path))
          sftpService.rmdir(sessionId, payload.path, requestId);
        else throw new Error("Missing or unsafe 'path' in payload for rmdir");
        break;
      case 'sftp:unlink':
        if (payload?.path && validateSafePath(payload.path))
          sftpService.unlink(sessionId, payload.path, requestId);
        else throw new Error("Missing or unsafe 'path' in payload for unlink");
        break;
      case 'sftp:rename':
        if (
          payload?.oldPath &&
          payload?.newPath &&
          validateSafePath(payload.oldPath) &&
          validateSafePath(payload.newPath)
        )
          sftpService.rename(sessionId, payload.oldPath, payload.newPath, requestId);
        else throw new Error("Missing or unsafe 'oldPath' or 'newPath' in payload for rename");
        break;
      case 'sftp:chmod':
        if (payload?.path && typeof payload?.mode === 'number' && validateSafePath(payload.path))
          sftpService.chmod(sessionId, payload.path, payload.mode, requestId);
        else throw new Error("Missing or unsafe 'path' or invalid 'mode' in payload for chmod");
        break;
      case 'sftp:realpath':
        if (payload?.path && validateSafePath(payload.path))
          sftpService.realpath(sessionId, payload.path, requestId);
        else throw new Error("Missing or unsafe 'path' in payload for realpath");
        break;
      case 'sftp:copy':
        if (
          Array.isArray(payload?.sources) &&
          payload?.destination &&
          validateSafePath(payload.destination as string)
        ) {
          // 校验每个源路径
          const allSourcesSafe = (payload.sources as string[]).every((s: string) =>
            validateSafePath(s),
          );
          if (!allSourcesSafe) throw new Error("Unsafe path in 'sources' for copy");
          sftpService.copy(sessionId, payload.sources, payload.destination, requestId);
        } else
          throw new Error(
            "Missing or unsafe 'sources' (array) or 'destination' in payload for copy",
          );
        break;
      case 'sftp:move':
        if (
          Array.isArray(payload?.sources) &&
          payload?.destination &&
          validateSafePath(payload.destination as string)
        ) {
          const allSourcesSafe = (payload.sources as string[]).every((s: string) =>
            validateSafePath(s),
          );
          if (!allSourcesSafe) throw new Error("Unsafe path in 'sources' for move");
          sftpService.move(sessionId, payload.sources, payload.destination, requestId);
        } else
          throw new Error(
            "Missing or unsafe 'sources' (array) or 'destination' in payload for move",
          );
        break;
      case 'sftp:compress':
        if (
          Array.isArray(payload?.sources) &&
          payload?.destination &&
          payload?.format &&
          typeof payload.format === 'string' &&
          ['zip', 'targz', 'tarbz2'].includes(payload.format) &&
          requestId &&
          validateSafePath(payload.destination as string)
        ) {
          const allSourcesSafe = (payload.sources as string[]).every((s: string) =>
            validateSafePath(s),
          );
          if (!allSourcesSafe) throw new Error("Unsafe path in 'sources' for compress");
          const destinationPath = payload.destination as string;
          // 从 destinationPath 中提取 targetDirectory 和 destinationArchiveName
          // pathModule.posix 总是使用 / 作为分隔符
          const pathModule = await import('path'); // 动态导入 path 模块
          const targetDirectory = pathModule.posix.dirname(destinationPath);
          const destinationArchiveName = pathModule.posix.basename(destinationPath);

          const compressPayload: SftpCompressRequestPayload = {
            sources: payload.sources,
            destinationArchiveName,
            format: payload.format,
            targetDirectory,
            requestId,
          };
          sftpService.compress(sessionId, compressPayload);
        } else
          throw new Error(
            "Missing 'sources' (array), 'destination', 'format', or 'requestId' in payload for compress",
          );
        break;
      case 'sftp:decompress':
        if (payload?.source && requestId && validateSafePath(payload.source as string)) {
          const decompressPayload: SftpDecompressRequestPayload = {
            archivePath: payload.source,
            // destinationDirectory: payload.destination as string, // sftpService.decompress 目前不使用此参数
            requestId,
          };
          sftpService.decompress(sessionId, decompressPayload);
        } else throw new Error("Missing 'source' or 'requestId' in payload for decompress");
        break;
      default:
        logger.warn(`WebSocket: Received unhandled SFTP message type in sftp.handler: ${type}`);
        sendWsMessage(
          ws,
          'sftp_error',
          { message: `内部未处理的 SFTP 类型: ${type}`, requestId },
          sessionId,
        );
        throw new Error(`Unhandled SFTP type: ${type}`);
    }
  } catch (sftpCallError: unknown) {
    const sftpCallErrMsg = getErrorMessage(sftpCallError);
    logger.error(
      `WebSocket: Error preparing/calling SFTP service for ${type} (Request ID: ${requestId}):`,
      sftpCallError,
    );
    sendWsMessage(
      ws,
      'sftp_error',
      { message: `处理 SFTP 请求 ${type} 时出错: ${sftpCallErrMsg}`, requestId },
      sessionId,
    );
  }
}

export function handleSftpUploadStart(
  ws: AuthenticatedWebSocket,
  payload: SftpUploadStartPayload,
  overrideSessionId?: string,
): void {
  const sessionId = overrideSessionId ?? ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;

  if (!sessionId || !state) {
    logger.warn(`WebSocket: 收到来自 ${ws.username} 的 SFTP 上传开始请求，但无活动会话。`);
    sendWsMessage(
      ws,
      'sftp:upload:error',
      { uploadId: payload?.uploadId, message: '无效的会话' },
      sessionId,
    );
    return;
  }
  if (!payload?.uploadId || !payload?.remotePath || typeof payload?.size !== 'number') {
    logger.error(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:start 请求，但缺少 uploadId, remotePath 或 size。`,
    );
    sendWsMessage(
      ws,
      'sftp:upload:error',
      { uploadId: payload?.uploadId, message: '缺少 uploadId, remotePath 或 size' },
      sessionId,
    );
    return;
  }
  // 校验上传目标路径，防止路径穿越和 Shell 注入（与 handleSftpOperation 保持一致）
  if (!validateSafePath(payload.remotePath)) {
    logger.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:start 请求，但 remotePath 不安全: ${payload.remotePath}`,
    );
    sendWsMessage(
      ws,
      'sftp:upload:error',
      { uploadId: payload.uploadId, message: '无效或不安全的上传路径' },
      sessionId,
    );
    return;
  }
  const relativePath = payload?.relativePath;
  logger.info(
    `WebSocket: SFTP Upload Start - Session: ${sessionId}, UploadID: ${payload.uploadId}, RemotePath: ${payload.remotePath}, Size: ${payload.size}, RelativePath: ${relativePath}`,
  );
  sftpService.startUpload(
    sessionId,
    payload.uploadId,
    payload.remotePath,
    payload.size,
    relativePath,
  );
}

export async function handleSftpUploadChunk(
  ws: AuthenticatedWebSocket,
  payload: SftpUploadChunkPayload,
  overrideSessionId?: string,
): Promise<void> {
  const sessionId = overrideSessionId ?? ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!sessionId || !state) return; // Silently ignore if session is gone

  if (
    !payload?.uploadId ||
    typeof payload?.chunkIndex !== 'number' ||
    typeof payload?.data !== 'string'
  ) {
    logger.error(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:chunk 请求，但缺少 uploadId, chunkIndex 或 data。`,
    );
    // Optionally send error to client, but be mindful of flooding for many chunks
    return;
  }
  await sftpService.handleUploadChunk(
    sessionId,
    payload.uploadId,
    payload.chunkIndex,
    payload.data,
    payload.isLast,
  );
}

export function handleSftpUploadCancel(
  ws: AuthenticatedWebSocket,
  payload: SftpUploadCancelPayload,
  overrideSessionId?: string,
): void {
  const sessionId = overrideSessionId ?? ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!sessionId || !state) return; // Silently ignore

  if (!payload?.uploadId) {
    logger.error(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 sftp:upload:cancel 请求，但缺少 uploadId。`,
    );
    sendWsMessage(
      ws,
      'sftp:upload:error',
      { uploadId: payload?.uploadId, message: '缺少 uploadId' },
      sessionId,
    );
    return;
  }
  sftpService.cancelUpload(sessionId, payload.uploadId);
}
