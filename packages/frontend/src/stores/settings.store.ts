/**
 * 设置 Store（主编排器）
 * 职责：协调各子 Store，管理核心设置状态、数据加载与更新
 *
 * 子模块拆分:
 * - settings-system.store.ts: 系统级设置计算属性（语言、UI偏好、Docker等）
 * - settings-security.store.ts: 安全设置计算属性（IP白名单/黑名单、登录安全）
 * - settings-layout.store.ts: 布局设置计算属性（侧边栏、文件管理器布局）
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { setLocale, defaultLng, availableLocales } from '../i18n';
import type { PaneName } from './layout.store';

// 子 Store 导入
import {
  createSystemSettingsGetters,
  type SortField,
  type SortOrder,
} from './settings-system.store';
import { createSecuritySettingsGetters } from './settings-security.store';
import { createLayoutSettingsGetters } from './settings-layout.store';
import { log } from '@/utils/log';

// 重新导出类型供外部使用
export type { SortField, SortOrder };

// CaptchaProvider / CaptchaSettings / UpdateCaptchaSettingsDto 已迁移至 captchaSettings.store.ts
// 移除 ITheme 和默认主题定义，这些移到 appearance.store.ts

// 定义通用设置状态类型
interface SettingsState {
  language?: string;
  ipWhitelist?: string;
  maxLoginAttempts?: string;
  loginBanDuration?: string;
  showPopupFileEditor?: string;
  showPopupFileManager?: string;
  shareFileEditorTabs?: string;
  ipWhitelistEnabled?: string;
  autoCopyOnSelect?: string;
  dockerStatusIntervalSeconds?: string;
  dockerDefaultExpand?: string;
  statusMonitorIntervalSeconds?: string;
  workspaceSidebarPersistent?: string;
  sidebarPaneWidths?: string;
  fileManagerRowSizeMultiplier?: string;
  fileManagerColWidths?: string;
  commandInputSyncTarget?: 'quickCommands' | 'commandHistory' | 'none';
  timezone?: string;
  rdpModalWidth?: string;
  rdpModalHeight?: string;
  vncModalWidth?: string;
  vncModalHeight?: string;
  ipBlacklistEnabled?: string;
  dashboardSortBy?: SortField;
  dashboardSortOrder?: SortOrder;
  showConnectionTags?: string;
  showQuickCommandTags?: string;
  layoutLocked?: string;
  terminalScrollbackLimit?: string;
  terminalAutoWrapEnabled?: string;
  sshSuspendKeepAliveSeconds?: string;
  fileManagerShowDeleteConfirmation?: string;
  fileManagerSingleClickOpenFile?: string;
  terminalEnableRightClickPaste?: string;
  showStatusMonitorIpAddress?: string;
  quickCommandRowSizeMultiplier?: string;
  quickCommandsCompactMode?: string;
  terminalOutputEnhancerEnabled?: string;
  terminalEnableBracketedPaste?: string;
  [key: string]: string | undefined;
}

export const useSettingsStore = defineStore('settings', () => {
  // --- 核心状态 ---
  const settings = ref<Partial<SettingsState>>({});
  const parsedSidebarPaneWidths = ref<Record<string, string>>({});
  const parsedFileManagerColWidths = ref<Record<string, number>>({});
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // --- 初始化子 Store ---
  const systemGetters = createSystemSettingsGetters({ settings });
  const securityGetters = createSecuritySettingsGetters({ settings });
  const layoutGetters = createLayoutSettingsGetters({
    settings,
    parsedSidebarPaneWidths,
    parsedFileManagerColWidths,
  });

  // --- 内部 Action: 更新单个设置 ---
  // API 错误消息提取
  interface ApiErrorLike {
    response?: { status?: number; data?: unknown; headers?: unknown };
    request?: unknown;
    message?: string;
  }

  const getApiErrorMessage = (err: unknown, fallback: string): string => {
    const apiErr = err as ApiErrorLike;
    const status = apiErr.response?.status;
    const data = apiErr.response?.data;

    if (typeof data === 'string' && data.trim()) {
      return data.trim();
    }

    const dataObject =
      typeof data === 'object' && data !== null
        ? (data as { message?: unknown; error?: { message?: unknown } })
        : null;
    let messageFromObject: string | null = null;
    if (typeof dataObject?.message === 'string') {
      messageFromObject = dataObject.message;
    } else if (typeof dataObject?.error?.message === 'string') {
      messageFromObject = dataObject.error.message;
    }

    if (messageFromObject && messageFromObject.trim()) {
      return messageFromObject.trim();
    }

    if (status === 429) {
      return '请求过于频繁，请稍后再试';
    }

    return extractErrorMessage(err, fallback);
  };

  // --- 核心 Action: 加载设置 ---
  async function loadInitialSettings() {
    isLoading.value = true;
    error.value = null;
    let determinedLang: string | undefined;

    try {
      log.info('[SettingsStore] 加载通用设置...');
      const [generalSettingsResponse, showConnectionTagsResponse, showQuickCommandTagsResponse] =
        await Promise.all([
          apiClient.get<Record<string, string>>('/settings'),
          apiClient.get<{ enabled: boolean }>('/settings/show-connection-tags'),
          apiClient.get<{ enabled: boolean }>('/settings/show-quick-command-tags'),
        ]);

      settings.value = generalSettingsResponse.data;
      settings.value.showConnectionTags = String(showConnectionTagsResponse.data.enabled);
      settings.value.showQuickCommandTags = String(showQuickCommandTagsResponse.data.enabled);

      log.info('[SettingsStore] Fetched settings from backend:', JSON.stringify(settings.value));

      // --- 设置默认值 (如果后端未返回) ---
      applyDefaultValues();

      // --- 解析侧边栏宽度 ---
      parseSidebarPaneWidths();

      // --- 解析文件管理器布局 ---
      parseFileManagerLayout();

      // --- 加载 localStorage 缓存的设置 ---
      loadLocalStorageOverrides();

      // --- 语言设置 ---
      determinedLang = resolveLanguage(settings.value.language);
      if (determinedLang) {
        log.info(`[SettingsStore] Determined language: ${determinedLang}. Calling setLocale...`);
        setLocale(determinedLang);
      } else {
        log.error('[SettingsStore] Could not determine a valid language. This should not happen.');
        setLocale(defaultLng);
      }
    } catch (err: unknown) {
      log.error('Error loading general settings:', err);
      error.value = getApiErrorMessage(err, 'Failed to load settings');
      const navigatorLocale = navigator.language;
      const navigatorLangPart = navigatorLocale?.split('-')[0];
      let fallbackLang = defaultLng;
      if (navigatorLocale && availableLocales.includes(navigatorLocale)) {
        fallbackLang = navigatorLocale;
      } else if (navigatorLangPart && availableLocales.includes(navigatorLangPart)) {
        fallbackLang = navigatorLangPart;
      }
      log.info(
        `[SettingsStore] Error loading settings. Falling back to language: ${fallbackLang}. Calling setLocale...`,
      );
      setLocale(fallbackLang);
    } finally {
      isLoading.value = false;
    }
  }

  /** 应用默认值 */
  function applyDefaultValues() {
    const defaults: Record<string, string> = {
      showPopupFileEditor: 'true',
      showPopupFileManager: 'false',
      shareFileEditorTabs: 'true',
      ipWhitelistEnabled: 'false',
      maxLoginAttempts: '5',
      loginBanDuration: '300',
      ipBlacklistEnabled: 'true',
      autoCopyOnSelect: 'false',
      dockerStatusIntervalSeconds: '2',
      dockerDefaultExpand: 'false',
      statusMonitorIntervalSeconds: '3',
      workspaceSidebarPersistent: 'false',
      commandInputSyncTarget: 'none',
      timezone: 'UTC',
      rdpModalWidth: '1064',
      rdpModalHeight: '858',
      vncModalWidth: '1024',
      vncModalHeight: '768',
      dashboardSortBy: 'last_connected_at',
      dashboardSortOrder: 'desc',
      showConnectionTags: 'true',
      showQuickCommandTags: 'true',
      layoutLocked: 'false',
      terminalScrollbackLimit: '5000',
      terminalAutoWrapEnabled: 'true',
      sshSuspendKeepAliveSeconds: '0',
      fileManagerShowDeleteConfirmation: 'true',
      fileManagerSingleClickOpenFile: 'false',
      terminalEnableRightClickPaste: 'true',
      showStatusMonitorIpAddress: 'false',
      quickCommandRowSizeMultiplier: '1.0',
      quickCommandsCompactMode: 'false',
      terminalOutputEnhancerEnabled: 'true',
      terminalEnableBracketedPaste: 'true',
    };
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (settings.value[key] === undefined) {
        settings.value[key] = defaultValue;
        log.info(`[SettingsStore] ${key} not found, set to default: ${defaultValue}`);
      }
    }
  }

  /** 解析侧边栏宽度 */
  function parseSidebarPaneWidths() {
    const defaultPaneWidth = '350px';
    const knownPanes: PaneName[] = [
      'connections',
      'fileManager',
      'editor',
      'statusMonitor',
      'commandHistory',
      'quickCommands',
      'dockerManager',
    ];
    let loadedWidths: Record<string, string> = {};
    try {
      if (settings.value.sidebarPaneWidths) {
        loadedWidths = JSON.parse(settings.value.sidebarPaneWidths);
        if (typeof loadedWidths !== 'object' || loadedWidths === null) {
          log.warn('[SettingsStore] Invalid sidebarPaneWidths format loaded, resetting.');
          loadedWidths = {};
        }
      }
    } catch (parseError: unknown) {
      log.error('[SettingsStore] Failed to parse sidebarPaneWidths, resetting.', parseError);
      loadedWidths = {};
    }
    const finalWidths: Record<string, string> = {};
    knownPanes.forEach((pane) => {
      finalWidths[pane] = loadedWidths[pane] || defaultPaneWidth;
    });
    parsedSidebarPaneWidths.value = finalWidths;
  }

  /** 解析文件管理器布局 */
  function parseFileManagerLayout() {
    const defaultFileManagerRowMultiplier = '1.0';
    const defaultFileManagerColWidths: Record<string, number> = {
      type: 50,
      name: 300,
      size: 100,
      permissions: 120,
      modified: 180,
    };

    if (settings.value.fileManagerRowSizeMultiplier === undefined) {
      settings.value.fileManagerRowSizeMultiplier = defaultFileManagerRowMultiplier;
    }
    const parsedMultiplier = parseFloat(settings.value.fileManagerRowSizeMultiplier);
    if (Number.isNaN(parsedMultiplier) || parsedMultiplier <= 0) {
      settings.value.fileManagerRowSizeMultiplier = defaultFileManagerRowMultiplier;
    }

    let loadedFmWidths: Record<string, number> = {};
    try {
      if (settings.value.fileManagerColWidths) {
        loadedFmWidths = JSON.parse(settings.value.fileManagerColWidths);
        if (typeof loadedFmWidths !== 'object' || loadedFmWidths === null) {
          loadedFmWidths = {};
        }
        for (const key of Object.keys(loadedFmWidths)) {
          if (typeof loadedFmWidths[key] !== 'number') {
            loadedFmWidths = {};
            break;
          }
        }
      }
    } catch (parseError: unknown) {
      log.error('[SettingsStore] Failed to parse fileManagerColWidths, resetting.', parseError);
      loadedFmWidths = {};
    }
    const finalFmWidths: Record<string, number> = { ...defaultFileManagerColWidths };
    Object.keys(defaultFileManagerColWidths).forEach((key) => {
      if (loadedFmWidths[key] !== undefined && loadedFmWidths[key] > 0) {
        finalFmWidths[key] = loadedFmWidths[key];
      }
    });
    parsedFileManagerColWidths.value = finalFmWidths;
  }

  /** 从 localStorage 加载覆盖设置 */
  function loadLocalStorageOverrides() {
    const localQcRowSizeMultiplier = localStorage.getItem('nexus_quickCommandRowSizeMultiplier');
    if (localQcRowSizeMultiplier) {
      const parsedLocalMultiplier = parseFloat(localQcRowSizeMultiplier);
      if (!Number.isNaN(parsedLocalMultiplier) && parsedLocalMultiplier > 0) {
        settings.value.quickCommandRowSizeMultiplier = localQcRowSizeMultiplier;
      }
    }
    const localQcCompactMode = localStorage.getItem('nexus_quickCommandsCompactMode');
    if (localQcCompactMode === 'true' || localQcCompactMode === 'false') {
      settings.value.quickCommandsCompactMode = localQcCompactMode;
    }
  }

  /** 解析语言设置 */
  function resolveLanguage(langFromSettings: string | undefined): string {
    if (langFromSettings && availableLocales.includes(langFromSettings)) {
      return langFromSettings;
    }
    const navigatorLocale = navigator.language;
    if (navigatorLocale && availableLocales.includes(navigatorLocale)) {
      return navigatorLocale;
    }
    const navigatorLangPart = navigatorLocale?.split('-')[0];
    if (navigatorLangPart && availableLocales.includes(navigatorLangPart)) {
      return navigatorLangPart;
    }
    return defaultLng;
  }

  // --- 核心 Action: 更新单个设置 ---
  async function updateSetting(key: keyof SettingsState, value: string | boolean) {
    const allowedKeys: Array<keyof SettingsState> = [
      'language',
      'ipWhitelist',
      'maxLoginAttempts',
      'loginBanDuration',
      'showPopupFileEditor',
      'showPopupFileManager',
      'shareFileEditorTabs',
      'ipWhitelistEnabled',
      'autoCopyOnSelect',
      'dockerStatusIntervalSeconds',
      'dockerDefaultExpand',
      'statusMonitorIntervalSeconds',
      'workspaceSidebarPersistent',
      'sidebarPaneWidths',
      'fileManagerRowSizeMultiplier',
      'fileManagerColWidths',
      'commandInputSyncTarget',
      'timezone',
      'rdpModalWidth',
      'rdpModalHeight',
      'vncModalWidth',
      'vncModalHeight',
      'ipBlacklistEnabled',
      'dashboardSortBy',
      'dashboardSortOrder',
      'showConnectionTags',
      'showQuickCommandTags',
      'layoutLocked',
      'terminalScrollbackLimit',
      'terminalAutoWrapEnabled',
      'sshSuspendKeepAliveSeconds',
      'fileManagerShowDeleteConfirmation',
      'fileManagerSingleClickOpenFile',
      'terminalEnableRightClickPaste',
      'showStatusMonitorIpAddress',
      'quickCommandRowSizeMultiplier',
      'quickCommandsCompactMode',
      'terminalOutputEnhancerEnabled',
      'terminalEnableBracketedPaste',
    ];
    if (!allowedKeys.includes(key)) {
      log.error(`[SettingsStore] 尝试更新不允许的设置键: ${key}`);
      throw new Error(`不允许更新设置项 '${key}'`);
    }

    const booleanEndpoints: Partial<Record<keyof SettingsState, string>> = {
      showConnectionTags: '/settings/show-connection-tags',
      showQuickCommandTags: '/settings/show-quick-command-tags',
      autoCopyOnSelect: '/settings/auto-copy-on-select',
    };

    try {
      let apiPromise: Promise<unknown>;
      const endpoint = booleanEndpoints[key];

      if (endpoint && typeof value === 'boolean') {
        apiPromise = apiClient.put(endpoint, { enabled: value });
      } else if (typeof value === 'string') {
        const payload = { [key]: value };
        apiPromise = apiClient.put('/settings', payload);
      } else {
        throw new Error(
          `Invalid value type for setting '${key}': expected boolean for specific endpoint or string for general.`,
        );
      }

      await apiPromise;
      settings.value = { ...settings.value, [key]: String(value) };

      if (
        key === 'quickCommandsCompactMode' &&
        (String(value) === 'true' || String(value) === 'false')
      ) {
        try {
          localStorage.setItem('nexus_quickCommandsCompactMode', String(value));
        } catch (storageError: unknown) {
          log.error(
            '[SettingsStore] Failed to save quickCommandsCompactMode to localStorage:',
            storageError,
          );
        }
      }

      if (key === 'language' && typeof value === 'string' && availableLocales.includes(value)) {
        setLocale(value);
      } else if (key === 'language') {
        log.warn(
          `[SettingsStore] updateSetting: Attempted to set invalid language '${value}'. Ignoring i18n update.`,
        );
      }
    } catch (err: unknown) {
      log.error(`[SettingsStore] Failed to update setting '${key}' via API. Error:`, err);
      throw new Error(getApiErrorMessage(err, `更新设置项 '${key}' 失败`));
    }
  }

  // --- 核心 Action: 批量更新设置 ---
  async function updateMultipleSettings(updates: Partial<SettingsState>) {
    const allowedKeys: Array<keyof SettingsState> = [
      'language',
      'ipWhitelist',
      'maxLoginAttempts',
      'loginBanDuration',
      'showPopupFileEditor',
      'showPopupFileManager',
      'shareFileEditorTabs',
      'ipWhitelistEnabled',
      'autoCopyOnSelect',
      'dockerStatusIntervalSeconds',
      'dockerDefaultExpand',
      'statusMonitorIntervalSeconds',
      'workspaceSidebarPersistent',
      'sidebarPaneWidths',
      'fileManagerRowSizeMultiplier',
      'fileManagerColWidths',
      'commandInputSyncTarget',
      'timezone',
      'rdpModalWidth',
      'rdpModalHeight',
      'vncModalWidth',
      'vncModalHeight',
      'ipBlacklistEnabled',
      'dashboardSortBy',
      'dashboardSortOrder',
      'showConnectionTags',
      'showQuickCommandTags',
      'layoutLocked',
      'terminalScrollbackLimit',
      'terminalAutoWrapEnabled',
      'sshSuspendKeepAliveSeconds',
      'fileManagerShowDeleteConfirmation',
      'fileManagerSingleClickOpenFile',
      'terminalEnableRightClickPaste',
      'showStatusMonitorIpAddress',
      'quickCommandRowSizeMultiplier',
      'quickCommandsCompactMode',
      'terminalOutputEnhancerEnabled',
      'terminalEnableBracketedPaste',
    ];
    const filteredUpdates: Partial<SettingsState> = {};
    let languageUpdate: string | undefined;

    for (const key of Object.keys(updates)) {
      if (allowedKeys.includes(key as keyof SettingsState)) {
        filteredUpdates[key as keyof SettingsState] = updates[key as keyof SettingsState];
        if (key === 'language') {
          const langValue = updates[key];
          if (langValue && availableLocales.includes(langValue)) {
            languageUpdate = langValue;
          }
        }
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return;
    }

    try {
      await apiClient.put('/settings', filteredUpdates);
      settings.value = { ...settings.value, ...filteredUpdates };
      if (languageUpdate) {
        setLocale(languageUpdate);
      }
    } catch (err: unknown) {
      log.error('批量更新设置失败:', err);
      throw new Error(getApiErrorMessage(err, '批量更新设置失败'));
    }
  }

  // --- 布局专用 Action ---
  async function updateSidebarPaneWidth(paneName: PaneName, width: string) {
    if (!paneName) return;
    const newWidths = { ...parsedSidebarPaneWidths.value, [paneName]: width };
    parsedSidebarPaneWidths.value = newWidths;
    try {
      await updateMultipleSettings({ sidebarPaneWidths: JSON.stringify(newWidths) });
    } catch (err: unknown) {
      log.error(
        `[SettingsStore] Failed to save sidebarPaneWidths after updating ${paneName}:`,
        err,
      );
    }
  }

  async function updateFileManagerLayoutSettings(
    multiplier: number,
    widths: Record<string, number>,
  ) {
    const multiplierString = multiplier.toFixed(2);
    const widthsString = JSON.stringify(widths);
    parsedFileManagerColWidths.value = widths;
    settings.value.fileManagerRowSizeMultiplier = multiplierString;
    settings.value.fileManagerColWidths = widthsString;
    try {
      await updateMultipleSettings({
        fileManagerRowSizeMultiplier: multiplierString,
        fileManagerColWidths: widthsString,
      });
    } catch (err: unknown) {
      log.error('[SettingsStore] Failed to save file manager layout settings:', err);
    }
  }

  async function updateQuickCommandRowSizeMultiplier(multiplier: number) {
    const multiplierString = multiplier.toFixed(2);
    try {
      await updateSetting('quickCommandRowSizeMultiplier', multiplierString);
      try {
        localStorage.setItem('nexus_quickCommandRowSizeMultiplier', multiplierString);
      } catch (storageError: unknown) {
        log.error(
          '[SettingsStore] Failed to save quickCommandRowSizeMultiplier to localStorage:',
          storageError,
        );
      }
    } catch (err: unknown) {
      log.error('[SettingsStore] Failed to save Quick Command row size multiplier:', err);
    }
  }

  async function saveDashboardSortPreference(sortBy: SortField, sortOrder: SortOrder) {
    try {
      await updateMultipleSettings({
        dashboardSortBy: sortBy,
        dashboardSortOrder: sortOrder,
      });
    } catch (err: unknown) {
      log.error('[SettingsStore] Failed to save dashboard sort preference:', err);
    }
  }

  // --- 统一导出 ---
  return {
    // 核心状态
    settings,
    isLoading,
    error,

    // 核心 Action
    loadInitialSettings,
    updateSetting,
    updateMultipleSettings,
    updateSidebarPaneWidth,
    updateFileManagerLayoutSettings,
    updateQuickCommandRowSizeMultiplier,
    saveDashboardSortPreference,

    // 系统设置（来自 systemGetters）
    language: systemGetters.language,
    showPopupFileEditorBoolean: systemGetters.showPopupFileEditorBoolean,
    showPopupFileManagerBoolean: systemGetters.showPopupFileManagerBoolean,
    shareFileEditorTabsBoolean: systemGetters.shareFileEditorTabsBoolean,
    autoCopyOnSelectBoolean: systemGetters.autoCopyOnSelectBoolean,
    dockerDefaultExpandBoolean: systemGetters.dockerDefaultExpandBoolean,
    statusMonitorIntervalSecondsNumber: systemGetters.statusMonitorIntervalSecondsNumber,
    statusMonitorShowIpBoolean: systemGetters.statusMonitorShowIpBoolean,
    commandInputSyncTarget: systemGetters.commandInputSyncTarget,
    timezone: systemGetters.timezone,
    dashboardSortBy: systemGetters.dashboardSortBy,
    dashboardSortOrder: systemGetters.dashboardSortOrder,
    showConnectionTagsBoolean: systemGetters.showConnectionTagsBoolean,
    showQuickCommandTagsBoolean: systemGetters.showQuickCommandTagsBoolean,
    quickCommandsCompactModeBoolean: systemGetters.quickCommandsCompactModeBoolean,
    quickCommandRowSizeMultiplierNumber: systemGetters.quickCommandRowSizeMultiplierNumber,
    terminalOutputEnhancerEnabledBoolean: systemGetters.terminalOutputEnhancerEnabledBoolean,
    terminalScrollbackLimitNumber: systemGetters.terminalScrollbackLimitNumber,
    terminalAutoWrapEnabledBoolean: systemGetters.terminalAutoWrapEnabledBoolean,
    terminalEnableRightClickPasteBoolean: systemGetters.terminalEnableRightClickPasteBoolean,
    terminalEnableBracketedPasteBoolean: systemGetters.terminalEnableBracketedPasteBoolean,
    sshSuspendKeepAliveSecondsNumber: systemGetters.sshSuspendKeepAliveSecondsNumber,

    // 安全设置（来自 securityGetters）
    ipWhitelistEnabled: securityGetters.ipWhitelistEnabled,
    ipBlacklistEnabledBoolean: securityGetters.ipBlacklistEnabledBoolean,

    // 布局设置（来自 layoutGetters）
    workspaceSidebarPersistentBoolean: layoutGetters.workspaceSidebarPersistentBoolean,
    getSidebarPaneWidth: layoutGetters.getSidebarPaneWidth,
    fileManagerRowSizeMultiplierNumber: layoutGetters.fileManagerRowSizeMultiplierNumber,
    fileManagerColWidthsObject: layoutGetters.fileManagerColWidthsObject,
    fileManagerShowDeleteConfirmationBoolean:
      layoutGetters.fileManagerShowDeleteConfirmationBoolean,
    fileManagerSingleClickOpenFileBoolean: layoutGetters.fileManagerSingleClickOpenFileBoolean,
    layoutLockedBoolean: layoutGetters.layoutLockedBoolean,
  };
});
