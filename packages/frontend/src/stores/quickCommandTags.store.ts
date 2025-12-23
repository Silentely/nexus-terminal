import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient';
import { useUiNotificationsStore } from './uiNotifications.store';

// 定义快捷指令标签接口 (与后端 QuickCommandTag 对应)
export interface QuickCommandTag {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

export const useQuickCommandTagsStore = defineStore('quickCommandTags', () => {
  const tags = ref<QuickCommandTag[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const uiNotificationsStore = useUiNotificationsStore();

  // 获取快捷指令标签列表 (带缓存)
  async function fetchTags() {
    const cacheKey = 'quickCommandTagsCache';
    error.value = null;

    // 1. 尝试从 localStorage 加载缓存
    try {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        tags.value = JSON.parse(cachedData);
        isLoading.value = false;
      } else {
        isLoading.value = true;
      }
    } catch (e) {
      console.error('[QuickCmdTagStore] Failed to load or parse cache:', e);
      localStorage.removeItem(cacheKey);
      isLoading.value = true;
    }

    // 2. 后台获取最新数据
    isLoading.value = true;
    try {
      // 使用新的 API 端点
      const response = await apiClient.get<QuickCommandTag[]>('/quick-command-tags');
      const freshData = response.data;
      const freshDataString = JSON.stringify(freshData);

      // 3. 对比并更新
      const currentDataString = JSON.stringify(tags.value);
      if (currentDataString !== freshDataString) {
        tags.value = freshData;
        localStorage.setItem(cacheKey, freshDataString);
      } else {
      }
      error.value = null;
      return true;
    } catch (err: any) {
      console.error('[QuickCmdTagStore] Failed to fetch tags:', err);
      error.value = err.response?.data?.message || err.message || '获取快捷指令标签列表失败';
      if (error.value) {
        // Check if error.value is not null
        uiNotificationsStore.showError(error.value); // 显示错误通知
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // 添加新快捷指令标签 (添加后清除缓存)
  async function addTag(name: string): Promise<QuickCommandTag | null> {
    isLoading.value = true;
    error.value = null;
    try {
      // 使用新的 API 端点
      const response = await apiClient.post<{ message: string; tag: QuickCommandTag }>(
        '/quick-command-tags',
        { name }
      );
      const newTag = response.data.tag;
      localStorage.removeItem('quickCommandTagsCache'); // 清除缓存
      await fetchTags(); // 重新获取以更新列表
      uiNotificationsStore.showSuccess('快捷指令标签已添加');
      return newTag;
    } catch (err: any) {
      console.error('[QuickCmdTagStore] Failed to add tag:', err);
      error.value = err.response?.data?.message || err.message || '添加快捷指令标签失败';
      if (error.value) {
        // Check if error.value is not null
        uiNotificationsStore.showError(error.value);
      }
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  // 更新快捷指令标签
  async function updateTag(id: number, name: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      // 使用新的 API 端点
      await apiClient.put(`/quick-command-tags/${id}`, { name });
      localStorage.removeItem('quickCommandTagsCache');
      await fetchTags();
      uiNotificationsStore.showSuccess('快捷指令标签已更新');
      return true;
    } catch (err: any) {
      console.error('[QuickCmdTagStore] Failed to update tag:', err);
      error.value = err.response?.data?.message || err.message || '更新快捷指令标签失败';
      if (error.value) {
        // Check if error.value is not null
        uiNotificationsStore.showError(error.value);
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // 删除快捷指令标签
  async function deleteTag(id: number): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      // 使用新的 API 端点
      await apiClient.delete(`/quick-command-tags/${id}`);
      localStorage.removeItem('quickCommandTagsCache');
      await fetchTags();
      uiNotificationsStore.showSuccess('快捷指令标签已删除');
      return true;
    } catch (err: any) {
      console.error('[QuickCmdTagStore] Failed to delete tag:', err);
      error.value = err.response?.data?.message || err.message || '删除快捷指令标签失败';
      if (error.value) {
        // Check if error.value is not null
        uiNotificationsStore.showError(error.value);
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    tags,
    isLoading,
    error,
    fetchTags,
    addTag,
    updateTag,
    deleteTag,
  };
});
