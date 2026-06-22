<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useLayoutStore, type LayoutNode } from '../stores/layout.store';
import { useDeviceDetection } from '../composables/useDeviceDetection';
import { useVisualViewport } from '../composables/useVisualViewport';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import AddConnectionFormComponent from '../components/AddConnectionForm.vue';
import TerminalTabBar from '../components/TerminalTabBar.vue';
import LayoutRenderer from '../components/LayoutRenderer.vue';
import LayoutConfigurator from '../components/LayoutConfigurator.vue';
import Terminal from '../features/terminal/Terminal.vue';
import CommandInputBar from '../components/CommandInputBar.vue';
import VirtualKeyboard from '../components/VirtualKeyboard.vue';
import FileManagerModal from '../components/FileManagerModal.vue';
import { useSessionStore } from '../stores/session.store';
import { useSettingsStore } from '../stores/settings.store';
import { useFileEditorStore } from '../stores/fileEditor.store';
import { useCommandHistoryStore } from '../stores/commandHistory.store';
import { useWorkspaceEventSubscriber, useWorkspaceEventOff } from '../composables/workspaceEvents';
import { useTerminalEvents } from '../composables/useTerminalEvents';
import { useEditorEvents } from '../composables/useEditorEvents';
import { useWorkspaceSearch } from '../composables/useWorkspaceSearch';
import { useSessionTabActions } from '../composables/useSessionTabActions';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { log } from '@/utils/log';

// --- Setup ---
const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore(); // Keep settingsStore instance
const fileEditorStore = useFileEditorStore();
const layoutStore = useLayoutStore();
const commandHistoryStore = useCommandHistoryStore();
const connectionsStore = useConnectionsStore();
const uiNotificationsStore = useUiNotificationsStore();
const { isHeaderVisible } = storeToRefs(layoutStore);
const { isMobile } = useDeviceDetection();
const { isKeyboardOpen, keyboardHeight } = useVisualViewport();

// --- 从 Store 获取响应式状态和 Getters ---
const {
  sessionTabsWithStatus,
  activeSessionId,
  activeSession,
  isRdpModalOpen,
  rdpConnectionInfo,
  isVncModalOpen,
  vncConnectionInfo,
} = storeToRefs(sessionStore); // 使用 storeToRefs 获取 RDP 和 VNC 状态
const { shareFileEditorTabsBoolean, layoutLockedBoolean } = storeToRefs(settingsStore);
const { layoutTree } = storeToRefs(layoutStore);

// --- 计算属性 (用于动态绑定编辑器 Props) ---
// 这些计算属性现在需要传递给 LayoutRenderer

// +++ Add computed property for mobile terminal layout node +++
const mobileLayoutNodeForTerminal = computed((): LayoutNode | null => {
  return {
    id: 'mobile-main-terminal-pane',
    type: 'pane' as const,
    component: 'terminal' as const,
    size: 100,
  };
});

// --- UI 状态 (保持本地) ---
const showAddEditForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const showLayoutConfigurator = ref(false); // 控制布局配置器可见性
// 本地 RDP 状态已被移除

// --- Composables 初始化 ---
const { orderedTabs: fileEditorOrderedTabs, activeTabId: fileEditorActiveTabId } =
  storeToRefs(fileEditorStore);

const {
  editorTabs,
  activeEditorTabId,
  handleCloseEditorTab,
  handleActivateEditorTab,
  handleUpdateEditorContent,
  handleSaveEditorTab,
  handleChangeEncoding,
  handleChangeLineEnding,
  handleEditorScrollPositionUpdate,
  handleCloseOtherEditorTabs,
  handleCloseEditorTabsToRight,
  handleCloseEditorTabsToLeft,
} = useEditorEvents({
  fileEditorStore: {
    ...fileEditorStore,
    orderedTabs: fileEditorOrderedTabs,
    activeTabId: fileEditorActiveTabId,
  },
  sessionStore,
  activeSessionId,
  activeSession,
  shareFileEditorTabsBoolean,
});

const {
  handleSendCommand,
  handleTerminalInput,
  handleTerminalResize,
  handleTerminalReady,
  handleClearTerminal,
  handleScrollToBottomRequest,
  handleVirtualKeyPress,
  handleQuickCommandExecuteProcessed,
} = useTerminalEvents({
  sessionStore,
  connectionsStore,
  commandHistoryStore,
  activeSession,
  activeSessionId,
  isMobile,
  t,
});

const { handleSearch, handleFindNext, handleFindPrevious, handleCloseSearch } = useWorkspaceSearch({
  activeSession,
  isMobile,
});

const { handleCloseOtherSessions, handleCloseSessionsToRight, handleCloseSessionsToLeft } =
  useSessionTabActions({
    sessionStore,
    sessionTabsWithStatus,
  });

// --- 文件管理器模态框 ref ---
const fileManagerModalRef = ref<InstanceType<typeof FileManagerModal> | null>(null);

// --- 移动端状态 ---
const mobileTerminalRef = ref<InstanceType<typeof Terminal> | null>(null);
const isVirtualKeyboardVisible = ref(false);

// --- 处理全局键盘事件 ---
const handleGlobalKeyDown = (event: KeyboardEvent) => {
  // 检查是否按下了 Alt 键以及上/下箭头键
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault(); // 阻止默认行为 (例如页面滚动)

    const tabs = sessionTabsWithStatus.value;
    const currentId = activeSessionId.value;

    if (!tabs || tabs.length <= 1 || !currentId) {
      // 如果没有标签页、只有一个标签页或没有活动标签页，则不执行任何操作
      return;
    }

    const currentIndex = tabs.findIndex((tab) => tab.sessionId === currentId);
    if (currentIndex === -1) {
      // 如果找不到当前活动标签页 (理论上不应发生)，则不执行任何操作
      return;
    }

    let nextIndex: number;
    if (event.key === 'ArrowDown') {
      // Alt + 下箭头：切换到下一个标签页
      nextIndex = (currentIndex + 1) % tabs.length;
    } else {
      // Alt + 上箭头：切换到上一个标签页
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }

    const nextSessionId = tabs[nextIndex].sessionId;
    if (nextSessionId !== currentId) {
      log.info(`[WorkspaceView] Alt+${event.key} detected. Switching to session: ${nextSessionId}`);
      sessionStore.activateSession(nextSessionId);
    }
  }
};

// --- 事件处理器包装函数（确保 subscribe/unsubscribe 使用同一引用，避免 mitt 监听器泄漏） ---
const _onTerminalSendCommand = (payload: { command: string; sessionId?: string }) =>
  handleSendCommand(payload.command, payload.sessionId);
const _onEditorCloseTab = (payload: { tabId: string }) => handleCloseEditorTab(payload.tabId);
const _onEditorActivateTab = (payload: { tabId: string }) => handleActivateEditorTab(payload.tabId);
const _onEditorSaveTab = (payload: { tabId: string }) => handleSaveEditorTab(payload.tabId);
const _onEditorCloseOtherTabs = (payload: { tabId: string }) =>
  handleCloseOtherEditorTabs(payload.tabId);
const _onEditorCloseTabsToRight = (payload: { tabId: string }) =>
  handleCloseEditorTabsToRight(payload.tabId);
const _onEditorCloseTabsToLeft = (payload: { tabId: string }) =>
  handleCloseEditorTabsToLeft(payload.tabId);
const _onConnectionOpenNewSession = (payload: { connectionId: number }) =>
  handleOpenNewSession(payload.connectionId);
const _onConnectionRequestEdit = (payload: { connectionInfo: ConnectionInfo }) =>
  handleRequestEditConnection(payload.connectionInfo);
const _onSearchStart = (payload: { term: string }) => handleSearch(payload.term);
const _onSessionActivate = (payload: { sessionId: string }) =>
  sessionStore.activateSession(payload.sessionId);
const _onSessionClose = (payload: { sessionId: string }) => {
  fileManagerModalRef.value?.removeSession(payload.sessionId);
  sessionStore.closeSession(payload.sessionId);
};
const _onSessionCloseOthers = (payload: { targetSessionId: string }) =>
  handleCloseOtherSessions(payload.targetSessionId);
const _onSessionCloseToRight = (payload: { targetSessionId: string }) =>
  handleCloseSessionsToRight(payload.targetSessionId);
const _onSessionCloseToLeft = (payload: { targetSessionId: string }) =>
  handleCloseSessionsToLeft(payload.targetSessionId);
const _onFileManagerOpenModal = (payload: { sessionId: string }) =>
  fileManagerModalRef.value?.handleFileManagerOpenRequest(payload);

// --- 生命周期钩子 ---
onMounted(() => {
  log.info('[工作区视图] 组件已挂载。');
  // 添加键盘事件监听器
  window.addEventListener('keydown', handleGlobalKeyDown);
  // 确保布局已初始化 (layoutStore 内部会处理)

  // +++ 订阅工作区事件 +++
  subscribeToWorkspaceEvents('terminal:sendCommand', _onTerminalSendCommand);
  subscribeToWorkspaceEvents('terminal:input', handleTerminalInput);
  subscribeToWorkspaceEvents('terminal:resize', handleTerminalResize);
  subscribeToWorkspaceEvents('terminal:ready', handleTerminalReady);
  subscribeToWorkspaceEvents('terminal:clear', handleClearTerminal);
  subscribeToWorkspaceEvents('terminal:scrollToBottomRequest', handleScrollToBottomRequest);

  subscribeToWorkspaceEvents('editor:closeTab', _onEditorCloseTab);
  subscribeToWorkspaceEvents('editor:activateTab', _onEditorActivateTab);
  subscribeToWorkspaceEvents('editor:updateContent', handleUpdateEditorContent);
  subscribeToWorkspaceEvents('editor:saveTab', _onEditorSaveTab);
  subscribeToWorkspaceEvents('editor:changeEncoding', handleChangeEncoding);
  subscribeToWorkspaceEvents('editor:changeLineEnding', handleChangeLineEnding);
  subscribeToWorkspaceEvents('editor:closeOtherTabs', _onEditorCloseOtherTabs);
  subscribeToWorkspaceEvents('editor:closeTabsToRight', _onEditorCloseTabsToRight);
  subscribeToWorkspaceEvents('editor:closeTabsToLeft', _onEditorCloseTabsToLeft);
  subscribeToWorkspaceEvents('editor:updateScrollPosition', handleEditorScrollPositionUpdate); // +++ 订阅滚动位置更新事件 +++

  // 移除对 connection:connect 事件的监听，以避免重复创建会话
  // subscribeToWorkspaceEvents('connection:connect', (payload) => handleConnectRequest(payload.connectionId));
  subscribeToWorkspaceEvents('connection:openNewSession', _onConnectionOpenNewSession);
  subscribeToWorkspaceEvents('connection:requestAdd', handleRequestAddConnection);
  subscribeToWorkspaceEvents('connection:requestEdit', _onConnectionRequestEdit);

  subscribeToWorkspaceEvents('search:start', _onSearchStart);
  subscribeToWorkspaceEvents('search:findNext', handleFindNext);
  subscribeToWorkspaceEvents('search:findPrevious', handleFindPrevious);
  subscribeToWorkspaceEvents('search:close', handleCloseSearch);

  // 来自 TerminalTabBar 的事件
  subscribeToWorkspaceEvents('session:activate', _onSessionActivate);
  subscribeToWorkspaceEvents('session:close', _onSessionClose);
  subscribeToWorkspaceEvents('session:closeOthers', _onSessionCloseOthers);
  subscribeToWorkspaceEvents('session:closeToRight', _onSessionCloseToRight);
  subscribeToWorkspaceEvents('session:closeToLeft', _onSessionCloseToLeft);
  subscribeToWorkspaceEvents('ui:openLayoutConfigurator', handleOpenLayoutConfigurator);
  subscribeToWorkspaceEvents('fileManager:openModalRequest', _onFileManagerOpenModal);
  subscribeToWorkspaceEvents('quickCommand:executeProcessed', handleQuickCommandExecuteProcessed);
});

onBeforeUnmount(() => {
  log.info('[工作区视图] 组件即将卸载，清理所有会话...');
  // 移除键盘事件监听器
  window.removeEventListener('keydown', handleGlobalKeyDown);
  sessionStore.cleanupAllSessions();

  // +++ 取消订阅工作区事件 +++
  unsubscribeFromWorkspaceEvents('terminal:sendCommand', _onTerminalSendCommand);
  unsubscribeFromWorkspaceEvents('terminal:input', handleTerminalInput);
  unsubscribeFromWorkspaceEvents('terminal:resize', handleTerminalResize);
  unsubscribeFromWorkspaceEvents('terminal:ready', handleTerminalReady);
  unsubscribeFromWorkspaceEvents('terminal:clear', handleClearTerminal);
  unsubscribeFromWorkspaceEvents('terminal:scrollToBottomRequest', handleScrollToBottomRequest);

  unsubscribeFromWorkspaceEvents('editor:closeTab', _onEditorCloseTab);
  unsubscribeFromWorkspaceEvents('editor:activateTab', _onEditorActivateTab);
  unsubscribeFromWorkspaceEvents('editor:updateContent', handleUpdateEditorContent);
  unsubscribeFromWorkspaceEvents('editor:saveTab', _onEditorSaveTab);
  unsubscribeFromWorkspaceEvents('editor:changeEncoding', handleChangeEncoding);
  unsubscribeFromWorkspaceEvents('editor:changeLineEnding', handleChangeLineEnding);
  unsubscribeFromWorkspaceEvents('editor:closeOtherTabs', _onEditorCloseOtherTabs);
  unsubscribeFromWorkspaceEvents('editor:closeTabsToRight', _onEditorCloseTabsToRight);
  unsubscribeFromWorkspaceEvents('editor:closeTabsToLeft', _onEditorCloseTabsToLeft);
  unsubscribeFromWorkspaceEvents('editor:updateScrollPosition', handleEditorScrollPositionUpdate); // +++ 取消订阅滚动位置更新事件 +++

  // 移除对 connection:connect 事件的监听，以避免重复创建会话
  // unsubscribeFromWorkspaceEvents('connection:connect', (payload) => handleConnectRequest(payload.connectionId));
  unsubscribeFromWorkspaceEvents('connection:openNewSession', _onConnectionOpenNewSession);
  unsubscribeFromWorkspaceEvents('connection:requestAdd', handleRequestAddConnection);
  unsubscribeFromWorkspaceEvents('connection:requestEdit', _onConnectionRequestEdit);

  unsubscribeFromWorkspaceEvents('search:start', _onSearchStart);
  unsubscribeFromWorkspaceEvents('search:findNext', handleFindNext);
  unsubscribeFromWorkspaceEvents('search:findPrevious', handleFindPrevious);
  unsubscribeFromWorkspaceEvents('search:close', handleCloseSearch);

  unsubscribeFromWorkspaceEvents('session:activate', _onSessionActivate);
  unsubscribeFromWorkspaceEvents('session:close', _onSessionClose);
  unsubscribeFromWorkspaceEvents('session:closeOthers', _onSessionCloseOthers);
  unsubscribeFromWorkspaceEvents('session:closeToRight', _onSessionCloseToRight);
  unsubscribeFromWorkspaceEvents('session:closeToLeft', _onSessionCloseToLeft);
  unsubscribeFromWorkspaceEvents('ui:openLayoutConfigurator', handleOpenLayoutConfigurator);
  unsubscribeFromWorkspaceEvents('fileManager:openModalRequest', _onFileManagerOpenModal);
  unsubscribeFromWorkspaceEvents(
    'quickCommand:executeProcessed',
    handleQuickCommandExecuteProcessed,
  );
});

const subscribeToWorkspaceEvents = useWorkspaceEventSubscriber(); // +++ 定义订阅和取消订阅函数 +++
const unsubscribeFromWorkspaceEvents = useWorkspaceEventOff();

// --- 本地方法 (仅处理 UI 状态) ---
const handleRequestAddConnection = () => {
  log.info('[WorkspaceView] handleRequestAddConnection 被调用！');
  connectionToEdit.value = null;
  showAddEditForm.value = true;
};

const handleRequestEditConnection = (connection: ConnectionInfo) => {
  connectionToEdit.value = connection;
  showAddEditForm.value = true;
};

const handleFormClose = () => {
  showAddEditForm.value = false;
  connectionToEdit.value = null;
};

const handleConnectionAdded = () => {
  log.info('[工作区视图] 连接已添加');
  handleFormClose();
};

const handleConnectionUpdated = () => {
  log.info('[工作区视图] 连接已更新');
  handleFormClose();
};

// 处理打开和关闭布局配置器
const handleOpenLayoutConfigurator = () => {
  showLayoutConfigurator.value = true;
};
const handleCloseLayoutConfigurator = () => {
  showLayoutConfigurator.value = false;
};

// --- 连接列表操作处理 (保留于主组件) ---
const handleConnectRequest = (id: number) => {
  const connectionInfo = connectionsStore.connections.find((c) => c.id === id);
  // log.info(`[WorkspaceView] Received 'connect-request' event for ID: ${id}`); // 保留原始日志或移除
  if (connectionInfo) {
    sessionStore.handleConnectRequest(connectionInfo);
  } else {
    log.error(`[WorkspaceView] handleConnectRequest: Connection info not found for ID ${id}.`); // 保留错误日志
  }
};
const handleOpenNewSession = (id: number) => {
  log.info(`[WorkspaceView] Received 'open-new-session' event for ID: ${id}`);
  sessionStore.handleOpenNewSession(id);
};

// --- 虚拟键盘切换 (保留于主组件) ---
const toggleVirtualKeyboard = () => {
  isVirtualKeyboardVisible.value = !isVirtualKeyboardVisible.value;
};
</script>

<template>
  <!-- *** 动态 class 绑定，添加 is-mobile 类 *** -->
  <div :class="['workspace-view', { 'with-header': isHeaderVisible, 'is-mobile': isMobile }]">
    <!-- TerminalTabBar 始终渲染, 传递 isMobile 状态 -->
    <!-- TerminalTabBar 所有业务事件均通过 workspace event bus 发射，此处仅传递数据 props -->
    <TerminalTabBar
      :sessions="sessionTabsWithStatus"
      :active-session-id="activeSessionId"
      :is-mobile="isMobile"
    />

    <!-- --- 桌面端布局 --- -->
    <template v-if="!isMobile">
      <div class="main-content-area">
        <LayoutRenderer
          v-if="layoutTree"
          :is-root-renderer="true"
          :layout-node="layoutTree"
          :active-session-id="activeSessionId"
          :layout-locked="layoutLockedBoolean"
          class="layout-renderer-wrapper"
          :editor-tabs="editorTabs"
          :active-editor-tab-id="activeEditorTabId"
        ></LayoutRenderer>
        <div v-else class="pane-placeholder">
          {{ t('layout.loading', '加载布局中...') }}
        </div>
      </div>
    </template>

    <!-- --- 移动端布局 --- -->
    <template v-else>
      <div
        class="mobile-content-area"
        :style="
          isKeyboardOpen
            ? { height: `calc(100dvh - var(--header-height) - ${keyboardHeight}px)` }
            : {}
        "
      >
        <LayoutRenderer
          v-if="activeSessionId && mobileLayoutNodeForTerminal"
          :layout-node="mobileLayoutNodeForTerminal"
          :active-session-id="activeSessionId"
          :is-root-renderer="false"
          :layout-locked="layoutLockedBoolean"
          class="layout-renderer-wrapper flex-grow overflow-auto"
          :editor-tabs="editorTabs"
          :active-editor-tab-id="activeEditorTabId"
        />
        <div v-else class="pane-placeholder">
          {{ t('workspace.noActiveSession', '没有活动的会话') }}
        </div>
      </div>
      <CommandInputBar
        class="mobile-command-bar"
        :is-mobile="isMobile"
        @send-command="handleSendCommand"
        @search="handleSearch"
        @find-next="handleFindNext"
        @find-previous="handleFindPrevious"
        @close-search="handleCloseSearch"
        @clear-terminal="handleClearTerminal"
        :is-virtual-keyboard-visible="isVirtualKeyboardVisible"
        @toggle-virtual-keyboard="toggleVirtualKeyboard"
      />
      <!-- +++ Use v-show for VirtualKeyboard and bind visibility +++ -->
      <VirtualKeyboard
        v-show="isVirtualKeyboardVisible"
        class="mobile-virtual-keyboard"
        @send-key="handleVirtualKeyPress"
      />
    </template>

    <!-- Modals 保持不变，应在布局之外 -->
    <AddConnectionFormComponent
      v-if="showAddEditForm"
      :connection-to-edit="connectionToEdit"
      @close="handleFormClose"
      @connection-added="handleConnectionAdded"
      @connection-updated="handleConnectionUpdated"
    />

    <LayoutConfigurator
      :is-visible="showLayoutConfigurator"
      @close="handleCloseLayoutConfigurator"
    />

    <!-- RDP Modal is now rendered in App.vue -->
    <!-- VNC Modal is now rendered in App.vue -->

    <!-- FileManager Modal -->
    <FileManagerModal
      ref="fileManagerModalRef"
      :is-mobile="isMobile"
      :get-session="(id: string) => sessionStore.sessions.get(id)"
      :get-session-name="(id: string) => sessionStore.sessions.get(id)?.connectionName ?? id"
      :show-error="(msg: string) => uiNotificationsStore.showError(msg)"
      :t="t"
    />
  </div>
</template>

<style scoped>
.workspace-view {
  display: flex;
  background-color: transparent;
  flex-direction: column;
  height: 100vh; /* 兜底：旧版浏览器不支持 dvh */
  height: 100dvh; /* 动态视口高度，解决移动端地址栏遮挡 */
  overflow: hidden;
  transition: height 0.3s ease;
}

/* 当 Header 可见时，调整高度 */
.workspace-view.with-header {
  height: calc(100vh - var(--header-height));
  height: calc(100dvh - var(--header-height));
}

.main-content-area {
  display: flex;
  flex: 1;
  overflow: hidden; /* Keep overflow hidden */
  border: 1px solid var(--border-color, #ccc); /* Use variable for border */
  border-top: none; /* Remove top border as it's handled by the tab bar */
  border-radius: 0 0 5px 5px; /* Top-left, Top-right, Bottom-right, Bottom-left */
  margin: var(--base-margin, 0.5rem); /* Add some margin around the content area */
  margin-top: 0; /* Remove top margin if tab bar is directly above */
}

.layout-renderer-wrapper {
  flex-grow: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 面板占位符样式 (用于加载或错误状态) */
.pane-placeholder {
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: var(--text-color-secondary); /* Use secondary text color variable */
  background-color: var(--header-bg-color); /* Use header background for slight contrast */
  font-size: 0.9em;
  padding: var(--base-padding); /* Use base padding variable */
}

/* --- Mobile Layout Styles --- */
.workspace-view.is-mobile {
  /* Ensure flex column layout */
  display: flex; /* Uncommented */
  flex-direction: column; /* Uncommented */
  /* Height is already handled by .workspace-view and .with-header */
}

.workspace-view.is-mobile .main-content-area {
  /* Hide the desktop content area in mobile view */
  display: none;
}

.mobile-content-area {
  display: flex;
  flex-direction: column;
  flex: 1; /* 填充父容器剩余空间（父容器已减去 header 高度） */
  overflow: hidden;
  position: relative;
  margin: 0;
  border: none;
  border-radius: 0;
  transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1); /* 匹配系统动画曲线 */
}

.mobile-terminal {
  flex-grow: 1; /* Terminal takes all available space in mobile-content-area */
  width: 100%;
  overflow: hidden;
}

.mobile-command-bar {
  flex-shrink: 0; /* Prevent command bar from shrinking */
  /* Add specific styles if needed, e.g., border-top */
  border-top: 1px solid var(--border-color, #ccc);
}

.mobile-virtual-keyboard {
  flex-shrink: 0; /* 防止虚拟键盘缩小 */
  width: 100%; /* 确保宽度为 100% */
  box-sizing: border-box; /* 边框和内边距包含在宽度内 */
  /* 可以添加更多样式，例如背景色、边框等 */
}
</style>
