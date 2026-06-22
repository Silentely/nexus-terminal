/**
 * 文件管理器操作模态框逻辑
 * 从 FileManager.vue 提取，负责删除、重命名、权限修改、新建等模态框操作
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { useSessionStore } from '../../stores/session.store';
import { getWsDepsFromSession } from './fileManagerWsUtils';
import type { SftpManagerInstance } from '../../composables/useSftpActions';
import type { FileListItem } from '../../types/sftp.types';
import { log } from '@/utils/log';

type SessionStore = ReturnType<typeof useSessionStore>;

export interface UseFileManagerActionModalOptions {
  /** SFTP 管理器实例（响应式） */
  currentSftpManager: ComputedRef<SftpManagerInstance | null>;
  /** 会话 ID（响应式，session:remapped 后自动更新） */
  sessionId: ComputedRef<string>;
  /** 实例 ID */
  instanceId: string;
  /** 会话 Store */
  sessionStore: SessionStore;
  /** 选中项集合 */
  selectedItems: Ref<Set<string>>;
  /** 是否显示删除确认（响应式） */
  fileManagerShowDeleteConfirmationBoolean: Ref<boolean>;
  /** 显示错误通知的函数 */
  showError: (message: string) => void;
}

export function useFileManagerActionModal(options: UseFileManagerActionModalOptions) {
  const {
    currentSftpManager,
    sessionId,
    instanceId,
    sessionStore,
    selectedItems,
    fileManagerShowDeleteConfirmationBoolean,
    showError,
  } = options;

  const logPrefix = computed(() => `[FileManager ${sessionId.value}-${instanceId}]`);

  // --- 模态框状态 ---
  const isActionModalVisible = ref(false);
  const currentActionType = ref<'delete' | 'rename' | 'chmod' | 'newFile' | 'newFolder' | null>(
    null,
  );
  const actionItem = ref<FileListItem | null>(null);
  const actionItems = ref<FileListItem[]>([]);
  const actionInitialValue = ref('');

  /** 打开操作模态框 */
  const openActionModal = (
    type: 'delete' | 'rename' | 'chmod' | 'newFile' | 'newFolder',
    item?: FileListItem | null,
    items?: FileListItem[],
    initialValue?: string,
  ) => {
    currentActionType.value = type;
    actionItem.value = item || null;
    actionItems.value = items || (item ? [item] : []);
    actionInitialValue.value = initialValue || '';
    isActionModalVisible.value = true;
  };

  /** 关闭模态框并重置状态 */
  const handleModalClose = () => {
    isActionModalVisible.value = false;
    currentActionType.value = null;
    actionItem.value = null;
    actionItems.value = [];
    actionInitialValue.value = '';
  };

  /** 确认模态框操作 */
  const handleModalConfirm = (value?: string) => {
    const manager = currentSftpManager.value;
    if (!manager || !currentActionType.value) {
      handleModalClose();
      return;
    }

    switch (currentActionType.value) {
      case 'delete':
        if (actionItems.value.length > 0) {
          manager.deleteItems(actionItems.value);
          selectedItems.value.clear();
        }
        break;
      case 'rename':
        if (actionItem.value && value && value !== actionItem.value.filename) {
          manager.renameItem(actionItem.value, value);
        }
        break;
      case 'chmod':
        if (actionItem.value && value && /^[0-7]{3,4}$/.test(value)) {
          const newMode = parseInt(value, 8);
          manager.changePermissions(actionItem.value, newMode);
        } else if (value) {
          log.error(`${logPrefix.value} Invalid chmod value from modal: ${value}`);
          showError(`Invalid permission value: ${value}`);
          return;
        }
        break;
      case 'newFile':
        if (value) {
          if (manager.fileList.value.some((item: FileListItem) => item.filename === value)) {
            log.warn(`${logPrefix.value} File ${value} already exists. Modal should prevent this.`);
            showError(`File "${value}" already exists`);
            return;
          }
          manager.createFile(value);
        }
        break;
      case 'newFolder':
        if (value) {
          if (manager.fileList.value.some((item: FileListItem) => item.filename === value)) {
            log.warn(
              `${logPrefix.value} Folder ${value} already exists. Modal should prevent this.`,
            );
            showError(`Folder "${value}" already exists`);
            return;
          }
          manager.createDirectory(value);
        }
        break;
    }
    handleModalClose();
  };

  /** 删除选中项（从右键菜单触发） */
  const handleDeleteSelectedClick = () => {
    const manager = currentSftpManager.value;
    if (!manager) return;
    const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
    if (!wsDeps?.isConnected.value || selectedItems.value.size === 0) return;

    const itemsToDelete = Array.from(selectedItems.value)
      .map((filename) => manager.fileList.value.find((f: FileListItem) => f.filename === filename))
      .filter((item): item is FileListItem => item !== undefined);
    if (itemsToDelete.length === 0) return;

    if (fileManagerShowDeleteConfirmationBoolean.value) {
      openActionModal('delete', null, itemsToDelete);
    } else {
      manager.deleteItems(itemsToDelete);
      selectedItems.value.clear();
    }
  };

  /** 重命名（从右键菜单触发） */
  const handleRenameContextMenuClick = (item: FileListItem) => {
    const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
    if (!wsDeps?.isConnected.value || !item) return;
    if (!currentSftpManager.value) return;
    openActionModal('rename', item, undefined, item.filename);
  };

  /** 修改权限（从右键菜单触发） */
  const handleChangePermissionsContextMenuClick = (item: FileListItem) => {
    const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
    if (!wsDeps?.isConnected.value || !item) return;
    if (!currentSftpManager.value) return;
    const currentModeOctal = (item.attrs.mode & 0o7777).toString(8).padStart(4, '0');
    openActionModal('chmod', item, undefined, currentModeOctal);
  };

  /** 新建文件夹（从右键菜单触发） */
  const handleNewFolderContextMenuClick = () => {
    const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
    if (!wsDeps?.isConnected.value) return;
    if (!currentSftpManager.value) return;
    openActionModal('newFolder');
  };

  /** 新建文件（从右键菜单触发） */
  const handleNewFileContextMenuClick = () => {
    const wsDeps = getWsDepsFromSession(sessionStore, sessionId.value);
    if (!wsDeps?.isConnected.value) return;
    if (!currentSftpManager.value) return;
    openActionModal('newFile');
  };

  return {
    isActionModalVisible,
    currentActionType,
    actionItem,
    actionItems,
    actionInitialValue,
    openActionModal,
    handleModalClose,
    handleModalConfirm,
    handleDeleteSelectedClick,
    handleRenameContextMenuClick,
    handleChangePermissionsContextMenuClick,
    handleNewFolderContextMenuClick,
    handleNewFileContextMenuClick,
  };
}
