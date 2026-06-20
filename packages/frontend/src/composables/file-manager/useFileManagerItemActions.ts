/**
 * 文件管理器文件项操作逻辑
 * 从 FileManager.vue 提取，负责符号链接解析、目录进入、文件打开及多选模式
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { SftpManagerInstance } from '../../composables/useSftpActions';
import type { WebSocketMessage, MessagePayload } from '../../types/websocket.types';
import type { FileListItem } from '../../types/sftp.types';
import type { useFileEditorStore, FileInfo } from '../../stores/fileEditor.store';
import type { useSessionStore } from '../../stores/session.store';
import { getWsDepsFromSession } from './fileManagerWsUtils';
import { log } from '@/utils/log';

type FileEditorStore = ReturnType<typeof useFileEditorStore>;
type SessionStore = ReturnType<typeof useSessionStore>;

type SftpRealpathPayload = {
  requestedPath?: string;
  absolutePath?: string;
  targetType?: 'file' | 'directory' | 'unknown';
  error?: string;
};

const generateRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export interface UseFileManagerItemActionsOptions {
  /** SFTP 管理器实例（响应式） */
  currentSftpManager: ComputedRef<SftpManagerInstance | null>;
  /** 会话 ID（响应式，session:remapped 后自动更新） */
  sessionId: ComputedRef<string>;
  /** 实例 ID */
  instanceId: string;
  /** 是否为移动端（响应式） */
  isMobile: ComputedRef<boolean>;
  /** 是否弹窗编辑器（响应式） */
  showPopupFileEditorBoolean: Ref<boolean>;
  /** 是否共享编辑器标签页（响应式） */
  shareFileEditorTabsBoolean: Ref<boolean>;
  /** 文件编辑器 Store */
  fileEditorStore: FileEditorStore;
  /** 会话 Store */
  sessionStore: SessionStore;
  /** 延迟获取选中项集合（解决与 Selection composable 的循环依赖） */
  getSelectedItems: () => Ref<Set<string>>;
  /** 延迟获取清空选择函数 */
  getClearSelection: () => () => void;
  /** 显示错误通知的函数 */
  showError: (message: string) => void;
}

export function useFileManagerItemActions(options: UseFileManagerItemActionsOptions) {
  const {
    currentSftpManager,
    sessionId,
    instanceId,
    sessionStore,
    isMobile,
    showPopupFileEditorBoolean,
    shareFileEditorTabsBoolean,
    fileEditorStore,
    getSelectedItems,
    getClearSelection,
    showError,
  } = options;

  const logPrefix = computed(() => `[FileManager ${sessionId.value}-${instanceId}]`);

  const isMultiSelectMode = ref(false);

  // 延迟绑定的选择 composable 原始回调
  let _originalHandleItemClick: ((event: MouseEvent, item: FileListItem) => void) | null = null;
  let _originalHandleItemDoubleClick: ((event: MouseEvent, item: FileListItem) => void) | null =
    null;

  /**
   * 注入选择 composable 的原始点击回调
   * 需要在 useFileManagerSelection 实例化后调用
   */
  const setItemActionSelectionDeps = (deps: {
    originalHandleItemClick: (event: MouseEvent, item: FileListItem) => void;
    originalHandleItemDoubleClick: (event: MouseEvent, item: FileListItem) => void;
  }) => {
    _originalHandleItemClick = deps.originalHandleItemClick;
    _originalHandleItemDoubleClick = deps.originalHandleItemDoubleClick;
  };

  /** 核心文件项操作：符号链接解析、目录进入、文件打开 */
  const handleItemAction = (item: FileListItem) => {
    const manager = currentSftpManager.value;
    if (!manager) return;

    const itemPath = manager.joinPath(manager.currentPath.value, item.filename);

    // 符号链接处理：通过 realpath 解析目标类型
    if (item.attrs.isSymbolicLink) {
      if (manager.isLoading.value) return;
      log.info(
        `${logPrefix.value} Symbolic link clicked: ${itemPath}. Attempting to resolve with sftp:realpath...`,
      );

      const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
      if (!wsDeps) return;
      const { sendMessage: wsSend, onMessage: wsOnMessage } = wsDeps;
      const requestId = generateRequestId();

      const handleResolvedPath = (
        realPath: string,
        targetType: 'file' | 'directory' | 'unknown',
        originalLinkItem: FileListItem,
      ) => {
        if (!currentSftpManager.value) return;

        if (targetType === 'directory') {
          currentSftpManager.value.loadDirectory(realPath);
        } else {
          // 'file' 或 'unknown' 统一按文件处理
          if (targetType !== 'file') {
            log.warn(
              `${logPrefix.value} Symlink target '${realPath}' has an unknown type ('${targetType}'). Defaulting to open as file.`,
            );
          }
          const targetFilename =
            realPath.substring(realPath.lastIndexOf('/') + 1) || originalLinkItem.filename;
          const fileInfo: FileInfo = { name: targetFilename, fullPath: realPath };

          // 移动端多选模式：切换选中状态
          if (isMobile.value && isMultiSelectMode.value) {
            const selectedItems = getSelectedItems();
            if (selectedItems.value.has(originalLinkItem.filename)) {
              selectedItems.value.delete(originalLinkItem.filename);
            } else {
              selectedItems.value.add(originalLinkItem.filename);
            }
            return;
          }

          if (showPopupFileEditorBoolean.value) {
            fileEditorStore.triggerPopup(realPath, sessionId.value);
          }
          if (shareFileEditorTabsBoolean.value) {
            fileEditorStore.openFile(realPath, sessionId.value, instanceId);
          } else {
            sessionStore.openFileInSession(sessionId.value, fileInfo);
          }
        }
      };

      let unregisterSuccess: (() => void) | undefined;
      let unregisterError: (() => void) | undefined;
      let timeoutId: NodeJS.Timeout | number | undefined;

      const cleanupListeners = () => {
        unregisterSuccess?.();
        unregisterError?.();
        if (timeoutId) clearTimeout(timeoutId as NodeJS.Timeout);
        timeoutId = undefined;
      };

      unregisterSuccess = wsOnMessage(
        'sftp:realpath:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (!payload || typeof payload === 'string') return;
          const p = payload as SftpRealpathPayload;
          if (message.requestId === requestId && p.requestedPath === itemPath) {
            cleanupListeners();
            if (!currentSftpManager.value) return;
            const absolutePath = p.absolutePath;
            const targetType = p.targetType as 'file' | 'directory' | 'unknown';

            if (!absolutePath) {
              log.error(
                `${logPrefix.value} sftp:realpath:success for ${itemPath} missing absolutePath. Payload:`,
                p,
              );
              return;
            }
            if (!targetType) {
              log.warn(
                `${logPrefix.value} sftp:realpath:success for ${itemPath} missing targetType. Defaulting to 'file'. Payload:`,
                p,
              );
            }

            handleResolvedPath(absolutePath, targetType || 'unknown', item);
          }
        },
      );

      unregisterError = wsOnMessage(
        'sftp:realpath:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (!payload || typeof payload === 'string') return;
          const p = payload as SftpRealpathPayload;
          if (message.requestId === requestId && p?.requestedPath === itemPath) {
            cleanupListeners();
            const serverErrorMsg = p.error || 'Unknown error resolving symlink target type';
            const resolvedPathInfo = p.absolutePath ? ` (Resolved path: ${p.absolutePath})` : '';
            log.error(
              `${logPrefix.value} Failed to get realpath for symlink '${itemPath}': ${serverErrorMsg}${resolvedPathInfo}`,
            );
            showError(`Failed to resolve symlink: ${serverErrorMsg}`);
          }
        },
      );

      timeoutId = setTimeout(() => {
        cleanupListeners();
        log.error(
          `${logPrefix.value} Timeout getting realpath for symlink '${itemPath}' (ID: ${requestId}).`,
        );
        showError(`Timeout resolving symlink: ${itemPath}`);
      }, 10000);

      wsSend({ type: 'sftp:realpath', requestId, payload: { path: itemPath } });
      return;
    }

    // 目录处理：进入目录
    if (item.attrs.isDirectory) {
      if (manager.isLoading.value) return;
      const newPath =
        item.filename === '..'
          ? (() => {
              const cur = manager.currentPath.value.replace(/\/+$/, '') || '/';
              return cur.substring(0, cur.lastIndexOf('/')) || '/';
            })()
          : manager.joinPath(manager.currentPath.value, item.filename);
      manager.loadDirectory(newPath);
    } else if (item.attrs.isFile) {
      // 普通文件处理
      // 移动端多选模式：切换选中状态
      if (isMobile.value && isMultiSelectMode.value) {
        const selectedItems = getSelectedItems();
        if (selectedItems.value.has(item.filename)) {
          selectedItems.value.delete(item.filename);
        } else {
          selectedItems.value.add(item.filename);
        }
        return;
      }
      const fileInfo: FileInfo = { name: item.filename, fullPath: itemPath };

      if (showPopupFileEditorBoolean.value) {
        fileEditorStore.triggerPopup(itemPath, sessionId.value);
      }

      if (shareFileEditorTabsBoolean.value) {
        fileEditorStore.openFile(itemPath, sessionId.value, instanceId);
      } else {
        sessionStore.openFileInSession(sessionId.value, fileInfo);
      }
    }
  };

  /** 切换多选模式（主要用于移动端） */
  const toggleMultiSelectMode = () => {
    isMultiSelectMode.value = !isMultiSelectMode.value;
    if (!isMultiSelectMode.value) {
      getClearSelection()();
    }
    log.info(
      `${logPrefix.value} Multi-select mode: ${isMultiSelectMode.value ? 'enabled' : 'disabled'}`,
    );
  };

  /** 包装的列表项单击处理（支持移动端多选模式） */
  const handleItemClick = (event: MouseEvent, item: FileListItem, forceMultiSelect = false) => {
    if (item.filename === '..') {
      _originalHandleItemClick?.(event, item);
      return;
    }

    if (isMobile.value && (isMultiSelectMode.value || forceMultiSelect)) {
      const selectedItems = getSelectedItems();
      if (selectedItems.value.has(item.filename)) {
        selectedItems.value.delete(item.filename);
      } else {
        selectedItems.value.add(item.filename);
      }
      return;
    }
    _originalHandleItemClick?.(event, item);
  };

  /** 包装的列表项双击处理（移动端由长按手势触发） */
  const handleItemDoubleClick = (event: MouseEvent, item: FileListItem) => {
    _originalHandleItemDoubleClick?.(event, item);
  };

  return {
    isMultiSelectMode,
    handleItemAction,
    toggleMultiSelectMode,
    handleItemClick,
    handleItemDoubleClick,
    setItemActionSelectionDeps,
  };
}
