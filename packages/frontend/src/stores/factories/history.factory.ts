import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../../utils/apiClient';
import { extractErrorMessage } from '../../utils/errorExtractor';
import { useUiNotificationsStore } from '../uiNotifications.store';
import { log } from '@/utils/log';

export interface HistoryStoreConfig {
  storeId: string;
  apiEndpoint: string;
  itemLabel: string; // 条目字段名，如 'command' 或 'path'
  addLabel: string;
  deleteLabel: string;
  clearLabel: string;
  cacheKey: string;
  reverseOrder?: boolean; // 是否反转后端返回的排序（默认 true）
}

export interface HistoryEntryBE {
  id: number;
  timestamp: number;
}

export type HistoryEntryFE = HistoryEntryBE;

/**
 * Creates a Pinia store that manages a typed history list with search, selection navigation, local caching, and CRUD operations against a backend.
 *
 * @param config - Configuration for the history store:
 *   - `storeId`: unique Pinia store id.
 *   - `apiEndpoint`: backend endpoint for fetching/adding/deleting history entries.
 *   - `itemLabel`: object key used as the display label on each entry.
 *   - `addLabel`, `deleteLabel`, `clearLabel`: human-readable labels used in UI notifications.
 *   - `cacheKey`: localStorage key for caching the history list.
 *   - `reverseOrder` (optional): whether to reverse server-provided list before storing (defaults to `true`).
 * @returns A Pinia store exposing:
 *   - state refs: `historyList`, `searchTerm`, `isLoading`, `error`, `selectedIndex`
 *   - derived: `filteredHistory`
 *   - actions: `fetchHistory`, `addItem`, `deleteItem`, `clearAll`, `setSearchTerm`, `selectNext`, `selectPrevious`, `resetSelection`
 *   - backward-compatible aliases: `addCommand`, `deleteCommand`, `clearAllHistory`, `selectNextCommand`, `selectPreviousCommand`, `addPath`, `deletePath`, `selectNextPath`, `selectPreviousPath`
 */
export function createHistoryStore<T extends HistoryEntryFE = HistoryEntryFE>(
  config: HistoryStoreConfig,
) {
  const {
    storeId,
    apiEndpoint,
    itemLabel,
    addLabel,
    deleteLabel,
    clearLabel,
    cacheKey,
    reverseOrder = true,
  } = config;

  return defineStore(storeId, () => {
    const historyList = ref<T[]>([]);
    const searchTerm = ref('');
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const uiNotificationsStore = useUiNotificationsStore();
    const selectedIndex = ref<number>(-1);

    const filteredHistory = computed(() => {
      const term = searchTerm.value.toLowerCase().trim();
      if (!term) return historyList.value;
      return historyList.value.filter((entry) => {
        const val = (entry as Record<string, unknown>)[itemLabel];
        return typeof val === 'string' && val.toLowerCase().includes(term);
      });
    });

    const selectNext = () => {
      const history = filteredHistory.value;
      if (history.length === 0) {
        selectedIndex.value = -1;
        return;
      }
      selectedIndex.value = (selectedIndex.value + 1) % history.length;
    };

    const selectPrevious = () => {
      const history = filteredHistory.value;
      if (history.length === 0) {
        selectedIndex.value = -1;
        return;
      }
      // 当 selectedIndex 为 -1（未选中）时，选中最后一个元素
      if (selectedIndex.value === -1) {
        selectedIndex.value = history.length - 1;
      } else {
        selectedIndex.value = (selectedIndex.value - 1 + history.length) % history.length;
      }
    };

    const resetSelection = () => {
      selectedIndex.value = -1;
    };

    const fetchHistory = async () => {
      error.value = null;

      try {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          historyList.value = JSON.parse(cachedData);
          isLoading.value = false;
        } else {
          isLoading.value = true;
        }
      } catch (loadError: unknown) {
        log.error(`[${storeId}] 缓存加载失败:`, loadError);
        localStorage.removeItem(cacheKey);
        isLoading.value = true;
      }

      // 只在无缓存时设置 isLoading 为 true
      if (!localStorage.getItem(cacheKey)) {
        isLoading.value = true;
      }

      try {
        const response = await apiClient.get<T[]>(apiEndpoint);
        let freshData = response.data;
        if (reverseOrder) {
          freshData = freshData.reverse();
        }
        const freshDataString = JSON.stringify(freshData);

        const currentDataString = JSON.stringify(historyList.value);
        if (currentDataString !== freshDataString) {
          historyList.value = freshData;
          localStorage.setItem(cacheKey, freshDataString);
        }
        error.value = null;
      } catch (err: unknown) {
        log.error(`[${storeId}] 获取${addLabel}失败:`, err);
        error.value = extractErrorMessage(err, `获取${addLabel}时发生错误`);
        uiNotificationsStore.showError(error.value ?? '未知错误');
      } finally {
        isLoading.value = false;
      }
    };

    const addItem = async (itemValue: string) => {
      if (!itemValue || itemValue.trim().length === 0) return;

      // 过滤 Ctrl+C 信号
      if (itemValue === '\x03') return;

      isLoading.value = true;
      try {
        await apiClient.post(apiEndpoint, { [itemLabel]: itemValue.trim() });
        localStorage.removeItem(cacheKey);
        await fetchHistory();
      } catch (err: unknown) {
        log.error(`[${storeId}] 添加${addLabel}失败:`, err);
        const message = extractErrorMessage(err, `添加${addLabel}时发生错误`);
        uiNotificationsStore.showError(message);
      } finally {
        isLoading.value = false;
      }
    };

    const deleteItem = async (id: number) => {
      isLoading.value = true;
      try {
        await apiClient.delete(`${apiEndpoint}/${id}`);
        localStorage.removeItem(cacheKey);
        const index = historyList.value.findIndex((entry) => entry.id === id);
        if (index !== -1) {
          historyList.value.splice(index, 1);
        }
        uiNotificationsStore.showSuccess(`${deleteLabel}已删除`);
      } catch (err: unknown) {
        log.error(`[${storeId}] 删除${deleteLabel}失败:`, err);
        const message = extractErrorMessage(err, `删除${deleteLabel}时发生错误`);
        uiNotificationsStore.showError(message);
      } finally {
        isLoading.value = false;
      }
    };

    const clearAll = async () => {
      isLoading.value = true;
      try {
        await apiClient.delete(apiEndpoint);
        localStorage.removeItem(cacheKey);
        historyList.value = [];
        uiNotificationsStore.showSuccess(`${clearLabel}已清空`);
      } catch (err: unknown) {
        log.error(`[${storeId}] 清空${clearLabel}失败:`, err);
        const message = extractErrorMessage(err, `清空${clearLabel}时发生错误`);
        uiNotificationsStore.showError(message);
      } finally {
        isLoading.value = false;
      }
    };

    const setSearchTerm = (term: string) => {
      searchTerm.value = term;
      selectedIndex.value = -1;
    };

    return {
      historyList,
      searchTerm,
      isLoading,
      error,
      filteredHistory,
      selectedIndex,
      fetchHistory,
      addItem,
      deleteItem,
      clearAll,
      setSearchTerm,
      selectNext,
      selectPrevious,
      resetSelection,
      // 向后兼容别名（消费者可能使用实体特定名称）
      addCommand: addItem,
      deleteCommand: deleteItem,
      clearAllHistory: clearAll,
      selectNextCommand: selectNext,
      selectPreviousCommand: selectPrevious,
      addPath: addItem,
      deletePath: deleteItem,
      selectNextPath: selectNext,
      selectPreviousPath: selectPrevious,
    };
  });
}
