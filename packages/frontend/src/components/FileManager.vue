<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  watchEffect,
  type PropType,
  type Ref,
  readonly,
  shallowRef,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  createSftpActionsManager,
  type WebSocketDependencies,
} from '../composables/useSftpActions';
import { useFileUploader } from '../composables/useFileUploader';
import { useFileEditorStore, type FileInfo } from '../stores/fileEditor.store';
import { useSessionStore } from '../stores/session.store';
import { useSettingsStore } from '../stores/settings.store';
import { useFocusSwitcherStore } from '../stores/focusSwitcher.store';
import {
  useFileManagerContextMenu,
  type ClipboardState,
  type CompressFormat,
} from '../composables/file-manager/useFileManagerContextMenu';
import { useFileManagerSelection } from '../composables/file-manager/useFileManagerSelection';
import { useFileManagerDragAndDrop } from '../composables/file-manager/useFileManagerDragAndDrop';
import { useFileManagerKeyboardNavigation } from '../composables/file-manager/useFileManagerKeyboardNavigation';
import { useFileManagerSortFilter } from '../composables/file-manager/useFileManagerSortFilter';
import { useFileManagerColumnResize } from '../composables/file-manager/useFileManagerColumnResize';
import { useFileManagerLayoutSettings } from '../composables/file-manager/useFileManagerLayoutSettings';
import { useFileManagerPathNavigation } from '../composables/file-manager/useFileManagerPathNavigation';
import { useFileManagerSearch } from '../composables/file-manager/useFileManagerSearch';
import { useFileManagerTerminalSync } from '../composables/file-manager/useFileManagerTerminalSync';
import { useFileManagerItemActions } from '../composables/file-manager/useFileManagerItemActions';
import { useFileManagerActionModal } from '../composables/file-manager/useFileManagerActionModal';
import { useFileManagerClipboard } from '../composables/file-manager/useFileManagerClipboard';
import { useFileManagerDownload } from '../composables/file-manager/useFileManagerDownload';
import FileUploadPopup from './FileUploadPopup.vue';
import FileManagerContextMenu from './FileManagerContextMenu.vue';
import FileManagerActionModal from './FileManagerActionModal.vue';
import FileManagerToolbar from './FileManagerToolbar.vue';
import FileManagerFileList from './FileManagerFileList.vue';
import type { FileListItem } from '../types/sftp.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import { usePathHistoryStore } from '../stores/pathHistory.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useWorkspaceEventSubscriber, useWorkspaceEventOff } from '../composables/workspaceEvents';
import { log } from '@/utils/log';

type SftpManagerInstance = ReturnType<typeof createSftpActionsManager>;
type SftpRealpathPayload = {
  requestedPath?: string;
  absolutePath?: string;
  targetType?: 'file' | 'directory' | 'unknown';
  error?: string;
};
// --- Props ---
const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  // 文件管理器实例 ID
  instanceId: {
    type: String,
    required: true,
  },
  // 注入数据库连接 ID
  dbConnectionId: {
    type: String,
    required: true,
  },
  // 注入此组件及其子 composables 所需的 WebSocket 依赖项
  wsDeps: {
    type: Object as PropType<WebSocketDependencies>,
    required: true,
  },
  isMobile: {
    type: Boolean,
    default: false,
  },
});

// --- 核心 Composables ---
const { t } = useI18n();
const sessionStore = useSessionStore(); // 实例化 Session Store

// --- 获取并存储 SFTP 管理器实例 ---
// 使用 shallowRef 存储管理器实例，以便在 sessionId 变化时切换
const currentSftpManager = shallowRef<SftpManagerInstance | null>(null);

// 追踪当前有效的 session ID（session:remapped 后会更新）
const effectiveSessionId = ref(props.sessionId);

// 标记是否刚完成 session 重映射，用于抑制 isSftpReady watcher 的冗余 loadDirectory 调用
// 重映射后由连接 watcher（initialLoadDone 分支）负责正确的初始加载
const justRemapped = ref(false);
const lastReconnectPath = ref<string | null>(null);

const initializeSftpManager = (sessionId: string, instanceId: string, initialPath?: string) => {
  const manager = sessionStore.getOrCreateSftpManager(sessionId, instanceId, initialPath);
  if (!manager) {
    // 抛出错误或显示错误消息，阻止组件进一步渲染
    log.error(
      `[FileManager ${sessionId}-${instanceId}] Failed to get or create SFTP manager instance.`,
    );
    // 可以设置一个错误状态 ref 在模板中显示
    // managerError.value = `Failed to get SFTP manager for instance ${instanceId}`;
    currentSftpManager.value = null; // 确保设置为 null
    // 抛出错误会阻止组件渲染，可能不是最佳用户体验
    // throw new Error(`[FileManager ${sessionId}-${instanceId}] Failed to get or create SFTP manager instance.`);
  } else {
    currentSftpManager.value = manager;
    log.info(`[FileManager ${sessionId}-${instanceId}] SFTP Manager initialized/retrieved.`);
  }
};

// 初始加载管理器
initializeSftpManager(props.sessionId, props.instanceId);

// --- 监听 session:remapped 事件，处理 session ID 重映射 ---
const subscribeToWorkspaceEvents = useWorkspaceEventSubscriber();
const unsubscribeFromWorkspaceEvents = useWorkspaceEventOff();

const _onSessionRemapped = (payload: { oldSessionId: string; newSessionId: string }) => {
  if (payload.oldSessionId === effectiveSessionId.value) {
    // 使用本地 ref 获取旧 manager 的当前路径
    // 此时 sessionActions 已从 sessions Map 中删除旧 key，无法通过 store 查找
    const savedPath = currentSftpManager.value?.currentPath.value || '/';
    log.info(
      `[FileManager ${effectiveSessionId.value}-${props.instanceId}] 收到 session:remapped 事件，旧ID: ${payload.oldSessionId} → 新ID: ${payload.newSessionId}，保存路径: ${savedPath}，重新初始化 SFTP 管理器。`,
    );
    // 清理旧 manager 的监听器
    currentSftpManager.value?.cleanup?.();
    // sessionActions 已将 session 对象从 oldSessionId 移到 newSessionId，
    // 因此必须用 newSessionId 才能从 sftpManagers Map 中移除旧 manager
    sessionStore.removeSftpManager(payload.newSessionId, props.instanceId);
    effectiveSessionId.value = payload.newSessionId;
    // 标记为刚重映射，阻止 isSftpReady watcher 触发冗余的 loadDirectory
    // 目录加载由连接 watcher（initialLoadDone 分支）负责
    justRemapped.value = true;
    lastReconnectPath.value = null;
    // 传入保存的路径，使新管理器恢复到之前的导航位置
    initializeSftpManager(payload.newSessionId, props.instanceId, savedPath);
  }
};

subscribeToWorkspaceEvents('session:remapped', _onSessionRemapped);

// --- 监听 isSftpReady 状态，就绪后自动加载目录 ---
watch(
  () => props.wsDeps.isSftpReady.value,
  (ready) => {
    if (ready && currentSftpManager.value) {
      // 初始加载（initialLoadDone === false）统一由 watchEffect 通过 sftp:realpath 处理
      // 避免此处 loadDirectory('/') 与 watchEffect 的 loadDirectory(absolutePath) 产生竞争导致 UI 闪烁
      if (justRemapped.value || !currentSftpManager.value.initialLoadDone.value) {
        log.info(
          `[FileManager ${effectiveSessionId.value}-${props.instanceId}] SFTP 已就绪，但跳过自动加载（初始加载由 watchEffect 处理）`,
        );
        return;
      }
      log.info(
        `[FileManager ${effectiveSessionId.value}-${props.instanceId}] SFTP 已就绪，自动加载根目录`,
      );
      currentSftpManager.value.loadDirectory(currentSftpManager.value.currentPath.value || '/');
    }
  },
  { immediate: true },
);

// --- 文件上传模块 ---
// 修改：依赖 currentSftpManager 的状态
const { uploads, startFileUpload, cancelUpload } = useFileUploader(
  computed(() => effectiveSessionId.value),
  // 传递 manager 的 currentPath 和 fileList ref
  computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  computed(() => currentSftpManager.value?.fileList.value ?? []),
  computed(() => props.wsDeps),
);

// 实例化其他 Stores
const fileEditorStore = useFileEditorStore(); // 实例化 File Editor Store
// const sessionStore = useSessionStore(); // 已在上面实例化
const settingsStore = useSettingsStore(); // +++ 实例化 Settings Store +++
const focusSwitcherStore = useFocusSwitcherStore(); // +++ 实例化焦点切换 Store +++
const pathHistoryStore = usePathHistoryStore(); // +++ 实例化 PathHistoryStore +++
const uiNotificationsStore = useUiNotificationsStore(); // +++ 实例化通知 store +++

// 从 Settings Store 获取共享设置
const {
  shareFileEditorTabsBoolean,
  fileManagerRowSizeMultiplierNumber, // +++ 获取行大小 getter +++
  fileManagerColWidthsObject, // +++ 获取列宽 getter +++
  showPopupFileEditorBoolean, // +++ 获取弹窗设置状态 +++
  fileManagerShowDeleteConfirmationBoolean, // +++ 获取删除确认设置状态 +++
  fileManagerSingleClickOpenFileBoolean,
} = storeToRefs(settingsStore); // 使用 storeToRefs 保持响应性

// --- 排序与过滤 Composable ---
const { sortKey, sortDirection, searchQuery, filteredFileList, handleSort } =
  useFileManagerSortFilter({
    fileList: computed(() => currentSftpManager.value?.fileList.value ?? []),
  });

// --- 搜索 Composable（依赖 searchQuery、focusSwitcherStore）---
const { isSearchActive, activateSearch, deactivateSearch, cancelSearch, focusSearchInput } =
  useFileManagerSearch({
    toolbarRef: computed(() => toolbarRef.value),
    sessionStore,
    sessionId: computed(() => effectiveSessionId.value),
    instanceId: props.instanceId,
    searchQuery,
    focusSwitcherStore,
  });

// --- UI 状态 Refs ---
const fileInputRef = ref<HTMLInputElement | null>(null);
const folderInputRef = ref<HTMLInputElement | null>(null);
const fileListContainerRef = ref<HTMLDivElement | null>(null); // 文件列表容器引用
const toolbarRef = ref<InstanceType<typeof FileManagerToolbar> | null>(null); // 工具栏子组件引用
const fileListRef = ref<InstanceType<typeof FileManagerFileList> | null>(null); // 文件列表子组件引用

// --- 日志前缀（供多个 composable 共享）---
const logPrefix = computed(() => `[FileManager ${effectiveSessionId.value}-${props.instanceId}]`);

// --- 路径导航 Composable ---
const {
  isEditingPath,
  editablePath,
  showPathHistoryDropdown,
  startPathEdit,
  cancelPathEdit,
  handlePathInputFocus,
  handlePathInputKeydown,
  handlePathSelectedFromDropdown,
  navigateToPath,
  closePathHistory,
} = useFileManagerPathNavigation({
  currentSftpManager: computed(() => currentSftpManager.value),
  isConnected: computed(() => props.wsDeps.isConnected.value),
  pathHistoryStore,
  pathInputRef: computed(() => toolbarRef.value?.pathInputRef ?? null),
  logPrefix,
});

// +++ Path History Refs (for template binding) +++
const { selectedIndex: pathSelectedIndex, filteredHistory: filteredPathHistory } =
  storeToRefs(pathHistoryStore);

// --- 终端同步 Composable ---
const {
  isSyncingPathFromTerminal,
  sendCdCommandToTerminal,
  syncCurrentPathToTerminalDirectory,
  cleanupSilentExecRequest,
} = useFileManagerTerminalSync({
  currentSftpManager: computed(() => currentSftpManager.value),
  sessionId: computed(() => effectiveSessionId.value),
  instanceId: props.instanceId,
  t,
  uiNotificationsStore,
  sessionStore,
});

// --- 布局设置 Composable（列宽 + 行大小乘数）---
const { rowSizeMultiplier, colWidths, saveLayoutSettings, handleWheel } =
  useFileManagerLayoutSettings({
    storeMultiplier: fileManagerRowSizeMultiplierNumber,
    storeWidths: fileManagerColWidthsObject,
    onSaveSettings: (multiplier, widths) => {
      settingsStore.updateFileManagerLayoutSettings(multiplier, widths);
    },
  });

// --- 列宽调整 Composable ---
const { startResize } = useFileManagerColumnResize({
  colWidths,
  onResizeEnd: saveLayoutSettings,
});

// --- 辅助函数 ---
const generateRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// --- 排序与过滤逻辑已提取至 useFileManagerSortFilter composable ---

// --- 键盘导航滚动（委托给子组件 FileManagerFileList）---
const scrollToForKeyboardNavigation = (fileIndex: number) => {
  const hasParentLink = (currentSftpManager.value?.currentPath.value ?? '/') !== '/';
  const offset = hasParentLink ? 1 : 0;
  fileListRef.value?.scrollTo(fileIndex + offset);
};

// 文件列表子组件挂载后同步容器引用（供拖拽与键盘导航 composable 使用）
watch(
  () => fileListRef.value?.containerElement,
  (val) => {
    if (!val) return;
    fileListContainerRef.value = val as HTMLDivElement;
  },
  { immediate: true },
);

// --- 文件项操作 Composable（在 Selection 之前实例化，因为 Selection 回调依赖 handleItemAction）---
// 延迟引用 selectedItems/clearSelection，避免与 Selection 的循环依赖
let _selectionSelectedItems: Ref<Set<string>> | null = null;
let _selectionClearSelection: (() => void) | null = null;
const {
  isMultiSelectMode,
  handleItemAction,
  toggleMultiSelectMode,
  handleItemClick,
  handleItemDoubleClick,
  setItemActionSelectionDeps,
} = useFileManagerItemActions({
  currentSftpManager: computed(() => currentSftpManager.value),
  sessionId: computed(() => effectiveSessionId.value),
  instanceId: props.instanceId,
  isMobile: computed(() => props.isMobile),
  showPopupFileEditorBoolean,
  shareFileEditorTabsBoolean,
  fileEditorStore,
  sessionStore,
  getSelectedItems: () => _selectionSelectedItems!,
  getClearSelection: () => _selectionClearSelection!,
  showError: uiNotificationsStore.showError,
});

// --- 选择 Composable（依赖 handleItemAction）---
const {
  selectedItems,
  lastClickedIndex,
  handleItemClick: originalHandleItemClick,
  handleItemDoubleClick: originalHandleItemDoubleClick,
  clearSelection,
} = useFileManagerSelection({
  displayedFileList: filteredFileList,
  onItemSingleClickAction: (item) => {
    if (
      item.filename === '..' ||
      item.attrs.isDirectory ||
      fileManagerSingleClickOpenFileBoolean.value
    ) {
      handleItemAction(item);
    }
  },
  onItemDoubleClickAction: (item) => {
    if (
      !fileManagerSingleClickOpenFileBoolean.value &&
      item.filename !== '..' &&
      !item.attrs.isDirectory
    ) {
      handleItemAction(item);
    }
  },
});

// 注入选择 composable 的原始回调到 itemActions composable
_selectionSelectedItems = selectedItems;
_selectionClearSelection = clearSelection;
setItemActionSelectionDeps({
  originalHandleItemClick,
  originalHandleItemDoubleClick,
});

/** 移动端长按处理：等同 PC 右键，仅显示上下文菜单 */
const handleItemLongPress = (event: TouchEvent, item: FileListItem) => {
  if (item.filename === '..') return;
  const touch = event.changedTouches?.[0];
  if (touch) {
    showContextMenu(
      { preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY } as MouseEvent,
      item,
    );
  }
};

// +++ 计算属性：获取选中的完整文件对象列表 +++
const computedSelectedFullItems = computed((): FileListItem[] => {
  if (!selectedItems.value || selectedItems.value.size === 0) {
    return [];
  }
  return filteredFileList.value.filter((item) => selectedItems.value.has(item.filename));
});

// --- 操作模态框 Composable ---
const {
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
} = useFileManagerActionModal({
  currentSftpManager: computed(() => currentSftpManager.value),
  sessionId: computed(() => effectiveSessionId.value),
  instanceId: props.instanceId,
  sessionStore,
  selectedItems,
  fileManagerShowDeleteConfirmationBoolean,
  showError: uiNotificationsStore.showError,
});

// --- 剪贴板 Composable ---
const {
  clipboardState,
  clipboardSourcePaths,
  clipboardSourceBaseDir,
  handleCopy,
  handleCut,
  handlePaste,
} = useFileManagerClipboard({
  currentSftpManager: computed(() => currentSftpManager.value),
  selectedItems,
  sessionId: computed(() => effectiveSessionId.value),
  instanceId: props.instanceId,
});

// --- 文件上传触发器 ---
const triggerFileUpload = () => {
  fileInputRef.value?.click();
};

// --- 文件夹上传触发器 ---
const triggerFolderUpload = () => {
  folderInputRef.value?.click();
};

// --- 下载 Composable ---
const { triggerDownload, triggerDownloadDirectory } = useFileManagerDownload({
  currentSftpManager: computed(() => currentSftpManager.value),
  dbConnectionId: props.dbConnectionId,
  sessionId: computed(() => effectiveSessionId.value),
  instanceId: props.instanceId,
  sessionStore,
  showError: uiNotificationsStore.showError,
  recoverManager: () => {
    // 尝试重新初始化 SFTP 管理器
    initializeSftpManager(effectiveSessionId.value, props.instanceId);
    return currentSftpManager.value !== null;
  },
});

// +++ 压缩/解压处理函数 +++
const handleCompress = (items: FileListItem[], format: CompressFormat) => {
  if (!currentSftpManager.value) {
    log.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot compress: SFTP manager not available.`,
    );
    uiNotificationsStore.showError(t('fileManager.errors.sftpManagerUnavailable'));
    return;
  }
  log.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Requesting compression for ${items.length} items, format: ${format}`,
  );
  // 调用 SFTP 管理器上的新方法 (将在 useSftpActions.ts 中实现)
  currentSftpManager.value.compressItems(items, format);
};

const handleDecompress = (item: FileListItem) => {
  if (!currentSftpManager.value) {
    log.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot decompress: SFTP manager not available.`,
    );
    uiNotificationsStore.showError(t('fileManager.errors.sftpManagerUnavailable'));
    return;
  }
  log.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Requesting decompression for item: ${item.filename}`,
  );
  // 调用 SFTP 管理器上的新方法 (将在 useSftpActions.ts 中实现)
  currentSftpManager.value.decompressItem(item);
};

// +++ 复制路径到剪贴板 +++
const handleCopyPath = async (item: FileListItem) => {
  if (!currentSftpManager.value) return;
  const fullPath = currentSftpManager.value.joinPath(
    currentSftpManager.value.currentPath.value,
    item.filename,
  );
  try {
    await navigator.clipboard.writeText(fullPath);
    // 可选：显示成功通知
    log.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Copied path to clipboard: ${fullPath}`,
    );
    uiNotificationsStore.showSuccess(
      t('fileManager.notifications.pathCopied', 'Path copied to clipboard'),
    );
  } catch (err: unknown) {
    log.error(`[FileManager ${props.sessionId}-${props.instanceId}] Failed to copy path: `, err);
    // 可选：显示错误通知
    uiNotificationsStore.showError(t('fileManager.errors.copyPathFailed', 'Failed to copy path'));
  }
};

// --- 上下文菜单逻辑 (使用 Composable, 需要 Selection 和 Action Handlers) ---
const {
  contextMenuVisible,
  contextMenuPosition,
  contextMenuItems,
  contextMenuRef, // 获取 ref 以传递给子组件
  contextTargetItem, // Get the target item from the composable
  showContextMenu, // 使用 Composable 提供的函数
  hideContextMenu, // <-- 获取 hideContextMenu 函数
} = useFileManagerContextMenu({
  selectedItems,
  lastClickedIndex,
  // 修改：传递 manager 的 fileList 和 currentPath ref (保持 computed)
  fileList: computed(() => currentSftpManager.value?.fileList.value ?? []),
  currentPath: computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  isConnected: props.wsDeps.isConnected,
  isSftpReady: props.wsDeps.isSftpReady,
  clipboardState: readonly(clipboardState), // +++ 传递剪贴板状态 (只读) +++
  t,
  // --- 传递回调函数 ---
  // 修改：确保在调用前检查 currentSftpManager.value
  onRefresh: () => {
    if (currentSftpManager.value) {
      currentSftpManager.value.loadDirectory(currentSftpManager.value.currentPath.value, true);
    }
  },
  onUpload: triggerFileUpload,
  onUploadFolder: triggerFolderUpload,
  onDownload: triggerDownload,
  onDelete: handleDeleteSelectedClick,
  onRename: handleRenameContextMenuClick,
  onChangePermissions: handleChangePermissionsContextMenuClick,
  onNewFolder: handleNewFolderContextMenuClick,
  onNewFile: handleNewFileContextMenuClick,
  onCopy: handleCopy, // +++ 传递复制回调 +++
  onCut: handleCut, // +++ 传递剪切回调 +++
  onPaste: handlePaste, // +++ 传递粘贴回调 +++
  onDownloadDirectory: triggerDownloadDirectory, // +++ 传递文件夹下载回调 +++
  // +++ 传递压缩/解压回调 +++
  onCompressRequest: handleCompress,
  onDecompressRequest: handleDecompress,
  onCopyPath: handleCopyPath, // +++ 传递复制路径回调 +++
});

// --- 目录加载与导航 ---
// loadDirectory is provided by props.sftpManager

// --- 拖放逻辑 (使用 Composable) ---
const {
  // isDraggingOver, // 不再直接使用容器的悬停状态
  showExternalDropOverlay, // 控制蒙版显示
  dragOverTarget, // 行拖拽悬停目标 (内部)
  // draggedItem, // 内部状态，不需要在 FileManager 中直接使用
  // --- 事件处理器 ---
  handleDragEnter,
  handleDragOver, // 容器的 dragover (主要处理内部滚动)
  handleDragLeave,
  handleDrop, // 容器的 drop (主要用于清理)
  handleOverlayDrop, // 蒙版的 drop
  handleDragStart,
  handleDragEnd,
  handleDragOverRow,
  handleDragLeaveRow,
  handleDropOnRow,
} = useFileManagerDragAndDrop({
  isConnected: computed(() => props.wsDeps.isConnected.value),
  // 修改：传递 manager 的 currentPath (保持 computed)
  currentPath: computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  fileListContainerRef: fileListContainerRef,
  // 修改：传递一个包装函数给 joinPath
  joinPath: (base: string, target: string): string => {
    return (
      currentSftpManager.value?.joinPath(base, target) ?? `${base}/${target}`.replace(/\/+/g, '/')
    ); // 提供简单的默认实现
  },
  onFileUpload: startFileUpload,
  // 修改：确保在调用前检查 currentSftpManager.value
  onItemMove: (item, newName) => {
    currentSftpManager.value?.renameItem(item, newName);
  },
  selectedItems: selectedItems,
  // 修改：传递 manager 的 fileList ref (保持 computed)
  fileList: computed(() => currentSftpManager.value?.fileList.value ?? []),
});

// --- 文件上传逻辑 (handleFileSelected 保持在此处，由 triggerFileUpload 调用) ---
const handleFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files || !props.wsDeps.isConnected.value || !props.wsDeps.isSftpReady.value) return;
  Array.from(input.files).forEach((file) => {
    startFileUpload(file);
  });
  input.value = '';
};

// --- 文件夹上传逻辑 (handleFolderSelected 由 triggerFolderUpload 调用) ---
const handleFolderSelected = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files || !props.wsDeps.isConnected.value || !props.wsDeps.isSftpReady.value) return;
  // 提取 webkitRelativePath 作为相对路径，保留目录结构
  Array.from(input.files).forEach((file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    startFileUpload(file, relativePath || undefined);
  });
  input.value = '';
};

// --- 键盘导航逻辑 (使用 Composable) ---
const {
  selectedIndex, // 使用 Composable 返回的 selectedIndex
  handleKeydown, // 使用 Composable 返回的 handleKeydown
} = useFileManagerKeyboardNavigation({
  filteredFileList: filteredFileList,
  // 修改：传递 manager 的 currentPath ref
  currentPath: computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  fileListContainerRef: fileListContainerRef,
  // Enter 保持原有行为：直接触发打开/进入动作
  onEnterPress: (item) => handleItemAction(item),
  scrollTo: scrollToForKeyboardNavigation, // 传递虚拟滚动的 scrollTo 函数（键盘索引 -> 虚拟列表索引）
});

// --- 重置选中索引和清空选择的 Watchers ---
// 修改：监听 manager 的 currentPath
watch(
  () => currentSftpManager.value?.currentPath.value,
  () => {
    selectedIndex.value = -1;
    clearSelection();
  },
);
watch(searchQuery, () => {
  selectedIndex.value = -1;
  clearSelection(); // 清空选择
});
watch(sortKey, () => {
  selectedIndex.value = -1;
  clearSelection(); // 清空选择
});
watch(sortDirection, () => {
  selectedIndex.value = -1;
  clearSelection(); // 清空选择
});

// --- 生命周期钩子 ---
onMounted(() => {
  // --- 移除 onMounted 中的加载逻辑 ---
  // Initial load logic is handled by watchEffect below and the main sftp loading watchEffect
});

// 布局设置同步逻辑已提取至 useFileManagerLayoutSettings composable

// 使用 watchEffect 监听连接和 SFTP 就绪状态以触发初始加载
// 恢复使用 props.wsDeps
watchEffect((onCleanup) => {
  let unregisterSuccess: (() => void) | undefined;
  let unregisterError: (() => void) | undefined;
  let timeoutId: NodeJS.Timeout | number | undefined; // 修正类型以兼容 Node 和浏览器环境

  const cleanupListeners = () => {
    unregisterSuccess?.();
    unregisterError?.();
    if (timeoutId) clearTimeout(timeoutId);
    // isFetchingInitialPath 状态移除
  };

  onCleanup(cleanupListeners);

  // 修改：添加 ?. 访问 isLoading, 检查 manager 的 initialLoadDone
  // 只有在连接就绪、SFTP 就绪、管理器存在、未加载且 initialLoadDone 为 false 时才获取初始路径
  if (
    currentSftpManager.value &&
    props.wsDeps.isConnected.value &&
    props.wsDeps.isSftpReady.value &&
    !currentSftpManager.value.isLoading.value &&
    !currentSftpManager.value.initialLoadDone.value
  ) {
    log.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Connection ready for manager, fetching initial path for the first time (isLoading: ${currentSftpManager.value.isLoading.value}, initialLoadDone: ${currentSftpManager.value.initialLoadDone.value}).`,
    );
    // isFetchingInitialPath 状态移除, 使用 isLoading 状态

    // 仍然使用 props.wsDeps 中的 sendMessage 和 onMessage
    const { sendMessage: wsSend, onMessage: wsOnMessage } = props.wsDeps;
    const requestId = generateRequestId(); // 使用本地辅助函数
    const requestedPath = '.';

    unregisterSuccess = wsOnMessage(
      'sftp:realpath:success',
      (payload: MessagePayload, message: WebSocketMessage) => {
        if (!payload || typeof payload === 'string') return;
        const p = payload as SftpRealpathPayload;
        // message 已有类型
        if (message.requestId === requestId && p.requestedPath === requestedPath) {
          // 修改：检查 currentSftpManager 是否存在
          if (!currentSftpManager.value) return;
          const absolutePath = p.absolutePath;
          if (!absolutePath) {
            log.error(
              `[FileManager ${props.sessionId}-${props.instanceId}] Missing absolutePath for initial realpath response.`,
              payload,
            );
            cleanupListeners();
            return;
          }
          log.info(
            `[FileManager ${props.sessionId}-${props.instanceId}] Received initial absolute path for '.': ${absolutePath}. Loading directory.`,
          );
          // 修改：添加 ?. 访问 loadDirectory 和 setInitialLoadDone
          currentSftpManager.value?.loadDirectory(absolutePath);
          currentSftpManager.value?.setInitialLoadDone(true); // 设置 manager 内部状态
          cleanupListeners();
        }
      },
    );

    unregisterError = wsOnMessage(
      'sftp:realpath:error',
      (payload: MessagePayload, message: WebSocketMessage) => {
        if (!payload || typeof payload === 'string') return;
        const p = payload as SftpRealpathPayload;
        // message 已有类型
        // 修改：使用 payload.requestedPath (如果存在) 或 message.requestId 匹配
        if (message.requestId === requestId && p?.requestedPath === requestedPath) {
          log.error(
            `[FileManager ${props.sessionId}-${props.instanceId}] Failed to get realpath for '${requestedPath}':`,
            payload,
          );
          // 获取 realpath 失败时仅记录日志，标记初始加载完成以避免重复尝试
          currentSftpManager.value?.setInitialLoadDone(true);
          cleanupListeners();
        }
      },
    );

    log.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Sending initial sftp:realpath request (ID: ${requestId}) for path: ${requestedPath}`,
    );
    wsSend({ type: 'sftp:realpath', requestId: requestId, payload: { path: requestedPath } });

    timeoutId = setTimeout(() => {
      log.error(
        `[FileManager ${props.sessionId}-${props.instanceId}] Timeout getting initial realpath for '.' (ID: ${requestId}).`,
      );
      // 超时也标记初始加载尝试完成
      currentSftpManager.value?.setInitialLoadDone(true);
      cleanupListeners();
    }, 10000); // 10 秒超时
  } else if (
    currentSftpManager.value &&
    props.wsDeps.isConnected.value &&
    props.wsDeps.isSftpReady.value &&
    currentSftpManager.value.initialLoadDone.value
  ) {
    // 连接恢复，并且之前已经加载过 (initialLoadDone is true)
    // 显式地重新加载管理器中记录的当前路径，以防内部状态被重置
    const pathBeforeReconnect = currentSftpManager.value.currentPath.value;
    // 防止 watchEffect 因响应式依赖变化重复触发：同一路径只重载一次
    if (pathBeforeReconnect !== lastReconnectPath.value) {
      lastReconnectPath.value = pathBeforeReconnect;
      log.info(
        `[FileManager ${props.sessionId}-${props.instanceId}] Connection re-established. Explicitly reloading previous path: ${pathBeforeReconnect}`,
      );
      // 检查是否正在加载，避免并发请求
      if (!currentSftpManager.value.isLoading.value) {
        currentSftpManager.value.loadDirectory(pathBeforeReconnect, false);
      } else {
        log.info(
          `[FileManager ${props.sessionId}-${props.instanceId}] SFTP manager is currently loading, skipping explicit path reload on reconnect.`,
        );
      }
    }
    cleanupListeners(); // 清理可能存在的旧监听器
  } else if (!props.wsDeps.isConnected.value && currentSftpManager.value?.initialLoadDone.value) {
    // 检查 manager 的 initialLoadDone
    // 连接丢失，不需要重置 initialLoadDone，因为我们希望在重连时恢复状态
    // 只需要清理监听器
    log.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Connection lost (was previously loaded).`,
    );
    // clearSelection(); // 可以在连接丢失时不清空选择，看产品需求
    // currentSftpManager.value?.setInitialLoadDone(false); // 不再重置，保持状态
    cleanupListeners();
  }

  // 重映射标志在此 watchEffect 触发后重置
  // 确保 isSftpReady watcher 在重映射时跳过，但后续重连时正常工作
  if (justRemapped.value) {
    justRemapped.value = false;
  }
});

// --- 搜索激活触发器监听已提取至 useFileManagerSearch composable ---

// --- 监听 sessionId prop 的变化 ---
// 标签切换时不销毁旧 session 的 SFTP 管理器，保留路径状态
// getOrCreateSftpManager 会直接返回已存在的实例（含保留的路径）
watch(
  () => props.sessionId,
  (newSessionId, oldSessionId) => {
    if (newSessionId && newSessionId !== oldSessionId) {
      cancelPathEdit(); // 关闭路径编辑、历史下拉、并重置 editablePath
      pathHistoryStore.setSearchTerm(''); // 清空搜索词
      // 不再销毁旧 session 的 SFTP 管理器，保留其路径状态供后续切换恢复
      // 1. 同步 effectiveSessionId
      effectiveSessionId.value = newSessionId;
      // 2. 获取或创建 SFTP 管理器（如果已存在则直接返回，路径自动保留）
      initializeSftpManager(newSessionId, props.instanceId);

      // 3. 重置 UI 状态
      clearSelection();
      searchQuery.value = '';
      isSearchActive.value = false;
      sortKey.value = 'filename'; // 重置排序
      sortDirection.value = 'asc';
    }
  },
  { immediate: false },
); // immediate: false 避免初始挂载时触发

// +++ 注册/注销自定义聚焦动作 +++
let unregisterSearchFocusAction: (() => void) | null = null; // 搜索框注销函数
let unregisterPathFocusAction: (() => void) | null = null; // 路径编辑框注销函数

onMounted(() => {
  // 注册搜索框聚焦动作
  const focusSearchActionWrapper = async (): Promise<boolean | undefined> => {
    if (effectiveSessionId.value === sessionStore.activeSessionId) {
      log.info(
        `[FileManager ${effectiveSessionId.value}-${props.instanceId}] Executing search focus action for active session.`,
      );
      closePathHistory(); // Close path history if open
      return focusSearchInput();
    } else {
      log.info(
        `[FileManager ${effectiveSessionId.value}-${props.instanceId}] Search focus action skipped for inactive session.`,
      );
      return undefined;
    }
  };
  unregisterSearchFocusAction = focusSwitcherStore.registerFocusAction(
    'fileManagerSearch',
    focusSearchActionWrapper,
  );

  // 注册路径编辑框聚焦动作
  const focusPathActionWrapper = async (): Promise<boolean | undefined> => {
    if (effectiveSessionId.value === sessionStore.activeSessionId) {
      log.info(
        `[FileManager ${effectiveSessionId.value}-${props.instanceId}] Executing path edit focus action for active session.`,
      );
      // startPathEdit 本身不是 async，但注册时需要包装成 async 以匹配类型
      startPathEdit(); // 调用暴露的方法
      return true;
    } else {
      log.info(
        `[FileManager ${effectiveSessionId.value}-${props.instanceId}] Path edit focus action skipped for inactive session.`,
      );
      return undefined;
    }
  };
  unregisterPathFocusAction = focusSwitcherStore.registerFocusAction(
    'fileManagerPathInput',
    focusPathActionWrapper,
  );
});

onBeforeUnmount(() => {
  // 注销搜索框动作
  if (unregisterSearchFocusAction) {
    unregisterSearchFocusAction();
    log.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Unregistered search focus action on unmount.`,
    );
  }
  unregisterSearchFocusAction = null;

  // 注销路径编辑框动作
  if (unregisterPathFocusAction) {
    unregisterPathFocusAction();
    log.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Unregistered path edit focus action on unmount.`,
    );
  }
  unregisterPathFocusAction = null;
  cleanupSilentExecRequest();
  isSyncingPathFromTerminal.value = false;
  // 注销 session:remapped 事件监听
  unsubscribeFromWorkspaceEvents('session:remapped', _onSessionRemapped);
  sessionStore.removeSftpManager(effectiveSessionId.value, props.instanceId);
});

// 拖拽蒙版逻辑已移至子组件 FileManagerFileList 内部处理

// --- 列宽调整逻辑已提取至 useFileManagerColumnResize composable ---

// --- 路径编辑逻辑已提取至 useFileManagerPathNavigation composable ---

// --- 搜索框激活/取消逻辑已提取至 useFileManagerSearch composable ---

// --- 终端同步逻辑已提取至 useFileManagerTerminalSync composable ---

// --- 打开弹窗编辑器的方法 ---
const openPopupEditor = () => {
  if (!props.sessionId) {
    log.error('[FileManager] Cannot open popup editor: Missing session ID.');
    // 可以添加 UI 通知
    return;
  }
  log.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Triggering popup editor without specific file.`,
  );
  fileEditorStore.triggerPopup('', props.sessionId); // 修复：使用空字符串触发空编辑器
};
// --- 行大小调整逻辑已提取至 useFileManagerLayoutSettings composable ---

// --- 聚焦搜索框的方法已提取至 useFileManagerSearch composable ---
// --- 工具栏关闭路径历史回调 ---
const handleClosePathHistoryFromToolbar = () => {
  cancelPathEdit();
};

// --- 返回上级目录（供工具栏使用）---
const handleGoToParent = () => {
  if (!currentSftpManager.value || currentSftpManager.value.isLoading.value) return;
  const currentPath = currentSftpManager.value.currentPath.value;
  if (currentPath === '/') return;
  handleItemClick({} as MouseEvent, {
    filename: '..',
    longname: '..',
    attrs: {
      isDirectory: true,
      isFile: false,
      isSymbolicLink: false,
      size: 0,
      uid: 0,
      gid: 0,
      mode: 0,
      atime: 0,
      mtime: 0,
    },
  });
};

defineExpose({ focusSearchInput, startPathEdit });

// --- 处理'打开编辑器'按钮点击 ---
const handleOpenEditorClick = () => {
  if (!props.sessionId) {
    log.error(`[FileManager ${props.instanceId}] Cannot open editor: Missing session ID.`);
    uiNotificationsStore.showError(t('fileManager.errors.missingSessionId'));
    return;
  }
  log.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Triggering popup editor directly.`,
  );
  fileEditorStore.triggerPopup('', props.sessionId); // 修复：传递空字符串而不是 null
};

// +++ 收藏路径导航（走路径导航 composable，记录历史）+++
const handleNavigateToPathFromFavorites = (path: string) => {
  navigateToPath(path);
};
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-background text-foreground text-sm font-sans">
    <!-- 隐藏的文件选择输入框，由 triggerFileUpload 触发 -->
    <input ref="fileInputRef" type="file" multiple class="hidden" @change="handleFileSelected" />
    <!-- 隐藏的文件夹选择输入框，由 triggerFolderUpload 触发 -->
    <input
      ref="folderInputRef"
      type="file"
      multiple
      webkitdirectory
      class="hidden"
      @change="handleFolderSelected"
    />
    <FileManagerToolbar
      ref="toolbarRef"
      :current-path="currentSftpManager?.currentPath?.value ?? '/'"
      :is-editing-path="isEditingPath"
      :editable-path="editablePath"
      :search-query="searchQuery"
      :is-search-active="isSearchActive"
      :is-mobile="props.isMobile"
      :is-connected="!!currentSftpManager && props.wsDeps.isConnected.value"
      :is-sftp-ready="!!currentSftpManager && props.wsDeps.isSftpReady.value"
      :is-loading="!currentSftpManager || currentSftpManager.isLoading.value"
      :is-syncing-from-terminal="isSyncingPathFromTerminal"
      :is-at-root="currentSftpManager?.currentPath?.value === '/'"
      :show-popup-editor="showPopupFileEditorBoolean"
      :is-multi-select-mode="isMultiSelectMode"
      :show-path-history-dropdown="showPathHistoryDropdown"
      :path-selected-index="pathSelectedIndex"
      :filtered-path-history="filteredPathHistory"
      @cd-to-terminal="sendCdCommandToTerminal"
      @sync-from-terminal="syncCurrentPathToTerminalDirectory"
      @refresh="
        currentSftpManager?.loadDirectory(currentSftpManager?.currentPath?.value ?? '/', true)
      "
      @go-to-parent="handleGoToParent"
      @activate-search="activateSearch"
      @deactivate-search="deactivateSearch"
      @cancel-search="cancelSearch"
      @update:search-query="
        (v: string) => {
          searchQuery = v;
        }
      "
      @update:editable-path="
        (v: string) => {
          editablePath = v;
          pathHistoryStore.setSearchTerm(v);
        }
      "
      @start-path-edit="startPathEdit"
      @path-input-focus="handlePathInputFocus"
      @path-input-keydown="handlePathInputKeydown"
      @path-selected="handlePathSelectedFromDropdown"
      @close-path-history="handleClosePathHistoryFromToolbar"
      @navigate-to-favorite="handleNavigateToPathFromFavorites"
      @open-popup-editor="openPopupEditor"
      @trigger-file-upload="triggerFileUpload"
      @trigger-folder-upload="triggerFolderUpload"
      @new-folder="handleNewFolderContextMenuClick"
      @new-file="handleNewFileContextMenuClick"
      @toggle-multi-select="toggleMultiSelectMode"
      @search-keydown="handleKeydown"
    />
    <!-- 文件列表子组件 -->
    <FileManagerFileList
      ref="fileListRef"
      :files="filteredFileList"
      :has-parent-link="currentSftpManager ? currentSftpManager.currentPath.value !== '/' : false"
      :sort-key="sortKey"
      :sort-direction="sortDirection"
      :selected-items="selectedItems"
      :selected-index="selectedIndex"
      :is-mobile="props.isMobile"
      :col-widths="colWidths"
      :row-size-multiplier="rowSizeMultiplier"
      :is-loading="!currentSftpManager || currentSftpManager.isLoading.value"
      :search-query="searchQuery"
      :is-multi-select-mode="isMultiSelectMode"
      :show-external-drop-overlay="showExternalDropOverlay"
      :drag-over-target="dragOverTarget"
      @sort="handleSort"
      @item-click="handleItemClick"
      @item-double-click="handleItemDoubleClick"
      @item-long-press="handleItemLongPress"
      @context-menu="showContextMenu"
      @start-resize="startResize"
      @drag-enter="handleDragEnter"
      @drag-over="handleDragOver"
      @drag-leave="handleDragLeave"
      @drop="handleDrop"
      @overlay-drop="handleOverlayDrop"
      @drag-start="handleDragStart"
      @drag-end="handleDragEnd"
      @drag-over-row="handleDragOverRow"
      @drag-leave-row="handleDragLeaveRow"
      @drop-on-row="handleDropOnRow"
      @wheel="handleWheel"
      @keydown="handleKeydown"
    />

    <!-- 使用 FileUploadPopup 组件 -->
    <FileUploadPopup :uploads="uploads" @cancel-upload="cancelUpload" />

    <FileManagerContextMenu
      ref="contextMenuRef"
      :is-visible="contextMenuVisible"
      :position="contextMenuPosition"
      :items="contextMenuItems"
      :active-context-item="contextTargetItem"
      :selected-file-items="computedSelectedFullItems"
      :current-directory-path="currentSftpManager?.currentPath?.value ?? '/'"
      @close-request="hideContextMenu"
    />

    <!-- Action Modal -->
    <FileManagerActionModal
      :is-visible="isActionModalVisible"
      :action-type="currentActionType"
      :item="actionItem"
      :items="actionItems"
      :initial-value="actionInitialValue"
      @close="handleModalClose"
      @confirm="handleModalConfirm"
    />

    <!-- Favorite Paths Modal is now positioned near its button -->
  </div>
</template>

<style scoped>
/* Scoped styles removed for Tailwind CSS refactoring */
</style>
