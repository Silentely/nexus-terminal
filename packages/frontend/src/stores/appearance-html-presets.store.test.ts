import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createHtmlPresetsStore } from './appearance-html-presets.store';
import type { AppearanceSettings } from '../types/appearance.types';

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function createMockDeps(overrides: Partial<AppearanceSettings> = {}) {
  const settings = ref<Partial<AppearanceSettings>>({
    ...overrides,
  });
  return {
    appearanceSettings: settings,
    updateAppearanceSettings: vi.fn().mockResolvedValue(undefined),
  };
}

describe('appearance-html-presets.store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchLocalHtmlPresets', () => {
    it('成功应更新本地预设列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: [{ name: 'theme1', type: 'preset' }],
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.fetchLocalHtmlPresets();

      expect(store.localHtmlPresets.value).toHaveLength(1);
      expect(store.isLoadingHtmlPresets.value).toBe(false);
    });

    it('失败应设置错误并清空列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.fetchLocalHtmlPresets();

      expect(store.htmlPresetError.value).toBeTruthy();
      expect(store.localHtmlPresets.value).toEqual([]);
    });
  });

  describe('getLocalHtmlPresetContent', () => {
    it('成功应返回内容', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: '<html></html>' });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      const content = await store.getLocalHtmlPresetContent('theme1');

      expect(content).toBe('<html></html>');
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await expect(store.getLocalHtmlPresetContent('theme1')).rejects.toThrow();
    });
  });

  describe('createLocalHtmlPreset', () => {
    it('成功应调用 API 并刷新列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.createLocalHtmlPreset('new-theme', '<html></html>');

      expect(apiClient.post).toHaveBeenCalledWith('/appearance/html-presets/local', {
        name: 'new-theme',
        content: '<html></html>',
      });
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '创建失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await expect(store.createLocalHtmlPreset('new-theme', '<html></html>')).rejects.toThrow();
    });
  });

  describe('updateLocalHtmlPreset', () => {
    it('成功应调用 API', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.updateLocalHtmlPreset('theme1', '<html>updated</html>');

      expect(apiClient.put).toHaveBeenCalledWith('/appearance/html-presets/local/theme1', {
        content: '<html>updated</html>',
      });
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await expect(store.updateLocalHtmlPreset('theme1', '<html></html>')).rejects.toThrow();
    });
  });

  describe('deleteLocalHtmlPreset', () => {
    it('成功应调用 API 并刷新列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.deleteLocalHtmlPreset('theme1');

      expect(apiClient.delete).toHaveBeenCalledWith('/appearance/html-presets/local/theme1');
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.delete).mockRejectedValueOnce({
        response: { data: { message: '删除失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await expect(store.deleteLocalHtmlPreset('theme1')).rejects.toThrow();
    });
  });

  describe('fetchRemoteHtmlPresetsRepositoryUrl', () => {
    it('成功应更新仓库 URL', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { url: 'https://example.com/themes' },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.fetchRemoteHtmlPresetsRepositoryUrl();

      expect(store.remoteHtmlPresetsRepositoryUrl.value).toBe('https://example.com/themes');
    });

    it('失败应设置错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.fetchRemoteHtmlPresetsRepositoryUrl();

      expect(store.htmlPresetError.value).toBeTruthy();
    });
  });

  describe('updateRemoteHtmlPresetsRepositoryUrl', () => {
    it('成功应更新 URL 并同步设置', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.updateRemoteHtmlPresetsRepositoryUrl('https://new-url.com');

      expect(store.remoteHtmlPresetsRepositoryUrl.value).toBe('https://new-url.com');
      expect(deps.updateAppearanceSettings).toHaveBeenCalledWith({
        remoteHtmlPresetsUrl: 'https://new-url.com',
      });
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await expect(
        store.updateRemoteHtmlPresetsRepositoryUrl('https://new-url.com'),
      ).rejects.toThrow();
    });
  });

  describe('fetchRemoteHtmlPresets', () => {
    it('无仓库 URL 时应设置错误', async () => {
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.fetchRemoteHtmlPresets();

      expect(store.htmlPresetError.value).toBe('远程仓库链接未设置');
      expect(store.remoteHtmlPresets.value).toEqual([]);
    });

    it('成功应更新远程预设列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: [{ name: 'remote-theme', downloadUrl: 'https://example.com/theme.html' }],
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);
      store.remoteHtmlPresetsRepositoryUrl.value = 'https://example.com/repo';

      await store.fetchRemoteHtmlPresets();

      expect(store.remoteHtmlPresets.value).toHaveLength(1);
    });

    it('带参数时应传递 repoUrl', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await store.fetchRemoteHtmlPresets('https://custom-repo.com');

      expect(apiClient.get).toHaveBeenCalledWith('/appearance/html-presets/remote/list', {
        params: { repoUrl: 'https://custom-repo.com' },
      });
    });

    it('失败应设置错误并清空列表', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);
      store.remoteHtmlPresetsRepositoryUrl.value = 'https://example.com/repo';

      await store.fetchRemoteHtmlPresets();

      expect(store.htmlPresetError.value).toBeTruthy();
      expect(store.remoteHtmlPresets.value).toEqual([]);
    });
  });

  describe('getRemoteHtmlPresetContent', () => {
    it('成功应返回内容', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: '<html>remote</html>' });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      const content = await store.getRemoteHtmlPresetContent('https://example.com/theme.html');

      expect(content).toBe('<html>remote</html>');
    });

    it('失败应抛出错误', async () => {
      const apiClient = (await import('../utils/apiClient')).default;
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      await expect(
        store.getRemoteHtmlPresetContent('https://example.com/theme.html'),
      ).rejects.toThrow();
    });
  });

  describe('initRemoteUrl', () => {
    it('应从 settings 初始化远程 URL', () => {
      const deps = createMockDeps({ remoteHtmlPresetsUrl: 'https://stored-url.com' });
      const store = createHtmlPresetsStore(deps);

      store.initRemoteUrl();

      expect(store.remoteHtmlPresetsRepositoryUrl.value).toBe('https://stored-url.com');
    });

    it('settings 无 URL 时应设为 null', () => {
      const deps = createMockDeps();
      const store = createHtmlPresetsStore(deps);

      store.initRemoteUrl();

      expect(store.remoteHtmlPresetsRepositoryUrl.value).toBeNull();
    });
  });
});
