/**
 * SFTP 消息处理器模块
 * 职责：处理 WebSocket 消息响应（目录读取、文件操作成功/错误）
 */
import type { Ref } from 'vue';
import type { FileListItem } from '../types/sftp.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import type { useUiNotificationsStore } from '../stores/uiNotifications.store';
import type { TranslateFn } from '../types/i18n.types';
import type { FileTreeNode } from './useSftpActions';
import {
  findNodeByPath,
  removeNodeFromTree,
  addOrUpdateNodeInTree,
  sortFiles,
} from './useSftpTreeUtils';
import { log } from '@/utils/log';

/** 消息处理器依赖 */
export interface MessageHandlerDeps {
  fileTree: FileTreeNode;
  currentPathRef: Ref<string>;
  instanceSessionId: string;
  isLoading: Ref<boolean>;
  loadingRequestId: Ref<string | null>;
  uiNotificationsStore: ReturnType<typeof useUiNotificationsStore>;
  t: TranslateFn;
  loadDirectory: (path: string, forceRefresh?: boolean) => void;
  scheduleDirectoryRefresh: (path: string, delay?: number) => void;
}

/** 消息处理器注册信息 */
export interface MessageHandlerRegistration {
  type: string;
  handler: (payload: MessagePayload, message: WebSocketMessage) => void;
}

/**
 * 创建所有 SFTP 消息处理器
 */
export function createMessageHandlers(deps: MessageHandlerDeps) {
  const {
    fileTree,
    currentPathRef,
    instanceSessionId,
    isLoading,
    loadingRequestId,
    uiNotificationsStore,
    t,
    loadDirectory,
    scheduleDirectoryRefresh,
  } = deps;

  const onSftpReaddirSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const fileListPayload = payload as unknown as FileListItem[];
    const { path } = message;

    if (!path) {
      log.error(`[SFTP ${instanceSessionId}] Received readdir success without path!`);
      if (message.requestId === loadingRequestId.value) {
        isLoading.value = false;
        loadingRequestId.value = null;
      }
      return;
    }

    if (message.requestId !== loadingRequestId.value) {
      log.info(
        `[SFTP ${instanceSessionId}] Received stale readdir success for ${path} (ID: ${message.requestId}, expected: ${loadingRequestId.value}). Ignoring.`,
      );
      return;
    }

    log.info(`[SFTP ${instanceSessionId}] Received file list for directory ${path}`);

    const targetNode = findNodeByPath(fileTree, path, instanceSessionId, true);

    if (!targetNode) {
      log.error(
        `[SFTP ${instanceSessionId}] Failed to find or create node for path ${path}. Cannot update tree.`,
      );
      if (path === currentPathRef.value) {
        isLoading.value = false;
      }
      return;
    }

    // 合并逻辑：保留已加载的目录子节点
    const existingChildren = targetNode.children || [];
    const mergedChildren: FileTreeNode[] = [];
    const existingChildrenMap = new Map(existingChildren.map((node) => [node.filename, node]));

    for (const newItemData of fileListPayload) {
      const existingNode = existingChildrenMap.get(newItemData.filename);

      if (existingNode && existingNode.childrenLoaded && existingNode.attrs.isDirectory) {
        mergedChildren.push(existingNode);
        log.info(
          `[SFTP ${instanceSessionId}] Merging: Kept existing loaded node ${path}/${existingNode.filename}`,
        );
      } else {
        const shouldReusePlaceholderChildren =
          existingNode && !existingNode.childrenLoaded && existingNode.children;
        let children: FileTreeNode[] | null;
        if (shouldReusePlaceholderChildren) {
          children = existingNode.children;
        } else if (newItemData.attrs.isDirectory) {
          children = null;
        } else {
          children = [];
        }
        const childrenLoaded = shouldReusePlaceholderChildren
          ? existingNode.childrenLoaded
          : !newItemData.attrs.isDirectory;
        const newNode: FileTreeNode = {
          filename: newItemData.filename,
          longname: newItemData.longname,
          attrs: newItemData.attrs,
          children,
          childrenLoaded,
        };
        mergedChildren.push(newNode);
        if (existingNode && !existingNode.childrenLoaded) {
          log.info(
            `[SFTP ${instanceSessionId}] Merging: Updated placeholder node ${path}/${newNode.filename}`,
          );
        } else if (!existingNode) {
          log.info(
            `[SFTP ${instanceSessionId}] Merging: Added new node ${path}/${newNode.filename}`,
          );
        }
      }
    }

    mergedChildren.sort(sortFiles);
    targetNode.children = mergedChildren;
    targetNode.childrenLoaded = true;
    log.info(`[SFTP ${instanceSessionId}] File tree node ${path}'s children updated after merge.`);

    currentPathRef.value = path;
    log.info(
      `[SFTP ${instanceSessionId}] currentPathRef updated to ${path} after successful readdir.`,
    );

    isLoading.value = false;
    loadingRequestId.value = null;
    log.info(`[SFTP ${instanceSessionId}] isLoading reset after successful readdir for ${path}.`);
  };

  const onSftpReaddirError = (payload: MessagePayload, message: WebSocketMessage) => {
    const errorPayload = payload as unknown as string;
    const errorPath = message.path;

    if (message.requestId !== loadingRequestId.value) {
      log.info(
        `[SFTP ${instanceSessionId}] Received stale readdir error for ${errorPath} (ID: ${message.requestId}, expected: ${loadingRequestId.value}). Ignoring.`,
      );
      return;
    }

    log.error(`[SFTP ${instanceSessionId}] 加载目录 ${errorPath} 出错:`, errorPayload);
    uiNotificationsStore.showError(
      `${t('fileManager.errors.loadDirectoryFailed')}: ${errorPayload}`,
    );

    isLoading.value = false;
    loadingRequestId.value = null;
    log.info(`[SFTP ${instanceSessionId}] isLoading reset after failed readdir for ${errorPath}.`);
  };

  const onMkdirSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const newItem = payload as unknown as FileListItem | null;
    const parentPath = message.path?.substring(0, message.path.lastIndexOf('/')) || '/';

    log.info(`[SFTP ${instanceSessionId}] 创建目录成功: ${message.path}`);

    if (newItem) {
      addOrUpdateNodeInTree(fileTree, parentPath, newItem, instanceSessionId);
    } else {
      const parentNode = findNodeByPath(fileTree, parentPath, instanceSessionId);
      if (parentNode) {
        parentNode.childrenLoaded = false;
        log.warn(
          `[SFTP ${instanceSessionId}] Mkdir success for ${message.path} but no item details received. Marking parent ${parentPath} for reload.`,
        );
        if (parentPath === currentPathRef.value) {
          loadDirectory(currentPathRef.value);
        }
      }
    }
  };

  const onRemoveSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const removedPath = message.path;
    const parentPath = removedPath?.substring(0, removedPath.lastIndexOf('/')) || '/';
    const removedFilename = removedPath?.substring(removedPath.lastIndexOf('/') + 1);

    log.info(`[SFTP ${instanceSessionId}] 删除成功: ${removedPath}`);
    removeNodeFromTree(fileTree, parentPath, removedFilename || '', instanceSessionId);
    const removedNode = findNodeByPath(fileTree, removedPath || '', instanceSessionId);
    if (removedNode && removedNode.attrs.isDirectory) {
      log.info(`[SFTP ${instanceSessionId}] 目录 ${removedPath} 已从树中移除`);
    }
  };

  const onRenameSuccess = (payload: MessagePayload, _message: WebSocketMessage) => {
    const renamePayload = payload as unknown as {
      oldPath: string;
      newPath: string;
      newItem: FileListItem | null;
    };
    const oldParentPath =
      renamePayload.oldPath.substring(0, renamePayload.oldPath.lastIndexOf('/')) || '/';
    const newParentPath =
      renamePayload.newPath.substring(0, renamePayload.newPath.lastIndexOf('/')) || '/';
    const oldFilename = renamePayload.oldPath.substring(renamePayload.oldPath.lastIndexOf('/') + 1);
    const { newItem } = renamePayload;

    log.info(
      `[SFTP ${instanceSessionId}] 重命名成功: ${renamePayload.oldPath} -> ${renamePayload.newPath}`,
    );

    const removed = removeNodeFromTree(fileTree, oldParentPath, oldFilename, instanceSessionId);

    if (newItem) {
      addOrUpdateNodeInTree(fileTree, newParentPath, newItem, instanceSessionId);
    } else {
      if (oldParentPath !== newParentPath) {
        const newParentNode = findNodeByPath(fileTree, newParentPath, instanceSessionId);
        if (newParentNode) {
          newParentNode.childrenLoaded = false;
          log.warn(
            `[SFTP ${instanceSessionId}] Rename/Move success to ${renamePayload.newPath} but no item details. Marking parent ${newParentPath} for reload.`,
          );
          if (newParentPath === currentPathRef.value) {
            loadDirectory(currentPathRef.value);
          }
        }
      } else if (removed) {
        const parentNode = findNodeByPath(fileTree, oldParentPath, instanceSessionId);
        if (parentNode) {
          parentNode.childrenLoaded = false;
          log.warn(
            `[SFTP ${instanceSessionId}] Rename success in ${oldParentPath} but no item details. Marking parent for reload.`,
          );
          if (oldParentPath === currentPathRef.value) {
            loadDirectory(currentPathRef.value);
          }
        }
      }
    }
  };

  const onChmodSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const updatedItem = payload as unknown as FileListItem | null;
    const targetPath = message.path;
    const parentPath = targetPath?.substring(0, targetPath.lastIndexOf('/')) || '/';

    log.info(`[SFTP ${instanceSessionId}] 修改权限成功: ${targetPath}`);

    if (updatedItem) {
      addOrUpdateNodeInTree(fileTree, parentPath, updatedItem, instanceSessionId);
    } else {
      const parentNode = findNodeByPath(fileTree, parentPath, instanceSessionId);
      if (parentNode) {
        parentNode.childrenLoaded = false;
        log.warn(
          `[SFTP ${instanceSessionId}] Chmod success for ${targetPath} but no item details received. Marking parent ${parentPath} for reload.`,
        );
        if (parentPath === currentPathRef.value) {
          loadDirectory(currentPathRef.value);
        }
      }
    }
  };

  const onWriteFileSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const updatedItem = payload as unknown as FileListItem | null;
    const filePath = message.path;
    const parentPath = filePath?.substring(0, filePath.lastIndexOf('/')) || '/';

    log.info(`[SFTP ${instanceSessionId}] 写入文件成功: ${filePath}`);

    if (updatedItem) {
      addOrUpdateNodeInTree(fileTree, parentPath, updatedItem, instanceSessionId);
    } else {
      const parentNode = findNodeByPath(fileTree, parentPath, instanceSessionId);
      if (parentNode) {
        parentNode.childrenLoaded = false;
        log.warn(
          `[SFTP ${instanceSessionId}] WriteFile success for ${filePath} but no item details received. Marking parent ${parentPath} for reload.`,
        );
        if (parentPath === currentPathRef.value) {
          loadDirectory(currentPathRef.value);
        }
      }
    }
  };

  const onCopySuccess = (payload: MessagePayload, _message: WebSocketMessage) => {
    const copyPayload = payload as unknown as { destination: string; items: FileListItem[] | null };
    const destinationDir = copyPayload.destination;
    const newItems = copyPayload.items;

    log.info(`[SFTP ${instanceSessionId}] 复制成功到: ${destinationDir}`);
    uiNotificationsStore.showSuccess(t('fileManager.notifications.copySuccess'));

    const destNode = findNodeByPath(fileTree, destinationDir, instanceSessionId);
    if (destNode && newItems) {
      if (destNode.childrenLoaded && destNode.children) {
        newItems.forEach((item) =>
          addOrUpdateNodeInTree(fileTree, destinationDir, item, instanceSessionId),
        );
      } else {
        destNode.childrenLoaded = false;
        log.info(
          `[SFTP ${instanceSessionId}] 复制成功，但目标目录 ${destinationDir} 未加载，标记为需要刷新`,
        );
        if (destinationDir === currentPathRef.value) {
          loadDirectory(currentPathRef.value);
        }
      }
    } else if (destNode && !newItems) {
      destNode.childrenLoaded = false;
      log.warn(
        `[SFTP ${instanceSessionId}] Copy success to ${destinationDir} but no item details received. Marking parent for reload.`,
      );
      if (destinationDir === currentPathRef.value) {
        loadDirectory(currentPathRef.value);
      }
    } else {
      log.warn(
        `[SFTP ${instanceSessionId}] Copy success, but destination node ${destinationDir} not found in tree.`,
      );
    }
  };

  const onMoveSuccess = (payload: MessagePayload, _message: WebSocketMessage) => {
    const movePayload = payload as unknown as {
      sources: string[];
      destination: string;
      items: FileListItem[] | null;
    };
    const sourcePaths = movePayload.sources;
    const destinationDir = movePayload.destination;
    const newItems = movePayload.items;

    log.info(`[SFTP ${instanceSessionId}] 移动成功到: ${destinationDir}`);
    uiNotificationsStore.showSuccess(t('fileManager.notifications.moveSuccess'));

    sourcePaths.forEach((oldPath) => {
      const oldParentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
      const oldFilename = oldPath.substring(oldPath.lastIndexOf('/') + 1);
      removeNodeFromTree(fileTree, oldParentPath, oldFilename, instanceSessionId);
    });

    const destNode = findNodeByPath(fileTree, destinationDir, instanceSessionId);
    if (destNode && newItems) {
      if (destNode.childrenLoaded && destNode.children) {
        newItems.forEach((item) =>
          addOrUpdateNodeInTree(fileTree, destinationDir, item, instanceSessionId),
        );
      } else {
        destNode.childrenLoaded = false;
        log.info(
          `[SFTP ${instanceSessionId}] 移动成功，但目标目录 ${destinationDir} 未加载，标记为需要刷新`,
        );
        if (destinationDir === currentPathRef.value) {
          loadDirectory(currentPathRef.value);
        }
      }
    } else if (destNode && !newItems) {
      destNode.childrenLoaded = false;
      log.warn(
        `[SFTP ${instanceSessionId}] Move success to ${destinationDir} but no item details received. Marking parent for reload.`,
      );
      if (destinationDir === currentPathRef.value) {
        loadDirectory(currentPathRef.value);
      }
    } else {
      log.warn(
        `[SFTP ${instanceSessionId}] Move success, but destination node ${destinationDir} not found in tree.`,
      );
    }
  };

  const onUploadSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
    const newItem = payload as unknown as FileListItem | null;
    const fullPath = message.path;

    if (!fullPath) {
      log.error(
        `[SFTP ${instanceSessionId}] Received upload success but message is missing 'path'. Payload:`,
        payload,
      );
      const filename = newItem?.filename;
      log.warn(
        `[SFTP ${instanceSessionId}] Upload success for ${filename || '(unknown file)'} but cannot determine parent path. Reloading current directory.`,
      );
      loadDirectory(currentPathRef.value);
      return;
    }

    const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/';
    const filename = fullPath.substring(fullPath.lastIndexOf('/') + 1);

    log.info(`[SFTP ${instanceSessionId}] 上传文件成功: ${fullPath}`);

    if (newItem) {
      if (newItem.filename !== filename) {
        log.warn(
          `[SFTP ${instanceSessionId}] Upload success: filename mismatch between message.path ('${filename}') and payload.filename ('${newItem.filename}'). Using filename from path.`,
        );
        newItem.filename = filename;
      }
      addOrUpdateNodeInTree(fileTree, parentPath, newItem, instanceSessionId);

      const parentNodeAfterUpload = findNodeByPath(fileTree, parentPath, instanceSessionId);
      if (parentNodeAfterUpload) {
        parentNodeAfterUpload.childrenLoaded = true;
      }

      if (
        parentPath === currentPathRef.value ||
        parentPath.startsWith(`${currentPathRef.value}/`)
      ) {
        scheduleDirectoryRefresh(currentPathRef.value);
      }
    } else {
      const parentNode = findNodeByPath(fileTree, parentPath, instanceSessionId);
      if (parentNode && !parentNode.childrenLoaded) {
        parentNode.childrenLoaded = false;
        log.warn(
          `[SFTP ${instanceSessionId}] Upload success for ${fullPath} but no item details received. Marking parent ${parentPath} for reload.`,
        );
        if (
          parentPath === currentPathRef.value ||
          parentPath.startsWith(`${currentPathRef.value}/`)
        ) {
          scheduleDirectoryRefresh(currentPathRef.value);
        }
      } else if (!parentNode) {
        log.warn(
          `[SFTP ${instanceSessionId}] Upload success for ${fullPath}, no item details, and parent node ${parentPath} not found in tree.`,
        );
        scheduleDirectoryRefresh(currentPathRef.value);
      }
    }
  };

  const onActionError = (payload: MessagePayload, message: WebSocketMessage) => {
    const errorPayload = payload as unknown as string;
    log.error(`[SFTP ${instanceSessionId}] Action ${message.type} failed:`, errorPayload);
    const actionTypeMap: Record<string, string> = {
      'sftp:mkdir:error': t('fileManager.errors.createFolderFailed'),
      'sftp:rmdir:error': t('fileManager.errors.deleteFailed'),
      'sftp:unlink:error': t('fileManager.errors.deleteFailed'),
      'sftp:rename:error': t('fileManager.errors.renameFailed'),
      'sftp:chmod:error': t('fileManager.errors.chmodFailed'),
      'sftp:writefile:error': t('fileManager.errors.saveFailed'),
      'sftp:copy:error': t('fileManager.errors.copyFailed'),
      'sftp:move:error': t('fileManager.errors.moveFailed'),
    };
    const prefix = actionTypeMap[message.type] || t('fileManager.errors.generic');
    uiNotificationsStore.showError(`${prefix}: ${errorPayload}`);
  };

  const onCommandNotFound = (payload: MessagePayload, _message: WebSocketMessage) => {
    const {
      operation,
      command,
      message: details,
    } = payload as unknown as {
      operation: 'compress' | 'decompress';
      command: string;
      message?: string;
    };
    log.error(
      `[SFTP ${instanceSessionId}] Command '${command}' not found on server for ${operation}. Details: ${details}`,
    );
    let errorMsgKey = '';
    if (operation === 'compress') {
      errorMsgKey = 'fileManager.errors.commandNotFoundCompress';
    } else if (operation === 'decompress') {
      errorMsgKey = 'fileManager.errors.commandNotFoundDecompress';
    }
    if (errorMsgKey) {
      uiNotificationsStore.showError(t(errorMsgKey, { command }));
    } else {
      uiNotificationsStore.showError(
        t('fileManager.errors.genericCommandNotFound', { command, operation }),
      );
    }
  };

  // 返回所有处理器的注册信息
  const registrations: MessageHandlerRegistration[] = [
    { type: 'sftp:readdir:success', handler: onSftpReaddirSuccess },
    { type: 'sftp:readdir:error', handler: onSftpReaddirError },
    { type: 'sftp:mkdir:success', handler: onMkdirSuccess },
    { type: 'sftp:rmdir:success', handler: onRemoveSuccess },
    { type: 'sftp:unlink:success', handler: onRemoveSuccess },
    { type: 'sftp:rename:success', handler: onRenameSuccess },
    { type: 'sftp:chmod:success', handler: onChmodSuccess },
    { type: 'sftp:writefile:success', handler: onWriteFileSuccess },
    { type: 'sftp:upload:success', handler: onUploadSuccess },
    { type: 'sftp:mkdir:error', handler: onActionError },
    { type: 'sftp:rmdir:error', handler: onActionError },
    { type: 'sftp:unlink:error', handler: onActionError },
    { type: 'sftp:rename:error', handler: onActionError },
    { type: 'sftp:chmod:error', handler: onActionError },
    { type: 'sftp:writefile:error', handler: onActionError },
    { type: 'sftp:copy:success', handler: onCopySuccess },
    { type: 'sftp:copy:error', handler: onActionError },
    { type: 'sftp:move:success', handler: onMoveSuccess },
    { type: 'sftp:move:error', handler: onActionError },
    { type: 'sftp:command_not_found', handler: onCommandNotFound },
  ];

  return { registrations };
}
