import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { useUiNotificationsStore } from './uiNotifications.store';

// 后端返回的原始路径历史记录条目接口
interface PathHistoryEntryBE {
  id: number;
  path: string;
  timestamp: number; // Unix 时间戳 (秒)
}

// 前端使用的路径历史记录条目接口
export interface PathHistoryEntryFE extends PathHistoryEntryBE {
  // 可以根据需要添加前端特定的字段
}

export const usePathHistoryStore = defineStore('pathHistory', () => {
  const historyList = ref<PathHistoryEntryFE[]>([]);
  const searchTerm = ref('');
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const uiNotificationsStore = useUiNotificationsStore();
  const selectedIndex = ref<number>(-1); // 过滤列表中选中路径的索引

  // --- Getters ---

  // 计算属性：根据搜索词过滤历史记录
  const filteredHistory = computed(() => {
    const term = searchTerm.value.toLowerCase().trim();
    if (!term) {
      return historyList.value; // 没有搜索词则返回全部
    }
    return historyList.value.filter((entry) => entry.path.toLowerCase().includes(term));
  });

  // --- Actions ---

  // Action: 选中过滤列表中的下一个路径
  const selectNextPath = () => {
    const history = filteredHistory.value;
    if (history.length === 0) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value + 1) % history.length;
  };

  // Action: 选中过滤列表中的上一个路径
  const selectPreviousPath = () => {
    const history = filteredHistory.value;
    if (history.length === 0) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value - 1 + history.length) % history.length;
  };

  // Action: 重置选中状态
  const resetSelection = () => {
    selectedIndex.value = -1;
  };

  // 从后端获取历史记录
  const fetchHistory = async () => {
    // 注意：路径历史可能不需要像命令历史那样频繁地使用 localStorage 缓存，
    // 因为它通常在用户与 UI 交互时（如聚焦输入框）才加载。
    // 如果需要缓存，可以参考 commandHistory.store.ts 中的实现。
    error.value = null;
    isLoading.value = true;
    try {
      const response = await apiClient.get<PathHistoryEntryBE[]>('/path-history');
      // 后端返回的可能是升序，前端通常希望降序显示（最新的在前面）
      historyList.value = response.data.sort((a, b) => b.timestamp - a.timestamp);
      error.value = null;
    } catch (err: any) {
      console.error('[PathHistoryStore] 获取路径历史记录失败:', err);
      error.value = err.response?.data?.message || '获取路径历史记录时发生错误';
      uiNotificationsStore.showError(error.value ?? '未知错误');
    } finally {
      isLoading.value = false;
    }
  };

  // 添加路径到历史记录
  const addPath = async (path: string) => {
    if (!path || path.trim().length === 0) {
      return; // 不添加空路径
    }
    try {
      await apiClient.post('/path-history', { path: path.trim() });
      // 添加成功后，重新获取列表以保证最新状态和正确排序
      await fetchHistory();
      // 也可以考虑在前端直接将新条目添加到列表顶部，以优化体验，
      // 但需要确保 ID 和 timestamp 的处理与后端一致或在 fetchHistory 时得到刷新。
      // 例如 (如果后端返回新条目):
      // const newEntry = response.data;
      // historyList.value.unshift(newEntry);
      // historyList.value.sort((a, b) => b.timestamp - a.timestamp); // 确保排序
    } catch (err: any) {
      console.error('[PathHistoryStore] 添加路径历史记录失败:', err);
      const message = err.response?.data?.message || '添加路径历史记录时发生错误';
      uiNotificationsStore.showError(message);
    }
  };

  // 删除单条历史记录
  const deletePath = async (id: number) => {
    try {
      await apiClient.delete(`/path-history/${id}`);
      // 删除成功后，更新本地列表
      const index = historyList.value.findIndex((entry) => entry.id === id);
      if (index !== -1) {
        historyList.value.splice(index, 1);
      }
      uiNotificationsStore.showSuccess('路径历史记录已删除');
    } catch (err: any) {
      console.error('[PathHistoryStore] 删除路径历史记录失败:', err);
      const message = err.response?.data?.message || '删除路径历史记录时发生错误';
      uiNotificationsStore.showError(message);
    }
  };

  // 清空所有历史记录
  const clearAllHistory = async () => {
    try {
      await apiClient.delete('/path-history');
      historyList.value = []; // 清空本地列表
      uiNotificationsStore.showSuccess('所有路径历史记录已清空');
    } catch (err: any) {
      console.error('[PathHistoryStore] 清空路径历史记录失败:', err);
      const message = err.response?.data?.message || '清空路径历史记录时发生错误';
      uiNotificationsStore.showError(message);
    }
  };

  // 设置搜索词
  const setSearchTerm = (term: string) => {
    searchTerm.value = term;
    resetSelection(); // 搜索词变化时重置选中项
  };

  return {
    historyList,
    searchTerm,
    isLoading,
    error,
    filteredHistory,
    selectedIndex,
    fetchHistory,
    addPath,
    deletePath,
    clearAllHistory,
    setSearchTerm,
    selectNextPath,
    selectPreviousPath,
    resetSelection,
  };
});
