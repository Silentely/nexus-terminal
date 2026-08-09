import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createBackgroundStore, safeJsonParse } from './appearance-background.store';
import type { AppearanceSettings } from '../types/appearance.types';

vi.mock('../utils/apiClient', () => ({
  default: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../features/appearance/config/default-themes', () => ({
  defaultUiTheme: {
    '--app-bg-color': '#ffffff',
    '--text-color': '#333333',
    '--input-bg-color': '#ffffff',
    '--input-text-color': '#333333',
  },
  darkUiTheme: {
    '--app-bg-color': '#1a1a2e',
    '--text-color': '#e2e8f0',
    '--input-bg-color': '#1e293b',
    '--input-text-color': '#f8fafc',
  },
}));

function createMockDeps(overrides: Partial<AppearanceSettings> = {}) {
  const settings = ref<Partial<AppearanceSettings>>({
    terminalBackgroundEnabled: true,
    terminalBackgroundOverlayOpacity: 0.5,
    ...overrides,
  });
  return {
    appearanceSettings: settings,
    updateAppearanceSettings: vi.fn().mockResolvedValue(undefined),
  };
}

describe('appearance-background.store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.cssText = '';
    document.body.style.cssText = '';
  });

  describe('计算属性', () => {
    it('isDark 应根据背景颜色判断深色模式', () => {
      const deps = createMockDeps({ customUiTheme: '{"--app-bg-color":"#000000"}' });
      const store = createBackgroundStore(deps);
      expect(store.isDark.value).toBe(true);
    });

    it('isDark 浅色背景应返回 false', () => {
      const deps = createMockDeps({ customUiTheme: '{"--app-bg-color":"#ffffff"}' });
      const store = createBackgroundStore(deps);
      expect(store.isDark.value).toBe(false);
    });

    it('currentUiTheme 应返回解析后的主题对象', () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);
      expect(store.currentUiTheme.value).toBeDefined();
      expect(typeof store.currentUiTheme.value).toBe('object');
    });

    it('currentUiTheme 无效 JSON 应回退到默认主题', () => {
      const deps = createMockDeps({ customUiTheme: 'not-json' });
      const store = createBackgroundStore(deps);
      expect(store.currentUiTheme.value).toBeDefined();
    });

    it('pageBackgroundImage 应返回设置值', () => {
      const deps = createMockDeps({ pageBackgroundImage: '/img/bg.jpg' });
      const store = createBackgroundStore(deps);
      expect(store.pageBackgroundImage.value).toBe('/img/bg.jpg');
    });

    it('terminalBackgroundImage 应返回设置值', () => {
      const deps = createMockDeps({ terminalBackgroundImage: '/img/term.png' });
      const store = createBackgroundStore(deps);
      expect(store.terminalBackgroundImage.value).toBe('/img/term.png');
    });

    it('isTerminalBackgroundEnabled 布尔值应直接返回', () => {
      const deps = createMockDeps({ terminalBackgroundEnabled: false });
      const store = createBackgroundStore(deps);
      expect(store.isTerminalBackgroundEnabled.value).toBe(false);
    });

    it('isTerminalBackgroundEnabled 非布尔值应默认 true', () => {
      const deps = createMockDeps({ terminalBackgroundEnabled: undefined });
      const store = createBackgroundStore(deps);
      expect(store.isTerminalBackgroundEnabled.value).toBe(true);
    });

    it('shouldRenderTerminalBackground 用户禁用时应返回 false', () => {
      const deps = createMockDeps({
        terminalBackgroundEnabled: false,
        terminalBackgroundImage: '/img/term.png',
      });
      const store = createBackgroundStore(deps);
      expect(store.shouldRenderTerminalBackground.value).toBe(false);
    });

    it('shouldRenderTerminalBackground 启用但无图片无 HTML 时应返回 false（避免空蒙版全黑）', () => {
      const deps = createMockDeps({ terminalBackgroundEnabled: true });
      const store = createBackgroundStore(deps);
      expect(store.shouldRenderTerminalBackground.value).toBe(false);
    });

    it('shouldRenderTerminalBackground 启用且有背景图片时应返回 true', () => {
      const deps = createMockDeps({
        terminalBackgroundEnabled: true,
        terminalBackgroundImage: '/img/term.png',
      });
      const store = createBackgroundStore(deps);
      expect(store.shouldRenderTerminalBackground.value).toBe(true);
    });

    it('shouldRenderTerminalBackground 启用且有非空 HTML 时应返回 true', () => {
      const deps = createMockDeps({
        terminalBackgroundEnabled: true,
        terminal_custom_html: '<div style="background:red">hello</div>',
      });
      const store = createBackgroundStore(deps);
      expect(store.shouldRenderTerminalBackground.value).toBe(true);
    });

    it('shouldRenderTerminalBackground 启用但 HTML 为空白时应返回 false', () => {
      const deps = createMockDeps({
        terminalBackgroundEnabled: true,
        terminal_custom_html: '   ',
      });
      const store = createBackgroundStore(deps);
      expect(store.shouldRenderTerminalBackground.value).toBe(false);
    });

    it('currentTerminalBackgroundOverlayOpacity 有效值应返回', () => {
      const deps = createMockDeps({ terminalBackgroundOverlayOpacity: 0.8 });
      const store = createBackgroundStore(deps);
      expect(store.currentTerminalBackgroundOverlayOpacity.value).toBe(0.8);
    });

    it('currentTerminalBackgroundOverlayOpacity 超出范围应返回默认值', () => {
      const deps = createMockDeps({ terminalBackgroundOverlayOpacity: 1.5 });
      const store = createBackgroundStore(deps);
      expect(store.currentTerminalBackgroundOverlayOpacity.value).toBe(0.5);
    });

    it('terminalCustomHTML 应返回设置值', () => {
      const deps = createMockDeps({ terminal_custom_html: '<style>body{}</style>' });
      const store = createBackgroundStore(deps);
      expect(store.terminalCustomHTML.value).toBe('<style>body{}</style>');
    });

    it('terminalCustomHTML 未设置时应返回 null', () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);
      expect(store.terminalCustomHTML.value).toBeNull();
    });
  });

  describe('UI 主题操作', () => {
    it('saveCustomUiTheme 应序列化并调用 updateAppearanceSettings', async () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);
      const theme = { '--app-bg-color': '#000' };

      await store.saveCustomUiTheme(theme);

      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({
        customUiTheme: JSON.stringify(theme),
      });
    });

    it('resetCustomUiTheme 应保存默认主题', async () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.resetCustomUiTheme();

      expect(deps.updateAppearanceSettings).toHaveBeenCalled();
    });

    it('setTheme dark 应保存暗色主题', async () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.setTheme('dark');

      expect(deps.updateAppearanceSettings).toHaveBeenCalled();
    });

    it('setTheme light 应保存亮色主题', async () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.setTheme('light');

      expect(deps.updateAppearanceSettings).toHaveBeenCalled();
    });
  });

  describe('终端背景操作', () => {
    it('setTerminalBackgroundEnabled 应调用 updateAppearanceSettings', async () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.setTerminalBackgroundEnabled(false);

      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({
        terminalBackgroundEnabled: false,
      });
    });

    it('setTerminalBackgroundOverlayOpacity 应调用 updateAppearanceSettings', async () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.setTerminalBackgroundOverlayOpacity(0.7);

      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({
        terminalBackgroundOverlayOpacity: 0.7,
      });
    });

    it('setTerminalCustomHTML 应调用 updateAppearanceSettings', async () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.setTerminalCustomHTML('<div>test</div>');

      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({
        terminal_custom_html: '<div>test</div>',
      });
    });

    it('setTerminalCustomHTML 失败时应抛出错误', async () => {
      const deps = createMockDeps();
      deps.updateAppearanceSettings.mockRejectedValueOnce(new Error('网络错误'));
      const store = createBackgroundStore(deps);

      await expect(store.setTerminalCustomHTML('<div>test</div>')).rejects.toThrow();
    });
  });

  describe('背景图片操作', () => {
    it('uploadPageBackground 成功应返回路径', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { filePath: '/uploads/bg.jpg' } });
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);
      const file = new File([''], 'bg.jpg', { type: 'image/jpeg' });

      const result = await store.uploadPageBackground(file);

      expect(result).toBe('/uploads/bg.jpg');
    });

    it('uploadPageBackground 失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('上传失败'));
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);
      const file = new File([''], 'bg.jpg', { type: 'image/jpeg' });

      await expect(store.uploadPageBackground(file)).rejects.toThrow();
    });

    it('uploadTerminalBackground 成功应返回路径', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { filePath: '/uploads/term.png' } });
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);
      const file = new File([''], 'term.png', { type: 'image/png' });

      const result = await store.uploadTerminalBackground(file);

      expect(result).toBe('/uploads/term.png');
    });

    it('uploadTerminalBackground 失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('上传失败'));
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);
      const file = new File([''], 'term.png', { type: 'image/png' });

      await expect(store.uploadTerminalBackground(file)).rejects.toThrow();
    });

    it('removePageBackground 成功应调用 API', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.removePageBackground();

      expect(apiClient.delete).toHaveBeenCalledWith('/appearance/background/page');
      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({ pageBackgroundImage: '' });
    });

    it('removePageBackground 失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockRejectedValueOnce(new Error('删除失败'));
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await expect(store.removePageBackground()).rejects.toThrow();
    });

    it('removeTerminalBackground 成功应调用 API', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await store.removeTerminalBackground();

      expect(apiClient.delete).toHaveBeenCalledWith('/appearance/background/terminal');
      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({ terminalBackgroundImage: '' });
    });

    it('removeTerminalBackground 失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockRejectedValueOnce(new Error('删除失败'));
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      await expect(store.removeTerminalBackground()).rejects.toThrow();
    });
  });

  describe('applyUiTheme', () => {
    it('应将 CSS 变量应用到文档根元素', () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      store.applyUiTheme({ '--app-bg-color': '#123456' });

      expect(document.documentElement.style.getPropertyValue('--app-bg-color')).toBe('#123456');
    });

    it('应用主题后应派发 appearance-theme-applied 事件', () => {
      const deps = createMockDeps();
      const store = createBackgroundStore(deps);

      const listener = vi.fn();
      window.addEventListener('appearance-theme-applied', listener);

      store.applyUiTheme({ '--app-bg-color': '#123456' });

      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener('appearance-theme-applied', listener);
    });
  });

  describe('safeJsonParse', () => {
    it('有效 JSON 应返回解析结果', () => {
      expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    });

    it('undefined 应返回默认值', () => {
      expect(safeJsonParse(undefined, { default: true })).toEqual({ default: true });
    });

    it('null 应返回默认值', () => {
      expect(safeJsonParse(null, { default: true })).toEqual({ default: true });
    });

    it('无效 JSON 应返回默认值', () => {
      expect(safeJsonParse('not json', { default: true })).toEqual({ default: true });
    });
  });
});
