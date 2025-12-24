// packages/frontend/src/stores/session/actions/editorActions.ts

import type { useI18n } from 'vue-i18n';
import { sessions } from '../state';
import { getLanguageFromFilename, decodeRawContent } from '../utils';
import type { FileTab, SftpManagerInstance } from '../types';
import type { FileInfo } from '../../fileEditor.store'; // 路径: packages/frontend/src/stores/fileEditor.store.ts
import type { SftpReadFileSuccessPayload } from '../../../types/sftp.types'; // 路径: packages/frontend/src/types/sftp.types.ts

// --- Editor Actions ---
export const openFileInSession = (
  sessionId: string,
  fileInfo: FileInfo,
  dependencies: {
    getOrCreateSftpManager: (sessionId: string, instanceId: string) => SftpManagerInstance | null;
    t: ReturnType<typeof useI18n>['t'];
  }
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中打开文件`);
    return;
  }
  const { getOrCreateSftpManager, t } = dependencies;

  const existingTab = session.editorTabs.value.find((tab) => tab.filePath === fileInfo.fullPath);
  if (existingTab) {
    session.activeEditorTabId.value = existingTab.id;
    console.log(
      `[EditorActions] 会话 ${sessionId} 中已存在文件 ${fileInfo.fullPath} 的标签页，已激活: ${existingTab.id}`
    );
  } else {
    const newTabId = `${sessionId}:${fileInfo.fullPath}`; // 保证唯一性
    const newTab: FileTab = {
      id: newTabId,
      sessionId,
      filePath: fileInfo.fullPath,
      filename: fileInfo.name,
      content: '',
      originalContent: '',
      rawContentBase64: null,
      language: getLanguageFromFilename(fileInfo.name),
      selectedEncoding: 'utf-8',
      isLoading: true,
      loadingError: null,
      isSaving: false,
      saveStatus: 'idle',
      saveError: null,
      isModified: false,
    };
    session.editorTabs.value.push(newTab);
    session.activeEditorTabId.value = newTab.id;
    console.log(
      `[EditorActions] 已在会话 ${sessionId} 中为文件 ${fileInfo.fullPath} 创建新标签页: ${newTab.id}`
    );

    const loadContent = async () => {
      const tabRef = session.editorTabs.value.find((t) => t.id === newTab.id);
      if (!tabRef) return;

      // 使用 tabRef 更新，确保操作的是响应式对象内的属性
      tabRef.isLoading = true;
      tabRef.loadingError = null;

      try {
        const sftpManager = getOrCreateSftpManager(sessionId, 'primary-editor'); // 使用特定实例 ID
        if (!sftpManager) {
          throw new Error(t('fileManager.errors.sftpManagerNotFound'));
        }
        console.log(
          `[EditorActions ${sessionId}] 使用 primary-editor sftpManager 读取文件 ${fileInfo.fullPath}`
        );

        const fileData: SftpReadFileSuccessPayload = await sftpManager.readFile(fileInfo.fullPath);
        console.log(
          `[EditorActions ${sessionId}] 文件 ${fileInfo.fullPath} 读取成功。后端使用编码: ${fileData.encodingUsed}`
        );

        // 再次查找 tab，因为它可能在异步操作期间被关闭
        const currentTabState = session.editorTabs.value.find((t) => t.id === newTab.id);
        if (!currentTabState) return;

        const initialContent = decodeRawContent(fileData.rawContentBase64, fileData.encodingUsed);
        currentTabState.content = initialContent;
        currentTabState.originalContent = initialContent;
        currentTabState.rawContentBase64 = fileData.rawContentBase64;
        currentTabState.selectedEncoding = fileData.encodingUsed;
        currentTabState.isLoading = false;
        currentTabState.isModified = false;
        currentTabState.loadingError = null;
        console.log(
          `[EditorActions ${sessionId}] 文件 ${fileInfo.fullPath} 内容已加载并设置到标签页 ${newTab.id}。`
        );
      } catch (err: any) {
        console.error(`[EditorActions ${sessionId}] 读取文件 ${fileInfo.fullPath} 失败:`, err);
        const errorTabRef = session.editorTabs.value.find((t) => t.id === newTab.id);
        if (errorTabRef) {
          errorTabRef.isLoading = false;
          errorTabRef.loadingError = `${t('fileManager.errors.readFileFailed')}: ${err.message || err}`;
          errorTabRef.content = `// 加载错误: ${err.message || err}`;
        }
      }
    };
    loadContent();
  }
};

export const closeEditorTabInSession = async (
  sessionId: string,
  tabId: string,
  dependencies?: {
    showConfirmDialog?: (options: {
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
    }) => Promise<boolean>;
    t?: (key: string, defaultMessage: string) => string;
  }
): Promise<boolean> => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中关闭标签页 ${tabId}`);
    return false;
  }

  const tabIndex = session.editorTabs.value.findIndex((tab) => tab.id === tabId);
  if (tabIndex === -1) {
    console.warn(`[EditorActions] 尝试关闭会话 ${sessionId} 中不存在的标签页 ID: ${tabId}`);
    return false;
  }

  const tab = session.editorTabs.value[tabIndex];

  // 检查未保存更改
  if (tab.isModified && dependencies?.showConfirmDialog && dependencies?.t) {
    const shouldDiscard = await dependencies.showConfirmDialog({
      title: dependencies.t('editor.unsavedChanges.title', '未保存的更改'),
      message: dependencies.t(
        'editor.unsavedChanges.message',
        `文件 "${tab.filename}" 有未保存的更改。确定要丢弃这些更改吗？`
      ),
      confirmText: dependencies.t('editor.unsavedChanges.discard', '丢弃更改'),
      cancelText: dependencies.t('common.cancel', '取消'),
    });

    if (!shouldDiscard) {
      console.log(`[EditorActions] 用户取消关闭有未保存更改的标签页: ${tabId}`);
      return false;
    }
  }

  session.editorTabs.value.splice(tabIndex, 1);
  console.log(`[EditorActions] 已从会话 ${sessionId} 中移除标签页: ${tabId}`);

  if (session.activeEditorTabId.value === tabId) {
    const remainingTabs = session.editorTabs.value;
    const nextActiveTabId =
      remainingTabs.length > 0
        ? remainingTabs[Math.max(0, tabIndex > 0 ? tabIndex - 1 : 0)].id
        : null;
    session.activeEditorTabId.value = nextActiveTabId;
    console.log(`[EditorActions] 会话 ${sessionId} 关闭活动标签页后，切换到: ${nextActiveTabId}`);
  }
  return true;
};

export const setActiveEditorTabInSession = (sessionId: string, tabId: string) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中激活标签页 ${tabId}`);
    return;
  }

  if (session.editorTabs.value.some((tab) => tab.id === tabId)) {
    if (session.activeEditorTabId.value !== tabId) {
      session.activeEditorTabId.value = tabId;
      console.log(`[EditorActions] 已在会话 ${sessionId} 中激活标签页: ${tabId}`);
    }
  } else {
    console.warn(`[EditorActions] 尝试激活会话 ${sessionId} 中不存在的标签页 ID: ${tabId}`);
  }
};

export const updateFileContentInSession = (
  sessionId: string,
  tabId: string,
  newContent: string
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中更新标签页 ${tabId} 内容`);
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (tab && !tab.isLoading) {
    tab.content = newContent;
    tab.isModified = tab.content !== tab.originalContent;
    if (tab.saveStatus === 'success' || tab.saveStatus === 'error') {
      tab.saveStatus = 'idle';
      tab.saveError = null;
    }
  } else if (tab) {
    console.warn(`[EditorActions] 尝试更新正在加载的标签页 ${tabId} 的内容`);
  } else {
    console.warn(`[EditorActions] 尝试更新会话 ${sessionId} 中不存在的标签页 ${tabId} 的内容`);
  }
};

export const saveFileInSession = async (
  sessionId: string,
  tabId: string,
  dependencies: {
    getOrCreateSftpManager: (sessionId: string, instanceId: string) => SftpManagerInstance | null;
    t: ReturnType<typeof useI18n>['t'];
  }
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中保存标签页 ${tabId}`);
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (!tab) {
    console.warn(`[EditorActions] 尝试保存在会话 ${sessionId} 中不存在的标签页 ${tabId}`);
    return;
  }
  const { getOrCreateSftpManager, t } = dependencies;

  if (tab.isSaving || tab.isLoading || tab.loadingError || !tab.isModified) {
    console.warn(
      `[EditorActions] 保存条件不满足 for ${tab.filePath} (会话 ${sessionId})，无法保存。`,
      { tab }
    );
    return;
  }

  if (!session.wsManager.isConnected.value || !session.wsManager.isSftpReady.value) {
    console.error(`[EditorActions] 保存失败：会话 ${sessionId} 无效或未连接/SFTP 未就绪。`);
    tab.saveStatus = 'error';
    tab.saveError = t('fileManager.errors.sessionInvalidOrNotReady');
    setTimeout(() => {
      if (tab.saveStatus === 'error') {
        tab.saveStatus = 'idle';
        tab.saveError = null;
      }
    }, 5000);
    return;
  }

  const sftpManager = getOrCreateSftpManager(sessionId, 'primary-editor');
  if (!sftpManager) {
    console.error(
      `[EditorActions] 保存失败：无法获取会话 ${sessionId} 的 primary-editor sftpManager。`
    );
    tab.saveStatus = 'error';
    tab.saveError = t('fileManager.errors.sftpManagerNotFound');
    setTimeout(() => {
      if (tab.saveStatus === 'error') {
        tab.saveStatus = 'idle';
        tab.saveError = null;
      }
    }, 5000);
    return;
  }

  console.log(
    `[EditorActions] 开始保存文件: ${tab.filePath} (会话 ${sessionId}, Tab ID: ${tab.id}) using primary-editor sftpManager`
  );
  tab.isSaving = true;
  tab.saveStatus = 'saving';
  tab.saveError = null;

  const contentToSave = tab.content;
  const encodingToUse = tab.selectedEncoding;

  try {
    await sftpManager.writeFile(tab.filePath, contentToSave, encodingToUse);
    console.log(
      `[EditorActions] 文件 ${tab.filePath} (会话 ${sessionId}) 使用编码 ${encodingToUse} 保存成功。`
    );
    tab.isSaving = false;
    tab.saveStatus = 'success';
    tab.saveError = null;
    tab.originalContent = contentToSave;
    tab.isModified = false;
    setTimeout(() => {
      if (tab.saveStatus === 'success') {
        tab.saveStatus = 'idle';
      }
    }, 2000);
  } catch (err: any) {
    console.error(`[EditorActions] 保存文件 ${tab.filePath} (会话 ${sessionId}) 失败:`, err);
    tab.isSaving = false;
    tab.saveStatus = 'error';
    tab.saveError = `${t('fileManager.errors.saveFailed')}: ${err.message || err}`;
    setTimeout(() => {
      if (tab.saveStatus === 'error') {
        tab.saveStatus = 'idle';
        tab.saveError = null;
      }
    }, 5000);
  }
};

export const changeEncodingInSession = (sessionId: string, tabId: string, newEncoding: string) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.warn(`[EditorActions] 尝试更改不存在的会话 ${sessionId} 中标签页 ${tabId} 的编码。`);
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (!tab) {
    console.warn(`[EditorActions] 尝试更改会话 ${sessionId} 中不存在的标签页 ${tabId} 的编码。`);
    return;
  }

  if (!tab.rawContentBase64) {
    console.error(
      `[EditorActions] 无法更改编码：会话 ${sessionId} 标签页 ${tabId} 没有原始文件数据。`
    );
    tab.isLoading = false; // 应该已经是 false，但确保
    tab.loadingError = '缺少原始文件数据，无法更改编码';
    return;
  }
  if (tab.selectedEncoding === newEncoding) {
    console.log(
      `[EditorActions] 会话 ${sessionId} 标签页 ${tabId} 编码已经是 ${newEncoding}，无需更改。`
    );
    return;
  }

  console.log(
    `[EditorActions] 使用新编码 "${newEncoding}" 在前端重新解码文件: ${tab.filePath} (会话 ${sessionId}, Tab ID: ${tabId})`
  );

  try {
    const newContent = decodeRawContent(tab.rawContentBase64, newEncoding);
    tab.content = newContent;
    tab.selectedEncoding = newEncoding;
    // tab.isModified 状态取决于新内容是否与 originalContent 不同，或者用户可能希望将更改编码视为“修改”
    // 这里我们假设仅更改编码预览不直接标记为 isModified，除非内容实际变化
    // 如果 newContent === tab.originalContent，isModified 可以保持不变或设为 false
    // 如果 newContent !== tab.originalContent，isModified 应该为 true
    // 为了简单起见，这里不改变 isModified，由后续的 content 比较来决定
    tab.loadingError = null; // 清除可能存在的旧错误
    console.log(
      `[EditorActions] 文件 ${tab.filePath} (会话 ${sessionId}) 使用新编码 "${newEncoding}" 解码完成。`
    );
  } catch (err: any) {
    console.error(
      `[EditorActions] 使用编码 "${newEncoding}" 在前端解码文件 ${tab.filePath} (会话 ${sessionId}) 失败:`,
      err
    );
    tab.loadingError = `前端解码失败 (编码: ${newEncoding}): ${err.message || err}`;
  }
};

export const closeOtherTabsInSession = async (
  sessionId: string,
  targetTabId: string,
  dependencies?: {
    showConfirmDialog?: (options: {
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
    }) => Promise<boolean>;
    t?: (key: string, defaultMessage: string) => string;
  }
) => {
  const session = sessions.value.get(sessionId);
  if (!session) return;
  const targetTab = session.editorTabs.value.find((tab) => tab.id === targetTabId);
  if (!targetTab) return;

  console.log(`[EditorActions ${sessionId}] 关闭除 ${targetTabId} 之外的所有标签页...`);
  const tabsToClose = session.editorTabs.value.filter((tab) => tab.id !== targetTabId);
  const idsToClose = tabsToClose.map((t) => t.id);
  for (const id of idsToClose) {
    await closeEditorTabInSession(sessionId, id, dependencies);
  }
};

export const closeTabsToTheRightInSession = async (
  sessionId: string,
  targetTabId: string,
  dependencies?: {
    showConfirmDialog?: (options: {
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
    }) => Promise<boolean>;
    t?: (key: string, defaultMessage: string) => string;
  }
) => {
  const session = sessions.value.get(sessionId);
  if (!session) return;
  const targetIndex = session.editorTabs.value.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex === -1) return;

  console.log(`[EditorActions ${sessionId}] 关闭 ${targetTabId} 右侧的所有标签页...`);
  const tabsToClose = session.editorTabs.value.slice(targetIndex + 1);
  const idsToClose = tabsToClose.map((t) => t.id);
  for (const id of idsToClose) {
    await closeEditorTabInSession(sessionId, id, dependencies);
  }
};

export const updateTabScrollPositionInSession = (
  sessionId: string,
  tabId: string,
  scrollTop: number,
  scrollLeft: number
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.error(
      `[EditorActions] 尝试在不存在的会话 ${sessionId} 中更新标签页 ${tabId} 的滚动位置`
    );
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (tab) {
    tab.scrollTop = scrollTop;
    tab.scrollLeft = scrollLeft;
  } else {
    console.warn(`[EditorActions] 尝试更新会话 ${sessionId} 中不存在的标签页 ${tabId} 的滚动位置`);
  }
};

export const closeTabsToTheLeftInSession = async (
  sessionId: string,
  targetTabId: string,
  dependencies?: {
    showConfirmDialog?: (options: {
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
    }) => Promise<boolean>;
    t?: (key: string, defaultMessage: string) => string;
  }
) => {
  const session = sessions.value.get(sessionId);
  if (!session) return;
  const targetIndex = session.editorTabs.value.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex === -1) return;

  console.log(`[EditorActions ${sessionId}] 关闭 ${targetTabId} 左侧的所有标签页...`);
  const tabsToClose = session.editorTabs.value.slice(0, targetIndex);
  const idsToClose = tabsToClose.map((t) => t.id);
  for (const id of idsToClose) {
    await closeEditorTabInSession(sessionId, id, dependencies);
  }
};
