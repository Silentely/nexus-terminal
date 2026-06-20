/**
 * 外观 Store（主编排器）
 * 职责：协调各子 Store，管理核心设置状态和数据加载
 *
 * 子模块拆分:
 * - appearance-terminal-theme.store.ts: 终端主题 CRUD、激活、预览
 * - appearance-font.store.ts: 字体与文字效果设置
 * - appearance-background.store.ts: 背景与 UI 主题管理
 * - appearance-html-presets.store.ts: HTML 预设主题管理
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { useDeviceDetection } from '../composables/useDeviceDetection';
import type { TerminalTheme } from '../types/terminal-theme.types';
import type { AppearanceSettings, UpdateAppearanceDto } from '../types/appearance.types';
import { defaultUiTheme } from '../features/appearance/config/default-themes';
import { extractErrorMessage } from '../utils/errorExtractor';

// 子 Store 导入
import { createTerminalThemeStore } from './appearance-terminal-theme.store';
import { createFontStore } from './appearance-font.store';
import { createBackgroundStore, safeJsonParse } from './appearance-background.store';
import { createHtmlPresetsStore } from './appearance-html-presets.store';
import { log } from '@/utils/log';

// 终端渲染模式类型（内联定义，避免循环依赖）
export type RenderMode = 'auto' | 'webgpu' | 'webgl' | 'canvas' | 'dom';

// 重新导出 safeJsonParse 供外部使用（如 StyleCustomizerUiTab.vue）
export { safeJsonParse };

export const useAppearanceStore = defineStore('appearance', () => {
  const { isMobile } = useDeviceDetection();

  // --- 核心状态 ---
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isStyleCustomizerVisible = ref(false);
  const appearanceSettings = ref<Partial<AppearanceSettings>>({});
  const initialAppearanceDataLoaded = ref(false);
  const allTerminalThemes = ref<TerminalTheme[]>([]);

  // --- 渲染与性能状态 ---
  const terminalRenderMode = ref<RenderMode>('auto');
  const terminalShowFps = ref(false);

  // --- 内部 updateAppearanceSettings（供子 Store 调用） ---
  async function _updateAppearanceSettings(updates: Record<string, unknown>) {
    const payloadToSend: Partial<AppearanceSettings> = {
      ...appearanceSettings.value,
      ...updates,
    };
    const response = await apiClient.put<AppearanceSettings>('/appearance', payloadToSend);
    appearanceSettings.value = response.data;
    log.info('[AppearanceStore] 外观设置已更新:', appearanceSettings.value);
    // 如果 UI 主题或背景更新，重新应用
    if (updates.customUiTheme !== undefined)
      backgroundStore.applyUiTheme(backgroundStore.currentUiTheme.value);
    if (updates.pageBackgroundImage !== undefined) backgroundStore.applyPageBackground();
  }

  // --- 初始化子 Store ---
  const themeStore = createTerminalThemeStore({
    appearanceSettings,
    allTerminalThemes,
    isLoading,
    error,
    updateAppearanceSettings: _updateAppearanceSettings,
  });

  const fontStore = createFontStore({
    appearanceSettings,
    updateAppearanceSettings: _updateAppearanceSettings,
  });

  const backgroundStore = createBackgroundStore({
    appearanceSettings,
    updateAppearanceSettings: _updateAppearanceSettings,
  });

  const htmlPresetsStore = createHtmlPresetsStore({
    appearanceSettings,
    updateAppearanceSettings: _updateAppearanceSettings,
  });

  // --- 覆盖 currentTerminalFontSize 以支持设备检测 ---
  const currentTerminalFontSize = computed<number>(() => {
    let size;
    if (isMobile.value) {
      size = appearanceSettings.value.terminalFontSizeMobile;
    } else {
      size = appearanceSettings.value.terminalFontSize;
    }
    return typeof size === 'number' && size > 0 ? size : 14;
  });

  // --- 渲染模式与 FPS ---
  const VALID_RENDER_MODES: RenderMode[] = ['auto', 'webgpu', 'webgl', 'canvas', 'dom'];
  const isRenderMode = (value: unknown): value is RenderMode =>
    typeof value === 'string' && VALID_RENDER_MODES.includes(value as RenderMode);

  const currentRenderMode = computed<RenderMode>(() => terminalRenderMode.value);
  const isFpsEnabled = computed<boolean>(() => terminalShowFps.value);

  // --- 核心 Action: 加载所有外观数据 ---
  async function loadInitialAppearanceData() {
    isLoading.value = true;
    error.value = null;
    try {
      const [settingsResponse, themesResponse] = await Promise.all([
        apiClient.get<AppearanceSettings>('/appearance'),
        apiClient.get<TerminalTheme[]>('/terminal-themes'),
      ]);
      appearanceSettings.value = settingsResponse.data;
      allTerminalThemes.value = themesResponse.data;
      initialAppearanceDataLoaded.value = true;

      // 从后端加载渲染模式与 FPS 设置（带白名单校验）
      const settings = settingsResponse.data;
      if (isRenderMode(settings.terminalRenderMode)) {
        terminalRenderMode.value = settings.terminalRenderMode;
      } else if (settings.terminalRenderMode) {
        log.warn('[AppearanceStore] 非法渲染模式值，回退到 auto:', settings.terminalRenderMode);
      }
      if (settings.terminalShowFps !== undefined) {
        terminalShowFps.value = String(settings.terminalShowFps) === 'true';
      }

      // 初始化远程预设 URL
      htmlPresetsStore.initRemoteUrl();

      // 应用加载的 UI 主题
      backgroundStore.applyUiTheme(backgroundStore.currentUiTheme.value);
      // 应用背景
      backgroundStore.applyPageBackground();
    } catch (err: unknown) {
      log.error('加载外观数据失败:', err);
      error.value = extractErrorMessage(err, '加载外观数据失败');
      appearanceSettings.value = {};
      allTerminalThemes.value = [];
      initialAppearanceDataLoaded.value = false;
      backgroundStore.applyUiTheme(defaultUiTheme);
      backgroundStore.applyPageBackground();
    } finally {
      isLoading.value = false;
    }
  }

  // --- 核心 Action: 更新外观设置 ---
  async function updateAppearanceSettings(updates: UpdateAppearanceDto) {
    try {
      await _updateAppearanceSettings(updates);
    } catch (err: unknown) {
      log.error('更新外观设置失败:', err);
      throw new Error(extractErrorMessage(err, '更新外观设置失败'));
    }
  }

  // --- 渲染模式 Action ---
  async function setRenderMode(mode: RenderMode) {
    const prevMode = terminalRenderMode.value;
    terminalRenderMode.value = mode;
    try {
      await updateAppearanceSettings({ terminalRenderMode: mode } as UpdateAppearanceDto);
      log.info('[AppearanceStore] 终端渲染模式已切换:', mode);
    } catch (err: unknown) {
      // 回滚本地状态
      terminalRenderMode.value = prevMode;
      log.error('[AppearanceStore] 渲染模式切换失败，已回滚:', err);
    }
  }

  // --- FPS 显示 Action ---
  async function toggleFps() {
    const prevValue = terminalShowFps.value;
    terminalShowFps.value = !terminalShowFps.value;
    try {
      await updateAppearanceSettings({
        terminalShowFps: terminalShowFps.value,
      } as UpdateAppearanceDto);
      log.info('[AppearanceStore] FPS 显示已切换:', terminalShowFps.value);
    } catch (err: unknown) {
      // 回滚本地状态
      terminalShowFps.value = prevValue;
      log.error('[AppearanceStore] FPS 显示切换失败，已回滚:', err);
    }
  }

  // --- 可见性控制 ---
  function toggleStyleCustomizer(visible?: boolean) {
    isStyleCustomizerVisible.value =
      visible === undefined ? !isStyleCustomizerVisible.value : visible;
    log.info(
      '[AppearanceStore] Style Customizer visibility toggled:',
      isStyleCustomizerVisible.value,
    );
  }

  // --- HTML 预设应用 ---
  async function applyHtmlPreset(htmlContent: string) {
    await backgroundStore.setTerminalCustomHTML(htmlContent);
  }

  // --- 统一导出 ---
  return {
    // 核心状态
    isLoading,
    error,
    initialAppearanceDataLoaded,
    appearanceSettings,
    allTerminalThemes,
    isStyleCustomizerVisible,

    // 核心 Action
    loadInitialAppearanceData,
    updateAppearanceSettings,
    toggleStyleCustomizer,

    // 渲染模式与 FPS
    currentRenderMode,
    isFpsEnabled,
    setRenderMode,
    toggleFps,

    // 终端主题（来自 themeStore）
    isPreviewingTerminalTheme: themeStore.isPreviewingTerminalTheme,
    previewTerminalThemeData: themeStore.previewTerminalThemeData,
    activeTerminalThemeId: themeStore.activeTerminalThemeId,
    currentTerminalTheme: themeStore.currentTerminalTheme,
    effectiveTerminalTheme: themeStore.effectiveTerminalTheme,
    setActiveTerminalTheme: themeStore.setActiveTerminalTheme,
    createTerminalTheme: themeStore.createTerminalTheme,
    updateTerminalTheme: themeStore.updateTerminalTheme,
    deleteTerminalTheme: themeStore.deleteTerminalTheme,
    importTerminalTheme: themeStore.importTerminalTheme,
    exportTerminalTheme: themeStore.exportTerminalTheme,
    loadTerminalThemeData: themeStore.loadTerminalThemeData,
    startTerminalThemePreview: themeStore.startTerminalThemePreview,
    stopTerminalThemePreview: themeStore.stopTerminalThemePreview,

    // 字体（来自 fontStore），currentTerminalFontSize 使用带设备检测的版本
    currentTerminalFontFamily: fontStore.currentTerminalFontFamily,
    currentTerminalFontSize, // 覆盖：使用带 isMobile 检测的版本
    terminalFontSizeDesktop: fontStore.terminalFontSizeDesktop,
    terminalFontSizeMobile: fontStore.terminalFontSizeMobile,
    currentEditorFontSize: fontStore.currentEditorFontSize,
    currentEditorFontFamily: fontStore.currentEditorFontFamily,
    currentMobileEditorFontSize: fontStore.currentMobileEditorFontSize,
    setTerminalFontFamily: fontStore.setTerminalFontFamily,
    setTerminalFontSize: fontStore.setTerminalFontSize,
    setTerminalFontSizeMobile: fontStore.setTerminalFontSizeMobile,
    setEditorFontSize: fontStore.setEditorFontSize,
    setEditorFontFamily: fontStore.setEditorFontFamily,
    setMobileEditorFontSize: fontStore.setMobileEditorFontSize,

    // 文字效果（来自 fontStore）
    terminalTextStrokeEnabled: fontStore.terminalTextStrokeEnabled,
    terminalTextStrokeWidth: fontStore.terminalTextStrokeWidth,
    terminalTextStrokeColor: fontStore.terminalTextStrokeColor,
    terminalTextShadowEnabled: fontStore.terminalTextShadowEnabled,
    terminalTextShadowOffsetX: fontStore.terminalTextShadowOffsetX,
    terminalTextShadowOffsetY: fontStore.terminalTextShadowOffsetY,
    terminalTextShadowBlur: fontStore.terminalTextShadowBlur,
    terminalTextShadowColor: fontStore.terminalTextShadowColor,
    setTerminalTextStrokeEnabled: fontStore.setTerminalTextStrokeEnabled,
    setTerminalTextStrokeWidth: fontStore.setTerminalTextStrokeWidth,
    setTerminalTextStrokeColor: fontStore.setTerminalTextStrokeColor,
    setTerminalTextShadowEnabled: fontStore.setTerminalTextShadowEnabled,
    setTerminalTextShadowOffsetX: fontStore.setTerminalTextShadowOffsetX,
    setTerminalTextShadowOffsetY: fontStore.setTerminalTextShadowOffsetY,
    setTerminalTextShadowBlur: fontStore.setTerminalTextShadowBlur,
    setTerminalTextShadowColor: fontStore.setTerminalTextShadowColor,

    // 背景与 UI 主题（来自 backgroundStore）
    isDark: backgroundStore.isDark,
    currentUiTheme: backgroundStore.currentUiTheme,
    pageBackgroundImage: backgroundStore.pageBackgroundImage,
    terminalBackgroundImage: backgroundStore.terminalBackgroundImage,
    isTerminalBackgroundEnabled: backgroundStore.isTerminalBackgroundEnabled,
    shouldRenderTerminalBackground: backgroundStore.shouldRenderTerminalBackground,
    currentTerminalBackgroundOverlayOpacity:
      backgroundStore.currentTerminalBackgroundOverlayOpacity,
    terminalCustomHTML: backgroundStore.terminalCustomHTML,
    saveCustomUiTheme: backgroundStore.saveCustomUiTheme,
    resetCustomUiTheme: backgroundStore.resetCustomUiTheme,
    setTheme: backgroundStore.setTheme,
    setTerminalBackgroundEnabled: backgroundStore.setTerminalBackgroundEnabled,
    setTerminalBackgroundOverlayOpacity: backgroundStore.setTerminalBackgroundOverlayOpacity,
    setTerminalCustomHTML: backgroundStore.setTerminalCustomHTML,
    uploadPageBackground: backgroundStore.uploadPageBackground,
    uploadTerminalBackground: backgroundStore.uploadTerminalBackground,
    removePageBackground: backgroundStore.removePageBackground,
    removeTerminalBackground: backgroundStore.removeTerminalBackground,
    applyUiTheme: backgroundStore.applyUiTheme,
    applyPageBackground: backgroundStore.applyPageBackground,

    // HTML 预设（来自 htmlPresetsStore）
    localHtmlPresets: htmlPresetsStore.localHtmlPresets,
    remoteHtmlPresets: htmlPresetsStore.remoteHtmlPresets,
    remoteHtmlPresetsRepositoryUrl: htmlPresetsStore.remoteHtmlPresetsRepositoryUrl,
    activeHtmlPresetTab: htmlPresetsStore.activeHtmlPresetTab,
    isLoadingHtmlPresets: htmlPresetsStore.isLoadingHtmlPresets,
    htmlPresetError: htmlPresetsStore.htmlPresetError,
    fetchLocalHtmlPresets: htmlPresetsStore.fetchLocalHtmlPresets,
    getLocalHtmlPresetContent: htmlPresetsStore.getLocalHtmlPresetContent,
    createLocalHtmlPreset: htmlPresetsStore.createLocalHtmlPreset,
    updateLocalHtmlPreset: htmlPresetsStore.updateLocalHtmlPreset,
    deleteLocalHtmlPreset: htmlPresetsStore.deleteLocalHtmlPreset,
    fetchRemoteHtmlPresetsRepositoryUrl: htmlPresetsStore.fetchRemoteHtmlPresetsRepositoryUrl,
    updateRemoteHtmlPresetsRepositoryUrl: htmlPresetsStore.updateRemoteHtmlPresetsRepositoryUrl,
    fetchRemoteHtmlPresets: htmlPresetsStore.fetchRemoteHtmlPresets,
    getRemoteHtmlPresetContent: htmlPresetsStore.getRemoteHtmlPresetContent,
    applyHtmlPreset,
  };
});
