/**
 * 文件管理器下载逻辑
 * 从 FileManager.vue 提取，负责文件和目录的下载触发
 */

import { computed, type ComputedRef } from 'vue';
import type { useSessionStore } from '../../stores/session.store';
import { getWsDepsFromSession } from './fileManagerWsUtils';
import type { SftpManagerInstance } from '../../composables/useSftpActions';
import type { FileListItem } from '../../types/sftp.types';
import { log } from '@/utils/log';

type SessionStore = ReturnType<typeof useSessionStore>;

export interface UseFileManagerDownloadOptions {
  /** SFTP 管理器实例（响应式） */
  currentSftpManager: ComputedRef<SftpManagerInstance | null>;
  /** 数据库连接 ID */
  dbConnectionId: string;
  /** 会话 ID（响应式，session:remapped 后自动更新） */
  sessionId: ComputedRef<string>;
  /** 实例 ID */
  instanceId: string;
  /** 会话 Store */
  sessionStore: SessionStore;
  /** 显示错误通知的函数 */
  showError: (message: string) => void;
  /** 尝试恢复 SFTP 管理器的回调（可选），返回是否恢复成功 */
  recoverManager?: () => boolean;
}

export function useFileManagerDownload(options: UseFileManagerDownloadOptions) {
  const {
    currentSftpManager,
    dbConnectionId,
    sessionId,
    instanceId,
    sessionStore,
    showError,
    recoverManager,
  } = options;

  const logPrefix = computed(() => `[FileManager ${sessionId.value}-${instanceId}]`);

  /** 触发文件下载（支持多文件） */
  const triggerDownload = (items: FileListItem[]) => {
    const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
    if (!wsDeps?.isConnected.value) {
      return;
    }
    if (!dbConnectionId) {
      log.error(`${logPrefix.value} Cannot download: Missing connection ID.`);
      return;
    }
    let manager = currentSftpManager.value;
    if (!manager) {
      log.warn(
        `${logPrefix.value} SFTP manager not available for download, attempting recovery...`,
      );
      if (recoverManager?.()) {
        manager = currentSftpManager.value;
      }
      if (!manager) {
        log.error(
          `${logPrefix.value} Cannot download: SFTP manager is not available after recovery.`,
        );
        showError('SFTP manager is not available.');
        return;
      }
    }

    items.forEach((item) => {
      if (!item.attrs.isFile) {
        log.warn(`${logPrefix.value} Skipping download for non-file item: ${item.filename}`);
        return;
      }

      const downloadPath = manager.joinPath(manager.currentPath.value, item.filename);
      const downloadUrl = `/api/v1/sftp/download?connectionId=${dbConnectionId}&remotePath=${encodeURIComponent(downloadPath)}`;
      log.info(`${logPrefix.value} Triggering download for ${item.filename}: ${downloadUrl}`);

      const link = document.createElement('a');
      link.href = downloadUrl;
      // 移除文件名中的双引号以兼容 Chrome
      const safeFilename = item.filename.replace(/"/g, '');
      link.setAttribute('download', safeFilename);
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
    });
  };

  /** 触发目录下载（通过后端压缩后下载） */
  const triggerDownloadDirectory = (item: FileListItem) => {
    const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
    if (!wsDeps?.isConnected.value) {
      return;
    }
    if (!dbConnectionId) {
      log.error(`${logPrefix.value} Cannot download directory: Missing connection ID.`);
      return;
    }
    let manager = currentSftpManager.value;
    if (!manager) {
      log.warn(
        `${logPrefix.value} SFTP manager not available for directory download, attempting recovery...`,
      );
      if (recoverManager?.()) {
        manager = currentSftpManager.value;
      }
      if (!manager) {
        log.error(
          `${logPrefix.value} Cannot download directory: SFTP manager is not available after recovery.`,
        );
        showError('SFTP manager is not available.');
        return;
      }
    }

    if (!item.attrs.isDirectory) {
      log.warn(
        `${logPrefix.value} Skipping directory download for non-directory item: ${item.filename}`,
      );
      return;
    }

    const directoryPath = manager.joinPath(manager.currentPath.value, item.filename);
    const downloadUrl = `/api/v1/sftp/download-directory?connectionId=${dbConnectionId}&remotePath=${encodeURIComponent(directoryPath)}`;

    log.info(
      `${logPrefix.value} Attempting directory download for ${item.filename}: ${downloadUrl}`,
    );

    fetch(downloadUrl)
      .then(async (response) => {
        if (response.ok) {
          const blob = await response.blob();
          const contentDisposition = response.headers.get('content-disposition');
          let filename = `${item.filename}.zip`;
          if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
            if (filenameMatch && filenameMatch.length > 1) {
              filename = filenameMatch[1];
            }
          }

          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          const safeZipFilename = filename.replace(/"/g, '');
          link.setAttribute('download', safeZipFilename);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
          log.info(`${logPrefix.value} Directory download triggered for: ${filename}`);
        } else {
          log.error(
            `${logPrefix.value} Directory download failed: ${response.status} ${response.statusText}`,
          );
          let errorMsg = `Server responded with status ${response.status}`;
          try {
            const errorData = await response.json();
            errorMsg = errorData.message || errorMsg;
          } catch {
            try {
              const textError = await response.text();
              if (textError) errorMsg = textError;
            } catch (textParseError: unknown) {
              log.debug(
                '[FileManager] 读取错误响应文本失败:',
                textParseError instanceof Error ? textParseError.message : textParseError,
              );
            }
          }
          showError(errorMsg);
        }
      })
      .catch((error: unknown) => {
        log.error(`${logPrefix.value} Network error during directory download:`, error);
        showError(error instanceof Error ? error.message : String(error));
      });
  };

  return {
    triggerDownload,
    triggerDownloadDirectory,
  };
}
