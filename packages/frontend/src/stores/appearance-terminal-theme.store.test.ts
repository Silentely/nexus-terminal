import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createTerminalThemeStore } from './appearance-terminal-theme.store';
import type { TerminalTheme } from '../types/terminal-theme.types';
import type { AppearanceSettings } from '../types/appearance.types';

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../features/appearance/config/default-themes', () => ({
  defaultXtermTheme: { background: '#000000', foreground: '#ffffff' },
}));

function createMockDeps(overrides: Partial<AppearanceSettings> = {}) {
  const settings = ref<Partial<AppearanceSettings>>({
    activeTerminalThemeId: null,
    ...overrides,
  });
  const themes = ref<TerminalTheme[]>([]);
  const isLoadingRef = ref(false);
  const errorRef = ref<string | null>(null);
  return {
    appearanceSettings: settings,
    allTerminalThemes: themes,
    isLoading: isLoadingRef,
    error: errorRef,
    updateAppearanceSettings: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTheme(id: string, name: string, isSystemDefault = false): TerminalTheme {
  return {
    _id: id,
    name,
    themeData: { background: `#${id}000000`, foreground: '#ffffff' },
    isSystemDefault,
  } as TerminalTheme;
}

describe('appearance-terminal-theme.store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('activeTerminalThemeId', () => {
    it('应返回设置中的激活主题 ID', () => {
      const deps = createMockDeps({ activeTerminalThemeId: 5 });
      const store = createTerminalThemeStore(deps);
      expect(store.activeTerminalThemeId.value).toBe(5);
    });

    it('未设置时应返回 null', () => {
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);
      expect(store.activeTerminalThemeId.value).toBeNull();
    });
  });

  describe('currentTerminalTheme', () => {
    it('无激活主题时应返回系统默认主题', () => {
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('1', '自定义'), makeTheme('2', '默认', true)];
      const store = createTerminalThemeStore(deps);

      expect(store.currentTerminalTheme.value).toEqual({
        background: '#2000000',
        foreground: '#ffffff',
      });
    });

    it('无激活主题且无系统默认时应回退到 xterm 默认', () => {
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('1', '自定义')];
      const store = createTerminalThemeStore(deps);

      expect(store.currentTerminalTheme.value).toEqual({
        background: '#000000',
        foreground: '#ffffff',
      });
    });

    it('主题列表为空时应回退到 xterm 默认', () => {
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      expect(store.currentTerminalTheme.value).toEqual({
        background: '#000000',
        foreground: '#ffffff',
      });
    });

    it('有激活主题时应返回匹配的主题', () => {
      const deps = createMockDeps({ activeTerminalThemeId: 2 });
      deps.allTerminalThemes.value = [makeTheme('1', '主题1'), makeTheme('2', '主题2')];
      const store = createTerminalThemeStore(deps);

      expect(store.currentTerminalTheme.value).toEqual({
        background: '#2000000',
        foreground: '#ffffff',
      });
    });

    it('激活主题不匹配时应回退到默认', () => {
      const deps = createMockDeps({ activeTerminalThemeId: 99 });
      deps.allTerminalThemes.value = [makeTheme('1', '主题1')];
      const store = createTerminalThemeStore(deps);

      expect(store.currentTerminalTheme.value).toEqual({
        background: '#000000',
        foreground: '#ffffff',
      });
    });
  });

  describe('effectiveTerminalTheme', () => {
    it('预览模式下应返回预览主题', () => {
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('1', '默认', true)];
      const store = createTerminalThemeStore(deps);
      const previewTheme = { background: '#preview', foreground: '#fff' };

      store.startTerminalThemePreview(previewTheme);

      expect(store.effectiveTerminalTheme.value).toEqual(previewTheme);
    });

    it('非预览模式下应返回当前主题', () => {
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('1', '默认', true)];
      const store = createTerminalThemeStore(deps);

      expect(store.effectiveTerminalTheme.value).toEqual(store.currentTerminalTheme.value);
    });
  });

  describe('预览控制', () => {
    it('startTerminalThemePreview 应设置预览状态', () => {
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);
      const theme = { background: '#preview' };

      store.startTerminalThemePreview(theme as any);

      expect(store.isPreviewingTerminalTheme.value).toBe(true);
      expect(store.previewTerminalThemeData.value).toEqual(theme);
    });

    it('stopTerminalThemePreview 应清除预览状态', () => {
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      store.startTerminalThemePreview({ background: '#preview' } as any);
      store.stopTerminalThemePreview();

      expect(store.isPreviewingTerminalTheme.value).toBe(false);
      expect(store.previewTerminalThemeData.value).toBeNull();
    });
  });

  describe('setActiveTerminalTheme', () => {
    it('有效 ID 应更新设置并调用后端', async () => {
      const deps = createMockDeps({ activeTerminalThemeId: 1 });
      const store = createTerminalThemeStore(deps);

      await store.setActiveTerminalTheme('2');

      expect(deps.appearanceSettings.value.activeTerminalThemeId).toBe(2);
      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({ activeTerminalThemeId: 2 });
    });

    it('无效 ID 应抛出错误', async () => {
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await expect(store.setActiveTerminalTheme('abc')).rejects.toThrow('无效的主题 ID');
    });

    it('后端失败应回滚到之前的 ID', async () => {
      const deps = createMockDeps({ activeTerminalThemeId: 1 });
      deps.updateAppearanceSettings.mockRejectedValueOnce(new Error('网络错误'));
      const store = createTerminalThemeStore(deps);

      await expect(store.setActiveTerminalTheme('2')).rejects.toThrow();
      expect(deps.appearanceSettings.value.activeTerminalThemeId).toBe(1);
    });
  });

  describe('createTerminalTheme', () => {
    it('成功应调用 API 并刷新列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await store.createTerminalTheme('新主题', { background: '#000' });

      expect(apiClient.post).toHaveBeenCalledWith('/terminal-themes', {
        name: '新主题',
        themeData: { background: '#000' },
      });
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '创建失败' } },
      });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await expect(store.createTerminalTheme('新主题', { background: '#000' })).rejects.toThrow();
    });
  });

  describe('updateTerminalTheme', () => {
    it('成功应调用 API 并刷新列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await store.updateTerminalTheme('1', '更新主题', { background: '#111' });

      expect(apiClient.put).toHaveBeenCalledWith('/terminal-themes/1', {
        name: '更新主题',
        themeData: { background: '#111' },
      });
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新失败' } },
      });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await expect(
        store.updateTerminalTheme('1', '更新主题', { background: '#111' }),
      ).rejects.toThrow();
    });
  });

  describe('deleteTerminalTheme', () => {
    it('删除非激活主题应直接调用 API', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      const deps = createMockDeps({ activeTerminalThemeId: 1 });
      deps.allTerminalThemes.value = [makeTheme('1', '主题1', true), makeTheme('2', '主题2')];
      const store = createTerminalThemeStore(deps);

      await store.deleteTerminalTheme('2');

      expect(apiClient.delete).toHaveBeenCalledWith('/terminal-themes/2');
    });

    it('删除激活主题应切换到默认主题', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
      const deps = createMockDeps({ activeTerminalThemeId: 2 });
      deps.allTerminalThemes.value = [makeTheme('1', '默认', true), makeTheme('2', '自定义')];
      const store = createTerminalThemeStore(deps);

      await store.deleteTerminalTheme('2');

      // 应尝试切换到默认主题 ID 1
      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({ activeTerminalThemeId: 1 });
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockRejectedValueOnce({
        response: { data: { message: '删除失败' } },
      });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await expect(store.deleteTerminalTheme('1')).rejects.toThrow();
    });
  });

  describe('importTerminalTheme', () => {
    it('成功应调用 API 并刷新列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);
      const file = new File(['{}'], 'theme.json', { type: 'application/json' });

      await store.importTerminalTheme(file, '导入主题');

      expect(apiClient.post).toHaveBeenCalledWith('/terminal-themes/import', expect.any(FormData), {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '导入失败' } },
      });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);
      const file = new File(['{}'], 'theme.json', { type: 'application/json' });

      await expect(store.importTerminalTheme(file)).rejects.toThrow();
    });
  });

  describe('loadTerminalThemeData', () => {
    it('主题数据已加载时应直接返回', async () => {
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('1', '主题1')];
      const store = createTerminalThemeStore(deps);

      const result = await store.loadTerminalThemeData('1');

      expect(result).toEqual({ background: '#1000000', foreground: '#ffffff' });
    });

    it('主题数据未加载时应从后端获取', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { _id: '2', name: '主题2', themeData: { background: '#loaded' } },
      });
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('2', '主题2')];
      // 清空 themeData 以触发加载
      deps.allTerminalThemes.value[0].themeData = {} as any;
      const store = createTerminalThemeStore(deps);

      const result = await store.loadTerminalThemeData('2');

      expect(result).toEqual({ background: '#loaded' });
    });

    it('API 返回无效数据时应返回 null', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { _id: '3' } });
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('3', '主题3')];
      deps.allTerminalThemes.value[0].themeData = {} as any;
      const store = createTerminalThemeStore(deps);

      const result = await store.loadTerminalThemeData('3');

      expect(result).toBeNull();
    });

    it('API 失败时应返回 null 并设置错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '加载失败' } },
      });
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('4', '主题4')];
      deps.allTerminalThemes.value[0].themeData = {} as any;
      const store = createTerminalThemeStore(deps);

      const result = await store.loadTerminalThemeData('4');

      expect(result).toBeNull();
      expect(deps.error.value).toBeTruthy();
    });
  });

  describe('exportTerminalTheme', () => {
    it('成功应触发下载', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: new Blob(['{}']),
        headers: { 'content-disposition': 'filename="theme.json"' },
      });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      // Mock DOM methods
      const clickSpy = vi.fn();
      const linkSpy = vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        setAttribute: vi.fn(),
        click: clickSpy,
      } as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({}) as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({}) as any);

      await store.exportTerminalTheme('1');

      expect(clickSpy).toHaveBeenCalled();
      linkSpy.mockRestore();
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '导出失败' } },
      });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await expect(store.exportTerminalTheme('1')).rejects.toThrow();
    });
  });

  describe('loadTerminalThemeList', () => {
    it('成功应更新主题列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: [makeTheme('1', '主题1'), makeTheme('2', '主题2')],
      });
      const deps = createMockDeps();
      const store = createTerminalThemeStore(deps);

      await store.loadTerminalThemeList();

      expect(deps.allTerminalThemes.value).toHaveLength(2);
    });

    it('失败不应修改列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络错误'));
      const deps = createMockDeps();
      deps.allTerminalThemes.value = [makeTheme('1', '已有主题')];
      const store = createTerminalThemeStore(deps);

      await store.loadTerminalThemeList();

      expect(deps.allTerminalThemes.value).toHaveLength(1);
    });
  });
});
