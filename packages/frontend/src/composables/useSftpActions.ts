import { ref, reactive, computed, type Ref, type ComputedRef } from 'vue';
import type { FileListItem, FileAttributes, SftpReadFileSuccessPayload } from '../types/sftp.types';
import type { WebSocketMessage, MessageHandler } from '../types/websocket.types';
import type { TranslateFn } from '../types/i18n.types';

import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { findNodeByPath } from './useSftpTreeUtils';
import { createMessageHandlers } from './useSftpMessageHandlers';
import { createSftpOperations } from './useSftpOperations';
import { log } from '@/utils/log';

/**
 * @interface WebSocketDependencies
 * @description Defines the necessary functions and state required from a WebSocket manager instance.
 */
export interface WebSocketDependencies {
  sendMessage: (message: WebSocketMessage) => boolean | void;
  onMessage: (type: string, handler: MessageHandler) => () => void;
  isConnected: ComputedRef<boolean>;
  isSftpReady: Readonly<Ref<boolean>>;
}

/**
 * @interface SftpManagerInstance
 * @description Defines the shape of the object returned by createSftpActionsManager.
 */
export interface SftpManagerInstance {
  // State
  fileList: Readonly<ComputedRef<FileListItem[]>>;
  isLoading: Readonly<Ref<boolean>>;
  fileTree: Readonly<FileTreeNode>;
  initialLoadDone: Readonly<Ref<boolean>>;
  currentPath: Readonly<Ref<string>>;

  // Methods
  loadDirectory: (path: string, forceRefresh?: boolean) => void;
  createDirectory: (newDirName: string) => void;
  createFile: (newFileName: string) => void;
  deleteItems: (items: FileListItem[]) => void;
  renameItem: (item: FileListItem, newName: string) => void;
  changePermissions: (item: FileListItem, mode: number) => void;
  readFile: (path: string, encoding?: string) => Promise<SftpReadFileSuccessPayload>;
  writeFile: (path: string, content: string, encoding?: string) => Promise<void>;
  copyItems: (sourcePaths: string[], destinationDir: string) => void;
  moveItems: (sourcePaths: string[], destinationDir: string) => void;
  compressItems: (items: FileListItem[], format: 'zip' | 'targz' | 'tarbz2') => Promise<void>;
  decompressItem: (item: FileListItem) => Promise<void>;
  archiveProgress: {
    active: boolean;
    operation: 'compress' | 'decompress' | null;
    fileCount: number;
    currentFile: string | null;
    archiveName: string | null;
  };
  joinPath: (base: string, name: string) => string;
  setInitialLoadDone: (value: boolean) => void;

  // Cleanup function
  cleanup: () => void;
}

// 辅助函数：生成唯一请求 ID
const generateRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// *** 文件树节点接口 ***
export interface FileTreeNode {
  filename: string;
  longname: string;
  attrs: FileAttributes;
  children: FileTreeNode[] | null;
  childrenLoaded: boolean;
}

/**
 * 创建并管理单个 SFTP 会话的操作。
 * 每个实例对应一个会话 (Session) 并依赖于一个 WebSocket 管理器实例。
 */
export function createSftpActionsManager(
  sessionId: string,
  currentPathRef: Ref<string>,
  wsDeps: WebSocketDependencies,
  t: TranslateFn,
): SftpManagerInstance {
  const { sendMessage, onMessage, isSftpReady } = wsDeps;

  const isLoading = ref<boolean>(false);
  const loadingRequestId = ref<string | null>(null);
  const instanceSessionId = sessionId;
  const uiNotificationsStore = useUiNotificationsStore();
  const initialLoadDone = ref<boolean>(false);

  const unregisterCallbacks: (() => void)[] = [];

  // *** 响应式文件树 ***
  const fileTree = reactive<FileTreeNode>({
    filename: '/',
    longname: '/',
    attrs: {
      isDirectory: true,
      isFile: false,
      isSymbolicLink: false,
      size: 0,
      mtime: 0,
      atime: 0,
      uid: 0,
      gid: 0,
      mode: 0o755,
    },
    children: null,
    childrenLoaded: false,
  });

  const cleanup = () => {
    log.info(`[SFTP ${instanceSessionId}] Cleaning up message handlers.`);
    unregisterCallbacks.forEach((cb) => cb());
    unregisterCallbacks.length = 0;
  };

  // --- 目录加载 ---

  const loadDirectory = (path: string, forceRefresh: boolean = false) => {
    const targetNode = findNodeByPath(fileTree, path, instanceSessionId);

    if (targetNode && targetNode.childrenLoaded && !forceRefresh) {
      log.info(`[SFTP ${instanceSessionId}] 使用文件树缓存加载目录: ${path}`);
      isLoading.value = false;
      currentPathRef.value = path;
      return;
    }

    if (forceRefresh && targetNode) {
      log.info(`[SFTP ${instanceSessionId}] 强制刷新，重置节点 ${path} 的 childrenLoaded 状态`);
      targetNode.childrenLoaded = false;
    }

    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      isLoading.value = false;
      log.warn(`[SFTP ${instanceSessionId}] 尝试加载目录 ${path} 但 SFTP 未就绪。`);
      return;
    }
    if (isLoading.value) {
      log.warn(`[SFTP ${instanceSessionId}] 尝试加载目录 ${path} 但已在加载中。`);
      return;
    }

    log.info(`[SFTP ${instanceSessionId}] ${forceRefresh ? '强制' : ''}加载目录: ${path}`);
    isLoading.value = true;
    const requestId = generateRequestId();
    loadingRequestId.value = requestId;
    sendMessage({ type: 'sftp:readdir', requestId, payload: { path } });
  };

  // --- 防抖刷新：合并短时间内的多次 loadDirectory 请求 ---
  const _pendingRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduleDirectoryRefresh = (path: string, delay = 150) => {
    const existing = _pendingRefreshTimers.get(path);
    if (existing) clearTimeout(existing);
    _pendingRefreshTimers.set(
      path,
      setTimeout(() => {
        _pendingRefreshTimers.delete(path);
        if (currentPathRef.value === path && !isLoading.value) {
          loadDirectory(path, true);
        }
      }, delay),
    );
  };

  // --- 文件操作（委托给子模块） ---
  const operations = createSftpOperations({
    sendMessage,
    onMessage,
    isSftpReady,
    currentPathRef,
    instanceSessionId,
    uiNotificationsStore,
    t,
    loadDirectory,
  });

  // --- Message Handlers (委托给子模块) ---
  const { registrations } = createMessageHandlers({
    fileTree,
    currentPathRef,
    instanceSessionId,
    isLoading,
    loadingRequestId,
    uiNotificationsStore,
    t,
    loadDirectory,
    scheduleDirectoryRefresh,
  });

  // 注册所有消息处理器
  for (const { type, handler } of registrations) {
    unregisterCallbacks.push(onMessage(type, handler));
  }

  // *** 计算属性 fileList ***
  const fileList = computed<FileListItem[]>(() => {
    const node = findNodeByPath(fileTree, currentPathRef.value, instanceSessionId);
    if (node && node.childrenLoaded && node.children) {
      return node.children.map((child) => ({
        filename: child.filename,
        longname: child.longname,
        attrs: child.attrs,
      }));
    }
    return [];
  });

  return {
    fileList,
    isLoading,
    fileTree,
    initialLoadDone,
    loadDirectory,
    createDirectory: operations.createDirectory,
    createFile: operations.createFile,
    deleteItems: operations.deleteItems,
    renameItem: operations.renameItem,
    changePermissions: operations.changePermissions,
    readFile: operations.readFile,
    writeFile: operations.writeFile,
    copyItems: operations.copyItems,
    moveItems: operations.moveItems,
    compressItems: operations.compressItems,
    decompressItem: operations.decompressItem,
    archiveProgress: operations.archiveProgress,
    joinPath: operations.joinPath,
    currentPath: currentPathRef,
    setInitialLoadDone: (value: boolean) => {
      initialLoadDone.value = value;
    },
    cleanup,
  };
}
