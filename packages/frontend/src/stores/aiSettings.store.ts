/**
 * AI Settings Store
 * 管理 AI Provider 配置状态
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AISettings, AISettingsResponse, AITestResponse } from '../types/nl2cmd.types';
import apiClient, { AI_REQUEST_TIMEOUT_MS } from '../utils/apiClient';

// 默认 AI 设置常量
const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-4o-mini',
  openaiEndpoint: 'chat/completions',
  rateLimitEnabled: true,
};

export const useAISettingsStore = defineStore('aiSettings', () => {
  // State
  const settings = ref<AISettings>({ ...DEFAULT_AI_SETTINGS });

  const isLoading = ref(false);
  const isTesting = ref(false);
  const hasLoaded = ref(false);

  // Actions

  /**
   * 加载 AI 配置
   */
  async function loadSettings(): Promise<void> {
    isLoading.value = true;
    try {
      const response = await apiClient.get<AISettingsResponse>('/ai/settings');
      if (response.data.success && response.data.settings) {
        settings.value = response.data.settings;
        hasLoaded.value = true;
      }
    } catch (error) {
      console.error('[AI Settings Store] 加载配置失败:', error);
      hasLoaded.value = true; // 即使失败也标记为已加载，避免重复请求
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 保存 AI 配置
   */
  async function saveSettings(newSettings: AISettings): Promise<void> {
    isLoading.value = true;
    try {
      const response = await apiClient.post('/ai/settings', newSettings);
      if (response.data.success) {
        settings.value = newSettings;
      } else {
        throw new Error(response.data.message || '保存配置失败');
      }
    } catch (error) {
      console.error('[AI Settings Store] 保存配置失败:', error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 测试 AI 连接
   */
  async function testConnection(testSettings: AISettings): Promise<boolean> {
    isTesting.value = true;
    try {
      const response = await apiClient.post<AITestResponse>('/ai/test', testSettings, {
        timeout: AI_REQUEST_TIMEOUT_MS,
      });
      return response.data.success;
    } catch (error) {
      console.error('[AI Settings Store] 测试连接失败:', error);
      return false;
    } finally {
      isTesting.value = false;
    }
  }

  /**
   * 确保已加载一次配置
   */
  async function ensureLoaded(): Promise<void> {
    if (hasLoaded.value) return;
    try {
      await loadSettings();
    } catch (error) {
      console.warn('[AI Settings Store] ensureLoaded: 加载配置失败，将保持默认配置');
    }
  }

  /**
   * 重置配置为默认值
   */
  function resetSettings(): void {
    settings.value = { ...DEFAULT_AI_SETTINGS };
  }

  return {
    settings,
    isLoading,
    isTesting,
    hasLoaded,
    loadSettings,
    saveSettings,
    testConnection,
    ensureLoaded,
    resetSettings,
  };
});
