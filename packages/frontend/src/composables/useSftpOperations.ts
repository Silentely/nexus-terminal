/**
 * SFTP 文件操作模块
 * 职责：文件/目录的 CRUD 操作、读写、复制移动、压缩解压
 * 从 useSftpActions.ts 提取，降低主模块复杂度
 */
import type { Ref } from 'vue';
import { reactive } from 'vue';
import type {
  FileListItem,
  SftpReadFileSuccessPayload,
  SftpReadFileRequestPayload,
  ArchiveProgressState,
} from '../types/sftp.types';
import type { WebSocketMessage, MessagePayload, MessageHandler } from '../types/websocket.types';
import type { useUiNotificationsStore } from '../stores/uiNotifications.store';
import type { TranslateFn } from '../types/i18n.types';
import { log } from '@/utils/log';

/** 文件操作模块的依赖注入接口 */
export interface SftpOperationsDeps {
  sendMessage: (message: WebSocketMessage) => boolean | void;
  onMessage: (type: string, handler: MessageHandler) => () => void;
  isSftpReady: Readonly<Ref<boolean>>;
  currentPathRef: Ref<string>;
  instanceSessionId: string;
  uiNotificationsStore: ReturnType<typeof useUiNotificationsStore>;
  t: TranslateFn;
  loadDirectory: (path: string, forceRefresh?: boolean) => void;
}

/** 生成唯一请求 ID */
const generateRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

/** 拼接路径 */
const joinPath = (base: string, name: string): string => {
  if (!base || base === '/') return `/${name}`;
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
};

const getArchiveBaseName = (filename: string): string => {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return filename || 'archive';
  }
  return filename.slice(0, lastDotIndex) || filename;
};

/**
 * 创建 SFTP 文件操作函数集合
 * 包含：createDirectory, createFile, deleteItems, renameItem, changePermissions,
 *       readFile, writeFile, copyItems, moveItems, compressItems, decompressItem
 */
export function createSftpOperations(deps: SftpOperationsDeps) {
  const {
    sendMessage,
    onMessage,
    isSftpReady,
    currentPathRef,
    instanceSessionId,
    uiNotificationsStore,
    t,
    loadDirectory,
  } = deps;

  /** 压缩/解压进度状态（响应式，供外部 UI 消费） */
  const archiveProgress = reactive<ArchiveProgressState>({
    active: false,
    operation: null,
    fileCount: 0,
    currentFile: null,
    archiveName: null,
  });

  /** 重置压缩/解压进度状态 */
  const resetArchiveProgress = () => {
    archiveProgress.active = false;
    archiveProgress.operation = null;
    archiveProgress.fileCount = 0;
    archiveProgress.currentFile = null;
    archiveProgress.archiveName = null;
  };

  // --- 简单文件操作（发送消息即返回） ---

  /** 创建目录 */
  const createDirectory = (newDirName: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      log.warn(`[SFTP ${instanceSessionId}] 尝试创建目录 ${newDirName} 但 SFTP 未就绪。`);
      return;
    }
    const newFolderPath = joinPath(currentPathRef.value, newDirName);
    const requestId = generateRequestId();
    sendMessage({ type: 'sftp:mkdir', requestId, payload: { path: newFolderPath } });
  };

  /** 创建空文件 */
  const createFile = (newFileName: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      log.warn(`[SFTP ${instanceSessionId}] 尝试创建文件 ${newFileName} 但 SFTP 未就绪。`);
      return;
    }
    const newFilePath = joinPath(currentPathRef.value, newFileName);
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:writefile',
      requestId,
      payload: { path: newFilePath, content: '', encoding: 'utf8' },
    });
  };

  /** 批量删除文件或目录 */
  const deleteItems = (items: FileListItem[]) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      log.warn(`[SFTP ${instanceSessionId}] 尝试删除项目但 SFTP 未就绪。`);
      return;
    }
    if (items.length === 0) return;
    items.forEach((item) => {
      const targetPath = joinPath(currentPathRef.value, item.filename);
      const actionType = item.attrs.isDirectory ? 'sftp:rmdir' : 'sftp:unlink';
      const requestId = generateRequestId();
      sendMessage({ type: actionType, requestId, payload: { path: targetPath } });
    });
  };

  /** 重命名文件或目录 */
  const renameItem = (item: FileListItem, newName: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      log.warn(`[SFTP ${instanceSessionId}] 尝试重命名项目 ${item.filename} 但 SFTP 未就绪。`);
      return;
    }
    if (!newName || item.filename === newName) return;
    const oldPath = joinPath(currentPathRef.value, item.filename);
    const newPath = newName.startsWith('/') ? newName : joinPath(currentPathRef.value, newName);
    const requestId = generateRequestId();
    sendMessage({ type: 'sftp:rename', requestId, payload: { oldPath, newPath } });
  };

  /** 修改文件权限 */
  const changePermissions = (item: FileListItem, mode: number) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      log.warn(`[SFTP ${instanceSessionId}] 尝试修改 ${item.filename} 的权限但 SFTP 未就绪。`);
      return;
    }
    const targetPath = joinPath(currentPathRef.value, item.filename);
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:chmod',
      requestId,
      payload: { path: targetPath, mode },
    });
  };

  // --- Promise 包装的文件读写操作 ---

  /** 读取文件内容（返回 Promise，等待 WebSocket 响应） */
  const readFile = (path: string, encoding?: string): Promise<SftpReadFileSuccessPayload> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        log.warn(`[SFTP ${instanceSessionId}] 尝试读取文件 ${path} 但 SFTP 未就绪。`);
        uiNotificationsStore.showError(errMsg);
        return reject(new Error(errMsg));
      }
      const requestId = generateRequestId();
      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;

      // 读取大文件可能耗时较久，使用 120 秒超时（与压缩保持一致）
      // 后端流式读取大文件可能没有中间进度上报，但断开/失败会立即触发 error 事件
      const timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        unregisterSuccess?.();
        unregisterError?.();
        const errMsg = t('fileManager.errors.readFileTimeout');
        uiNotificationsStore.showError(errMsg);
        reject(new Error(errMsg));
      }, 120_000);

      unregisterSuccess = onMessage(
        'sftp:readfile:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const successPayload = payload as unknown as SftpReadFileSuccessPayload;
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            resolve({
              rawContentBase64: successPayload.rawContentBase64,
              encodingUsed: successPayload.encodingUsed,
            });
          }
        },
      );

      unregisterError = onMessage(
        'sftp:readfile:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as string;
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            const errorMsg = errorPayload || t('fileManager.errors.readFileFailed');
            uiNotificationsStore.showError(`${t('fileManager.errors.readFileError')}: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        },
      );

      const requestPayload: SftpReadFileRequestPayload = { path };
      if (encoding) {
        requestPayload.encoding = encoding;
      }
      sendMessage({ type: 'sftp:readfile', requestId, payload: requestPayload });
    });
  };

  /** 写入文件内容（返回 Promise，等待 WebSocket 响应） */
  const writeFile = (path: string, content: string, encoding?: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        log.warn(`[SFTP ${instanceSessionId}] 尝试写入文件 ${path} 但 SFTP 未就绪。`);
        uiNotificationsStore.showError(errMsg);
        return reject(new Error(errMsg));
      }
      const requestId = generateRequestId();
      const finalEncoding = encoding || 'utf8';
      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;

      // 写入大文件可能耗时较久，使用 120 秒超时（与压缩保持一致）
      const timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        unregisterSuccess?.();
        unregisterError?.();
        const errMsg = t('fileManager.errors.saveTimeout');
        uiNotificationsStore.showError(errMsg);
        reject(new Error(errMsg));
      }, 120_000);

      unregisterSuccess = onMessage(
        'sftp:writefile:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            resolve();
          }
        },
      );

      unregisterError = onMessage(
        'sftp:writefile:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as string;
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            const errorMsg = errorPayload || t('fileManager.errors.saveFailed');
            uiNotificationsStore.showError(errorMsg);
            reject(new Error(errorMsg));
          }
        },
      );

      sendMessage({
        type: 'sftp:writefile',
        requestId,
        payload: { path, content, encoding: finalEncoding },
      });
    });
  };

  // --- 批量操作（复制、移动、压缩、解压） ---

  /** 复制文件/目录到目标路径 */
  const copyItems = (sourcePaths: string[], destinationDir: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      log.warn(`[SFTP ${instanceSessionId}] 尝试复制项目但 SFTP 未就绪。`);
      return;
    }
    if (sourcePaths.length === 0) return;
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:copy',
      requestId,
      payload: { sources: sourcePaths, destination: destinationDir },
    });
    log.info(
      `[SFTP ${instanceSessionId}] 发送 sftp:copy 请求 (ID: ${requestId}) Sources: ${sourcePaths.join(', ')}, Dest: ${destinationDir}`,
    );
  };

  /** 移动文件/目录到目标路径 */
  const moveItems = (sourcePaths: string[], destinationDir: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      log.warn(`[SFTP ${instanceSessionId}] 尝试移动项目但 SFTP 未就绪。`);
      return;
    }
    if (sourcePaths.length === 0) return;
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:move',
      requestId,
      payload: { sources: sourcePaths, destination: destinationDir },
    });
    log.info(
      `[SFTP ${instanceSessionId}] 发送 sftp:move 请求 (ID: ${requestId}) Sources: ${sourcePaths.join(', ')}, Dest: ${destinationDir}`,
    );
  };

  /** 压缩文件/目录（返回 Promise，等待 WebSocket 响应） */
  const compressItems = (
    items: FileListItem[],
    format: 'zip' | 'targz' | 'tarbz2',
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        uiNotificationsStore.showError(errMsg);
        log.warn(`[SFTP ${instanceSessionId}] 尝试压缩项目但 SFTP 未就绪。`);
        return reject(new Error(errMsg));
      }
      const sourcePaths = items.map((item) => joinPath(currentPathRef.value, item.filename));
      const requestId = generateRequestId();

      // 激活压缩进度状态
      archiveProgress.active = true;
      archiveProgress.operation = 'compress';
      archiveProgress.fileCount = 0;
      archiveProgress.currentFile = null;

      const parentDir = currentPathRef.value;
      let archiveBaseName = 'archive';
      if (items.length === 1) {
        archiveBaseName = getArchiveBaseName(items[0].filename);
      } else if (items.length > 1) {
        const parentFolderName = parentDir.split('/').pop();
        if (parentFolderName && parentFolderName !== 'root' && parentFolderName !== '') {
          archiveBaseName = parentFolderName;
        }
      }
      let archiveExtension: string = format;
      if (format === 'targz') {
        archiveExtension = 'tar.gz';
      } else if (format === 'tarbz2') {
        archiveExtension = 'tar.bz2';
      }
      const archiveName = `${archiveBaseName}.${archiveExtension}`;
      const destinationPath = joinPath(parentDir, archiveName);
      archiveProgress.archiveName = archiveName;

      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;
      let unregisterProgress: (() => void) | null = null;
      let unregisterCommandNotFound: (() => void) | null = null;

      /** 重置超时计时器（收到进度消息时调用） */
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const resetTimeout = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          unregisterSuccess?.();
          unregisterError?.();
          unregisterProgress?.();
          unregisterCommandNotFound?.();
          resetArchiveProgress();
          const errMsg = t('fileManager.errors.compressTimeout');
          uiNotificationsStore.showError(errMsg);
          reject(new Error(errMsg));
        }, 120_000);
      };
      resetTimeout();

      unregisterSuccess = onMessage(
        'sftp:compress:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            unregisterProgress?.();
            unregisterCommandNotFound?.();
            resetArchiveProgress();
            uiNotificationsStore.showSuccess(
              t('fileManager.notifications.compressSuccess', { name: archiveName }),
            );
            loadDirectory(currentPathRef.value, true);
            resolve();
          }
        },
      );

      unregisterError = onMessage(
        'sftp:compress:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as { error: string; details?: string };
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            unregisterProgress?.();
            unregisterCommandNotFound?.();
            resetArchiveProgress();
            const errorMsg =
              errorPayload.details || errorPayload.error || t('fileManager.errors.compressFailed');
            uiNotificationsStore.showError(
              t('fileManager.errors.compressErrorDetailed', { error: errorMsg }),
            );
            reject(new Error(errorMsg));
          }
        },
      );

      // 监听进度消息，更新进度状态并重置超时计时器
      unregisterProgress = onMessage(
        'sftp:compress:progress',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            resetTimeout();
            const progressPayload = payload as unknown as {
              fileCount?: number;
              currentFile?: string;
            };
            if (typeof progressPayload.fileCount === 'number') {
              archiveProgress.fileCount = progressPayload.fileCount;
            }
            if (progressPayload.currentFile) {
              archiveProgress.currentFile = progressPayload.currentFile;
            }
          }
        },
      );

      // 后端在压缩命令缺失时只发 sftp:command_not_found（不会走 compress:error 分支），
      // 必须按 requestId 立即 reject，否则 Promise 悬挂到 120 秒超时（issue #112）
      unregisterCommandNotFound = onMessage(
        'sftp:command_not_found',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            unregisterProgress?.();
            unregisterCommandNotFound?.();
            resetArchiveProgress();
            // 全局 onCommandNotFound 已弹出错误提示，这里不再重复 toast
            const { operation, command } = payload as unknown as {
              operation: string;
              command: string;
            };
            reject(new Error(`Command '${command}' not found on server for ${operation}.`));
          }
        },
      );

      log.info(
        `[SFTP ${instanceSessionId}] 发送 sftp:compress 请求 (ID: ${requestId}) Sources: ${sourcePaths.join(', ')}, Dest: ${destinationPath}, Format: ${format}`,
      );
      sendMessage({
        type: 'sftp:compress',
        requestId,
        payload: { sources: sourcePaths, destination: destinationPath, format },
      });
    });
  };

  /** 解压文件（返回 Promise，等待 WebSocket 响应） */
  const decompressItem = (item: FileListItem): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        uiNotificationsStore.showError(errMsg);
        log.warn(`[SFTP ${instanceSessionId}] 尝试解压项目 ${item.filename} 但 SFTP 未就绪。`);
        return reject(new Error(errMsg));
      }
      const sourcePath = joinPath(currentPathRef.value, item.filename);
      const destinationDir = currentPathRef.value;
      const requestId = generateRequestId();

      // 激活解压进度状态
      archiveProgress.active = true;
      archiveProgress.operation = 'decompress';
      archiveProgress.fileCount = 0;
      archiveProgress.currentFile = null;
      archiveProgress.archiveName = item.filename;

      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;
      let unregisterProgress: (() => void) | null = null;
      let unregisterCommandNotFound: (() => void) | null = null;

      /** 重置超时计时器（收到进度消息时调用） */
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const resetTimeout = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          unregisterSuccess?.();
          unregisterError?.();
          unregisterProgress?.();
          unregisterCommandNotFound?.();
          resetArchiveProgress();
          const errMsg = t('fileManager.errors.decompressTimeout');
          uiNotificationsStore.showError(errMsg);
          reject(new Error(errMsg));
        }, 120_000);
      };
      resetTimeout();

      unregisterSuccess = onMessage(
        'sftp:decompress:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            unregisterProgress?.();
            unregisterCommandNotFound?.();
            resetArchiveProgress();
            uiNotificationsStore.showSuccess(
              t('fileManager.notifications.decompressSuccess', { name: item.filename }),
            );
            loadDirectory(currentPathRef.value, true);
            resolve();
          }
        },
      );

      unregisterError = onMessage(
        'sftp:decompress:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as { error: string; details?: string };
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            unregisterProgress?.();
            unregisterCommandNotFound?.();
            resetArchiveProgress();
            const errorMsg =
              errorPayload.details ||
              errorPayload.error ||
              t('fileManager.errors.decompressFailed');
            uiNotificationsStore.showError(
              t('fileManager.errors.decompressErrorDetailed', { error: errorMsg }),
            );
            reject(new Error(errorMsg));
          }
        },
      );

      // 监听进度消息，更新进度状态并重置超时计时器
      unregisterProgress = onMessage(
        'sftp:decompress:progress',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            resetTimeout();
            const progressPayload = payload as unknown as {
              fileCount?: number;
              currentFile?: string;
            };
            if (typeof progressPayload.fileCount === 'number') {
              archiveProgress.fileCount = progressPayload.fileCount;
            }
            if (progressPayload.currentFile) {
              archiveProgress.currentFile = progressPayload.currentFile;
            }
          }
        },
      );

      // 后端在解压命令缺失时只发 sftp:command_not_found（不会走 decompress:error 分支），
      // 必须按 requestId 立即 reject，否则 Promise 悬挂到 120 秒超时（issue #112）
      unregisterCommandNotFound = onMessage(
        'sftp:command_not_found',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            unregisterProgress?.();
            unregisterCommandNotFound?.();
            resetArchiveProgress();
            // 全局 onCommandNotFound 已弹出错误提示，这里不再重复 toast
            const { operation, command } = payload as unknown as {
              operation: string;
              command: string;
            };
            reject(new Error(`Command '${command}' not found on server for ${operation}.`));
          }
        },
      );

      log.info(
        `[SFTP ${instanceSessionId}] 发送 sftp:decompress 请求 (ID: ${requestId}) Source: ${sourcePath}, Dest: ${destinationDir}`,
      );
      sendMessage({
        type: 'sftp:decompress',
        requestId,
        payload: { source: sourcePath, destination: destinationDir },
      });
    });
  };

  return {
    createDirectory,
    createFile,
    deleteItems,
    renameItem,
    changePermissions,
    readFile,
    writeFile,
    copyItems,
    moveItems,
    compressItems,
    decompressItem,
    archiveProgress,
    joinPath,
  };
}
