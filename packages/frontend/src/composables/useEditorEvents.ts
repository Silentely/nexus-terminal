import { computed, type Ref } from 'vue';
import type { FileTab } from '../stores/fileEditor.store';
import { log } from '@/utils/log';

/**
 * @interface EditorEventsDependencies
 * @description 编辑器事件处理所需的外部依赖
 */
export interface EditorEventsDependencies {
  fileEditorStore: {
    closeTab: (tabId: string) => void;
    setActiveTab: (tabId: string) => void;
    updateFileContent: (tabId: string, content: string) => void;
    saveFile: (tabId: string) => void;
    changeEncoding: (tabId: string, encoding: string) => void;
    changeLineEnding: (tabId: string, lineEnding: 'lf' | 'crlf' | 'cr') => void;
    updateTabScrollPosition: (tabId: string, scrollTop: number, scrollLeft: number) => void;
    orderedTabs: Ref<FileTab[]>;
    activeTabId: Ref<string | null>;
  };
  sessionStore: {
    closeEditorTabInSession: (sessionId: string, tabId: string) => void;
    setActiveEditorTabInSession: (sessionId: string, tabId: string) => void;
    updateFileContentInSession: (sessionId: string, tabId: string, content: string) => void;
    saveFileInSession: (sessionId: string, tabId: string) => void;
    changeEncodingInSession: (sessionId: string, tabId: string, encoding: string) => void;
    changeLineEndingInSession: (
      sessionId: string,
      tabId: string,
      lineEnding: 'lf' | 'crlf' | 'cr',
    ) => void;
    updateTabScrollPositionInSession: (
      sessionId: string,
      tabId: string,
      scrollTop: number,
      scrollLeft: number,
    ) => void;
  };
  activeSessionId: Ref<string | null>;
  activeSession: Ref<{
    sessionId: string;
    editorTabs: Ref<FileTab[]>;
    activeEditorTabId: Ref<string | null>;
  } | null>;
  shareFileEditorTabsBoolean: Ref<boolean>;
}

/**
 * 编辑器事件处理 composable
 * 从 WorkspaceView.vue 提取的编辑器相关事件处理逻辑
 */
export function useEditorEvents(deps: EditorEventsDependencies) {
  const {
    fileEditorStore,
    sessionStore,
    activeSessionId,
    activeSession,
    shareFileEditorTabsBoolean,
  } = deps;

  /**
   * 计算属性：编辑器标签页列表（共享模式 vs 独立模式）
   */
  const editorTabs = computed((): FileTab[] => {
    if (shareFileEditorTabsBoolean.value) {
      return fileEditorStore.orderedTabs.value;
    } else {
      return activeSession.value?.editorTabs.value ?? [];
    }
  });

  /**
   * 计算属性：当前活动的编辑器标签页 ID
   */
  const activeEditorTabId = computed(() => {
    if (shareFileEditorTabsBoolean.value) {
      return fileEditorStore.activeTabId.value;
    } else {
      return activeSession.value?.activeEditorTabId.value ?? null;
    }
  });

  /**
   * 处理关闭编辑器标签页
   */
  const handleCloseEditorTab = (tabId: string) => {
    const isShared = shareFileEditorTabsBoolean.value;
    log.info(`[useEditorEvents] handleCloseEditorTab: ${tabId}, Shared mode: ${isShared}`);
    if (isShared) {
      fileEditorStore.closeTab(tabId);
    } else {
      const currentActiveSessionId = activeSessionId.value;
      if (currentActiveSessionId) {
        sessionStore.closeEditorTabInSession(currentActiveSessionId, tabId);
      } else {
        log.warn(
          '[useEditorEvents] Cannot close editor tab: No active session in independent mode.',
        );
      }
    }
  };

  /**
   * 处理激活编辑器标签页
   */
  const handleActivateEditorTab = (tabId: string) => {
    const isShared = shareFileEditorTabsBoolean.value;
    log.info(`[useEditorEvents] handleActivateEditorTab: ${tabId}, Shared mode: ${isShared}`);
    if (isShared) {
      fileEditorStore.setActiveTab(tabId);
    } else {
      const currentActiveSessionId = activeSessionId.value;
      if (currentActiveSessionId) {
        sessionStore.setActiveEditorTabInSession(currentActiveSessionId, tabId);
      } else {
        log.warn(
          '[useEditorEvents] Cannot activate editor tab: No active session in independent mode.',
        );
      }
    }
  };

  /**
   * 处理更新编辑器内容
   */
  const handleUpdateEditorContent = (payload: { tabId: string; content: string }) => {
    const isShared = shareFileEditorTabsBoolean.value;
    log.info(
      `[useEditorEvents] handleUpdateEditorContent for tab ${payload.tabId}, Shared mode: ${isShared}`,
    );
    if (isShared) {
      fileEditorStore.updateFileContent(payload.tabId, payload.content);
    } else {
      const currentActiveSessionId = activeSessionId.value;
      if (currentActiveSessionId) {
        sessionStore.updateFileContentInSession(
          currentActiveSessionId,
          payload.tabId,
          payload.content,
        );
      } else {
        log.warn(
          '[useEditorEvents] Cannot update editor content: No active session in independent mode.',
        );
      }
    }
  };

  /**
   * 处理保存编辑器标签页
   */
  const handleSaveEditorTab = (tabId: string) => {
    const isShared = shareFileEditorTabsBoolean.value;
    log.info(`[useEditorEvents] handleSaveEditorTab: ${tabId}, Shared mode: ${isShared}`);
    if (isShared) {
      fileEditorStore.saveFile(tabId);
    } else {
      const currentActiveSessionId = activeSessionId.value;
      if (currentActiveSessionId) {
        sessionStore.saveFileInSession(currentActiveSessionId, tabId);
      } else {
        log.warn(
          '[useEditorEvents] Cannot save editor tab: No active session in independent mode.',
        );
      }
    }
  };

  /**
   * 处理编辑器编码更改事件
   */
  const handleChangeEncoding = (payload: { tabId: string; encoding: string }) => {
    const isShared = shareFileEditorTabsBoolean.value;
    log.info(
      `[useEditorEvents] handleChangeEncoding for tab ${payload.tabId} to ${payload.encoding}, Shared mode: ${isShared}`,
    );
    if (isShared) {
      fileEditorStore.changeEncoding(payload.tabId, payload.encoding);
    } else {
      const currentActiveSessionId = activeSessionId.value;
      if (currentActiveSessionId) {
        sessionStore.changeEncodingInSession(
          currentActiveSessionId,
          payload.tabId,
          payload.encoding,
        );
      } else {
        log.warn(
          '[useEditorEvents] Cannot change editor encoding: No active session in independent mode.',
        );
      }
    }
  };

  /**
   * 处理编辑器换行符更改事件
   */
  const handleChangeLineEnding = (payload: { tabId: string; lineEnding: 'lf' | 'crlf' | 'cr' }) => {
    const isShared = shareFileEditorTabsBoolean.value;
    log.info(
      `[useEditorEvents] handleChangeLineEnding for tab ${payload.tabId} to ${payload.lineEnding}, Shared mode: ${isShared}`,
    );
    if (isShared) {
      fileEditorStore.changeLineEnding(payload.tabId, payload.lineEnding);
    } else {
      const currentActiveSessionId = activeSessionId.value;
      if (currentActiveSessionId) {
        sessionStore.changeLineEndingInSession(
          currentActiveSessionId,
          payload.tabId,
          payload.lineEnding,
        );
      } else {
        log.warn(
          '[useEditorEvents] Cannot change editor line ending: No active session in independent mode.',
        );
      }
    }
  };

  /**
   * 处理编辑器滚动位置更新事件
   */
  const handleEditorScrollPositionUpdate = (payload: {
    tabId: string;
    scrollTop: number;
    scrollLeft: number;
  }) => {
    const { tabId, scrollTop, scrollLeft } = payload;
    if (shareFileEditorTabsBoolean.value) {
      fileEditorStore.updateTabScrollPosition(tabId, scrollTop, scrollLeft);
    } else {
      const currentActiveSession = activeSession.value;
      if (currentActiveSession) {
        sessionStore.updateTabScrollPositionInSession(
          currentActiveSession.sessionId,
          tabId,
          scrollTop,
          scrollLeft,
        );
      } else {
        log.warn(
          '[useEditorEvents] Cannot update editor scroll position: No active session in independent mode for tab:',
          tabId,
        );
      }
    }
  };

  /**
   * 处理关闭其他编辑器标签页
   */
  const handleCloseOtherEditorTabs = (targetTabId: string) => {
    const tabsToClose = editorTabs.value
      .filter((tab) => tab.id !== targetTabId)
      .map((tab) => tab.id);
    tabsToClose.forEach((id) => handleCloseEditorTab(id));
  };

  /**
   * 处理关闭右侧编辑器标签页
   */
  const handleCloseEditorTabsToRight = (targetTabId: string) => {
    const targetIndex = editorTabs.value.findIndex((tab) => tab.id === targetTabId);
    if (targetIndex === -1) return;
    const tabsToClose = editorTabs.value.slice(targetIndex + 1).map((tab) => tab.id);
    tabsToClose.forEach((id) => handleCloseEditorTab(id));
  };

  /**
   * 处理关闭左侧编辑器标签页
   */
  const handleCloseEditorTabsToLeft = (targetTabId: string) => {
    const targetIndex = editorTabs.value.findIndex((tab) => tab.id === targetTabId);
    if (targetIndex === -1) return;
    const tabsToClose = editorTabs.value.slice(0, targetIndex).map((tab) => tab.id);
    tabsToClose.forEach((id) => handleCloseEditorTab(id));
  };

  return {
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
  };
}
