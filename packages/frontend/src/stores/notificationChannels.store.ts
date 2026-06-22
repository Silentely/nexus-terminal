import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient'; // 使用统一的 apiClient
import { extractErrorMessage } from '../utils/errorExtractor';
import {
  NotificationSetting,
  NotificationSettingData,
  NotificationChannelType,
  NotificationChannelConfig,
  NotificationTestResult,
} from '../types/server.types'; // Import NotificationChannelType
import { log } from '@/utils/log';

export const useNotificationsStore = defineStore('notifications', () => {
  const settings = ref<NotificationSetting[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const fetchSettings = async () => {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.get<NotificationSetting[]>('/notifications'); // 使用 apiClient
      settings.value = response.data;
    } catch (err: unknown) {
      log.error('Error fetching notification settings:', err);
      error.value = extractErrorMessage(err, '获取通知设置失败');
      settings.value = []; // Clear settings on error
    } finally {
      isLoading.value = false;
    }
  };

  const addSetting = async (
    settingData: NotificationSettingData,
  ): Promise<NotificationSetting | null> => {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.post<NotificationSetting>('/notifications', settingData); // 使用 apiClient
      settings.value.push(response.data);
      return response.data;
    } catch (err: unknown) {
      log.error('Error adding notification setting:', err);
      error.value = extractErrorMessage(err, '添加通知设置失败');
      return null;
    } finally {
      isLoading.value = false;
    }
  };

  const updateSetting = async (
    id: number,
    settingData: Partial<NotificationSettingData>,
  ): Promise<NotificationSetting | null> => {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.put<NotificationSetting>(
        `/notifications/${id}`,
        settingData,
      ); // 使用 apiClient
      const index = settings.value.findIndex((s) => s.id === id);
      if (index !== -1) {
        settings.value[index] = response.data;
      } else {
        // If not found locally, maybe fetch again or just add it
        settings.value.push(response.data);
      }
      return response.data;
    } catch (err: unknown) {
      log.error(`Error updating notification setting ${id}:`, err);
      error.value = extractErrorMessage(err, '更新通知设置失败');
      return null;
    } finally {
      isLoading.value = false;
    }
  };

  const deleteSetting = async (id: number): Promise<boolean> => {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.delete(`/notifications/${id}`); // 使用 apiClient
      settings.value = settings.value.filter((s) => s.id !== id);
      return true;
    } catch (err: unknown) {
      log.error(`Error deleting notification setting ${id}:`, err);
      error.value = extractErrorMessage(err, '删除通知设置失败');
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const testSetting = async (
    id: number,
    _config: NotificationChannelConfig,
  ): Promise<NotificationTestResult> => {
    // Note: We don't set isLoading here as it might interfere with the main form submission state.
    // The component handles its own 'testingNotification' state.
    error.value = null; // Clear previous general errors
    try {
      // Send the request without a body, as the backend uses the saved config for the given ID
      const response = await apiClient.post<Partial<NotificationTestResult>>(
        `/notifications/${id}/test`,
      );
      return {
        success: response.data.success ?? true,
        message: response.data.message || '',
      };
    } catch (err: unknown) {
      log.error(`Error testing notification setting ${id}:`, err);
      // Don't set the main 'error' ref here, let the component handle test-specific errors/results.
      // Throw the error so the component's catch block can handle it.
      throw err; // Re-throw the error to be caught in the component
    }
    // No finally block needed here as loading state is managed in the component
  };

  // Test an unsaved setting configuration
  const testUnsavedSetting = async (
    channelType: NotificationChannelType,
    config: NotificationChannelConfig,
  ): Promise<NotificationTestResult> => {
    error.value = null;
    try {
      // Send the channel type and config in the request body
      const response = await apiClient.post<Partial<NotificationTestResult>>(
        `/notifications/test-unsaved`,
        {
          channel_type: channelType,
          config,
        },
      ); // 使用 apiClient
      return {
        success: response.data.success ?? true,
        message: response.data.message || '',
      };
    } catch (err: unknown) {
      log.error(`Error testing unsaved notification setting:`, err);
      throw err; // Re-throw the error to be caught in the component
    }
  };

  // Computed property to get settings by type (example)
  const webhookSettings = computed(() =>
    settings.value.filter((s) => s.channel_type === 'webhook'),
  );
  const emailSettings = computed(() => settings.value.filter((s) => s.channel_type === 'email'));
  const telegramSettings = computed(() =>
    settings.value.filter((s) => s.channel_type === 'telegram'),
  );

  return {
    settings,
    isLoading,
    error,
    fetchSettings,
    addSetting,
    updateSetting,
    deleteSetting,
    testSetting,
    testUnsavedSetting, // Add the new function here
    webhookSettings,
    emailSettings,
    telegramSettings,
  };
});
