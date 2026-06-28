import { reactive, onScopeDispose, getCurrentScope, type Ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../types/sftp.types';
import type { UploadItem } from '../types/upload.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';

import type { WebSocketDependencies } from './useSftpActions';
import { sendFileChunks, type ChunkManagerDeps } from './useUploadChunkManager';
import { log } from '@/utils/log';

const generateUploadId = (): string => {
  return `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const joinPath = (base: string, name: string): string => {
  if (base === '/') return `/${name}`;
  if (base.endsWith('/')) return `${base}${name}`;
  return `${base}/${name}`;
};

export function useFileUploader(
  sessionIdForLog: Ref<string>,
  currentPathRef: Ref<string>,
  fileListRef: Readonly<Ref<readonly FileListItem[]>>, // 使用 Readonly 类型
  wsDeps: Ref<WebSocketDependencies>,
) {
  const { t } = useI18n();
  wsDeps;

  // 对 uploads 字典使用 reactive 以获得更好的深度响应性
  const uploads = reactive<Record<string, UploadItem>>({});

  // --- 分块上传管理器依赖（委托给 useUploadChunkManager） ---
  const chunkDeps: ChunkManagerDeps = {
    uploads,
    wsDeps,
    sessionIdForLog,
    t,
  };

  const startFileUpload = (file: File, relativePath?: string) => {
    // Roo: 使用 .value 访问响应式的 sessionIdForLog
    if (!wsDeps.value.isConnected.value) {
      log.warn(
        `[FileUploader ${sessionIdForLog.value}] Cannot start upload: WebSocket not connected.`,
      );

      return;
    }

    const uploadId = generateUploadId();

    let finalRemotePath: string;
    if (relativePath) {
      const basePath = currentPathRef.value.endsWith('/')
        ? currentPathRef.value
        : `${currentPathRef.value}/`;
      // 确保 relativePath 开头没有斜杠，末尾有斜杠 (如果非空)
      let cleanRelativePath = relativePath.startsWith('/')
        ? relativePath.substring(1)
        : relativePath;
      // 移除末尾斜杠（如果有），因为文件名会加上
      cleanRelativePath = cleanRelativePath.endsWith('/')
        ? cleanRelativePath.slice(0, -1)
        : cleanRelativePath;

      // 文件夹上传时 webkitRelativePath 已包含文件名（如 test/4.txt），
      // 需要提取纯目录部分，避免文件名被拼接两次
      const pathParts = cleanRelativePath.split('/');
      if (pathParts.length > 1 && pathParts[pathParts.length - 1] === file.name) {
        cleanRelativePath = pathParts.slice(0, -1).join('/');
      }

      // 拼接路径，确保 cleanRelativePath 和 file.name 之间只有一个斜杠
      finalRemotePath = `${basePath}${cleanRelativePath ? `${cleanRelativePath}/` : ''}${file.name}`;
    } else {
      finalRemotePath = joinPath(currentPathRef.value, file.name); // 对于非文件夹上传，保持原样
    }
    // 规范化路径，移除多余的斜杠 e.g. /root//dir -> /root/dir
    finalRemotePath = finalRemotePath.replace(/\/+/g, '/');
    log.info(
      `[FileUploader ${sessionIdForLog.value}] Calculated finalRemotePath: ${finalRemotePath} (current: ${currentPathRef.value}, relative: ${relativePath}, filename: ${file.name}) // wsDeps.isSftpReady: ${wsDeps.value.isSftpReady.value}`,
    );
    // --- 结束修正 ---

    // 添加到响应式 uploads 字典
    uploads[uploadId] = {
      id: uploadId,
      file,
      filename: file.name,
      progress: 0,
      status: 'pending', // 初始状态
    };

    log.info(
      `[FileUploader ${sessionIdForLog.value}] Starting upload ${uploadId} to ${finalRemotePath}`,
    );
    wsDeps.value.sendMessage({
      type: 'sftp:upload:start',
      payload: {
        uploadId,
        remotePath: finalRemotePath,
        size: file.size,
        relativePath: relativePath || undefined,
      },
    });
    // 后端应该响应 sftp:upload:ready
  };

  const cancelUpload = (uploadId: string, notifyBackend = true) => {
    const upload = uploads[uploadId];
    if (upload && ['pending', 'uploading', 'paused'].includes(upload.status)) {
      log.info(`[FileUploader ${sessionIdForLog.value}] Cancelling upload ${uploadId}`);
      upload.status = 'cancelled'; // 立即更新状态

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      if (notifyBackend && wsDeps.value.isConnected.value) {
        wsDeps.value.sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } });
      }

      // 短暂延迟后从列表中移除，以显示取消状态
      setTimeout(() => {
        if (uploads[uploadId]?.status === 'cancelled') {
          delete uploads[uploadId];
        }
      }, 3000);
    }
  };

  // --- 消息处理器 ---

  const onUploadReady = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;

    const upload = uploads[uploadId];
    if (upload && upload.status === 'pending') {
      log.info(
        `[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} ready, starting chunk sending.`,
      );
      upload.status = 'uploading';
      sendFileChunks(chunkDeps, uploadId, upload.file); // 开始发送块
    } else {
      log.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:ready for unknown or non-pending upload ID: ${uploadId}`,
      );
    }
  };

  const onUploadSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;

    const upload = uploads[uploadId];
    if (upload) {
      log.info(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} successful.`);
      upload.status = 'success';
      upload.progress = 100;

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      // 立即删除记录
      if (uploads[uploadId]) {
        delete uploads[uploadId];
      }
    } else {
      log.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:success for unknown upload ID: ${uploadId}`,
      );
    }
  };

  const onUploadError = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) {
      log.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:error with missing uploadId:`,
        message,
      );
      return;
    }

    const upload = uploads[uploadId];
    if (upload) {
      const errorMessage = (() => {
        if (typeof payload === 'string') {
          return payload;
        }
        if (typeof payloadObj.message === 'string' && (payloadObj.message as string).trim()) {
          return payloadObj.message as string;
        }
        return t('fileManager.errors.uploadFailed');
      })();
      log.error(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} error:`, errorMessage);
      upload.status = 'error';
      upload.error = errorMessage; // 使用 payload 作为错误消息

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      // 让错误消息可见时间长一些
      setTimeout(() => {
        if (uploads[uploadId]?.status === 'error') {
          delete uploads[uploadId];
        }
      }, 5000);
    } else {
      log.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:error for unknown upload ID: ${uploadId}`,
      );
    }
  };

  const onUploadPause = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;
    const upload = uploads[uploadId];
    if (upload && upload.status === 'uploading') {
      log.info(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} paused.`);
      upload.status = 'paused';
    }
  };

  const onUploadResume = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;
    const upload = uploads[uploadId];
    if (upload && upload.status === 'paused') {
      log.info(`[FileUploader ${sessionIdForLog.value}] Resuming upload ${uploadId}`);
      upload.status = 'uploading';
      sendFileChunks(chunkDeps, uploadId, upload.file);
    }
  };

  const onUploadCancelled = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined);
    if (!uploadId) return;
    const upload = uploads[uploadId];
    if (upload) {
      // 状态可能已经由用户操作设置为 'cancelled'
      if (upload.status !== 'cancelled') {
        upload.status = 'cancelled';
      }

      // 清理滑动窗口 ack 监听器
      const uploadWithAck = upload as UploadItem & { _unregisterAck?: () => void };
      if (uploadWithAck._unregisterAck) {
        uploadWithAck._unregisterAck();
        uploadWithAck._unregisterAck = undefined;
      }

      // 确保它会被移除（如果尚未计划移除）
      setTimeout(() => {
        if (uploads[uploadId]?.status === 'cancelled') {
          delete uploads[uploadId];
        }
      }, 3000);
    }
  };

  // +++ 处理上传进度更新 +++
  const onUploadProgress = (payload: MessagePayload, message: WebSocketMessage) => {
    const payloadObj =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const uploadId = message.uploadId || (payloadObj.uploadId as string | undefined); // 从顶层获取 uploadId
    if (!uploadId) {
      return;
    }

    const upload = uploads[uploadId];
    if (upload && upload.status === 'uploading') {
      // payload 现在应该包含 bytesWritten 和 totalSize
      if (typeof payloadObj.bytesWritten === 'number' && typeof payloadObj.totalSize === 'number') {
        upload.progress = Math.min(
          100,
          Math.round((payloadObj.bytesWritten / payloadObj.totalSize) * 100),
        );
      } else {
        log.warn(
          `[FileUploader ${sessionIdForLog.value}] Received upload:progress with incorrect payload format:`,
          payload,
        );
      }
    } else if (upload) {
    } else {
      log.warn(
        `[FileUploader ${sessionIdForLog.value}] Received upload:progress for unknown upload ID: ${uploadId}`,
      );
    }
  };

  // --- 动态注册和注销处理器 ---
  watchEffect((onCleanup) => {
    // 当 wsDeps.value 变化时，此 effect 会重新运行
    if (!wsDeps.value || !wsDeps.value.onMessage) {
      log.warn(
        `[FileUploader ${sessionIdForLog.value}] wsDeps.value or wsDeps.value.onMessage is not available for registering listeners.`,
      );
      return;
    }

    const unregisterUploadReady = wsDeps.value.onMessage('sftp:upload:ready', onUploadReady);
    const unregisterUploadSuccess = wsDeps.value.onMessage('sftp:upload:success', onUploadSuccess);
    const unregisterUploadError = wsDeps.value.onMessage('sftp:upload:error', onUploadError);
    const unregisterUploadPause = wsDeps.value.onMessage('sftp:upload:pause', onUploadPause);
    const unregisterUploadResume = wsDeps.value.onMessage('sftp:upload:resume', onUploadResume);
    const unregisterUploadCancelled = wsDeps.value.onMessage(
      'sftp:upload:cancelled',
      onUploadCancelled,
    );
    const unregisterUploadProgress = wsDeps.value.onMessage(
      'sftp:upload:progress',
      onUploadProgress,
    );

    onCleanup(() => {
      unregisterUploadReady?.();
      unregisterUploadSuccess?.();
      unregisterUploadError?.();
      unregisterUploadPause?.();
      unregisterUploadResume?.();
      unregisterUploadCancelled?.();
      unregisterUploadProgress?.();
    });
  });

  // --- 清理 (onScopeDispose 用于 reactivity scope 销毁时的清理) ---
  if (getCurrentScope()) {
    onScopeDispose(() => {
      // 当使用此 composable 的 scope 销毁时（通常是组件卸载），取消任何正在进行的上传
      Object.keys(uploads).forEach((uploadId) => {
        cancelUpload(uploadId, true); // 卸载时通知后端
      });
    });
  }

  return {
    uploads,
    startFileUpload,
    cancelUpload,
  };
}
