/**
 * AI Settings Store 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAISettingsStore } from './aiSettings.store';
import apiClient from '../utils/apiClient';

// Mock apiClient
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('AI Settings Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的默认配置', () => {
      const store = useAISettingsStore();

      expect(store.settings.enabled).toBe(false);
      expect(store.settings.provider).toBe('openai');
      expect(store.settings.baseUrl).toBe('https://api.openai.com');
      expect(store.settings.apiKey).toBe('');
      expect(store.settings.model).toBe('gpt-4o-mini');
      expect(store.settings.openaiEndpoint).toBe('chat/completions');
      expect(store.settings.rateLimitEnabled).toBe(true);
    });

    it('应该默认未加载状态', () => {
      const store = useAISettingsStore();

      expect(store.hasLoaded).toBe(false);
      expect(store.isLoading).toBe(false);
      expect(store.isTesting).toBe(false);
    });
  });

  describe('loadSettings', () => {
    it('应该成功加载配置', async () => {
      const mockSettings = {
        enabled: true,
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'api-key-***',
        model: 'gemini-pro',
      };

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, settings: mockSettings },
      });

      const store = useAISettingsStore();
      await store.loadSettings();

      expect(apiClient.get).toHaveBeenCalledWith('/api/v1/ai/settings');
      expect(store.settings.enabled).toBe(true);
      expect(store.settings.provider).toBe('gemini');
      expect(store.hasLoaded).toBe(true);
    });

    it('应该处理加载失败', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      const store = useAISettingsStore();

      await expect(store.loadSettings()).rejects.toThrow();
      expect(store.hasLoaded).toBe(true); // 即使失败也标记为已加载
    });
  });

  describe('saveSettings', () => {
    it('应该成功保存配置', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true },
      });

      const store = useAISettingsStore();
      const newSettings = {
        enabled: true,
        provider: 'claude' as const,
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test',
        model: 'claude-3-haiku-20240307',
      };

      await store.saveSettings(newSettings);

      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/ai/settings', newSettings);
      expect(store.settings.provider).toBe('claude');
    });

    it('应该在保存失败时抛出错误', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: false, message: '保存失败' },
      });

      const store = useAISettingsStore();

      await expect(
        store.saveSettings({
          enabled: true,
          provider: 'openai',
          baseUrl: 'url',
          apiKey: 'key',
          model: 'model',
        })
      ).rejects.toThrow('保存配置失败');
    });
  });

  describe('testConnection', () => {
    it('应该返回 true 当连接成功', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true },
      });

      const store = useAISettingsStore();
      const result = await store.testConnection({
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4',
      });

      expect(result).toBe(true);
      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/ai/test', expect.any(Object));
    });

    it('应该返回 false 当连接失败', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Connection failed'));

      const store = useAISettingsStore();
      const result = await store.testConnection({
        enabled: true,
        provider: 'openai',
        baseUrl: 'invalid-url',
        apiKey: 'invalid-key',
        model: 'model',
      });

      expect(result).toBe(false);
    });

    it('应该在测试期间设置 isTesting 状态', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(apiClient.post).mockReturnValue(promise as any);

      const store = useAISettingsStore();

      const testPromise = store.testConnection({
        enabled: true,
        provider: 'openai',
        baseUrl: 'url',
        apiKey: 'key',
        model: 'model',
      });

      expect(store.isTesting).toBe(true);

      resolvePromise!({ data: { success: true } });
      await testPromise;

      expect(store.isTesting).toBe(false);
    });
  });

  describe('ensureLoaded', () => {
    it('应该只加载一次', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { success: true, settings: { enabled: false } },
      });

      const store = useAISettingsStore();

      await store.ensureLoaded();
      await store.ensureLoaded();
      await store.ensureLoaded();

      expect(apiClient.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetSettings', () => {
    it('应该重置为默认配置', async () => {
      const store = useAISettingsStore();

      // 先修改配置
      store.settings.enabled = true;
      store.settings.provider = 'claude';
      store.settings.model = 'claude-3-opus';

      // 重置
      store.resetSettings();

      expect(store.settings.enabled).toBe(false);
      expect(store.settings.provider).toBe('openai');
      expect(store.settings.model).toBe('gpt-4o-mini');
      expect(store.settings.rateLimitEnabled).toBe(true);
    });
  });
});
