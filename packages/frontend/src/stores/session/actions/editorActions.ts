// packages/frontend/src/stores/session/actions/editorActions.ts

import type { useI18n } from 'vue-i18n';
import { sessions } from '../state';
import { getLanguageFromFilename, decodeRawContent } from '../utils';
import type { FileTab, SftpManagerInstance } from '../types';
import type { FileInfo } from '../../fileEditor.store'; // 路径: packages/frontend/src/stores/fileEditor.store.ts
import type { SftpReadFileSuccessPayload } from '../../../types/sftp.types'; // 路径: packages/frontend/src/types/sftp.types.ts
import { log } from '@/utils/log';
import { convertLineEnding, detectLineEnding, type LineEnding } from '../../../utils/lineEnding';

// --- Editor Actions ---
const loadTabContentInSession = async (
  sessionId: string,
  tabId: string,
  filePath: string,
  dependencies: {
    getOrCreateSftpManager: (sessionId: string, instanceId: string) => SftpManagerInstance | null;
    t: ReturnType<typeof useI18n>['t'];
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中加载标签页 ${tabId}`);
    return;
  }

  const { getOrCreateSftpManager, t } = dependencies;
  const tabRef = session.editorTabs.value.find((tabItem) => tabItem.id === tabId);
  if (!tabRef) {
    log.warn(`[EditorActions] 会话 ${sessionId} 中不存在标签页 ${tabId}，无法加载文件内容。`);
    return;
  }

  tabRef.isLoading = true;
  tabRef.loadingError = null;

  try {
    const sftpManager = getOrCreateSftpManager(sessionId, 'primary-editor');
    if (!sftpManager) {
      throw new Error(t('fileManager.errors.sftpManagerNotFound'));
    }
    log.info(`[EditorActions ${sessionId}] 使用 primary-editor sftpManager 读取文件 ${filePath}`);

    const fileData: SftpReadFileSuccessPayload = await sftpManager.readFile(filePath);
    log.info(
      `[EditorActions ${sessionId}] 文件 ${filePath} 读取成功。后端使用编码: ${fileData.encodingUsed}`,
    );

    const currentTabState = session.editorTabs.value.find((tabItem) => tabItem.id === tabId);
    if (!currentTabState) return;

    const initialContent = decodeRawContent(fileData.rawContentBase64, fileData.encodingUsed);
    currentTabState.content = initialContent;
    currentTabState.originalContent = initialContent;
    currentTabState.rawContentBase64 = fileData.rawContentBase64;
    currentTabState.selectedEncoding = fileData.encodingUsed;
    currentTabState.lineEnding = detectLineEnding(initialContent);
    currentTabState.isLoading = false;
    currentTabState.isModified = false;
    currentTabState.loadingError = null;
    log.info(`[EditorActions ${sessionId}] 文件 ${filePath} 内容已加载并设置到标签页 ${tabId}。`);
  } catch (err: unknown) {
    log.error(`[EditorActions ${sessionId}] 读取文件 ${filePath} 失败:`, err);
    const errorTabRef = session.editorTabs.value.find((tabItem) => tabItem.id === tabId);
    if (errorTabRef) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      errorTabRef.isLoading = false;
      errorTabRef.loadingError = `${t('fileManager.errors.readFileFailed')}: ${errorMessage}`;
    }
  }
};

export const openFileInSession = (
  sessionId: string,
  fileInfo: FileInfo,
  dependencies: {
    getOrCreateSftpManager: (sessionId: string, instanceId: string) => SftpManagerInstance | null;
    t: ReturnType<typeof useI18n>['t'];
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中打开文件`);
    return;
  }
  const { getOrCreateSftpManager, t } = dependencies;

  const existingTab = session.editorTabs.value.find((tab) => tab.filePath === fileInfo.fullPath);
  if (existingTab) {
    session.activeEditorTabId.value = existingTab.id;
    log.info(
      `[EditorActions] 会话 ${sessionId} 中已存在文件 ${fileInfo.fullPath} 的标签页，已激活: ${existingTab.id}`,
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
      lineEnding: 'lf', // 默认 LF，加载时会自动检测
      isLoading: true,
      loadingError: null,
      isSaving: false,
      saveStatus: 'idle',
      saveError: null,
      isModified: false,
    };
    session.editorTabs.value.push(newTab);
    session.activeEditorTabId.value = newTab.id;
    log.info(
      `[EditorActions] 已在会话 ${sessionId} 中为文件 ${fileInfo.fullPath} 创建新标签页: ${newTab.id}`,
    );
    loadTabContentInSession(sessionId, newTab.id, fileInfo.fullPath, { getOrCreateSftpManager, t });
  }
};

export const reloadTabInSession = async (
  sessionId: string,
  tabId: string,
  dependencies: {
    getOrCreateSftpManager: (sessionId: string, instanceId: string) => SftpManagerInstance | null;
    t: ReturnType<typeof useI18n>['t'];
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中刷新标签页 ${tabId}`);
    return;
  }

  const tab = session.editorTabs.value.find((tabItem) => tabItem.id === tabId);
  if (!tab) {
    log.warn(`[EditorActions] 尝试刷新会话 ${sessionId} 中不存在的标签页 ${tabId}`);
    return;
  }

  if (tab.isSaving) {
    log.warn(`[EditorActions] 标签页 ${tabId} 正在保存，跳过刷新。`);
    return;
  }

  await loadTabContentInSession(sessionId, tabId, tab.filePath, dependencies);
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
  },
): Promise<boolean> => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中关闭标签页 ${tabId}`);
    return false;
  }

  const tabIndex = session.editorTabs.value.findIndex((tab) => tab.id === tabId);
  if (tabIndex === -1) {
    log.warn(`[EditorActions] 尝试关闭会话 ${sessionId} 中不存在的标签页 ID: ${tabId}`);
    return false;
  }

  const tab = session.editorTabs.value[tabIndex];

  // 检查未保存更改
  if (tab.isModified && dependencies?.showConfirmDialog && dependencies?.t) {
    const shouldDiscard = await dependencies.showConfirmDialog({
      title: dependencies.t('editor.unsavedChanges.title', '未保存的更改'),
      message: dependencies.t(
        'editor.unsavedChanges.message',
        `文件 "${tab.filename}" 有未保存的更改。确定要丢弃这些更改吗？`,
      ),
      confirmText: dependencies.t('editor.unsavedChanges.discard', '丢弃更改'),
      cancelText: dependencies.t('common.cancel', '取消'),
    });

    if (!shouldDiscard) {
      log.info(`[EditorActions] 用户取消关闭有未保存更改的标签页: ${tabId}`);
      return false;
    }
  }

  session.editorTabs.value.splice(tabIndex, 1);
  log.info(`[EditorActions] 已从会话 ${sessionId} 中移除标签页: ${tabId}`);

  if (session.activeEditorTabId.value === tabId) {
    const remainingTabs = session.editorTabs.value;
    const nextActiveTabId =
      remainingTabs.length > 0
        ? remainingTabs[Math.max(0, tabIndex > 0 ? tabIndex - 1 : 0)].id
        : null;
    session.activeEditorTabId.value = nextActiveTabId;
    log.info(`[EditorActions] 会话 ${sessionId} 关闭活动标签页后，切换到: ${nextActiveTabId}`);
  }
  return true;
};

export const setActiveEditorTabInSession = (sessionId: string, tabId: string) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中激活标签页 ${tabId}`);
    return;
  }

  if (session.editorTabs.value.some((tab) => tab.id === tabId)) {
    if (session.activeEditorTabId.value !== tabId) {
      session.activeEditorTabId.value = tabId;
      log.info(`[EditorActions] 已在会话 ${sessionId} 中激活标签页: ${tabId}`);
    }
  } else {
    log.warn(`[EditorActions] 尝试激活会话 ${sessionId} 中不存在的标签页 ID: ${tabId}`);
  }
};

export const updateFileContentInSession = (
  sessionId: string,
  tabId: string,
  newContent: string,
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中更新标签页 ${tabId} 内容`);
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
    log.warn(`[EditorActions] 尝试更新正在加载的标签页 ${tabId} 的内容`);
  } else {
    log.warn(`[EditorActions] 尝试更新会话 ${sessionId} 中不存在的标签页 ${tabId} 的内容`);
  }
};

export const saveFileInSession = async (
  sessionId: string,
  tabId: string,
  dependencies: {
    getOrCreateSftpManager: (sessionId: string, instanceId: string) => SftpManagerInstance | null;
    t: ReturnType<typeof useI18n>['t'];
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中保存标签页 ${tabId}`);
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (!tab) {
    log.warn(`[EditorActions] 尝试保存在会话 ${sessionId} 中不存在的标签页 ${tabId}`);
    return;
  }
  const { getOrCreateSftpManager, t } = dependencies;

  if (tab.isSaving || tab.isLoading || tab.loadingError || !tab.isModified) {
    log.warn(`[EditorActions] 保存条件不满足 for ${tab.filePath} (会话 ${sessionId})，无法保存。`, {
      tab,
    });
    return;
  }

  if (!session.wsManager.isConnected.value || !session.wsManager.isSftpReady.value) {
    log.error(`[EditorActions] 保存失败：会话 ${sessionId} 无效或未连接/SFTP 未就绪。`);
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
    log.error(
      `[EditorActions] 保存失败：无法获取会话 ${sessionId} 的 primary-editor sftpManager。`,
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

  log.info(
    `[EditorActions] 开始保存文件: ${tab.filePath} (会话 ${sessionId}, Tab ID: ${tab.id}) using primary-editor sftpManager`,
  );
  tab.isSaving = true;
  tab.saveStatus = 'saving';
  tab.saveError = null;

  const contentToSave = tab.content;
  const encodingToUse = tab.selectedEncoding;

  try {
    await sftpManager.writeFile(tab.filePath, contentToSave, encodingToUse);
    log.info(
      `[EditorActions] 文件 ${tab.filePath} (会话 ${sessionId}) 使用编码 ${encodingToUse} 保存成功。`,
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
  } catch (err: unknown) {
    log.error(`[EditorActions] 保存文件 ${tab.filePath} (会话 ${sessionId}) 失败:`, err);
    tab.isSaving = false;
    tab.saveStatus = 'error';
    const errMsg = err instanceof Error ? err.message : String(err);
    tab.saveError = `${t('fileManager.errors.saveFailed')}: ${errMsg}`;
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
    log.warn(`[EditorActions] 尝试更改不存在的会话 ${sessionId} 中标签页 ${tabId} 的编码。`);
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (!tab) {
    log.warn(`[EditorActions] 尝试更改会话 ${sessionId} 中不存在的标签页 ${tabId} 的编码。`);
    return;
  }

  if (!tab.rawContentBase64) {
    log.error(`[EditorActions] 无法更改编码：会话 ${sessionId} 标签页 ${tabId} 没有原始文件数据。`);
    tab.isLoading = false; // 应该已经是 false，但确保
    tab.loadingError = '缺少原始文件数据，无法更改编码';
    return;
  }
  if (tab.selectedEncoding === newEncoding) {
    log.info(
      `[EditorActions] 会话 ${sessionId} 标签页 ${tabId} 编码已经是 ${newEncoding}，无需更改。`,
    );
    return;
  }

  log.info(
    `[EditorActions] 使用新编码 "${newEncoding}" 在前端重新解码文件: ${tab.filePath} (会话 ${sessionId}, Tab ID: ${tabId})`,
  );

  try {
    const newContent = decodeRawContent(tab.rawContentBase64, newEncoding);
    tab.content = newContent;
    tab.selectedEncoding = newEncoding;
    tab.lineEnding = detectLineEnding(newContent); // 编码切换后重新检测行尾格式
    // tab.isModified 状态取决于新内容是否与 originalContent 不同，或者用户可能希望将更改编码视为'修改'
    // 这里我们假设仅更改编码预览不直接标记为 isModified，除非内容实际变化
    // 如果 newContent === tab.originalContent，isModified 可以保持不变或设为 false
    // 如果 newContent !== tab.originalContent，isModified 应该为 true
    // 为了简单起见，这里不改变 isModified，由后续的 content 比较来决定
    tab.loadingError = null; // 清除可能存在的旧错误
    log.info(
      `[EditorActions] 文件 ${tab.filePath} (会话 ${sessionId}) 使用新编码 "${newEncoding}" 解码完成。`,
    );
  } catch (err: unknown) {
    log.error(
      `[EditorActions] 使用编码 "${newEncoding}" 在前端解码文件 ${tab.filePath} (会话 ${sessionId}) 失败:`,
      err,
    );
    const errMsg = err instanceof Error ? err.message : String(err);
    tab.loadingError = `前端解码失败 (编码: ${newEncoding}): ${errMsg}`;
  }
};

// +++ 更改文件换行符格式 +++
export const changeLineEndingInSession = (
  sessionId: string,
  tabId: string,
  newLineEnding: LineEnding,
  dependencies?: {
    t: ReturnType<typeof useI18n>['t'];
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.warn(`[EditorActions] 尝试更改不存在的会话 ${sessionId} 中标签页 ${tabId} 的换行符。`);
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (!tab) {
    log.warn(`[EditorActions] 尝试更改会话 ${sessionId} 中不存在的标签页 ${tabId} 的换行符。`);
    return;
  }
  if (tab.lineEnding === newLineEnding) {
    log.info(
      `[EditorActions] 会话 ${sessionId} 标签页 ${tabId} 换行符已经是 ${newLineEnding}，无需更改。`,
    );
    return;
  }

  log.info(
    `[EditorActions] 会话 ${sessionId} 标签页 ${tabId} 更换行符: ${tab.lineEnding} → ${newLineEnding}`,
  );

  try {
    const newContent = convertLineEnding(tab.content, newLineEnding);
    tab.content = newContent;
    tab.lineEnding = newLineEnding;
    tab.isModified = tab.content !== tab.originalContent;
    tab.loadingError = null; // 清除可能存在的旧错误
    log.info(
      `[EditorActions] 文件 ${tab.filePath} (会话 ${sessionId}) 换行符已更改为 ${newLineEnding}。`,
    );
  } catch (err: unknown) {
    log.error(`[EditorActions] 更换行符失败 (会话 ${sessionId}, 标签页 ${tabId}):`, err);
    const errMsg = err instanceof Error ? err.message : String(err);
    const errorMessage = dependencies?.t
      ? dependencies.t('fileManager.errors.lineEndingConversionFailed', '换行符转换失败')
      : '换行符转换失败';
    tab.loadingError = `${errorMessage}: ${errMsg}`;
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
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) return;
  const targetTab = session.editorTabs.value.find((tab) => tab.id === targetTabId);
  if (!targetTab) return;

  log.info(`[EditorActions ${sessionId}] 关闭除 ${targetTabId} 之外的所有标签页...`);
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
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) return;
  const targetIndex = session.editorTabs.value.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex === -1) return;

  log.info(`[EditorActions ${sessionId}] 关闭 ${targetTabId} 右侧的所有标签页...`);
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
  scrollLeft: number,
) => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    log.error(`[EditorActions] 尝试在不存在的会话 ${sessionId} 中更新标签页 ${tabId} 的滚动位置`);
    return;
  }
  const tab = session.editorTabs.value.find((t) => t.id === tabId);
  if (tab) {
    tab.scrollTop = scrollTop;
    tab.scrollLeft = scrollLeft;
  } else {
    log.warn(`[EditorActions] 尝试更新会话 ${sessionId} 中不存在的标签页 ${tabId} 的滚动位置`);
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
  },
) => {
  const session = sessions.value.get(sessionId);
  if (!session) return;
  const targetIndex = session.editorTabs.value.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex === -1) return;

  log.info(`[EditorActions ${sessionId}] 关闭 ${targetTabId} 左侧的所有标签页...`);
  const tabsToClose = session.editorTabs.value.slice(0, targetIndex);
  const idsToClose = tabsToClose.map((t) => t.id);
  for (const id of idsToClose) {
    await closeEditorTabInSession(sessionId, id, dependencies);
  }
};
