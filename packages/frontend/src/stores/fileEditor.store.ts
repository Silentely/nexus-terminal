import { ref, computed, readonly, watch, nextTick, onScopeDispose, getCurrentScope } from 'vue';
import { defineStore } from 'pinia';
import { useI18n } from 'vue-i18n';
import * as iconv from '@vscode/iconv-lite-umd';
import { Buffer } from 'buffer/';
import { useSessionStore } from './session.store';
import type { SaveStatus, SftpReadFileSuccessPayload } from '../types/sftp.types';
import { extractErrorMessage } from '../utils/errorExtractor';
import { workspaceEmitter } from '../composables/workspaceEvents';
import { log } from '@/utils/log';
import { convertLineEnding, detectLineEnding, type LineEnding } from '../utils/lineEnding';

// --- 类型定义 ---
// 文件信息，用于打开文件操作
export interface FileInfo {
  name: string;
  fullPath: string;
}

// 编辑器标签页状态
// 编辑器标签页状态 (简化)
export interface FileTab {
  id: string;
  sessionId: string;
  instanceId?: string;
  filePath: string;
  filename: string;
  content: string; // 当前解码后的内容 (前端解码)
  originalContent: string; // 初始加载或上次保存时解码后的内容 (前端解码)
  rawContentBase64: string | null; // +++ 存储原始 Base64 数据 +++
  language: string;
  selectedEncoding: string; // 当前选择或自动检测到的编码
  lineEnding: 'lf' | 'crlf' | 'cr'; // 当前换行符格式
  isLoading: boolean;
  loadingError: string | null;
  isSaving: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  isModified: boolean;
  scrollTop?: number; // 编辑器垂直滚动位置
  scrollLeft?: number; // 编辑器水平滚动位置
}

// --- 辅助函数 (移到外部并导出) ---
export const getLanguageFromFilename = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'py':
      return 'python';
    case 'java':
      return 'java';
    case 'c':
      return 'c';
    case 'cpp':
      return 'cpp';
    case 'cs':
      return 'csharp';
    case 'go':
      return 'go';
    case 'php':
      return 'php';
    case 'rb':
      return 'ruby';
    case 'rs':
      return 'rust';
    case 'sql':
      return 'sql';
    case 'sh':
      return 'shell';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'md':
      return 'markdown';
    case 'xml':
      return 'xml';
    case 'ini':
      return 'ini';
    case 'conf':
      return 'ini';
    case 'bat':
      return 'bat';
    case 'dockerfile':
      return 'dockerfile';
    default:
      return 'plaintext';
  }
};

export const getFilenameFromPath = (filePath: string): string => {
  return filePath.split('/').pop() || filePath;
};

// +++ 前端解码辅助函数 +++
const decodeRawContent = (rawContentBase64: string, encoding: string): string => {
  try {
    const buffer = Buffer.from(rawContentBase64, 'base64');
    const normalizedEncoding = encoding.toLowerCase().replace(/[^a-z0-9]/g, ''); // Normalize encoding name

    // 优先使用 TextDecoder 处理标准编码
    if (['utf8', 'utf16le', 'utf16be'].includes(normalizedEncoding)) {
      const decoder = new TextDecoder(encoding); // Use original encoding name for TextDecoder
      return decoder.decode(buffer);
    }
    // 使用 iconv-lite 处理其他编码
    if (iconv.encodingExists(normalizedEncoding)) {
      return iconv.decode(buffer, normalizedEncoding);
    }
    // 如果 iconv-lite 也不支持，回退到 UTF-8 并警告

    log.warn(
      `[decodeRawContent] Unsupported encoding "${encoding}" requested. Falling back to UTF-8.`,
    );
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  } catch (error: unknown) {
    const decodeErrorMessage = extractErrorMessage(error, 'Unknown decode error');
    log.error(`[decodeRawContent] Error decoding content with encoding "${encoding}":`, error);
    return `// Error decoding content: ${decodeErrorMessage}`; // 返回错误信息
  }
};

export const useFileEditorStore = defineStore('fileEditor', () => {
  const { t } = useI18n();
  const sessionStore = useSessionStore();

  // --- 多标签状态 ---
  const tabs = ref(new Map<string, FileTab>()); // 存储所有打开的标签页 (使用 FileTab)
  const activeTabId = ref<string | null>(null); // 当前激活的标签页 ID
  // const editorVisibleState = ref<'visible' | 'minimized' | 'closed'>('closed'); // 移除，面板可见性由布局控制
  const popupTrigger = ref(0); // 用于触发弹窗显示的信号
  const popupFileInfo = ref<{ filePath: string; sessionId: string } | null>(null); // 存储弹窗文件信息

  // --- session:remapped 事件处理 ---
  // 跟踪已被 remap 的旧 session ID，防止 watcher 误删 tab
  const _remappedSessionIds = new Set<string>();

  const _onSessionRemapped = (payload: { oldSessionId: string; newSessionId: string }) => {
    const { oldSessionId, newSessionId } = payload;
    log.info(
      `[文件编辑器 Store] session:remapped ${oldSessionId} → ${newSessionId}，更新标签页 sessionId。`,
    );

    // 标记旧 ID 为已 remap，防止 watcher 误删
    _remappedSessionIds.add(oldSessionId);

    // 就地修改标签页属性，避免替换对象导致其他代码持有的旧引用失效
    const keysToUpdate: string[] = [];
    tabs.value.forEach((tab, tabId) => {
      if (tab.sessionId === oldSessionId) {
        keysToUpdate.push(tabId);
      }
    });

    for (const oldTabId of keysToUpdate) {
      const tab = tabs.value.get(oldTabId);
      if (!tab) continue;

      const newTabId = oldTabId.replace(`${oldSessionId}:`, `${newSessionId}:`);
      // 就地修改属性
      tab.sessionId = newSessionId;
      tab.id = newTabId;
      log.info(`[文件编辑器 Store] 标签页 ${oldTabId} → ${newTabId} (文件: ${tab.filename})`);

      // 更新 activeTabId
      if (activeTabId.value === oldTabId) {
        activeTabId.value = newTabId;
      }

      // 更新 Map key（Vue Map 代理追踪 delete + set）
      if (oldTabId !== newTabId) {
        if (tabs.value.has(newTabId)) {
          log.warn(
            `[文件编辑器 Store] remap key 冲突: ${newTabId} 已存在，跳过 ${oldTabId} 的 key 更新`,
          );
          continue;
        }
        tabs.value.delete(oldTabId);
        tabs.value.set(newTabId, tab);
      }
    }
  };

  workspaceEmitter.on('session:remapped', _onSessionRemapped);
  if (getCurrentScope()) {
    onScopeDispose(() => {
      workspaceEmitter.off('session:remapped', _onSessionRemapped);
    });
  }

  // --- 计算属性 ---
  const orderedTabs = computed(() => Array.from(tabs.value.values())); // 获取标签页数组，用于渲染
  const activeTab = computed(() => {
    if (!activeTabId.value) return null;
    return tabs.value.get(activeTabId.value) || null;
  });
  // 提供给 MonacoEditor 的内容绑定
  const activeEditorContent = computed({
    get: () => activeTab.value?.content ?? '',
    set: (value) => {
      if (activeTab.value) {
        // 调用新的 updateFileContent action，并传递 tabId
        updateFileContent(activeTab.value.id, value);
      }
    },
  });

  // --- 移除 decodeBase64Content 辅助方法 ---

  // --- 核心方法 ---

  // 统一的加载逻辑：首次打开与手动刷新共用，避免状态处理分叉
  const loadTabContent = async (
    tabId: string,
    filePath: string,
    readFile: (path: string) => Promise<SftpReadFileSuccessPayload>,
  ) => {
    const tab = tabs.value.get(tabId);
    if (!tab) {
      log.warn(`[文件编辑器 Store] 无法加载标签页 ${tabId}：标签页不存在。`);
      return;
    }

    // 保存原始对象引用，用于 await 后定位（_onSessionRemapped 可能更改了 tab.id/key）
    const originalTabRef = tab;

    tab.isLoading = true;
    tab.loadingError = null;

    try {
      const fileData = await readFile(filePath);
      log.info(
        `[文件编辑器 Store] 文件 ${filePath} 原始数据读取成功。后端使用编码: ${fileData.encodingUsed}`,
      );

      // await 后定位当前 tab 对象：
      // 优先用原 tabId 查找（未发生 remap 的常见路径），
      // 若找不到则通过对象身份匹配（_onSessionRemapped 就地修改了属性但对象引用不变）
      let tabToUpdate = tabs.value.get(tabId);
      if (!tabToUpdate) {
        for (const [, tabEntry] of tabs.value) {
          if (tabEntry === originalTabRef) {
            tabToUpdate = tabEntry;
            log.info(`[文件编辑器 Store] 通过对象引用定位到重映射后的标签页: ${tabToUpdate.id}`);
            break;
          }
        }
      }

      if (!tabToUpdate) {
        log.error(`[文件编辑器 Store] 无法更新标签页 ${tabId}，因为它在加载完成前被关闭了。`);
        return;
      }

      const initialContent = decodeRawContent(fileData.rawContentBase64, fileData.encodingUsed);
      // 就地修改属性，避免替换整个对象导致外部引用（如 saveFile 中的 const tab）失效
      tabToUpdate.rawContentBase64 = fileData.rawContentBase64;
      tabToUpdate.content = initialContent;
      tabToUpdate.originalContent = initialContent;
      tabToUpdate.selectedEncoding = fileData.encodingUsed;
      tabToUpdate.lineEnding = detectLineEnding(initialContent);
      tabToUpdate.isLoading = false;
      tabToUpdate.isModified = false;
      tabToUpdate.loadingError = null;

      log.info(
        `[文件编辑器 Store] 文件 ${filePath} 内容已解码 (${fileData.encodingUsed}) 并设置到标签页 ${tabToUpdate.id}。`,
      );
    } catch (err: unknown) {
      log.error(`[文件编辑器 Store] 读取文件 ${filePath} 失败:`, err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorMsg = `${t('fileManager.errors.readFileFailed')}: ${errorMessage}`;
      // 错误处理同样需要定位当前 tab（对象身份匹配）
      let tabToUpdate = tabs.value.get(tabId);
      if (!tabToUpdate) {
        for (const [, tabEntry] of tabs.value) {
          if (tabEntry === originalTabRef) {
            tabToUpdate = tabEntry;
            break;
          }
        }
      }
      if (tabToUpdate) {
        tabToUpdate.isLoading = false;
        tabToUpdate.loadingError = errorMsg;
      }
    }
  };

  // 修改：triggerPopup 接收文件信息并存储
  const triggerPopup = (filePath: string, sessionId: string) => {
    log.info(`[文件编辑器 Store] Triggering popup for ${filePath} in session ${sessionId}.`);
    popupFileInfo.value = { filePath, sessionId };
    popupTrigger.value++; // 增加触发器值以通知监听者
  };

  // 移除内部的 getSftpManager 辅助函数，将直接使用 sessionStore.getOrCreateSftpManager
  // const getSftpManager = (sessionId: string | null) => { ... };

  // 移除 setEditorVisibility 方法
  // const setEditorVisibility = ...

  // 打开或切换到文件标签页
  // 修改：添加 instanceId 参数
  const openFile = async (targetFilePath: string, sessionId: string, instanceId: string) => {
    // 在共享模式下，我们仍然需要 sessionId 来构建唯一的 tabId
    // 并与 SFTP 管理器关联
    const tabId = `${sessionId}:${targetFilePath}`; // Tab ID 仍然基于 sessionId 和 filePath 保持唯一性
    log.info(
      `[文件编辑器 Store - 共享模式] 尝试打开文件: ${targetFilePath} (会话: ${sessionId}, 实例: ${instanceId}, Tab ID: ${tabId})`,
    );

    // 移除确保编辑器可见的逻辑
    // if (editorVisibleState.value === 'closed') {
    //     setEditorVisibility('visible');
    // }

    // 如果标签页已存在，则激活它
    if (tabs.value.has(tabId)) {
      log.info(`[文件编辑器 Store] 标签页 ${tabId} 已存在，激活它。`);
      setActiveTab(tabId);
      // 触发弹窗 (如果设置允许)
      popupTrigger.value++;
      return;
    }

    // 创建新标签页 (使用简化后的 FileTab)
    const newTab: FileTab = {
      id: tabId,
      sessionId,
      instanceId,
      filePath: targetFilePath,
      filename: getFilenameFromPath(targetFilePath),
      content: '', // 将在加载后由前端解码填充
      originalContent: '', // 将在加载后由前端解码填充
      rawContentBase64: null, // +++ 初始化为 null +++
      language: getLanguageFromFilename(targetFilePath),
      selectedEncoding: 'utf-8', // 初始默认，将由后端更新
      lineEnding: 'lf', // 默认 LF，加载时会自动检测
      isLoading: true,
      loadingError: null,
      isSaving: false,
      saveStatus: 'idle',
      saveError: null,
      isModified: false,
      scrollTop: 0, // 初始化滚动位置
      scrollLeft: 0, // 初始化滚动位置
    };
    tabs.value.set(tabId, newTab);
    // setActiveTab(tabId); // 移除同步激活

    // 使用 nextTick 延迟激活，给 DOM 更新留出时间
    nextTick(() => {
      setActiveTab(tabId);
    });

    // 不再在这里触发弹窗
    // popupTrigger.value++;

    // 获取 SFTP 管理器 - 修改：使用 sessionStore.getOrCreateSftpManager 并传入 instanceId
    const sftpManager = sessionStore.getOrCreateSftpManager(sessionId, instanceId);
    if (!sftpManager) {
      // 错误消息保持不变，但现在知道是哪个实例找不到管理器
      log.error(
        `[文件编辑器 Store] 无法找到会话 ${sessionId} (实例 ${instanceId}) 的 SFTP 管理器。`,
      );
      const tabToUpdate = tabs.value.get(tabId);
      if (tabToUpdate) {
        tabToUpdate.isLoading = false;
        tabToUpdate.loadingError = t('fileManager.errors.sftpManagerNotFound'); // 可以考虑添加 instanceId 到错误消息
      }
      return;
    }

    await loadTabContent(tabId, targetFilePath, (path) => sftpManager.readFile(path));
  };

  // 手动刷新标签页内容（覆盖当前内容）
  const reloadTab = async (tabId: string) => {
    const tab = tabs.value.get(tabId);
    if (!tab) {
      log.warn(`[文件编辑器 Store] 刷新失败：标签页 ${tabId} 不存在。`);
      return;
    }

    if (tab.isSaving) {
      log.warn(`[文件编辑器 Store] 刷新失败：标签页 ${tabId} 正在保存。`);
      return;
    }

    const instanceId = tab.instanceId ?? 'primary';
    const sftpManager = sessionStore.getOrCreateSftpManager(tab.sessionId, instanceId);
    if (!sftpManager) {
      log.error(
        `[文件编辑器 Store] 刷新失败：无法找到会话 ${tab.sessionId} (实例 ${instanceId}) 的 SFTP 管理器。`,
      );
      tab.isLoading = false;
      tab.loadingError = t('fileManager.errors.sftpManagerNotFound');
      return;
    }

    await loadTabContent(tab.id, tab.filePath, (path) => sftpManager.readFile(path));
  };

  // 保存指定（或当前激活）标签页的文件
  const saveFile = async (tabIdToSave?: string) => {
    const targetTabId = tabIdToSave ?? activeTabId.value;
    if (!targetTabId) {
      log.warn('[文件编辑器 Store] 保存失败：没有活动的标签页。');
      return;
    }

    const tab = tabs.value.get(targetTabId);
    if (!tab) {
      log.warn(`[文件编辑器 Store] 保存失败：找不到标签页 ${targetTabId}。`);
      return;
    }

    if (tab.isSaving || tab.isLoading || tab.loadingError) {
      log.warn(`[文件编辑器 Store] 保存条件不满足 for ${tab.filePath}，无法保存。`, { tab });
      return;
    }

    // 检查会话是否存在且连接
    const session = sessionStore.sessions.get(tab.sessionId);
    if (!session || !session.wsManager.isConnected.value || !session.wsManager.isSftpReady.value) {
      log.error(`[文件编辑器 Store] 保存失败：会话 ${tab.sessionId} 无效或未连接/SFTP 未就绪。`);
      tab.saveStatus = 'error';
      tab.saveError = t('fileManager.errors.sessionInvalidOrNotReady'); // 需要添加新的翻译
      // 可以在这里添加一个短暂的错误提示
      setTimeout(() => {
        if (tab.saveStatus === 'error') {
          tab.saveStatus = 'idle';
          tab.saveError = null;
        }
      }, 5000);
      return;
    }

    // 修改：优先使用 tab.instanceId 查找对应的 SFTP 管理器，避免多实例时路由错误
    const sftpManagersMap = session.sftpManagers;
    if (!sftpManagersMap || sftpManagersMap.size === 0) {
      log.error(`[文件编辑器 Store] 保存失败：会话 ${tab.sessionId} 没有可用的 SFTP 管理器实例。`);
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

    // 优先按 tab.instanceId 查找；若找不到则回退到第一个可用实例
    const targetInstanceId = tab.instanceId || 'primary';
    let sftpManager = sftpManagersMap.get(targetInstanceId);
    let instanceId = targetInstanceId;
    if (!sftpManager) {
      const fallback = sftpManagersMap.entries().next().value;
      if (fallback && fallback[1]) {
        [instanceId, sftpManager] = fallback;
        log.warn(
          `[文件编辑器 Store] 未找到实例 ${targetInstanceId} 的 SFTP 管理器，回退到实例 ${instanceId}`,
        );
      }
    }

    // +++ 再次检查 sftpManager 是否有效 (虽然理论上 Map 不应存储 undefined 值) +++
    if (!sftpManager) {
      log.error(
        `[文件编辑器 Store] 保存失败：从会话 ${tab.sessionId} 的 sftpManagers Map 获取到的 SFTP 管理器实例无效 (instanceId: ${instanceId})。`,
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
    // --- 检查结束 ---

    // 安全检查：rawContentBase64 为 null 表示文件内容从未成功加载过，需先重载
    if (tab.rawContentBase64 === null && !tab.isLoading) {
      log.warn(
        `[文件编辑器 Store] 保存前检测到文件内容未加载（rawContentBase64=null），尝试重新加载: ${tab.filePath}`,
      );
      const sftpManagerForReload = sessionStore.getOrCreateSftpManager(
        tab.sessionId,
        tab.instanceId || instanceId,
      );
      if (!sftpManagerForReload) {
        log.error(`[文件编辑器 Store] 无法重新加载：找不到 SFTP 管理器。中止保存。`);
        tab.isSaving = false;
        tab.saveStatus = 'error';
        tab.saveError = t('fileManager.errors.sftpManagerNotFound');
        return;
      }
      try {
        await loadTabContent(tab.id, tab.filePath, (path) => sftpManagerForReload.readFile(path));
      } catch (reloadErr: unknown) {
        log.error(`[文件编辑器 Store] 重新加载文件失败，中止保存:`, reloadErr);
        tab.isSaving = false;
        tab.saveStatus = 'error';
        tab.saveError = t('fileManager.errors.readFileFailed');
        return;
      }
    }

    log.info(
      `[文件编辑器 Store] 开始保存文件: ${tab.filePath} (Tab ID: ${tab.id}) 使用实例 ${instanceId}`,
    );
    tab.isSaving = true;
    tab.saveStatus = 'saving';
    tab.saveError = null;

    // 统一引用：重新从 Map 获取，确保读写都基于同一个对象
    const resolvedTab = tabs.value.get(targetTabId) ?? tab;
    const contentToSave = resolvedTab.content;
    const encodingToUse = resolvedTab.selectedEncoding;

    // 诊断日志：保存前检查内容状态
    log.info(
      `[文件编辑器 Store] 保存诊断: content长度=${contentToSave?.length ?? 'null'}, rawContentBase64=${resolvedTab.rawContentBase64 ? '有数据' : 'null/空'}, encoding=${encodingToUse}`,
    );

    // 防御性检查：content 不应为 undefined/null（空字符串是合法的空文件内容）
    if (contentToSave == null) {
      log.error(
        `[文件编辑器 Store] 保存中止：content 为 null/undefined。Tab ID: ${resolvedTab.id}`,
      );
      resolvedTab.isSaving = false;
      resolvedTab.saveStatus = 'error';
      resolvedTab.saveError = t('fileManager.errors.saveFailed');
      return;
    }

    try {
      // --- 修改：传递 selectedEncoding 给 writeFile ---
      await sftpManager.writeFile(resolvedTab.filePath, contentToSave, encodingToUse);
      log.info(
        `[文件编辑器 Store] 文件 ${resolvedTab.filePath} 使用编码 ${encodingToUse} 保存成功。`,
      );
      resolvedTab.isSaving = false;
      resolvedTab.saveStatus = 'success';
      resolvedTab.saveError = null;
      resolvedTab.originalContent = contentToSave; // 更新原始内容
      // 重新编码保存后的内容到 rawContentBase64，确保切换编码时不会回退到旧数据
      try {
        const { Buffer: SafeBuffer } = await import('buffer/');
        resolvedTab.rawContentBase64 = SafeBuffer.from(contentToSave).toString('base64');
      } catch {
        // iconv-lite 在前端环境不可用时回退到 UTF-8
        const { Buffer: SafeBuffer } = await import('buffer/');
        resolvedTab.rawContentBase64 = SafeBuffer.from(contentToSave, 'utf-8').toString('base64');
      }
      resolvedTab.isModified = false; // 重置修改状态

      setTimeout(() => {
        if (resolvedTab.saveStatus === 'success') {
          resolvedTab.saveStatus = 'idle';
        }
      }, 2000);
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, String(err));
      log.error(`[文件编辑器 Store] 保存文件 ${resolvedTab.filePath} 失败:`, err);
      resolvedTab.isSaving = false;
      resolvedTab.saveStatus = 'error';
      resolvedTab.saveError = `${t('fileManager.errors.saveFailed')}: ${errorMessage}`;

      setTimeout(() => {
        if (resolvedTab.saveStatus === 'error') {
          resolvedTab.saveStatus = 'idle';
          resolvedTab.saveError = null;
        }
      }, 5000);
    }
  };

  // 关闭指定标签页
  const closeTab = (tabId: string) => {
    const tabToClose = tabs.value.get(tabId);
    if (!tabToClose) return;

    // 简单处理：如果修改过，提醒用户（实际应用可能需要更复杂的确认对话框）
    if (tabToClose.isModified) {
      // 这里可以集成 UI 通知库来提示
      log.warn(
        `[文件编辑器 Store] 标签页 ${tabId} (${tabToClose.filename}) 已修改但未保存。正在关闭...`,
      );
    }

    log.info(`[文件编辑器 Store] 关闭标签页: ${tabId}`);
    tabs.value.delete(tabId);

    // 如果关闭的是当前激活的标签页，则切换到另一个标签页
    if (activeTabId.value === tabId) {
      const remainingTabs = Array.from(tabs.value.keys());
      if (remainingTabs.length > 0) {
        // 简单切换到最后一个标签页
        setActiveTab(remainingTabs[remainingTabs.length - 1]);
      } else {
        activeTabId.value = null; // 没有标签页了
        // setEditorVisibility('closed'); // 移除：容器可见性由外部控制
      }
    }
    // 如果关闭的不是活动标签页，或者活动标签页已成功切换，检查是否需要关闭容器
    else if (tabs.value.size === 0) {
      // setEditorVisibility('closed'); // 移除：容器可见性由外部控制
    }
  };

  // 关闭所有标签页
  const closeAllTabs = () => {
    // 简单处理：直接关闭所有，不检查修改状态（实际应用需要确认）
    log.info('[文件编辑器 Store] 关闭所有标签页...');
    tabs.value.clear();
    activeTabId.value = null;
    // setEditorVisibility('closed'); // 移除：容器可见性由外部控制
  };

  // +++ 关闭其他标签页 +++
  const closeOtherTabs = (targetTabId: string) => {
    log.info(
      `[文件编辑器 Store] closeOtherTabs: Action called. Current keys in tabs map:`,
      Array.from(tabs.value.keys()),
    ); // ++ Log current keys at start
    if (!tabs.value.has(targetTabId)) {
      log.warn(`[文件编辑器 Store] closeOtherTabs: 目标 ID ${targetTabId} 在 Map 中不存在。`); // Updated warning
      return;
    }
    log.info(`[文件编辑器 Store] closeOtherTabs: 开始关闭除 ${targetTabId} 之外的所有标签页...`);
    const tabsToClose = Array.from(tabs.value.keys()).filter((id) => id !== targetTabId);
    log.info(`[文件编辑器 Store] closeOtherTabs: 将要关闭的标签页 IDs:`, tabsToClose); // + Log IDs to close
    tabsToClose.forEach((id) => {
      log.info(`[文件编辑器 Store] closeOtherTabs: 正在调用 closeTab 关闭 ${id}`); // + Log loop iteration
      closeTab(id);
    });
  };

  // +++ 关闭右侧标签页 +++
  const closeTabsToTheRight = (targetTabId: string) => {
    const tabsArray = Array.from(tabs.value.values());
    const targetIndex = tabsArray.findIndex((tab) => tab.id === targetTabId);
    log.info(
      `[文件编辑器 Store] closeTabsToTheRight: Action called. Current keys in tabs map:`,
      Array.from(tabs.value.keys()),
    ); // ++ Log current keys at start
    if (targetIndex === -1) {
      log.warn(`[文件编辑器 Store] closeTabsToTheRight: 目标 ID ${targetTabId} 未找到索引。`);
      return;
    }
    log.info(
      `[文件编辑器 Store] closeTabsToTheRight: 开始关闭 ${targetTabId} (索引 ${targetIndex}) 右侧的所有标签页...`,
    );
    const tabsToClose = tabsArray.slice(targetIndex + 1).map((tab) => tab.id);
    log.info(`[文件编辑器 Store] closeTabsToTheRight: 将要关闭的标签页 IDs:`, tabsToClose); // + Log IDs to close
    tabsToClose.forEach((id) => {
      log.info(`[文件编辑器 Store] closeTabsToTheRight: 正在调用 closeTab 关闭 ${id}`); // + Log loop iteration
      closeTab(id);
    });
  };

  // +++ 关闭左侧标签页 +++
  const closeTabsToTheLeft = (targetTabId: string) => {
    const tabsArray = Array.from(tabs.value.values());
    const targetIndex = tabsArray.findIndex((tab) => tab.id === targetTabId);
    log.info(
      `[文件编辑器 Store] closeTabsToTheLeft: Action called. Current keys in tabs map:`,
      Array.from(tabs.value.keys()),
    ); // ++ Log current keys at start
    if (targetIndex === -1) {
      log.warn(`[文件编辑器 Store] closeTabsToTheLeft: 目标 ID ${targetTabId} 未找到索引。`);
      return;
    }
    log.info(
      `[文件编辑器 Store] closeTabsToTheLeft: 开始关闭 ${targetTabId} (索引 ${targetIndex}) 左侧的所有标签页...`,
    );
    const tabsToClose = tabsArray.slice(0, targetIndex).map((tab) => tab.id);
    log.info(`[文件编辑器 Store] closeTabsToTheLeft: 将要关闭的标签页 IDs:`, tabsToClose); // + Log IDs to close
    tabsToClose.forEach((id) => {
      log.info(`[文件编辑器 Store] closeTabsToTheLeft: 正在调用 closeTab 关闭 ${id}`); // + Log loop iteration
      closeTab(id);
    });
  };

  // 设置当前激活的标签页
  const setActiveTab = (tabId: string) => {
    if (tabs.value.has(tabId)) {
      activeTabId.value = tabId;
      log.info(`[文件编辑器 Store] 激活标签页: ${tabId}`);
      // 移除：切换标签不应改变容器可见性状态
      // if (editorVisibleState.value === 'closed' || editorVisibleState.value === 'minimized') {
      //     setEditorVisibility('visible');
      // }
    } else {
      log.warn(`[文件编辑器 Store] 尝试激活不存在的标签页: ${tabId}`);
    }
  };

  // 更新指定标签页的内容 (由 FileEditorContainer 的 v-model 触发)
  const updateFileContent = (tabId: string, newContent: string) => {
    const tab = tabs.value.get(tabId);
    if (tab && !tab.isLoading) {
      tab.content = newContent;
      // 检查是否修改
      tab.isModified = tab.content !== tab.originalContent;
      // 当用户编辑时，重置保存状态
      if (tab.saveStatus === 'success' || tab.saveStatus === 'error') {
        tab.saveStatus = 'idle';
        tab.saveError = null;
      }
    }
  };

  // +++ 修改：更改文件编码（通过请求后端重新读取） +++
  // +++ 修改：changeEncoding 现在在前端解码 +++
  const changeEncoding = (tabId: string, newEncoding: string) => {
    const tab = tabs.value.get(tabId);
    if (!tab) {
      log.warn(`[文件编辑器 Store] 尝试更改不存在的标签页 ${tabId} 的编码。`);
      return;
    }
    if (!tab.rawContentBase64) {
      log.error(`[文件编辑器 Store] 无法更改编码：标签页 ${tabId} 没有原始文件数据。`);
      // 可以设置错误状态
      tab.loadingError = '缺少原始文件数据，无法更改编码';
      return;
    }
    if (tab.selectedEncoding === newEncoding) {
      log.info(`[文件编辑器 Store] 编码已经是 ${newEncoding}，无需更改。`);
      return;
    }

    log.info(
      `[文件编辑器 Store] 使用新编码 "${newEncoding}" 在前端重新解码文件: ${tab.filePath} (Tab ID: ${tabId})`,
    );

    // 设置加载状态（可选，解码通常很快，但可以防止 UI 闪烁）
    // tab.isLoading = true;
    // tab.loadingError = null;

    try {
      // 使用新编码解码存储的原始数据
      const newContent = decodeRawContent(tab.rawContentBase64, newEncoding);

      // 就地修改属性，避免替换对象导致外部引用失效
      tab.content = newContent;
      tab.selectedEncoding = newEncoding;
      tab.lineEnding = detectLineEnding(newContent); // 编码切换后重新检测行尾格式
      tab.isLoading = false;
      tab.loadingError = null;
      // isModified 状态保持不变
      log.info(`[文件编辑器 Store] 文件 ${tab.filePath} 使用新编码 "${newEncoding}" 解码完成。`);
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, String(err));
      log.error(
        `[文件编辑器 Store] 使用编码 "${newEncoding}" 在前端解码文件 ${tab.filePath} 失败:`,
        err,
      );
      const errorMsg = `前端解码失败 (编码: ${newEncoding}): ${errorMessage}`;
      // 就地修改错误状态
      tab.isLoading = false;
      tab.loadingError = errorMsg;
    }
    // finally {
    //     if (tab) tab.isLoading = false; // 确保加载状态被重置
    // }
  };

  // +++ 更改文件换行符格式 +++
  const changeLineEnding = (tabId: string, newLineEnding: LineEnding) => {
    const tab = tabs.value.get(tabId);
    if (!tab) {
      log.warn(`[文件编辑器 Store] 尝试更改不存在的标签页 ${tabId} 的换行符。`);
      return;
    }
    if (tab.lineEnding === newLineEnding) {
      log.info(`[文件编辑器 Store] 换行符已经是 ${newLineEnding}，无需更改。`);
      return;
    }

    log.info(
      `[文件编辑器 Store] 更换行符: ${tab.lineEnding} → ${newLineEnding} for ${tab.filePath} (Tab ID: ${tabId})`,
    );

    try {
      const newContent = convertLineEnding(tab.content, newLineEnding);
      tab.content = newContent;
      tab.lineEnding = newLineEnding;
      tab.isModified = tab.content !== tab.originalContent;
      tab.loadingError = null; // 清除可能存在的旧错误
      log.info(`[文件编辑器 Store] 文件 ${tab.filePath} 换行符已更改为 ${newLineEnding}。`);
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, String(err));
      log.error(`[文件编辑器 Store] 更换行符失败:`, err);
      tab.loadingError = `${t('fileManager.errors.lineEndingConversionFailed', '换行符转换失败')}: ${errorMessage}`;
    }
  };

  // +++ 更新标签页滚动位置 +++
  const updateTabScrollPosition = (tabId: string, scrollTop: number, scrollLeft: number) => {
    const tab = tabs.value.get(tabId);
    if (tab) {
      tab.scrollTop = scrollTop;
      tab.scrollLeft = scrollLeft;
    }
  };

  // 移除旧的 updateContent，因为它只更新活动标签页
  // const updateContent = (newContent: string) => { ... };

  // 监听会话关闭事件，移除相关标签页
  // 排除刚 remap 的旧 session ID（由 _onSessionRemapped 处理）
  watch(
    () => sessionStore.sessions,
    (newSessions, oldSessions) => {
      const closedSessionIds = new Set<string>();
      oldSessions.forEach((_, sessionId) => {
        if (!newSessions.has(sessionId) && !_remappedSessionIds.has(sessionId)) {
          closedSessionIds.add(sessionId);
        }
      });

      if (closedSessionIds.size > 0) {
        log.info('[文件编辑器 Store] 检测到会话关闭:', Array.from(closedSessionIds));
        const tabsToRemove = Array.from(tabs.value.values()).filter((tab) =>
          closedSessionIds.has(tab.sessionId),
        );
        tabsToRemove.forEach((tab) => {
          log.info(`[文件编辑器 Store] 移除与已关闭会话 ${tab.sessionId} 相关的标签页: ${tab.id}`);
          // 这里不调用 closeTab 以避免潜在的修改提示，直接移除
          tabs.value.delete(tab.id);
          // 如果移除的是活动标签页，需要重新设置活动标签页
          if (activeTabId.value === tab.id) {
            const remainingTabs = Array.from(tabs.value.keys());
            if (remainingTabs.length > 0) {
              activeTabId.value = remainingTabs[remainingTabs.length - 1];
            } else {
              activeTabId.value = null;
            }
          }
        });
        // 如果移除后没有标签页了
        if (tabs.value.size === 0) {
          // setEditorVisibility('closed'); // 移除：容器可见性由外部控制
        } else if (!activeTabId.value && tabs.value.size > 0) {
          // 如果活动标签页被移除且没有自动设置新的，手动设置一个
          activeTabId.value = Array.from(tabs.value.keys())[0];
        }
      }
      // 清理 remap 追踪标记（watcher 已处理完毕）
      _remappedSessionIds.clear();
    },
    { deep: false },
  ); // 只监听 Map 本身的增删

  return {
    // 状态
    tabs: readonly(tabs), // 只读 Map
    activeTabId: readonly(activeTabId),
    // editorVisibleState: readonly(editorVisibleState), // 移除
    popupTrigger: readonly(popupTrigger), // 暴露触发器 (只读)
    popupFileInfo: readonly(popupFileInfo), // 暴露弹窗文件信息 (只读)

    // 计算属性
    orderedTabs,
    activeTab, // 只读的当前激活标签页对象
    activeEditorContent, // 用于 v-model 绑定到 MonacoEditor

    // 方法
    openFile,
    saveFile,
    closeTab,
    closeOtherTabs, // +++ 暴露新 action +++
    closeTabsToTheRight, // +++ 暴露新 action +++
    closeTabsToTheLeft, // +++ 暴露新 action +++
    closeAllTabs,
    setActiveTab,
    updateFileContent, // 暴露新的更新方法
    changeEncoding, // +++ 暴露更改编码的方法 +++
    changeLineEnding, // +++ 暴露更换行符的方法 +++
    reloadTab,
    triggerPopup, // 暴露新的触发方法
    // setEditorVisibility, // 移除
    updateTabScrollPosition, // +++ 暴露更新滚动位置的方法 +++
  };
});
