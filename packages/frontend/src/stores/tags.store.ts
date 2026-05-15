import { createTagStore, type TagInfo } from './factories/tag.factory';
import apiClient from '../utils/apiClient';
import { cacheManager, CACHE_KEYS } from '../utils/cacheManager';
import { extractErrorMessage } from '../utils/errorExtractor';
import { log } from '@/utils/log';

// 保持原有类型导出
export type { TagInfo };

export const useTagsStore = createTagStore({
  storeId: 'tags',
  apiEndpoint: '/tags',
  cacheKey: 'tagsCache',
  useNotifications: false,
});

// 扩展 store 类型，包含 updateTagConnections
export type TagsStoreExtended = ReturnType<typeof useTagsStore> & {
  updateTagConnections: (tagId: number, connectionIds: number[]) => Promise<boolean>;
};

/**
 * Return the tags store augmented with an `updateTagConnections` method.
 *
 * The added `updateTagConnections(tagId, connectionIds)` updates a tag's connection IDs on the server, clears related caches, and refreshes the store's tag data; on failure it sets `store.error`.
 *
 * @returns The tags store extended with an `updateTagConnections(tagId: number, connectionIds: number[]): Promise<boolean>` method that resolves to `true` on success, `false` otherwise.
 */
export function useTagsStoreExtended(): TagsStoreExtended {
  const store = useTagsStore();

  const updateTagConnections = async (tagId: number, connectionIds: number[]): Promise<boolean> => {
    store.isLoading = true;
    store.error = null;
    try {
      await apiClient.put(`/tags/${tagId}/connections`, {
        connection_ids: connectionIds,
      });
      cacheManager.remove(CACHE_KEYS.TAGS);
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      const fetchSuccess = await store.fetchTags();
      if (!fetchSuccess) {
        store.error = '标签数据刷新失败';
        return false;
      }
      return true;
    } catch (err: unknown) {
      log.error(`Failed to update connections for tag ${tagId}:`, err);
      store.error = extractErrorMessage(err, '连接更新失败');
      return false;
    } finally {
      store.isLoading = false;
    }
  };

  return Object.assign(store, { updateTagConnections });
}
