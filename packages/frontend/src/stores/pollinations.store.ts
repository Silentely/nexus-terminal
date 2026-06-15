import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '@/utils/apiClient';
import { extractErrorMessage } from '@/utils/errorExtractor';
import { log } from '@/utils/log';
import type {
  AuthStatus,
  AuthStartRequest,
  WebAuthResponse,
  DeviceAuthResponse,
  DeviceAuthPollResponse,
  BalanceResponse,
} from '@/types/pollinations.types';

/**
 * Pollinations BYOP 状态管理
 * 管理用户的 Pollinations 配置、授权流程和余额查询
 */
export const usePollinationsStore = defineStore('pollinations', () => {
  // --- State ---
  const authStatus = ref<AuthStatus>({
    hasUserKey: false,
    balance: null,
    expiry: null,
    enabled: false,
    userKey: null,
  });
  const appKey = ref<string>('');
  const scope = ref<string>('usage,keys');
  const models = ref<string[]>(['openai', 'claude', 'gemini']);
  const budget = ref<number>(5.0);
  const expiry = ref<number>(604800);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);

  // --- Getters ---
  const hasValidAuth = computed(() => authStatus.value.hasUserKey && authStatus.value.enabled);
  const remainingBalance = computed(() => authStatus.value.balance ?? 0);
  const isEnabled = computed(() => authStatus.value.enabled);

  // --- Actions ---

  /**
   * 获取用户的 Pollinations 配置
   */
  async function fetchSettings(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await apiClient.get('/pollinations/settings');
      const data = response.data;

      if (data.hasSettings && data.settings) {
        scope.value = data.settings.scope;
        models.value = data.settings.models;
        budget.value = data.settings.budget;
        expiry.value = data.settings.expiry;
        // 恢复 masked app key 状态
        appKey.value = data.settings.hasAppKey ? data.settings.appKey || '' : '';
        authStatus.value = {
          hasUserKey: data.settings.hasUserKey,
          balance: authStatus.value.balance,
          expiry: data.settings.expiry,
          enabled: data.settings.enabled,
          userKey: data.settings.userKey,
        };
      }
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, '获取 Pollinations 配置失败');
      log.error('[PollinationsStore] 获取配置失败', err);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 保存 Pollinations 配置
   */
  async function saveSettings(payload: {
    app_key: string;
    scope?: string;
    models?: string[];
    budget?: number;
    expiry?: number;
    enabled?: boolean;
  }): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await apiClient.post('/pollinations/settings', payload);
      appKey.value = payload.app_key;
      if (payload.enabled !== undefined) {
        authStatus.value.enabled = payload.enabled;
      }
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, '保存 Pollinations 配置失败');
      log.error('[PollinationsStore] 保存配置失败', err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 启动 Web Redirect 授权流程
   * @returns 授权 URL
   */
  async function startWebAuth(request: AuthStartRequest): Promise<string> {
    loading.value = true;
    error.value = null;
    try {
      const response = await apiClient.post<WebAuthResponse>('/pollinations/auth/start', request);
      return response.data.authorization_url;
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, '启动授权失败');
      log.error('[PollinationsStore] 启动 Web 授权失败', err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 处理 Web Redirect 授权回调
   */
  async function handleCallback(apiKey: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await apiClient.post('/pollinations/auth/callback', { api_key: apiKey });
      await fetchSettings();
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, '授权回调处理失败');
      log.error('[PollinationsStore] 授权回调失败', err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 启动 Device Code 授权流程
   */
  async function startDeviceAuth(request: AuthStartRequest): Promise<DeviceAuthResponse> {
    loading.value = true;
    error.value = null;
    try {
      const response = await apiClient.post<DeviceAuthResponse>(
        '/pollinations/device-auth/start',
        request
      );
      return response.data;
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, '启动设备授权失败');
      log.error('[PollinationsStore] 启动设备授权失败', err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 轮询 Device Code 授权状态
   */
  async function pollDeviceAuth(deviceCode: string): Promise<DeviceAuthPollResponse> {
    try {
      const response = await apiClient.post<DeviceAuthPollResponse>(
        '/pollinations/device-auth/poll',
        { device_code: deviceCode }
      );
      // 授权成功后刷新配置
      if (response.data.status === 'authorized') {
        await fetchSettings();
      }
      return response.data;
    } catch (err: unknown) {
      log.error('[PollinationsStore] 轮询设备授权失败', err);
      throw err;
    }
  }

  /**
   * 撤销授权
   */
  async function revokeAuth(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await apiClient.post('/pollinations/revoke');
      authStatus.value = {
        hasUserKey: false,
        balance: null,
        expiry: null,
        enabled: false,
        userKey: null,
      };
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, '撤销授权失败');
      log.error('[PollinationsStore] 撤销授权失败', err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 刷新余额
   */
  async function refreshBalance(): Promise<void> {
    error.value = null;
    try {
      const response = await apiClient.get<BalanceResponse>('/pollinations/balance');
      authStatus.value.balance = response.data.balance;
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, '刷新余额失败');
      log.error('[PollinationsStore] 刷新余额失败', err);
      throw err;
    }
  }

  return {
    // State
    authStatus,
    appKey,
    scope,
    models,
    budget,
    expiry,
    loading,
    error,
    // Getters
    hasValidAuth,
    remainingBalance,
    isEnabled,
    // Actions
    fetchSettings,
    saveSettings,
    startWebAuth,
    handleCallback,
    startDeviceAuth,
    pollDeviceAuth,
    revokeAuth,
    refreshBalance,
  };
});
