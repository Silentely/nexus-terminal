import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient'; // 使用统一的 apiClient

// 定义标签信息接口
export interface TagInfo {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

export const useTagsStore = defineStore('tags', () => {
  const tags = ref<TagInfo[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // 获取标签列表 (带缓存)
  async function fetchTags() {
    const cacheKey = 'tagsCache';
    error.value = null; // 重置错误

    // 1. 尝试从 localStorage 加载缓存
    try {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        tags.value = JSON.parse(cachedData);
        isLoading.value = false; // 先显示缓存
      } else {
        isLoading.value = true; // 无缓存，初始加载
      }
    } catch (e) {
      console.error('[TagsStore] Failed to load or parse tags cache:', e);
      localStorage.removeItem(cacheKey); // 解析失败则移除缓存
      isLoading.value = true; // 缓存无效，需要加载
    }

    // 2. 后台获取最新数据
    isLoading.value = true; // 标记正在后台获取
    try {
      const response = await apiClient.get<TagInfo[]>('/tags');
      const freshData = response.data;
      const freshDataString = JSON.stringify(freshData);

      // 3. 对比并更新
      const currentDataString = JSON.stringify(tags.value);
      if (currentDataString !== freshDataString) {
        tags.value = freshData;
        localStorage.setItem(cacheKey, freshDataString); // 更新缓存
      } else {
        console.log('[TagsStore] Tags data is up-to-date.');
      }
      error.value = null; // 清除错误
      return true; // 表示获取成功（即使数据未变）
    } catch (err: any) {
      console.error('[TagsStore] Failed to fetch tags:', err);
      error.value = err.response?.data?.message || err.message || '获取标签列表失败';
      // 保留缓存数据，仅设置错误状态
      return false; // 表示获取失败
    } finally {
      isLoading.value = false; // 加载完成
    }
  }

  // 添加新标签 (添加后清除缓存)
  async function addTag(name: string): Promise<TagInfo | null> {
    // 修改返回类型
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.post<{ message: string; tag: TagInfo }>('/tags', { name }); // 假设后端返回新标签信息
      const newTag = response.data.tag;
      // 添加成功后，清除缓存并重新获取 (fetchTags 会更新本地列表)
      localStorage.removeItem('tagsCache');
      await fetchTags(); // fetchTags 会处理获取和缓存更新
      return newTag; // 返回新标签信息
    } catch (err: any) {
      console.error('Failed to add tag:', err);
      error.value = err.response?.data?.message || err.message || '添加标签失败';
      return null; // 返回 null 表示失败
    } finally {
      isLoading.value = false;
    }
  }

  // 更新标签
  async function updateTag(id: number, name: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.put(`/tags/${id}`, { name }); // 使用 apiClient 并移除 base URL
      // 更新成功后，清除缓存并重新获取
      localStorage.removeItem('tagsCache');
      await fetchTags();
      return true;
    } catch (err: any) {
      console.error('Failed to update tag:', err);
      error.value = err.response?.data?.message || err.message || '更新标签失败';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // 删除标签
  async function deleteTag(id: number): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.delete(`/tags/${id}`); // 使用 apiClient 并移除 base URL
      // 删除成功后，清除缓存并重新获取
      localStorage.removeItem('tagsCache');
      await fetchTags();
      return true;
    } catch (err: any) {
      console.error('Failed to delete tag:', err);
      error.value = err.response?.data?.message || err.message || '删除标签失败';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // 更新标签关联的连接
  async function updateTagConnections(tagId: number, connectionIds: number[]): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      // 假设后端 API 端点是 PUT /api/tags/:tagId/connections
      await apiClient.put(`/tags/${tagId}/connections`, { connection_ids: connectionIds });
      // 更新成功后，清除相关缓存并重新获取数据以确保一致性
      localStorage.removeItem('tagsCache'); // 清除标签缓存
      localStorage.removeItem('connectionsCache'); // 清除连接缓存，因为连接的 tag_ids 可能已更改

      await fetchTags(); // 重新获取标签
      // 可能还需要通知 connectionsStore 重新获取连接，或者在这里直接调用
      // (这取决于您希望如何管理 store 间的依赖和数据同步)
      // 例如: const connectionsStore = useConnectionsStore(); await connectionsStore.fetchConnections();
      // 为简单起见，这里假设调用者会处理连接列表的刷新，或者依赖于后续的自动刷新机制。
      // 或者，更健壮的做法是在此 action 成功后，让 connectionsStore 也刷新。
      // 但为了减少此处的直接依赖，暂时只刷新 tagsStore。
      // WorkspaceConnectionList 在模态框保存成功后会重新 fetchConnections。

      return true;
    } catch (err: any) {
      console.error(`Failed to update connections for tag ${tagId}:`, err);
      error.value = err.response?.data?.message || err.message || '更新标签连接失败';
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
    updateTagConnections, // 暴露新的 action
  };
});
