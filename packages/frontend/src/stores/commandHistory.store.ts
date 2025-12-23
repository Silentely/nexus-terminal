import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient'; // 使用统一的 apiClient
import { useUiNotificationsStore } from './uiNotifications.store'; // 用于显示通知

// 后端返回的原始历史记录条目接口
interface CommandHistoryEntryBE {
  id: number;
  command: string;
  timestamp: number; // Unix 时间戳 (秒)
}

// 前端使用的历史记录条目接口 (可能需要添加其他字段)
export interface CommandHistoryEntryFE extends CommandHistoryEntryBE {
  // 可以根据需要添加前端特定的字段
}

export const useCommandHistoryStore = defineStore('commandHistory', () => {
  const historyList = ref<CommandHistoryEntryFE[]>([]);
  const searchTerm = ref('');
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const uiNotificationsStore = useUiNotificationsStore();
  const selectedIndex = ref<number>(-1); //  Index of the selected command in the filtered list

  // --- Getters ---

  // 计算属性：根据搜索词过滤历史记录
  const filteredHistory = computed(() => {
    const term = searchTerm.value.toLowerCase().trim();
    if (!term) {
      return historyList.value; // 没有搜索词则返回全部
    }
    return historyList.value.filter((entry) => entry.command.toLowerCase().includes(term));
  });

  // --- Actions ---

  //  Action to select the next command in the filtered list
  const selectNextCommand = () => {
    const history = filteredHistory.value;
    if (history.length === 0) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value + 1) % history.length;
  };

  //  Action to select the previous command in the filtered list
  const selectPreviousCommand = () => {
    const history = filteredHistory.value;
    if (history.length === 0) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value - 1 + history.length) % history.length;
  };

  // 从后端获取历史记录 (带缓存)
  const fetchHistory = async () => {
    const cacheKey = 'commandHistoryCache';
    error.value = null; // 重置错误

    // 1. 尝试从 localStorage 加载缓存
    try {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        historyList.value = JSON.parse(cachedData); // 缓存中已是降序
        isLoading.value = false; // 先显示缓存
      } else {
        isLoading.value = true; // 无缓存，初始加载
      }
    } catch (e) {
      console.error('[CmdHistoryStore] Failed to load or parse history cache:', e);
      localStorage.removeItem(cacheKey); // 解析失败则移除缓存
      isLoading.value = true; // 缓存无效，需要加载
    }

    // 2. 后台获取最新数据
    isLoading.value = true; // 标记正在后台获取
    try {
      console.log('[CmdHistoryStore] Fetching latest history from server...');
      const response = await apiClient.get<CommandHistoryEntryBE[]>('/command-history');
      // 后端返回升序，前端需要降序
      const freshData = response.data.reverse();
      const freshDataString = JSON.stringify(freshData);

      // 3. 对比并更新
      const currentDataString = JSON.stringify(historyList.value);
      if (currentDataString !== freshDataString) {
        console.log('[CmdHistoryStore] History data changed, updating state and cache.');
        historyList.value = freshData;
        localStorage.setItem(cacheKey, freshDataString); // 更新缓存 (存降序)
      } else {
        console.log('[CmdHistoryStore] History data is up-to-date.');
      }
      error.value = null; // 清除错误
    } catch (err: any) {
      console.error('[CmdHistoryStore] 获取命令历史记录失败:', err);
      error.value = err.response?.data?.message || '获取历史记录时发生错误';
      // 保留缓存数据，仅设置错误状态
      uiNotificationsStore.showError(error.value ?? '未知错误');
    } finally {
      isLoading.value = false; // 加载完成
    }
  };

  // 添加命令到历史记录 (由 CommandInputBar 调用, 添加后清除缓存)
  const addCommand = async (command: string) => {
    //  Filter out Ctrl+C signal (\x03) from being added to history
    if (command === '\x03') {
      console.log('[CmdHistoryStore] Ignoring Ctrl+C signal for history.');
      return;
    }
    if (!command || command.trim().length === 0) {
      return; // 不添加空命令
    }
    try {
      const response = await apiClient.post<{ id: number }>('/command-history', {
        command: command.trim(),
      }); // 使用 apiClient
      // 添加成功后，重新获取列表以保证顺序和 ID 正确
      // 添加成功后，清除缓存并重新获取
      localStorage.removeItem('commandHistoryCache');
      await fetchHistory(); // fetchHistory 会处理获取和缓存更新
    } catch (err: any) {
      console.error('添加命令历史记录失败:', err);
      const message = err.response?.data?.message || '添加历史记录时发生错误';
      uiNotificationsStore.showError(message);
    }
  };

  // 删除单条历史记录
  const deleteCommand = async (id: number) => {
    try {
      await apiClient.delete(`/command-history/${id}`);
      // 删除成功后，清除缓存并更新本地列表
      localStorage.removeItem('commandHistoryCache');
      const index = historyList.value.findIndex((entry) => entry.id === id);
      if (index !== -1) {
        historyList.value.splice(index, 1);
      }
      uiNotificationsStore.showSuccess('历史记录已删除');
    } catch (err: any) {
      console.error('删除命令历史记录失败:', err);
      const message = err.response?.data?.message || '删除历史记录时发生错误';
      uiNotificationsStore.showError(message);
    }
  };

  // 清空所有历史记录
  const clearAllHistory = async () => {
    // 可以在调用前添加确认逻辑 (例如在组件层)
    try {
      await apiClient.delete('/command-history');
      // 清空成功后，清除缓存并清空本地列表
      localStorage.removeItem('commandHistoryCache');
      historyList.value = [];
      uiNotificationsStore.showSuccess('所有历史记录已清空');
    } catch (err: any) {
      console.error('清空命令历史记录失败:', err);
      const message = err.response?.data?.message || '清空历史记录时发生错误';
      uiNotificationsStore.showError(message);
    }
  };

  // 设置搜索词
  const setSearchTerm = (term: string) => {
    searchTerm.value = term;
    selectedIndex.value = -1; // Reset selection when search term changes
  };

  //  Action to reset the selection (Moved before return)
  const resetSelection = () => {
    selectedIndex.value = -1;
  };

  return {
    historyList,
    searchTerm,
    isLoading,
    error,
    filteredHistory,
    selectedIndex, //  Expose selected index
    fetchHistory,
    addCommand, // 导出 addCommand
    deleteCommand,
    clearAllHistory,
    setSearchTerm,
    selectNextCommand, //  Expose action
    selectPreviousCommand, //  Expose action
    resetSelection, // Ensure resetSelection is exported
  };

  // REMOVED resetSelection definition from here

  // REMOVED duplicate return block
});
