/**
 * 上传分块管理器
 * 从 useFileUploader.ts 提取，负责文件分块读取、滑动窗口发送与 ACK 超时回退
 */
import type { Ref } from 'vue';
import type { UploadItem } from '../types/upload.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import type { TranslateFn } from '../types/i18n.types';
import type { WebSocketDependencies } from './useSftpActions';
import { log } from '@/utils/log';

/** 分块大小：256KB（优化：减少消息数量，降低内存压力） */
const CHUNK_SIZE = 1024 * 256;

/** 滑动窗口大小：允许同时在途的最大块数量 */
const WINDOW_SIZE = 8;

/** ACK 超时回退时间（兼容旧后端不发送 ack 的场景） */
const ACK_TIMEOUT_MS = 3000;

/** 分块上传管理器依赖 */
export interface ChunkManagerDeps {
  /** 上传任务字典（响应式） */
  uploads: Record<string, UploadItem>;
  /** WebSocket 依赖 */
  wsDeps: Ref<WebSocketDependencies>;
  /** 会话标识（用于日志前缀） */
  sessionIdForLog: Ref<string>;
  /** 国际化翻译函数 */
  t: TranslateFn;
}

/**
 * 发送文件分块
 * 实现滑动窗口协议：初始填充窗口 → 等待 ACK → 按槽位补充
 * 兼容旧后端：ACK 超时后回退为隐式确认模式
 *
 * @param deps - 外部依赖（uploads、wsDeps、sessionIdForLog、t）
 * @param uploadId - 上传任务 ID
 * @param file - 要上传的文件对象
 * @param startByte - 起始字节偏移（续传场景，默认 0）
 */
export function sendFileChunks(
  deps: ChunkManagerDeps,
  uploadId: string,
  file: File,
  startByte = 0,
): void {
  const { uploads, wsDeps, sessionIdForLog, t } = deps;

  const upload = uploads[uploadId];
  // 在继续之前检查连接和上传状态
  if (!wsDeps.value.isConnected.value || !upload || upload.status !== 'uploading') {
    log.warn(
      `[FileUploader ${sessionIdForLog.value}] Cannot send chunk for ${uploadId}. Connection: ${wsDeps.value.isConnected.value}, Upload status: ${upload?.status}`,
    );
    return;
  }

  let offset = startByte;
  let inFlight = 0; // 当前在途（已发送未确认）的块数量
  let ackReceived = false; // 标记是否收到过 ack（用于判断后端是否支持滑动窗口）
  let ackFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  // 每个块创建独立的 FileReader，避免 InvalidStateError（FileReader 状态机限制）
  const readAndSendChunk = () => {
    if (offset >= file.size || uploads[uploadId]?.status !== 'uploading') return;

    const currentOffset = offset;
    const slice = file.slice(currentOffset, currentOffset + CHUNK_SIZE);
    const currentChunkSize = slice.size;
    offset += currentChunkSize;
    inFlight++;

    const reader = new FileReader();
    reader.onload = (e) => {
      const currentUpload = uploads[uploadId];
      if (
        !wsDeps.value.isConnected.value ||
        !currentUpload ||
        currentUpload.status !== 'uploading'
      ) {
        log.warn(
          `[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} status changed or disconnected before sending chunk at offset ${currentOffset}.`,
        );
        inFlight = Math.max(0, inFlight - 1);
        return;
      }

      const chunkResult = e.target?.result as string;
      if (typeof chunkResult === 'string' && chunkResult.startsWith('data:')) {
        const chunkBase64 = chunkResult.split(',')[1];
        const isLast = currentOffset + CHUNK_SIZE >= file.size;
        const chunkIndex = Math.floor(currentOffset / CHUNK_SIZE);

        wsDeps.value.sendMessage({
          type: 'sftp:upload:chunk',
          payload: { uploadId, chunkIndex, data: chunkBase64, isLast },
        });
      } else {
        log.error(
          `[FileUploader ${sessionIdForLog.value}] FileReader returned unexpected result for ${uploadId}:`,
          chunkResult,
        );
        currentUpload.status = 'error';
        currentUpload.error = t('fileManager.errors.readFileError');
        inFlight = Math.max(0, inFlight - 1);
      }
    };

    reader.onerror = () => {
      log.error(
        `[FileUploader ${sessionIdForLog.value}] FileReader error for upload ID: ${uploadId}`,
      );
      const failedUpload = uploads[uploadId];
      if (failedUpload) {
        failedUpload.status = 'error';
        failedUpload.error = t('fileManager.errors.readFileError');
      }
      inFlight = Math.max(0, inFlight - 1);
    };

    reader.readAsDataURL(slice);
  };

  // ACK 超时回退：兼容旧后端（不发送 ack 的场景），超时后视为隐式确认
  const resetAckFallbackTimer = () => {
    if (ackFallbackTimer) clearTimeout(ackFallbackTimer);
    ackFallbackTimer = setTimeout(() => {
      if (!ackReceived && uploads[uploadId]?.status === 'uploading') {
        log.warn(
          `[FileUploader ${sessionIdForLog.value}] ACK timeout for ${uploadId}, using fallback (treating as implicit ack).`,
        );
        // 旧后端不支持 ack，回退为每确认一个就补一个
        inFlight = Math.max(0, inFlight - 1);
        while (inFlight < WINDOW_SIZE && offset < file.size) {
          readAndSendChunk();
        }
      }
    }, ACK_TIMEOUT_MS);
  };

  // 后端 chunk ack 处理器：接收窗口槽位信息，触发下一批读取
  const onChunkAck = (payload: MessagePayload, message: WebSocketMessage) => {
    const ackUploadId =
      message.uploadId ||
      (typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).uploadId
        : undefined);
    if (ackUploadId !== uploadId) return;

    ackReceived = true;
    if (ackFallbackTimer) {
      clearTimeout(ackFallbackTimer);
      ackFallbackTimer = null;
    }

    inFlight = Math.max(0, inFlight - 1);

    // serverSlots 表示后端剩余可用窗口槽位（例如 6 表示还可以发 6 个块）
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const serverSlots =
      typeof payloadObj.windowSlots === 'number' ? payloadObj.windowSlots : WINDOW_SIZE;

    // 在窗口允许范围内继续读取
    while (inFlight < serverSlots && offset < file.size) {
      readAndSendChunk();
    }
  };

  // 注册 ack 处理器
  const unregisterAck = wsDeps.value.onMessage('sftp:upload:chunk:ack', onChunkAck);

  // 保存注销函数到 upload 对象，以便取消时清理
  (upload as UploadItem & { _unregisterAck?: () => void })._unregisterAck = unregisterAck;

  // 初始填充窗口：读取 WINDOW_SIZE 个块
  if (file.size > 0) {
    for (let i = 0; i < WINDOW_SIZE && offset < file.size; i++) {
      readAndSendChunk();
    }
    // 启动 ACK 超时回退定时器（仅在初始批次后启动）
    resetAckFallbackTimer();
  } else {
    // 零字节文件直接发送
    log.info(`[FileUploader ${sessionIdForLog.value}] Processing zero-byte file ${uploadId}`);
    wsDeps.value.sendMessage({
      type: 'sftp:upload:chunk',
      payload: { uploadId, chunkIndex: 0, data: '', isLast: true },
    });
    upload.progress = 100;
  }
}
