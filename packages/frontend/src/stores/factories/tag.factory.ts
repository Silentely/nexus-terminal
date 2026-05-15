import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../../utils/apiClient';
import { extractErrorMessage } from '../../utils/errorExtractor';
import { useUiNotificationsStore } from '../uiNotifications.store';
import { log } from '@/utils/log';

export interface TagStoreConfig {
  storeId: string;
  apiEndpoint: string;
  cacheKey: string;
  useNotifications?: boolean; // 是否显示成功通知（默认 true）
}

export interface TagInfo {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

/**
 * Creates a Pinia store for managing a list of tags with localStorage caching and optional UI notifications.
 *
 * @param config - Configuration for the store:
 *   - `storeId`: id used to register the Pinia store
 *   - `apiEndpoint`: backend endpoint for tag CRUD operations
 *   - `cacheKey`: localStorage key used to cache the tag list
 *   - `useNotifications` (optional, default `true`): whether to show success/error UI notifications
 * @returns The created Pinia store exposing:
 *   - `tags`: reactive array of `TagInfo`
 *   - `isLoading`: reactive boolean indicating loading state
 *   - `error`: reactive string or `null` for the last error message
 *   - `fetchTags()`: fetches and caches the tag list
 *   - `addTag(name)`: creates a tag and refreshes the list
 *   - `updateTag(id, name)`: updates a tag and refreshes the list
 *   - `deleteTag(id)`: deletes a tag and refreshes the list
 */
export function createTagStore(config: TagStoreConfig) {
  const { storeId, apiEndpoint, cacheKey, useNotifications = true } = config;

  return defineStore(storeId, () => {
    const tags = ref<TagInfo[]>([]);
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const uiNotificationsStore = useUiNotificationsStore();

    async function fetchTags() {
      error.value = null;

      try {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          tags.value = JSON.parse(cachedData);
          isLoading.value = false;
        } else {
          isLoading.value = true;
        }
      } catch (loadError: unknown) {
        log.error(`[${storeId}] 缓存加载失败:`, loadError);
        localStorage.removeItem(cacheKey);
        isLoading.value = true;
      }

      isLoading.value = true;
      try {
        const response = await apiClient.get<TagInfo[]>(apiEndpoint);
        const freshData = response.data;
        const freshDataString = JSON.stringify(freshData);

        const currentDataString = JSON.stringify(tags.value);
        if (currentDataString !== freshDataString) {
          tags.value = freshData;
          localStorage.setItem(cacheKey, freshDataString);
        }
        error.value = null;
        return true;
      } catch (err: unknown) {
        log.error(`[${storeId}] 获取标签失败:`, err);
        error.value = extractErrorMessage(err, '获取标签列表失败');
        if (useNotifications && error.value) {
          uiNotificationsStore.showError(error.value);
        }
        return false;
      } finally {
        isLoading.value = false;
      }
    }

    async function addTag(name: string): Promise<TagInfo | null> {
      isLoading.value = true;
      error.value = null;
      try {
        const response = await apiClient.post<{ message: string; tag: TagInfo }>(apiEndpoint, {
          name,
        });
        const newTag = response.data.tag;
        localStorage.removeItem(cacheKey);
        const fetchSuccess = await fetchTags();
        if (fetchSuccess && useNotifications) {
          uiNotificationsStore.showSuccess('标签已添加');
        }
        return newTag;
      } catch (err: unknown) {
        log.error(`[${storeId}] 添加标签失败:`, err);
        error.value = extractErrorMessage(err, '添加标签失败');
        if (useNotifications && error.value) {
          uiNotificationsStore.showError(error.value);
        }
        return null;
      } finally {
        isLoading.value = false;
      }
    }

    async function updateTag(id: number, name: string): Promise<boolean> {
      isLoading.value = true;
      error.value = null;
      try {
        await apiClient.put(`${apiEndpoint}/${id}`, { name });
        localStorage.removeItem(cacheKey);
        const fetchSuccess = await fetchTags();
        if (fetchSuccess && useNotifications) {
          uiNotificationsStore.showSuccess('标签已更新');
        }
        return true;
      } catch (err: unknown) {
        log.error(`[${storeId}] 更新标签失败:`, err);
        error.value = extractErrorMessage(err, '更新标签失败');
        if (useNotifications && error.value) {
          uiNotificationsStore.showError(error.value);
        }
        return false;
      } finally {
        isLoading.value = false;
      }
    }

    async function deleteTag(id: number): Promise<boolean> {
      isLoading.value = true;
      error.value = null;
      try {
        await apiClient.delete(`${apiEndpoint}/${id}`);
        localStorage.removeItem(cacheKey);
        const fetchSuccess = await fetchTags();
        if (fetchSuccess && useNotifications) {
          uiNotificationsStore.showSuccess('标签已删除');
        }
        return true;
      } catch (err: unknown) {
        log.error(`[${storeId}] 删除标签失败:`, err);
        error.value = extractErrorMessage(err, '删除标签失败');
        if (useNotifications && error.value) {
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
}
