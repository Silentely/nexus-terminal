/**
 * 外观 Store - 终端主题子模块
 * 职责：终端主题的 CRUD、激活、预览、数据加载
 */
import { ref, computed } from 'vue';
import type { ITheme } from '@xterm/xterm';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { defaultXtermTheme } from '../features/appearance/config/default-themes';
import type { TerminalTheme } from '../types/terminal-theme.types';
import type { AppearanceSettings } from '../types/appearance.types';
import { log } from '@/utils/log';

/** 终端主题子 Store 的依赖参数 */
export interface TerminalThemeDeps {
  appearanceSettings: { value: Partial<AppearanceSettings> };
  allTerminalThemes: { value: TerminalTheme[] };
  isLoading: { value: boolean };
  error: { value: string | null };
  updateAppearanceSettings: (updates: Record<string, unknown>) => Promise<void>;
}

/**
 * 创建终端主题子 Store，提供主题相关的状态、计算属性和操作方法
 */
export function createTerminalThemeStore(deps: TerminalThemeDeps) {
  const {
    appearanceSettings,
    allTerminalThemes,
    isLoading: _isLoading,
    error,
    updateAppearanceSettings,
  } = deps;
  // 辅助函数：安全获取 ref 值（ref 始终已初始化，不会为 undefined）
  const getSettings = () => appearanceSettings.value as AppearanceSettings;
  const getThemes = () => allTerminalThemes.value as TerminalTheme[];

  // --- 预览状态 ---
  const isPreviewingTerminalTheme = ref(false);
  const previewTerminalThemeData = ref<ITheme | null>(null);

  // --- 计算属性 ---

  /** 当前激活的终端主题 ID */
  const activeTerminalThemeId = computed(() => getSettings().activeTerminalThemeId);

  /** 当前应用的终端主题对象 (ITheme) */
  const currentTerminalTheme = computed<ITheme>(() => {
    const activeId = activeTerminalThemeId.value;
    if (activeId === null || activeId === undefined || getThemes().length === 0) {
      const defaultTheme =
        getThemes().find((t) => t.isSystemDefault === true) ||
        getThemes().find((t) => t.name === '默认');
      return defaultTheme ? defaultTheme.themeData : defaultXtermTheme;
    }
    const activeTheme = getThemes().find((t) => parseInt(t._id ?? '-1', 10) === activeId);
    return activeTheme ? activeTheme.themeData : defaultXtermTheme;
  });

  /** 有效终端主题（考虑预览状态） */
  const effectiveTerminalTheme = computed<ITheme>(() => {
    if (isPreviewingTerminalTheme.value && previewTerminalThemeData.value) {
      return previewTerminalThemeData.value;
    }
    const activeId = activeTerminalThemeId.value;
    if (activeId === null || activeId === undefined || getThemes().length === 0) {
      const defaultPresetTheme =
        getThemes().find((t) => t.isSystemDefault === true) ||
        getThemes().find((t) => t.name === '默认');
      return defaultPresetTheme ? defaultPresetTheme.themeData : defaultXtermTheme;
    }
    const activeSetTheme = getThemes().find((t) => parseInt(t._id ?? '-1', 10) === activeId);
    return activeSetTheme ? activeSetTheme.themeData : defaultXtermTheme;
  });

  // --- 操作方法 ---

  /** 设置激活的终端主题 */
  async function setActiveTerminalTheme(themeId: string) {
    const previousActiveId = getSettings().activeTerminalThemeId;
    const idNum = parseInt(themeId, 10);
    if (Number.isNaN(idNum)) {
      log.error(`[AppearanceStore] setActiveTerminalTheme 接收到无效的数字 ID 字符串: ${themeId}`);
      throw new Error(`无效的主题 ID: ${themeId}`);
    }
    getSettings().activeTerminalThemeId = idNum;
    log.info(`[AppearanceStore] Applied theme locally (ID): ${idNum}`);
    try {
      await updateAppearanceSettings({ activeTerminalThemeId: idNum });
      log.info(`[AppearanceStore] Notified backend. Sent activeTerminalThemeId: ${idNum}`);
    } catch (updateError: unknown) {
      log.error('[AppearanceStore] Failed to update backend activeTerminalThemeId:', updateError);
      getSettings().activeTerminalThemeId = previousActiveId;
      throw new Error(
        `应用主题失败: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
      );
    }
  }

  /** 创建新的终端主题 */
  async function createTerminalTheme(name: string, themeData: ITheme) {
    try {
      await apiClient.post('/terminal-themes', { name, themeData });
      await loadTerminalThemeList();
    } catch (err: unknown) {
      log.error('创建终端主题失败:', err);
      throw new Error(extractErrorMessage(err, '创建终端主题失败'));
    }
  }

  /** 更新终端主题 */
  async function updateTerminalTheme(id: string, name: string, themeData: ITheme) {
    try {
      await apiClient.put(`/terminal-themes/${id}`, { name, themeData });
      await loadTerminalThemeList();
    } catch (err: unknown) {
      log.error('更新终端主题失败:', err);
      throw new Error(extractErrorMessage(err, '更新终端主题失败'));
    }
  }

  /** 删除终端主题 */
  async function deleteTerminalTheme(id: string) {
    try {
      await apiClient.delete(`/terminal-themes/${id}`);
      const idNum = parseInt(id, 10);
      if (!Number.isNaN(idNum) && activeTerminalThemeId.value === idNum) {
        const defaultTheme = getThemes().find((t) => t.isSystemDefault || t.name === '默认');
        const defaultThemeId = defaultTheme?._id;
        if (defaultThemeId) {
          log.info(
            `[AppearanceStore] 删除的主题是当前激活主题，尝试切换到默认主题 ID: ${defaultThemeId}`,
          );
          await setActiveTerminalTheme(defaultThemeId);
        } else {
          log.warn('[AppearanceStore] 无法找到默认主题，保持当前状态');
        }
      }
      await loadTerminalThemeList();
    } catch (err: unknown) {
      log.error('删除终端主题失败:', err);
      throw new Error(extractErrorMessage(err, '删除终端主题失败'));
    }
  }

  /** 导入终端主题文件 */
  async function importTerminalTheme(file: File, name?: string) {
    const formData = new FormData();
    formData.append('themeFile', file);
    if (name) {
      formData.append('name', name);
    }
    try {
      await apiClient.post('/terminal-themes/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await loadTerminalThemeList();
    } catch (err: unknown) {
      log.error('导入终端主题失败:', err);
      throw new Error(extractErrorMessage(err, '导入终端主题失败'));
    }
  }

  /** 导出终端主题文件 */
  async function exportTerminalTheme(id: string) {
    try {
      const response = await apiClient.get(`/terminal-themes/${id}/export`, {
        responseType: 'blob',
      });
      const contentDisposition = response.headers['content-disposition'];
      let filename = `terminal_theme_${id}.json`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch && filenameMatch.length > 1) {
          filename = filenameMatch[1];
        }
      }
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      log.error('导出终端主题失败:', err);
      throw new Error(extractErrorMessage(err, '导出终端主题失败'));
    }
  }

  /** 按需加载单个终端主题的详细数据 */
  async function loadTerminalThemeData(themeId: string): Promise<ITheme | null> {
    const existingTheme = getThemes().find((t) => t._id === themeId);
    if (existingTheme?.themeData && Object.keys(existingTheme.themeData).length > 0) {
      log.info(`[AppearanceStore] Theme data for ${themeId} already loaded.`);
      return existingTheme.themeData;
    }
    log.info(`[AppearanceStore] Loading theme data for ${themeId} from backend...`);
    try {
      const response = await apiClient.get<TerminalTheme>(`/terminal-themes/${themeId}`);
      const fullTheme = response.data;
      if (fullTheme && fullTheme.themeData) {
        const index = getThemes().findIndex((t) => t._id === themeId);
        if (index !== -1) {
          getThemes()[index] = {
            ...getThemes()[index],
            themeData: fullTheme.themeData,
          };
          log.info(`[AppearanceStore] Updated theme data for ${themeId} in local store.`);
        } else {
          log.warn(
            `[AppearanceStore] Theme metadata for ${themeId} not found in initial list, but loaded data.`,
          );
        }
        return fullTheme.themeData;
      }
      log.error(
        `[AppearanceStore] Loaded data for theme ${themeId} is invalid or missing themeData.`,
      );
      return null;
    } catch (err: unknown) {
      log.error(`加载终端主题 ${themeId} 数据失败:`, err);
      error.value = extractErrorMessage(err, `加载主题 ${themeId} 数据失败`);
      return null;
    }
  }

  /** 主题预览控制 */
  function startTerminalThemePreview(themeData: ITheme) {
    previewTerminalThemeData.value = themeData;
    isPreviewingTerminalTheme.value = true;
    log.info('[AppearanceStore] Started terminal theme preview.');
  }

  function stopTerminalThemePreview() {
    previewTerminalThemeData.value = null;
    isPreviewingTerminalTheme.value = false;
    log.info('[AppearanceStore] Stopped terminal theme preview.');
  }

  /** 从后端重新加载终端主题列表（仅元数据） */
  async function loadTerminalThemeList() {
    try {
      const response = await apiClient.get<TerminalTheme[]>('/terminal-themes');
      allTerminalThemes.value = response.data;
    } catch (err: unknown) {
      log.error('重新加载终端主题列表失败:', err);
    }
  }

  return {
    // 状态
    isPreviewingTerminalTheme,
    previewTerminalThemeData,
    // 计算属性
    activeTerminalThemeId,
    currentTerminalTheme,
    effectiveTerminalTheme,
    // 操作方法
    setActiveTerminalTheme,
    createTerminalTheme,
    updateTerminalTheme,
    deleteTerminalTheme,
    importTerminalTheme,
    exportTerminalTheme,
    loadTerminalThemeData,
    startTerminalThemePreview,
    stopTerminalThemePreview,
    loadTerminalThemeList,
  };
}

export type TerminalThemeStore = ReturnType<typeof createTerminalThemeStore>;
