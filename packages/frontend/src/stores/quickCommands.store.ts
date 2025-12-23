import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '../utils/apiClient';
import { useUiNotificationsStore } from './uiNotifications.store';
import { useQuickCommandTagsStore, type QuickCommandTag } from './quickCommandTags.store';

// 定义前端使用的快捷指令接口 (包含 tagIds)
export interface QuickCommandFE {
  // Renamed from QuickCommand if necessary
  id: number;
  name: string | null;
  command: string;
  usage_count: number;
  created_at: number;
  updated_at: number;
  tagIds: number[]; // +++ Add tagIds +++
  variables?: Record<string, string>; // New: Add variables
}

// 定义排序类型
export type QuickCommandSortByType = 'name' | 'usage_count' | 'last_used';

// 定义分组后的数据结构
export interface GroupedQuickCommands {
  groupName: string;
  tagId: number | null; // null for "Untagged" group
  commands: QuickCommandFE[];
}

// +++ localStorage key for expanded groups +++
const EXPANDED_GROUPS_STORAGE_KEY = 'quickCommandsExpandedGroups';

export const useQuickCommandsStore = defineStore('quickCommands', () => {
  const quickCommandsList = ref<QuickCommandFE[]>([]); // Should now contain QuickCommandFE with tagIds
  const searchTerm = ref('');
  const sortBy = ref<QuickCommandSortByType>('name'); // 默认按名称排序
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const uiNotificationsStore = useUiNotificationsStore();
  const quickCommandTagsStore = useQuickCommandTagsStore(); // +++ Inject new tag store +++
  const { t } = useI18n(); // +++ For "Untagged" translation +++
  const selectedIndex = ref<number>(-1); // Index in the flatVisibleCommands list

  // +++ State for expanded groups +++
  const expandedGroups = ref<Record<string, boolean>>({});

  // --- Getters ---

  // +++ 重写 Getter: 过滤、分组、排序指令 +++
  const filteredAndGroupedCommands = computed((): GroupedQuickCommands[] => {
    const term = searchTerm.value.toLowerCase().trim();
    const allTags = quickCommandTagsStore.tags; // 获取快捷指令专属标签
    const tagMap = new Map(allTags.map((tag) => [tag.id, tag.name]));
    const untaggedGroupName = t('quickCommands.untagged', '未标记'); // 获取 "未标记" 的翻译

    // 1. 过滤 (New logic: filter by command name, command content, OR tag name)
    let filtered = quickCommandsList.value;
    if (term) {
      filtered = filtered.filter((cmd) => {
        // Check command name
        if (cmd.name && cmd.name.toLowerCase().includes(term)) {
          return true;
        }
        // Check command content
        if (cmd.command.toLowerCase().includes(term)) {
          return true;
        }
        // Check associated tag names
        if (cmd.tagIds && cmd.tagIds.length > 0) {
          for (const tagId of cmd.tagIds) {
            const tagName = tagMap.get(tagId);
            if (tagName && tagName.toLowerCase().includes(term)) {
              return true; // Match found in tag name
            }
          }
        }
        // No match found
        return false;
      });
    }

    // 2. 分组
    const groups: Record<string, { commands: QuickCommandFE[]; tagId: number | null }> = {};
    const untaggedCommands: QuickCommandFE[] = [];

    filtered.forEach((cmd) => {
      let isTagged = false;
      if (cmd.tagIds && cmd.tagIds.length > 0) {
        cmd.tagIds.forEach((tagId) => {
          const tagName = tagMap.get(tagId);
          if (tagName) {
            if (!groups[tagName]) {
              groups[tagName] = { commands: [], tagId };
              // 初始化展开状态 (如果未定义，默认为 true)
              if (expandedGroups.value[tagName] === undefined) {
                expandedGroups.value[tagName] = true;
              }
            }
            // 避免重复添加（如果一个指令有多个相同标签ID? 不太可能但做个防御）
            if (!groups[tagName].commands.some((c) => c.id === cmd.id)) {
              groups[tagName].commands.push(cmd);
            }
            isTagged = true;
          }
        });
      }
      if (!isTagged) {
        untaggedCommands.push(cmd);
      }
    });

    // 3. 排序分组内指令 & 格式化输出
    const sortedGroupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const result: GroupedQuickCommands[] = sortedGroupNames.map((groupName) => {
      const groupData = groups[groupName];
      // 组内排序
      groupData.commands.sort((a, b) => {
        if (sortBy.value === 'usage_count') {
          if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
        } else if (sortBy.value === 'last_used') {
          if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at;
        }
        const nameA = a.name ?? a.command; // Fallback to command if name is null
        const nameB = b.name ?? b.command;
        return nameA.localeCompare(nameB);
      });
      return {
        groupName,
        tagId: groupData.tagId,
        commands: groupData.commands,
      };
    });

    // 4. 处理未标记的分组
    if (untaggedCommands.length > 0) {
      // 初始化展开状态 (如果未定义，默认为 true)
      if (expandedGroups.value[untaggedGroupName] === undefined) {
        expandedGroups.value[untaggedGroupName] = true;
      }
      // 组内排序
      untaggedCommands.sort((a, b) => {
        if (sortBy.value === 'usage_count') {
          if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
        } else if (sortBy.value === 'last_used') {
          if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at;
        }
        const nameA = a.name ?? a.command;
        const nameB = b.name ?? b.command;
        return nameA.localeCompare(nameB);
      });
      result.push({
        groupName: untaggedGroupName,
        tagId: null,
        commands: untaggedCommands,
      });
    }

    return result;
  });

  // +++ Getter: 获取当前可见的扁平指令列表 (用于键盘导航) +++
  const flatVisibleCommands = computed((): QuickCommandFE[] => {
    const flatList: QuickCommandFE[] = [];
    filteredAndGroupedCommands.value.forEach((group) => {
      // 只添加已展开分组中的指令
      if (expandedGroups.value[group.groupName]) {
        flatList.push(...group.commands);
      }
    });
    return flatList;
  });

  // --- Actions ---

  // +++ Load initial expanded groups state from localStorage +++
  const loadExpandedGroups = () => {
    try {
      const storedState = localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
      if (storedState) {
        const parsedState = JSON.parse(storedState);
        if (typeof parsedState === 'object' && parsedState !== null) {
          expandedGroups.value = parsedState;
          console.log('[QuickCmdStore] Loaded expanded groups state from localStorage.');
          return;
        }
      }
    } catch (e) {
      console.error('[QuickCmdStore] Failed to load or parse expanded groups state:', e);
      localStorage.removeItem(EXPANDED_GROUPS_STORAGE_KEY);
    }
    // Default to empty object if no valid state found
    expandedGroups.value = {};
  };

  // +++ Save expanded groups state to localStorage +++
  const saveExpandedGroups = () => {
    try {
      localStorage.setItem(EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify(expandedGroups.value));
    } catch (e) {
      console.error('[QuickCmdStore] Failed to save expanded groups state:', e);
    }
  };

  // +++ Watch for changes and save +++
  watch(expandedGroups, saveExpandedGroups, { deep: true });

  // +++ Action to toggle group expansion +++
  const toggleGroup = (groupName: string) => {
    // Ensure the group exists in the state before toggling
    if (expandedGroups.value[groupName] === undefined) {
      // Default to true if toggling a group that wasn't explicitly set (e.g., newly appeared group)
      expandedGroups.value[groupName] = false; // Start collapsed if toggled first time? Or true? Let's start true.
    } else {
      expandedGroups.value[groupName] = !expandedGroups.value[groupName];
    }
    // The watcher will automatically save the state
    // Reset selection when a group is toggled? Maybe not necessary.
    // selectedIndex.value = -1;
  };

  // Action to select the next command in the *visible* flat list
  const selectNextCommand = () => {
    const commands = flatVisibleCommands.value; // Use the flat visible list
    if (commands.length === 0) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value + 1) % commands.length;
  };

  // Action to select the previous command in the *visible* flat list
  const selectPreviousCommand = () => {
    const commands = flatVisibleCommands.value; // Use the flat visible list
    if (commands.length === 0) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value - 1 + commands.length) % commands.length;
  };

  // 从后端获取快捷指令 (包含 tagIds，不再发送 sortBy)
  const fetchQuickCommands = async () => {
    // 简化缓存：只缓存原始列表，不再区分排序
    const cacheKey = 'quickCommandsListCache';
    error.value = null;

    // 1. 尝试从 localStorage 加载缓存
    try {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        // 确保解析后的数据符合 QuickCommandFE 结构 (特别是 tagIds 和 variables)
        const parsedData = JSON.parse(cachedData) as QuickCommandFE[];
        // 基本验证，确保 tagIds 是数组，variables 是对象或undefined
        if (
          Array.isArray(parsedData) &&
          parsedData.every(
            (item) =>
              Array.isArray(item.tagIds) &&
              (item.variables === undefined || typeof item.variables === 'object')
          )
        ) {
          quickCommandsList.value = parsedData;
          isLoading.value = false;
        } else {
          console.warn('[QuickCmdStore] Cached data format invalid, ignoring cache.');
          localStorage.removeItem(cacheKey);
          isLoading.value = true;
        }
      } else {
        isLoading.value = true;
      }
    } catch (e) {
      console.error('[QuickCmdStore] Failed to load or parse commands cache:', e);
      localStorage.removeItem(cacheKey);
      isLoading.value = true;
    }

    // 2. 后台获取最新数据
    isLoading.value = true;
    try {
      console.log(`[QuickCmdStore] Fetching latest commands from server...`);
      // 不再发送 sortBy 参数
      const response = await apiClient.get<QuickCommandFE[]>('/quick-commands');
      // 确保返回的数据包含 tagIds 数组和 variables 对象
      const freshData = response.data.map((cmd) => ({
        ...cmd,
        tagIds: Array.isArray(cmd.tagIds) ? cmd.tagIds : [], // 确保 tagIds 是数组
        variables: typeof cmd.variables === 'object' ? cmd.variables : undefined, // 确保 variables 是对象或 undefined
      }));
      const freshDataString = JSON.stringify(freshData);

      // 3. 对比并更新
      const currentDataString = JSON.stringify(quickCommandsList.value);
      if (currentDataString !== freshDataString) {
        console.log('[QuickCmdStore] Commands data changed, updating state and cache.');
        quickCommandsList.value = freshData;
        localStorage.setItem(cacheKey, freshDataString); // 更新缓存
      } else {
      }
      error.value = null;
    } catch (err: any) {
      console.error('[QuickCmdStore] 获取快捷指令失败:', err);
      error.value = err.response?.data?.message || '获取快捷指令时发生错误';
      if (error.value) {
        uiNotificationsStore.showError(error.value);
      }
    } finally {
      isLoading.value = false;
    }
  };

  // 清除快捷指令列表缓存
  const clearQuickCommandsCache = () => {
    localStorage.removeItem('quickCommandsListCache');
    console.log('[QuickCmdStore] Cleared quick commands list cache.');
  };

  // 添加快捷指令 (发送 tagIds 和 variables)
  const addQuickCommand = async (
    name: string | null,
    command: string,
    tagIds?: number[],
    variables?: Record<string, string>
  ): Promise<boolean> => {
    try {
      // 在请求体中包含 tagIds 和 variables
      const response = await apiClient.post<{ message: string; command: QuickCommandFE }>(
        '/quick-commands',
        { name, command, tagIds, variables }
      );
      // 后端现在返回完整的 command 对象，可以直接使用或触发刷新
      clearQuickCommandsCache(); // 清除缓存
      await fetchQuickCommands(); // 重新获取以确保数据同步
      uiNotificationsStore.showSuccess('快捷指令已添加');
      return true;
    } catch (err: any) {
      console.error('添加快捷指令失败:', err);
      const message = err.response?.data?.message || '添加快捷指令时发生错误';
      uiNotificationsStore.showError(message);
      return false;
    }
  };

  // 更新快捷指令 (发送 tagIds 和 variables)
  const updateQuickCommand = async (
    id: number,
    name: string | null,
    command: string,
    tagIds?: number[],
    variables?: Record<string, string>
  ): Promise<boolean> => {
    try {
      // 在请求体中包含 tagIds 和 variables (即使是 undefined 也要发送，让后端知道是否要更新)
      const response = await apiClient.put<{ message: string; command: QuickCommandFE }>(
        `/quick-commands/${id}`,
        { name, command, tagIds, variables }
      );
      // 后端现在返回完整的 command 对象
      clearQuickCommandsCache(); // 清除缓存
      await fetchQuickCommands(); // 重新获取以确保数据同步
      uiNotificationsStore.showSuccess('快捷指令已更新');
      return true;
    } catch (err: any) {
      console.error('更新快捷指令失败:', err);
      const message = err.response?.data?.message || '更新快捷指令时发生错误';
      uiNotificationsStore.showError(message);
      return false;
    }
  };

  // 删除快捷指令
  const deleteQuickCommand = async (id: number) => {
    try {
      await apiClient.delete(`/quick-commands/${id}`);
      clearQuickCommandsCache(); // 清除所有排序缓存
      // 从本地列表中移除
      const index = quickCommandsList.value.findIndex((cmd) => cmd.id === id);
      if (index !== -1) {
        quickCommandsList.value.splice(index, 1);
      }
      uiNotificationsStore.showSuccess('快捷指令已删除');
    } catch (err: any) {
      console.error('删除快捷指令失败:', err);
      const message = err.response?.data?.message || '删除快捷指令时发生错误';
      uiNotificationsStore.showError(message);
    }
  };

  // 增加使用次数 (调用 API，然后更新本地数据)
  const incrementUsage = async (id: number) => {
    try {
      await apiClient.post(`/quick-commands/${id}/increment-usage`); // 使用 apiClient
      // 更新本地计数，避免重新请求整个列表
      const command = quickCommandsList.value.find((cmd) => cmd.id === id);
      if (command) {
        command.usage_count += 1;
        // 如果当前是按使用次数排序，可能需要重新排序或刷新列表
        if (sortBy.value === 'usage_count') {
          // 清除所有排序缓存并重新获取当前排序
          clearQuickCommandsCache();
          await fetchQuickCommands();
        }
      }
    } catch (err: any) {
      console.error('增加使用次数失败:', err);
      // 这里可以选择不提示用户错误，因为这是一个后台操作
    }
  };

  // 设置搜索词
  const setSearchTerm = (term: string) => {
    searchTerm.value = term;
    selectedIndex.value = -1; // Reset selection when search term changes
  };

  // 设置排序方式 (只更新本地状态，不再重新获取数据)
  const setSortBy = (newSortBy: QuickCommandSortByType) => {
    if (sortBy.value !== newSortBy) {
      sortBy.value = newSortBy;
      // 排序现在由 filteredAndGroupedCommands getter 处理，无需重新 fetch
      selectedIndex.value = -1; // Reset selection when sort changes
    }
  };

  //  Action to reset the selection
  const resetSelection = () => {
    selectedIndex.value = -1;
  };

  // Removed duplicate resetSelection definition

  return {
    quickCommandsList,
    searchTerm,
    sortBy,
    isLoading,
    error,
    filteredAndGroupedCommands, // Expose the grouped data
    flatVisibleCommands, // Expose the flat visible list for navigation logic if needed outside
    selectedIndex, // Index within flatVisibleCommands
    expandedGroups, // Expose expanded groups state
    fetchQuickCommands,
    addQuickCommand,
    updateQuickCommand,
    deleteQuickCommand,
    incrementUsage,
    setSearchTerm,
    setSortBy,
    selectNextCommand,
    selectPreviousCommand,
    resetSelection,
    toggleGroup, // +++ Expose toggleGroup action +++
    loadExpandedGroups, // +++ Expose load action +++

    // +++ Action to assign a tag to multiple commands +++
    async assignCommandsToTagAction(commandIds: number[], tagId: number): Promise<boolean> {
      if (!commandIds || commandIds.length === 0) {
        console.warn('[Store] assignCommandsToTagAction: No command IDs provided.');
        return false;
      }
      isLoading.value = true; // Use the store's isLoading state
      error.value = null; // Use the store's error state
      try {
        const response = await apiClient.post('/quick-commands/bulk-assign-tag', {
          commandIds,
          tagId,
        });
        if (response.data.success) {
          console.log(
            `[Store] Successfully assigned tag ${tagId} to ${commandIds.length} commands via API.`
          );

          // --- Manual state update for immediate UI feedback ---
          let updatedCount = 0;
          commandIds.forEach((cmdId) => {
            const commandIndex = quickCommandsList.value.findIndex((cmd) => cmd.id === cmdId);
            if (commandIndex !== -1) {
              const command = quickCommandsList.value[commandIndex];
              // Ensure tagIds exists and add the new tagId if not already present
              if (!Array.isArray(command.tagIds)) {
                command.tagIds = [];
              }
              if (!command.tagIds.includes(tagId)) {
                command.tagIds.push(tagId);
                updatedCount++;
              }
            } else {
              console.warn(
                `[Store] assignCommandsToTagAction: Command ID ${cmdId} not found in local list for manual update.`
              );
            }
          });
          console.log(
            `[Store] Manually updated tagIds for ${updatedCount} commands in local state.`
          );

          // Optionally, still fetch for full consistency, but UI should update based on manual change first.
          // clearQuickCommandsCache();
          // await fetchQuickCommands();
          return true;
        }
        // This case might not happen if backend throws errors instead
        error.value = response.data.message || '批量分配标签失败 (未知)';
        if (error.value) uiNotificationsStore.showError(error.value); // Check if error.value is not null
        return false;
      } catch (err: any) {
        console.error('[Store] Error assigning tag to commands:', err);
        error.value =
          err.response?.data?.message || err.message || '批量分配标签时发生网络或服务器错误';
        if (error.value) uiNotificationsStore.showError(error.value); // Check if error.value is not null
        return false;
      } finally {
        isLoading.value = false;
      }
    },
  };
});
