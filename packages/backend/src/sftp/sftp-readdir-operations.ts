import type { Stats } from 'ssh2';
import type { ClientState } from '../websocket/types';
import { getErrorMessage } from '../utils/AppError';
import WebSocket from 'ws';
import { logger } from '../utils/logger';

interface ReaddirEntry {
  filename: string;
  longname: string;
  attrs: Stats;
}

/** 出站消息大小上限（3MB，为 WebSocket 帧头留出余量） */
const MAX_OUTBOUND_PAYLOAD_BYTES = 3 * 1024 * 1024;

export const executeReaddirSftpOperation = async (
  state: ClientState | undefined,
  sessionId: string,
  path: string,
  requestId: string,
): Promise<void> => {
  if (!state || !state.sftp) {
    logger.warn(`[SFTP] SFTP 未准备好，无法在 ${sessionId} 上执行 readdir (ID: ${requestId})`);
    state?.ws.send(
      JSON.stringify({
        type: 'sftp:readdir:error',
        path,
        payload: 'SFTP 会话未就绪',
        requestId,
      }),
    );
    return;
  }

  logger.debug(`[SFTP ${sessionId}] Received readdir request for ${path} (ID: ${requestId})`);
  try {
    state.sftp.readdir(path, (err, list: ReaddirEntry[]) => {
      if (err) {
        logger.error(`[SFTP ${sessionId}] readdir ${path} failed (ID: ${requestId}):`, err);
        if (state.ws.readyState !== WebSocket.OPEN) return;
        state.ws.send(
          JSON.stringify({
            type: 'sftp:readdir:error',
            path,
            payload: `读取目录失败: ${err.message}`,
            requestId,
          }),
        );
        return;
      }

      const files = list.map((item) => ({
        filename: item.filename,
        longname: item.longname,
        attrs: {
          size: item.attrs.size,
          uid: item.attrs.uid,
          gid: item.attrs.gid,
          mode: item.attrs.mode,
          atime: item.attrs.atime * 1000,
          mtime: item.attrs.mtime * 1000,
          isDirectory: item.attrs.isDirectory(),
          isFile: item.attrs.isFile(),
          isSymbolicLink: item.attrs.isSymbolicLink(),
        },
      }));

      const fullMessage = JSON.stringify({
        type: 'sftp:readdir:success',
        path,
        payload: files,
        requestId,
      });

      // 估算出站消息大小，超过上限时分批发送
      if (Buffer.byteLength(fullMessage, 'utf8') <= MAX_OUTBOUND_PAYLOAD_BYTES) {
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(fullMessage);
        }
        return;
      }

      // 大目录列表：按大小分批发送，每批控制在上限以内
      logger.warn(
        `[SFTP ${sessionId}] readdir ${path} 结果过大 (${Math.round(Buffer.byteLength(fullMessage, 'utf8') / 1024)}KB, ${files.length} 项)，分批发送。`,
      );
      let byteOffset = 0;
      let chunkIndex = 0;
      let startItemIndex = 0;

      for (let i = 0; i <= files.length; i++) {
        const isLast = i === files.length;
        if (!isLast) {
          const itemJson = JSON.stringify(files[i]);
          const itemBytes = Buffer.byteLength(itemJson, 'utf8') + 1; // +1 为逗号分隔符
          if (byteOffset + itemBytes > MAX_OUTBOUND_PAYLOAD_BYTES && i > startItemIndex) {
            // 发送当前批次
            const chunk = files.slice(startItemIndex, i);
            sendReaddirChunk(state, path, chunk, requestId, chunkIndex, false);
            chunkIndex++;
            startItemIndex = i;
            byteOffset = 0;
          }
          byteOffset += itemBytes;
        }
        if (isLast) {
          const chunk = files.slice(startItemIndex);
          sendReaddirChunk(state, path, chunk, requestId, chunkIndex, true);
        }
      }
    });
  } catch (error: unknown) {
    logger.error(
      `[SFTP ${sessionId}] readdir ${path} caught unexpected error (ID: ${requestId}):`,
      error,
    );
    if (state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(
      JSON.stringify({
        type: 'sftp:readdir:error',
        path,
        payload: `读取目录时发生意外错误: ${getErrorMessage(error)}`,
        requestId,
      }),
    );
  }
};

/**
 * 发送 readdir 的一个分批结果
 */
function sendReaddirChunk(
  state: ClientState,
  path: string,
  files: Array<{ filename: string; longname: string; attrs: Record<string, unknown> }>,
  requestId: string,
  chunkIndex: number,
  isLast: boolean,
): void {
  if (state.ws.readyState !== WebSocket.OPEN) return;

  state.ws.send(
    JSON.stringify({
      type: 'sftp:readdir:success',
      path,
      payload: files,
      requestId,
      chunkIndex,
      isLast,
    }),
  );
}
