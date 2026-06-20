/**
 * 外观 Store - HTML 预设子模块
 * 职责：本地/远程 HTML 预设主题的 CRUD 与管理
 */
import { ref } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import type { AppearanceSettings } from '../types/appearance.types';
import { log } from '@/utils/log';

/** HTML 预设子 Store 的依赖参数 */
export interface HtmlPresetsDeps {
  appearanceSettings: { value: Partial<AppearanceSettings> };
  updateAppearanceSettings: (updates: Record<string, unknown>) => Promise<void>;
}

/**
 * 创建 HTML 预设子 Store
 */
export function createHtmlPresetsStore(deps: HtmlPresetsDeps) {
  const { appearanceSettings, updateAppearanceSettings } = deps;
  // 辅助函数：安全获取 settings（ref 始终已初始化，不会为 undefined）
  const getSettings = () => appearanceSettings.value as AppearanceSettings;

  // --- 状态 ---
  const localHtmlPresets = ref<Array<{ name: string; type: 'preset' | 'custom' }>>([]);
  const remoteHtmlPresets = ref<Array<{ name: string; downloadUrl?: string }>>([]);
  const remoteHtmlPresetsRepositoryUrl = ref<string | null>(null);
  const activeHtmlPresetTab = ref<'local' | 'remote'>('local');
  const isLoadingHtmlPresets = ref(false);
  const htmlPresetError = ref<string | null>(null);

  // --- 本地 HTML 预设操作 ---

  async function fetchLocalHtmlPresets() {
    isLoadingHtmlPresets.value = true;
    htmlPresetError.value = null;
    try {
      const response = await apiClient.get<Array<{ name: string; type: 'preset' | 'custom' }>>(
        '/appearance/html-presets/local',
      );
      localHtmlPresets.value = response.data;
    } catch (err: unknown) {
      log.error('获取本地 HTML 主题列表失败:', err);
      htmlPresetError.value = extractErrorMessage(err, '获取本地 HTML 主题列表失败');
      localHtmlPresets.value = [];
    } finally {
      isLoadingHtmlPresets.value = false;
    }
  }

  async function getLocalHtmlPresetContent(name: string): Promise<string> {
    try {
      const response = await apiClient.get<string>(`/appearance/html-presets/local/${name}`, {
        transformResponse: (res) => res,
      });
      return response.data;
    } catch (err: unknown) {
      log.error(`获取本地 HTML 主题 '${name}' 内容失败:`, err);
      throw new Error(extractErrorMessage(err, `获取主题 '${name}' 内容失败`));
    }
  }

  async function createLocalHtmlPreset(name: string, content: string) {
    try {
      await apiClient.post('/appearance/html-presets/local', { name, content });
      await fetchLocalHtmlPresets();
    } catch (err: unknown) {
      log.error('创建本地 HTML 主题失败:', err);
      throw new Error(extractErrorMessage(err, '创建本地 HTML 主题失败'));
    }
  }

  async function updateLocalHtmlPreset(name: string, content: string) {
    try {
      await apiClient.put(`/appearance/html-presets/local/${name}`, { content });
    } catch (err: unknown) {
      log.error(`更新本地 HTML 主题 '${name}' 失败:`, err);
      throw new Error(extractErrorMessage(err, `更新主题 '${name}' 失败`));
    }
  }

  async function deleteLocalHtmlPreset(name: string) {
    try {
      await apiClient.delete(`/appearance/html-presets/local/${name}`);
      await fetchLocalHtmlPresets();
    } catch (err: unknown) {
      log.error(`删除本地 HTML 主题 '${name}' 失败:`, err);
      throw new Error(extractErrorMessage(err, `删除主题 '${name}' 失败`));
    }
  }

  // --- 远程 HTML 预设操作 ---

  async function fetchRemoteHtmlPresetsRepositoryUrl() {
    isLoadingHtmlPresets.value = true;
    htmlPresetError.value = null;
    try {
      const response = await apiClient.get<{ url: string | null }>(
        '/appearance/html-presets/remote/repository-url',
      );
      remoteHtmlPresetsRepositoryUrl.value = response.data.url;
    } catch (err: unknown) {
      log.error('获取远程 HTML 主题仓库链接失败:', err);
      htmlPresetError.value = extractErrorMessage(err, '获取远程仓库链接失败');
    } finally {
      isLoadingHtmlPresets.value = false;
    }
  }

  async function updateRemoteHtmlPresetsRepositoryUrl(url: string) {
    try {
      await apiClient.put('/appearance/html-presets/remote/repository-url', { url });
      remoteHtmlPresetsRepositoryUrl.value = url;
      await updateAppearanceSettings({ remoteHtmlPresetsUrl: url });
    } catch (err: unknown) {
      log.error('更新远程 HTML 主题仓库链接失败:', err);
      throw new Error(extractErrorMessage(err, '更新远程仓库链接失败'));
    }
  }

  async function fetchRemoteHtmlPresets(repoUrlParam?: string) {
    isLoadingHtmlPresets.value = true;
    htmlPresetError.value = null;
    const urlToFetch = repoUrlParam || remoteHtmlPresetsRepositoryUrl.value;
    if (!urlToFetch) {
      htmlPresetError.value = '远程仓库链接未设置';
      isLoadingHtmlPresets.value = false;
      remoteHtmlPresets.value = [];
      return;
    }
    try {
      const params: { repoUrl?: string } = {};
      if (repoUrlParam) {
        params.repoUrl = repoUrlParam;
      }
      const response = await apiClient.get<Array<{ name: string; downloadUrl?: string }>>(
        '/appearance/html-presets/remote/list',
        { params },
      );
      remoteHtmlPresets.value = response.data;
    } catch (err: unknown) {
      log.error('获取远程 HTML 主题列表失败:', err);
      htmlPresetError.value = extractErrorMessage(err, '获取远程主题列表失败');
      remoteHtmlPresets.value = [];
    } finally {
      isLoadingHtmlPresets.value = false;
    }
  }

  async function getRemoteHtmlPresetContent(fileUrl: string): Promise<string> {
    try {
      const response = await apiClient.get<string>(`/appearance/html-presets/remote/content`, {
        params: { fileUrl },
        transformResponse: (res) => res,
      });
      return response.data;
    } catch (err: unknown) {
      log.error(`获取远程 HTML 主题内容 (URL: ${fileUrl}) 失败:`, err);
      throw new Error(extractErrorMessage(err, '获取远程主题内容失败'));
    }
  }

  /** 初始化远程预设仓库 URL */
  function initRemoteUrl() {
    remoteHtmlPresetsRepositoryUrl.value = getSettings().remoteHtmlPresetsUrl || null;
  }

  return {
    // 状态
    localHtmlPresets,
    remoteHtmlPresets,
    remoteHtmlPresetsRepositoryUrl,
    activeHtmlPresetTab,
    isLoadingHtmlPresets,
    htmlPresetError,
    // 本地操作
    fetchLocalHtmlPresets,
    getLocalHtmlPresetContent,
    createLocalHtmlPreset,
    updateLocalHtmlPreset,
    deleteLocalHtmlPreset,
    // 远程操作
    fetchRemoteHtmlPresetsRepositoryUrl,
    updateRemoteHtmlPresetsRepositoryUrl,
    fetchRemoteHtmlPresets,
    getRemoteHtmlPresetContent,
    initRemoteUrl,
  };
}

export type HtmlPresetsStore = ReturnType<typeof createHtmlPresetsStore>;
