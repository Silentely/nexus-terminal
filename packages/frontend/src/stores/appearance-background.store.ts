/**
 * 外观 Store - 背景与 UI 主题子模块
 * 职责：页面/终端背景图片管理、UI 主题（CSS 变量）应用、暗色模式
 */
import { computed, watch, nextTick } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { defaultUiTheme } from '../features/appearance/config/default-themes';
import type { AppearanceSettings } from '../types/appearance.types';
import { log } from '@/utils/log';

/** 背景与 UI 主题子 Store 的依赖参数 */
export interface BackgroundDeps {
  appearanceSettings: { value: Partial<AppearanceSettings> };
  updateAppearanceSettings: (updates: Record<string, unknown>) => Promise<void>;
}

/**
 * 创建背景与 UI 主题子 Store
 */
export function createBackgroundStore(deps: BackgroundDeps) {
  const { appearanceSettings, updateAppearanceSettings } = deps;
  // 辅助函数：安全获取 settings（ref 始终已初始化，不会为 undefined）
  const getSettings = () => appearanceSettings.value as AppearanceSettings;

  // --- 计算属性 ---

  /** 页面背景颜色是否为深色 */
  const isDark = computed(() => {
    const bgColor = currentUiTheme.value['--app-bg-color'] || '#ffffff';
    return isColorDark(bgColor);
  });

  /** 当前应用的 UI 主题 (CSS 变量对象) */
  const currentUiTheme = computed<Record<string, string>>(() => {
    const parsedTheme = safeJsonParse<Record<string, string> | null>(
      getSettings().customUiTheme,
      defaultUiTheme,
    );
    return normalizeUiTheme(isUiThemeRecord(parsedTheme) ? parsedTheme : {});
  });

  /** 页面背景图片 URL */
  const pageBackgroundImage = computed(() => getSettings().pageBackgroundImage);

  /** 终端背景图片 URL */
  const terminalBackgroundImage = computed(() => getSettings().terminalBackgroundImage);

  /** 终端自定义 CSS（在 isTerminalBackgroundEnabled / shouldRenderTerminalBackground 之前声明，避免隐式前向依赖） */
  const terminalCustomHTML = computed(() => getSettings().terminal_custom_html ?? null);

  /** 终端背景是否启用（用户偏好，反映后端持久化的设置值） */
  const isTerminalBackgroundEnabled = computed<boolean>(() => {
    const enabled = getSettings().terminalBackgroundEnabled;
    return typeof enabled === 'boolean' ? enabled : true;
  });

  /**
   * 终端背景是否应实际渲染（有效渲染状态）。
   * 在用户启用的基础上，还必须存在背景图片或非空自定义 HTML，
   * 否则会出现"透明终端 + 黑色蒙版 + 无背景 = 全黑"的问题。
   */
  const shouldRenderTerminalBackground = computed<boolean>(() => {
    if (!isTerminalBackgroundEnabled.value) return false;
    const hasImage = !!terminalBackgroundImage.value;
    const hasHtml = !!(terminalCustomHTML.value && terminalCustomHTML.value.trim());
    return hasImage || hasHtml;
  });

  /** 终端背景蒙版透明度 */
  const currentTerminalBackgroundOverlayOpacity = computed<number>(() => {
    const opacity = getSettings().terminalBackgroundOverlayOpacity;
    return typeof opacity === 'number' && opacity >= 0 && opacity <= 1 ? opacity : 0.5;
  });

  // --- UI 主题操作方法 ---

  /** 保存自定义 UI 主题到后端 */
  async function saveCustomUiTheme(uiTheme: Record<string, string>) {
    await updateAppearanceSettings({ customUiTheme: JSON.stringify(uiTheme) });
  }

  /** 重置为默认 UI 主题 */
  async function resetCustomUiTheme() {
    await saveCustomUiTheme(defaultUiTheme);
  }

  /** 切换 UI 主题 (Light/Dark) */
  async function setTheme(mode: 'light' | 'dark') {
    const { darkUiTheme } = await import('../features/appearance/config/default-themes');
    const theme = mode === 'dark' ? darkUiTheme : defaultUiTheme;
    await saveCustomUiTheme(theme);
  }

  // --- 终端背景操作方法 ---

  async function setTerminalBackgroundEnabled(enabled: boolean) {
    log.info(
      `[AppearanceStore LOG] setTerminalBackgroundEnabled 调用，准备发送给后端的值: ${enabled}`,
    );
    await updateAppearanceSettings({ terminalBackgroundEnabled: enabled });
    log.info(`[AppearanceStore LOG] setTerminalBackgroundEnabled 更新后端调用完成。`);
  }

  async function setTerminalBackgroundOverlayOpacity(opacity: number) {
    await updateAppearanceSettings({ terminalBackgroundOverlayOpacity: opacity });
  }

  async function setTerminalCustomHTML(html: string | null) {
    try {
      await updateAppearanceSettings({ terminal_custom_html: html });
    } catch (err: unknown) {
      log.error('设置终端自定义 HTML 失败:', err);
      throw new Error(extractErrorMessage(err, '设置终端自定义 HTML 失败'));
    }
  }

  // --- 背景图片操作方法 ---

  async function uploadPageBackground(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('pageBackgroundFile', file);
    try {
      const response = await apiClient.post<{ filePath: string }>(
        '/appearance/background/page',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      getSettings().pageBackgroundImage = response.data.filePath;
      applyPageBackground();
      return response.data.filePath;
    } catch (err: unknown) {
      log.error('上传页面背景失败:', err);
      throw new Error(extractErrorMessage(err, '上传页面背景失败'));
    }
  }

  async function uploadTerminalBackground(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('terminalBackgroundFile', file);
    try {
      const response = await apiClient.post<{ filePath: string }>(
        '/appearance/background/terminal',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      getSettings().terminalBackgroundImage = response.data.filePath;
      return response.data.filePath;
    } catch (err: unknown) {
      log.error('上传终端背景失败:', err);
      throw new Error(extractErrorMessage(err, '上传终端背景失败'));
    }
  }

  async function removePageBackground() {
    try {
      await apiClient.delete('/appearance/background/page');
      await updateAppearanceSettings({ pageBackgroundImage: '' });
    } catch (err: unknown) {
      log.error('移除页面背景失败:', err);
      throw new Error(extractErrorMessage(err, '移除页面背景失败'));
    }
  }

  async function removeTerminalBackground() {
    try {
      await apiClient.delete('/appearance/background/terminal');
      await updateAppearanceSettings({ terminalBackgroundImage: '' });
    } catch (err: unknown) {
      log.error('移除终端背景失败:', err);
      throw new Error(extractErrorMessage(err, '移除终端背景失败'));
    }
  }

  // --- 辅助方法 ---

  /** 将 UI 主题 (CSS 变量) 应用到文档根元素 */
  function applyUiTheme(theme: Record<string, string>) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme)) {
      root.style.setProperty(key, value);
    }
  }

  /** 应用页面背景设置到 body 元素 */
  function applyPageBackground() {
    const { body } = document;
    if (pageBackgroundImage.value) {
      const backendUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin;
      const imagePath = pageBackgroundImage.value;
      log.info(
        `[AppearanceStore applyPageBackground] Base URL: "${backendUrl}", Image Path: "${imagePath}"`,
      );

      let fullImageUrl = '';
      try {
        const baseUrl = new URL(backendUrl);
        const correctedPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
        fullImageUrl = new URL(correctedPath, baseUrl).href;
        log.info(
          `[AppearanceStore applyPageBackground] Constructed Full Image URL: "${fullImageUrl}"`,
        );
      } catch (error: unknown) {
        log.error(`[AppearanceStore applyPageBackground] Error constructing image URL:`, error);
        body.style.backgroundImage = 'none';
        return;
      }

      body.style.backgroundImage = 'none';
      nextTick(() => {
        if (fullImageUrl) {
          body.style.backgroundImage = `url(${fullImageUrl})`;
          body.style.backgroundSize = 'cover';
          body.style.backgroundPosition = 'center';
          body.style.backgroundRepeat = 'no-repeat';
          body.style.backgroundAttachment = 'fixed';
          log.info(
            `[AppearanceStore applyPageBackground] Applied background image: ${fullImageUrl}`,
          );
        } else {
          log.warn(
            `[AppearanceStore applyPageBackground] Skipping background application due to invalid URL.`,
          );
          body.style.backgroundImage = 'none';
        }
      });
    } else {
      body.style.backgroundImage = 'none';
      log.info(`[AppearanceStore applyPageBackground] Cleared background image.`);
    }
    log.info('[AppearanceStore] 页面背景已应用:', pageBackgroundImage.value);
  }

  // --- Watchers ---

  watch(
    currentUiTheme,
    (newTheme) => {
      applyUiTheme(newTheme);
    },
    { deep: true, immediate: true },
  );

  watch(
    isDark,
    (val) => {
      if (val) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    },
    { immediate: true },
  );

  watch(pageBackgroundImage, () => {
    applyPageBackground();
  });

  return {
    // 计算属性
    isDark,
    currentUiTheme,
    pageBackgroundImage,
    terminalBackgroundImage,
    isTerminalBackgroundEnabled,
    shouldRenderTerminalBackground,
    currentTerminalBackgroundOverlayOpacity,
    terminalCustomHTML,
    // UI 主题方法
    saveCustomUiTheme,
    resetCustomUiTheme,
    setTheme,
    applyUiTheme,
    // 终端背景方法
    setTerminalBackgroundEnabled,
    setTerminalBackgroundOverlayOpacity,
    setTerminalCustomHTML,
    // 背景图片方法
    uploadPageBackground,
    uploadTerminalBackground,
    removePageBackground,
    removeTerminalBackground,
    applyPageBackground,
  };
}

export type BackgroundStore = ReturnType<typeof createBackgroundStore>;

// --- 从 appearance.store.ts 迁移的辅助函数 ---

/** Helper function to safely parse JSON */
export const safeJsonParse = <T>(jsonString: string | undefined | null, defaultValue: T): T => {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString);
  } catch (error: unknown) {
    log.error('JSON 解析失败:', error);
    return defaultValue;
  }
};

/** 判断十六进制颜色是否为深色 */
const isColorDark = (hexColor: string): boolean => {
  if (!hexColor || !hexColor.startsWith('#')) return false;
  const color = hexColor.substring(1);
  let r;
  let g;
  let b;
  if (color.length === 3) {
    r = parseInt(color[0] + color[0], 16);
    g = parseInt(color[1] + color[1], 16);
    b = parseInt(color[2] + color[2], 16);
  } else if (color.length === 6) {
    r = parseInt(color.substring(0, 2), 16);
    g = parseInt(color.substring(2, 4), 16);
    b = parseInt(color.substring(4, 6), 16);
  } else {
    return false;
  }
  const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
  return hsp < 127.5;
};

const hasOwnThemeKey = (theme: Record<string, string>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(theme, key);

const isUiThemeRecord = (theme: unknown): theme is Record<string, string> =>
  typeof theme === 'object' && theme !== null && !Array.isArray(theme);

const normalizeUiTheme = (rawTheme: Record<string, string>): Record<string, string> => {
  const normalizedTheme: Record<string, string> = { ...defaultUiTheme, ...rawTheme };
  const isDarkBackground = isColorDark(normalizedTheme['--app-bg-color'] || '#ffffff');

  if (!hasOwnThemeKey(rawTheme, '--input-bg-color')) {
    normalizedTheme['--input-bg-color'] = isDarkBackground
      ? '#1e293b'
      : defaultUiTheme['--input-bg-color'];
  }

  if (!hasOwnThemeKey(rawTheme, '--input-text-color')) {
    normalizedTheme['--input-text-color'] = isDarkBackground
      ? '#f8fafc'
      : normalizedTheme['--text-color'];
  }

  if (!hasOwnThemeKey(rawTheme, '--input-placeholder-color')) {
    normalizedTheme['--input-placeholder-color'] = isDarkBackground
      ? '#94a3b8'
      : normalizedTheme['--text-color-secondary'];
  }

  if (!hasOwnThemeKey(rawTheme, '--input-disabled-bg-color')) {
    normalizedTheme['--input-disabled-bg-color'] = isDarkBackground ? '#0b1220' : '#f3f4f6';
  }

  if (!hasOwnThemeKey(rawTheme, '--input-disabled-text-color')) {
    normalizedTheme['--input-disabled-text-color'] = isDarkBackground ? '#64748b' : '#6b7280';
  }

  if (!hasOwnThemeKey(rawTheme, '--input-disabled-placeholder-color')) {
    normalizedTheme['--input-disabled-placeholder-color'] = isDarkBackground
      ? '#475569'
      : '#9ca3af';
  }

  if (!hasOwnThemeKey(rawTheme, '--input-disabled-border-color')) {
    normalizedTheme['--input-disabled-border-color'] = isDarkBackground ? '#334155' : '#d1d5db';
  }

  return normalizedTheme;
};
