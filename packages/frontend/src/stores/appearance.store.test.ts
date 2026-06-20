/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref, computed } from 'vue';

// Mock apiClient
const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../utils/apiClient', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  },
}));

// Mock extractErrorMessage
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((err: unknown, fallback: string) => {
    if (err && typeof err === 'object' && 'response' in err) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      return apiErr.response?.data?.error || fallback;
    }
    if (err instanceof Error) return err.message;
    return fallback;
  }),
}));

// Mock useDeviceDetection
const mockIsMobile = ref(false);
vi.mock('../composables/useDeviceDetection', () => ({
  useDeviceDetection: () => ({
    isMobile: mockIsMobile,
  }),
}));

// Mock 子 Store 创建函数
const mockBackgroundApplyUiTheme = vi.fn();
const mockBackgroundApplyPageBackground = vi.fn();
const mockBackgroundSetTerminalCustomHTML = vi.fn();
const mockHtmlPresetsInitRemoteUrl = vi.fn();

vi.mock('./appearance-terminal-theme.store', () => ({
  createTerminalThemeStore: () => ({
    isPreviewingTerminalTheme: ref(false),
    previewTerminalThemeData: ref(null),
    activeTerminalThemeId: ref(null),
    currentTerminalTheme: ref({}),
    effectiveTerminalTheme: ref({}),
    setActiveTerminalTheme: vi.fn(),
    createTerminalTheme: vi.fn(),
    updateTerminalTheme: vi.fn(),
    deleteTerminalTheme: vi.fn(),
    importTerminalTheme: vi.fn(),
    exportTerminalTheme: vi.fn(),
    loadTerminalThemeData: vi.fn(),
    startTerminalThemePreview: vi.fn(),
    stopTerminalThemePreview: vi.fn(),
    loadTerminalThemeList: vi.fn(),
  }),
}));

vi.mock('./appearance-font.store', () => ({
  createFontStore: () => ({
    currentTerminalFontFamily: computed(() => 'Consolas, monospace'),
    terminalFontSizeDesktop: computed(() => 14),
    terminalFontSizeMobile: computed(() => 14),
    currentEditorFontSize: computed(() => 14),
    currentEditorFontFamily: computed(() => 'Consolas, monospace'),
    currentMobileEditorFontSize: computed(() => 16),
    setTerminalFontFamily: vi.fn(),
    setTerminalFontSize: vi.fn(),
    setTerminalFontSizeMobile: vi.fn(),
    setEditorFontSize: vi.fn(),
    setEditorFontFamily: vi.fn(),
    setMobileEditorFontSize: vi.fn(),
    terminalTextStrokeEnabled: computed(() => false),
    terminalTextStrokeWidth: computed(() => 1),
    terminalTextStrokeColor: computed(() => '#000000'),
    terminalTextShadowEnabled: computed(() => false),
    terminalTextShadowOffsetX: computed(() => 0),
    terminalTextShadowOffsetY: computed(() => 0),
    terminalTextShadowBlur: computed(() => 0),
    terminalTextShadowColor: computed(() => 'rgba(0,0,0,0.5)'),
    setTerminalTextStrokeEnabled: vi.fn(),
    setTerminalTextStrokeWidth: vi.fn(),
    setTerminalTextStrokeColor: vi.fn(),
    setTerminalTextShadowEnabled: vi.fn(),
    setTerminalTextShadowOffsetX: vi.fn(),
    setTerminalTextShadowOffsetY: vi.fn(),
    setTerminalTextShadowBlur: vi.fn(),
    setTerminalTextShadowColor: vi.fn(),
  }),
}));

vi.mock('./appearance-background.store', () => ({
  createBackgroundStore: () => ({
    isDark: computed(() => false),
    currentUiTheme: computed(() => ({ '--app-bg-color': '#ffffff' })),
    pageBackgroundImage: computed(() => undefined),
    terminalBackgroundImage: computed(() => undefined),
    isTerminalBackgroundEnabled: computed(() => true),
    currentTerminalBackgroundOverlayOpacity: computed(() => 0.5),
    terminalCustomHTML: computed(() => null),
    saveCustomUiTheme: vi.fn(),
    resetCustomUiTheme: vi.fn(),
    setTheme: vi.fn(),
    setTerminalBackgroundEnabled: vi.fn(),
    setTerminalBackgroundOverlayOpacity: vi.fn(),
    setTerminalCustomHTML: mockBackgroundSetTerminalCustomHTML,
    uploadPageBackground: vi.fn(),
    uploadTerminalBackground: vi.fn(),
    removePageBackground: vi.fn(),
    removeTerminalBackground: vi.fn(),
    applyUiTheme: mockBackgroundApplyUiTheme,
    applyPageBackground: mockBackgroundApplyPageBackground,
  }),
  safeJsonParse: <T>(jsonString: string | undefined | null, defaultValue: T): T => {
    if (!jsonString) return defaultValue;
    try {
      return JSON.parse(jsonString);
    } catch {
      return defaultValue;
    }
  },
}));

vi.mock('./appearance-html-presets.store', () => ({
  createHtmlPresetsStore: () => ({
    localHtmlPresets: ref([]),
    remoteHtmlPresets: ref([]),
    remoteHtmlPresetsRepositoryUrl: ref(null),
    activeHtmlPresetTab: ref('local'),
    isLoadingHtmlPresets: ref(false),
    htmlPresetError: ref(null),
    fetchLocalHtmlPresets: vi.fn(),
    getLocalHtmlPresetContent: vi.fn(),
    createLocalHtmlPreset: vi.fn(),
    updateLocalHtmlPreset: vi.fn(),
    deleteLocalHtmlPreset: vi.fn(),
    fetchRemoteHtmlPresetsRepositoryUrl: vi.fn(),
    updateRemoteHtmlPresetsRepositoryUrl: vi.fn(),
    fetchRemoteHtmlPresets: vi.fn(),
    getRemoteHtmlPresetContent: vi.fn(),
    initRemoteUrl: mockHtmlPresetsInitRemoteUrl,
  }),
}));

describe('appearance.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsMobile.value = false;
  });

  describe('初始状态', () => {
    it('应该有正确的默认状态', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.isStyleCustomizerVisible).toBe(false);
      expect(store.appearanceSettings).toEqual({});
      expect(store.initialAppearanceDataLoaded).toBe(false);
      expect(store.allTerminalThemes).toEqual([]);
    });
  });

  describe('loadInitialAppearanceData', () => {
    it('应该成功加载外观设置和终端主题数据', async () => {
      const mockSettings = {
        terminalFontSize: 16,
        terminalFontFamily: 'Fira Code',
        customUiTheme: '{"--app-bg-color":"#000"}',
      };
      const mockThemes = [
        { _id: '1', name: '深色主题', themeData: {}, isPreset: true, isSystemDefault: true },
      ];
      mockGet.mockResolvedValueOnce({ data: mockSettings });
      mockGet.mockResolvedValueOnce({ data: mockThemes });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(mockGet).toHaveBeenCalledWith('/appearance');
      expect(mockGet).toHaveBeenCalledWith('/terminal-themes');
      expect(store.appearanceSettings).toEqual(mockSettings);
      expect(store.allTerminalThemes).toEqual(mockThemes);
      expect(store.initialAppearanceDataLoaded).toBe(true);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('加载成功后应该初始化远程预设 URL', async () => {
      mockGet.mockResolvedValueOnce({ data: {} });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(mockHtmlPresetsInitRemoteUrl).toHaveBeenCalledTimes(1);
    });

    it('加载成功后应该应用 UI 主题和页面背景', async () => {
      mockGet.mockResolvedValueOnce({ data: {} });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(mockBackgroundApplyUiTheme).toHaveBeenCalled();
      expect(mockBackgroundApplyPageBackground).toHaveBeenCalled();
    });

    it('加载过程中应该正确设置 isLoading 状态', async () => {
      let resolveFirst: (value: unknown) => void;
      mockGet.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      const loadPromise = store.loadInitialAppearanceData();
      expect(store.isLoading).toBe(true);

      resolveFirst!({ data: {} });
      await loadPromise;

      expect(store.isLoading).toBe(false);
    });

    it('加载失败时应该设置错误状态并清空数据', async () => {
      const error = new Error('网络连接失败');
      mockGet.mockRejectedValueOnce(error);

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.error).toBe('网络连接失败');
      expect(store.appearanceSettings).toEqual({});
      expect(store.allTerminalThemes).toEqual([]);
      expect(store.initialAppearanceDataLoaded).toBe(false);
      expect(store.isLoading).toBe(false);
    });

    it('加载失败时应该应用默认 UI 主题和清除背景', async () => {
      mockGet.mockRejectedValueOnce(new Error('fail'));

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(mockBackgroundApplyUiTheme).toHaveBeenCalled();
      expect(mockBackgroundApplyPageBackground).toHaveBeenCalled();
    });

    it('加载失败且为 API 错误时应提取 response.data.error', async () => {
      const apiError = { response: { data: { error: '服务器内部错误' } } };
      mockGet.mockRejectedValueOnce(apiError);

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.error).toBe('服务器内部错误');
    });

    it('加载失败且无具体错误信息时应使用后备消息', async () => {
      mockGet.mockRejectedValueOnce(null);

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.error).toBe('加载外观数据失败');
    });
  });

  describe('updateAppearanceSettings', () => {
    it('应该成功更新外观设置', async () => {
      const initialSettings = { terminalFontSize: 14 };
      const updates = { terminalFontSize: 18 };
      const updatedSettings = { terminalFontSize: 18 };

      mockGet.mockResolvedValueOnce({ data: initialSettings });
      mockGet.mockResolvedValueOnce({ data: [] });
      mockPut.mockResolvedValueOnce({ data: updatedSettings });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();
      await store.updateAppearanceSettings(updates);

      expect(mockPut).toHaveBeenCalledWith('/appearance', expect.objectContaining(updates));
      expect(store.appearanceSettings).toEqual(updatedSettings);
    });

    it('更新失败时应该抛出错误', async () => {
      mockGet.mockResolvedValueOnce({ data: {} });
      mockGet.mockResolvedValueOnce({ data: [] });
      mockPut.mockRejectedValueOnce(new Error('保存失败'));

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      await expect(store.updateAppearanceSettings({ terminalFontSize: 20 })).rejects.toThrow(
        '保存失败',
      );
    });

    it('更新失败且为 API 错误时应提取错误信息', async () => {
      mockGet.mockResolvedValueOnce({ data: {} });
      mockGet.mockResolvedValueOnce({ data: [] });
      mockPut.mockRejectedValueOnce({ response: { data: { error: '参数无效' } } });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      await expect(store.updateAppearanceSettings({ terminalFontSize: -1 })).rejects.toThrow(
        '参数无效',
      );
    });

    it('更新时应合并现有设置和新更新', async () => {
      const initialSettings = { terminalFontSize: 14, terminalFontFamily: 'Arial' };
      const updates = { terminalFontSize: 18 };
      const expectedPayload = { terminalFontSize: 18, terminalFontFamily: 'Arial' };

      mockGet.mockResolvedValueOnce({ data: initialSettings });
      mockGet.mockResolvedValueOnce({ data: [] });
      mockPut.mockResolvedValueOnce({ data: expectedPayload });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();
      await store.updateAppearanceSettings(updates);

      expect(mockPut).toHaveBeenCalledWith('/appearance', expect.objectContaining(expectedPayload));
    });
  });

  describe('toggleStyleCustomizer', () => {
    it('无参数时应该切换可见性', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(store.isStyleCustomizerVisible).toBe(false);

      store.toggleStyleCustomizer();
      expect(store.isStyleCustomizerVisible).toBe(true);

      store.toggleStyleCustomizer();
      expect(store.isStyleCustomizerVisible).toBe(false);
    });

    it('传入 true 时应该设置为可见', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      store.toggleStyleCustomizer(true);
      expect(store.isStyleCustomizerVisible).toBe(true);
    });

    it('传入 false 时应该设置为不可见', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      store.isStyleCustomizerVisible = true;
      store.toggleStyleCustomizer(false);
      expect(store.isStyleCustomizerVisible).toBe(false);
    });
  });

  describe('applyHtmlPreset', () => {
    it('应该委托给 backgroundStore.setTerminalCustomHTML', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      const htmlContent = '<div>自定义终端内容</div>';
      await store.applyHtmlPreset(htmlContent);

      expect(mockBackgroundSetTerminalCustomHTML).toHaveBeenCalledWith(htmlContent);
    });
  });

  describe('currentTerminalFontSize（设备检测覆盖）', () => {
    it('桌面端未设置字体大小时应返回默认值 14', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(store.currentTerminalFontSize).toBe(14);
    });

    it('桌面端应返回 terminalFontSize', async () => {
      mockGet.mockResolvedValueOnce({ data: { terminalFontSize: 18 } });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.currentTerminalFontSize).toBe(18);
    });

    it('移动端应返回 terminalFontSizeMobile', async () => {
      mockIsMobile.value = true;
      mockGet.mockResolvedValueOnce({ data: { terminalFontSizeMobile: 12 } });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.currentTerminalFontSize).toBe(12);
    });

    it('移动端未设置 terminalFontSizeMobile 时应返回默认值 14', async () => {
      mockIsMobile.value = true;
      mockGet.mockResolvedValueOnce({ data: { terminalFontSize: 18 } });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.currentTerminalFontSize).toBe(14);
    });

    it('字体大小为 0 或负数时应返回默认值 14', async () => {
      mockGet.mockResolvedValueOnce({ data: { terminalFontSize: 0 } });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.currentTerminalFontSize).toBe(14);
    });

    it('terminalRenderMode 为 webgpu 时应正确设置 currentRenderMode', async () => {
      mockGet.mockResolvedValueOnce({ data: { terminalRenderMode: 'webgpu' } });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.currentRenderMode).toBe('webgpu');
    });

    it('terminalRenderMode 为非法字符串时应回退到 auto', async () => {
      mockGet.mockResolvedValueOnce({ data: { terminalRenderMode: 'invalid_mode' } });
      mockGet.mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();

      expect(store.currentRenderMode).toBe('auto');
    });

    it('setRenderMode 成功应更新 currentRenderMode', async () => {
      mockGet.mockResolvedValueOnce({ data: {} });
      mockGet.mockResolvedValueOnce({ data: [] });
      mockPut.mockResolvedValueOnce({ data: { terminalRenderMode: 'webgpu' } });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();
      await store.setRenderMode('webgpu');

      expect(store.currentRenderMode).toBe('webgpu');
    });

    it('setRenderMode 失败应回滚到之前的模式', async () => {
      mockGet.mockResolvedValueOnce({ data: { terminalRenderMode: 'auto' } });
      mockGet.mockResolvedValueOnce({ data: [] });
      mockPut.mockRejectedValueOnce(new Error('update failed'));

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.loadInitialAppearanceData();
      expect(store.currentRenderMode).toBe('auto');

      await store.setRenderMode('webgpu').catch(() => {});

      expect(store.currentRenderMode).toBe('auto');
    });
  });

  describe('子 Store 代理属性', () => {
    it('应该正确代理终端主题相关属性', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(store.isPreviewingTerminalTheme).toBe(false);
      expect(store.previewTerminalThemeData).toBeNull();
      expect(store.activeTerminalThemeId).toBeNull();
      expect(typeof store.setActiveTerminalTheme).toBe('function');
      expect(typeof store.createTerminalTheme).toBe('function');
      expect(typeof store.updateTerminalTheme).toBe('function');
      expect(typeof store.deleteTerminalTheme).toBe('function');
      expect(typeof store.importTerminalTheme).toBe('function');
      expect(typeof store.exportTerminalTheme).toBe('function');
      expect(typeof store.loadTerminalThemeData).toBe('function');
      expect(typeof store.startTerminalThemePreview).toBe('function');
      expect(typeof store.stopTerminalThemePreview).toBe('function');
    });

    it('应该正确代理字体相关属性', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(typeof store.currentTerminalFontFamily).toBe('string');
      expect(typeof store.terminalFontSizeDesktop).toBe('number');
      expect(typeof store.terminalFontSizeMobile).toBe('number');
      expect(typeof store.currentEditorFontSize).toBe('number');
      expect(typeof store.currentEditorFontFamily).toBe('string');
      expect(typeof store.currentMobileEditorFontSize).toBe('number');
      expect(typeof store.setTerminalFontFamily).toBe('function');
      expect(typeof store.setTerminalFontSize).toBe('function');
      expect(typeof store.setTerminalFontSizeMobile).toBe('function');
      expect(typeof store.setEditorFontSize).toBe('function');
      expect(typeof store.setEditorFontFamily).toBe('function');
      expect(typeof store.setMobileEditorFontSize).toBe('function');
    });

    it('应该正确代理文字效果相关属性', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(typeof store.terminalTextStrokeEnabled).toBe('boolean');
      expect(typeof store.terminalTextStrokeWidth).toBe('number');
      expect(typeof store.terminalTextStrokeColor).toBe('string');
      expect(typeof store.terminalTextShadowEnabled).toBe('boolean');
      expect(typeof store.terminalTextShadowOffsetX).toBe('number');
      expect(typeof store.terminalTextShadowOffsetY).toBe('number');
      expect(typeof store.terminalTextShadowBlur).toBe('number');
      expect(typeof store.terminalTextShadowColor).toBe('string');
      expect(typeof store.setTerminalTextStrokeEnabled).toBe('function');
      expect(typeof store.setTerminalTextStrokeWidth).toBe('function');
      expect(typeof store.setTerminalTextStrokeColor).toBe('function');
      expect(typeof store.setTerminalTextShadowEnabled).toBe('function');
      expect(typeof store.setTerminalTextShadowOffsetX).toBe('function');
      expect(typeof store.setTerminalTextShadowOffsetY).toBe('function');
      expect(typeof store.setTerminalTextShadowBlur).toBe('function');
      expect(typeof store.setTerminalTextShadowColor).toBe('function');
    });

    it('应该正确代理背景与 UI 主题相关属性', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(typeof store.isDark).toBe('boolean');
      expect(typeof store.currentUiTheme).toBe('object');
      expect(typeof store.isTerminalBackgroundEnabled).toBe('boolean');
      expect(typeof store.currentTerminalBackgroundOverlayOpacity).toBe('number');
      expect(typeof store.saveCustomUiTheme).toBe('function');
      expect(typeof store.resetCustomUiTheme).toBe('function');
      expect(typeof store.setTheme).toBe('function');
      expect(typeof store.setTerminalBackgroundEnabled).toBe('function');
      expect(typeof store.setTerminalBackgroundOverlayOpacity).toBe('function');
      expect(typeof store.setTerminalCustomHTML).toBe('function');
      expect(typeof store.uploadPageBackground).toBe('function');
      expect(typeof store.uploadTerminalBackground).toBe('function');
      expect(typeof store.removePageBackground).toBe('function');
      expect(typeof store.removeTerminalBackground).toBe('function');
      expect(typeof store.applyUiTheme).toBe('function');
      expect(typeof store.applyPageBackground).toBe('function');
    });

    it('应该正确代理 HTML 预设相关属性', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      expect(Array.isArray(store.localHtmlPresets)).toBe(true);
      expect(Array.isArray(store.remoteHtmlPresets)).toBe(true);
      expect(store.remoteHtmlPresetsRepositoryUrl).toBeNull();
      expect(store.activeHtmlPresetTab).toBe('local');
      expect(store.isLoadingHtmlPresets).toBe(false);
      expect(store.htmlPresetError).toBeNull();
      expect(typeof store.fetchLocalHtmlPresets).toBe('function');
      expect(typeof store.getLocalHtmlPresetContent).toBe('function');
      expect(typeof store.createLocalHtmlPreset).toBe('function');
      expect(typeof store.updateLocalHtmlPreset).toBe('function');
      expect(typeof store.deleteLocalHtmlPreset).toBe('function');
      expect(typeof store.fetchRemoteHtmlPresetsRepositoryUrl).toBe('function');
      expect(typeof store.updateRemoteHtmlPresetsRepositoryUrl).toBe('function');
      expect(typeof store.fetchRemoteHtmlPresets).toBe('function');
      expect(typeof store.getRemoteHtmlPresetContent).toBe('function');
    });
  });

  describe('边界条件', () => {
    it('多个 store 实例应共享同一份状态', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store1 = useAppearanceStore();
      const store2 = useAppearanceStore();

      store1.toggleStyleCustomizer(true);

      expect(store2.isStyleCustomizerVisible).toBe(true);
    });

    it('连续调用 loadInitialAppearanceData 不应产生竞态问题', async () => {
      const settings1 = { terminalFontSize: 14 };
      const settings2 = { terminalFontSize: 18 };

      mockGet
        .mockResolvedValueOnce({ data: settings1 })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: settings2 })
        .mockResolvedValueOnce({ data: [] });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await Promise.all([store.loadInitialAppearanceData(), store.loadInitialAppearanceData()]);

      expect(store.isLoading).toBe(false);
    });

    it('updateAppearanceSettings 在未加载初始数据时仍应正常工作', async () => {
      mockPut.mockResolvedValueOnce({ data: { terminalFontSize: 20 } });

      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      await store.updateAppearanceSettings({ terminalFontSize: 20 });

      expect(store.appearanceSettings).toEqual({ terminalFontSize: 20 });
    });

    it('isLoading 在所有操作完成后应始终为 false', async () => {
      const { useAppearanceStore } = await import('./appearance.store');
      const store = useAppearanceStore();

      // loadInitialAppearanceData 成功
      mockGet.mockResolvedValue({ data: {} });
      await store.loadInitialAppearanceData();
      expect(store.isLoading).toBe(false);

      // loadInitialAppearanceData 失败
      mockGet.mockRejectedValue(new Error('fail'));
      await store.loadInitialAppearanceData();
      expect(store.isLoading).toBe(false);
    });

    it('safeJsonParse 应正确解析有效 JSON 字符串', async () => {
      const { safeJsonParse } = await import('./appearance.store');

      expect(safeJsonParse('{"key":"value"}', {})).toEqual({ key: 'value' });
      expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
      expect(safeJsonParse('"hello"', '')).toBe('hello');
      expect(safeJsonParse('123', 0)).toBe(123);
      expect(safeJsonParse('true', false)).toBe(true);
    });

    it('safeJsonParse 应在无效 JSON 时返回默认值', async () => {
      const { safeJsonParse } = await import('./appearance.store');

      expect(safeJsonParse('invalid-json', { fallback: true })).toEqual({ fallback: true });
      expect(safeJsonParse('{broken', [])).toEqual([]);
    });

    it('safeJsonParse 应在 null/undefined 时返回默认值', async () => {
      const { safeJsonParse } = await import('./appearance.store');

      expect(safeJsonParse(null, 'default')).toBe('default');
      expect(safeJsonParse(undefined, 42)).toBe(42);
      expect(safeJsonParse('', 'empty')).toBe('empty');
    });
  });
});
