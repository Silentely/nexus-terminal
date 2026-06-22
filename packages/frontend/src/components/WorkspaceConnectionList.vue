<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, defineExpose, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useVirtualListSetup } from '../composables/useVirtualListSetup';

import { useI18n } from 'vue-i18n';

import { useConnectionsStore, ConnectionInfo } from '../stores/connections.store';
import { useTagsStore, TagInfo } from '../stores/tags.store'; // 确保 TagInfo 已导入
import { useSessionStore } from '../stores/session.store';
import { useFocusSwitcherStore } from '../stores/focusSwitcher.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store'; // +++ 修正导入大小写 +++
import { useSettingsStore } from '../stores/settings.store';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents';
import ManageTagConnectionsModal from './ManageTagConnectionsModal.vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { useContextMenuPosition } from '../composables/useContextMenuPosition';
import { useTagEditing } from '../composables/useTagEditing';
import ConnectionContextMenu from './ConnectionContextMenu.vue';
import TagGroupContextMenu from './TagGroupContextMenu.vue';
import ConnectionItem from './ConnectionItem.vue';
import { log } from '@/utils/log';

// 定义事件

const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++

const { t } = useI18n();
// const router = useRouter(); // 不再需要
const connectionsStore = useConnectionsStore();
const tagsStore = useTagsStore();
const sessionStore = useSessionStore(); // 获取 session store 实例
const focusSwitcherStore = useFocusSwitcherStore(); // +++ 实例化焦点切换 Store +++
const uiNotificationsStore = useUiNotificationsStore(); // +++ 修正实例化大小写 +++
const settingsStore = useSettingsStore(); // 实例化设置 store
const { showConfirmDialog } = useConfirmDialog();

const {
  connections,
  isLoading: connectionsLoading,
  error: connectionsError,
} = storeToRefs(connectionsStore);
const { tags, isLoading: tagsLoading, error: tagsError } = storeToRefs(tagsStore);
const { showConnectionTagsBoolean } = storeToRefs(settingsStore); // 获取设置项

// 搜索词
const searchTerm = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null); // 搜索输入框的 ref

// 右键菜单位置（composable 管理可见性与位置）
const connectionMenu = useContextMenuPosition();
const tagMenu = useContextMenuPosition();
const contextTargetConnection = ref<ConnectionInfo | null>(null);
const contextTargetTagGroup = ref<(typeof filteredAndGroupedConnections.value)[0] | null>(null);

// +++ 管理标签模态框状态 +++
const showManageTagModal = ref(false);
const tagToManage = ref<TagInfo | null>(null);

// +++ 本地存储键名 +++
const EXPANDED_GROUPS_STORAGE_KEY = 'workspaceConnectionListExpandedGroups';

// +++ 加载初始分组展开状态 +++
const loadInitialExpandedGroups = (): Record<string, boolean> => {
  try {
    const storedState = localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
    if (storedState) {
      const parsedState = JSON.parse(storedState);
      // 简单验证一下是否是对象
      if (typeof parsedState === 'object' && parsedState !== null) {
        return parsedState;
      }
    }
  } catch (error: unknown) {
    log.error('Failed to load or parse expanded groups state from localStorage:', error);
    localStorage.removeItem(EXPANDED_GROUPS_STORAGE_KEY); // 清除无效状态
  }
  // 默认返回空对象，让 computed 属性处理默认展开
  return {};
};

// 分组展开状态 - 从 localStorage 初始化
const expandedGroups = ref<Record<string, boolean>>(loadInitialExpandedGroups());

// --- 移除 RDP 模态框状态 ---
// const showRdpModal = ref(false);
// const selectedRdpConnection = ref<ConnectionInfo | null>(null);

// 键盘导航状态
const highlightedIndex = ref(-1); // -1 表示没有高亮项
const listAreaRef = ref<HTMLElement | null>(null); // 列表容器的 ref

// 计算属性：扁平化的、当前可见的连接列表（用于键盘导航）
// 注意：这个 flatVisibleConnections 依赖于 filteredAndGroupedConnections 和 expandedGroups
// 当 showConnectionTagsBoolean 为 false 时，它不会被直接使用，但键盘导航逻辑依赖它
const flatVisibleConnections = computed(() => {
  const flatList: ConnectionInfo[] = [];
  // 如果显示标签，则只包含展开分组的连接
  if (showConnectionTagsBoolean.value) {
    filteredAndGroupedConnections.value.forEach((group) => {
      if (expandedGroups.value[group.groupName]) {
        flatList.push(...group.connections);
      }
    });
  } else {
    // 如果不显示标签，则包含所有过滤后的连接
    flatList.push(...flatFilteredConnections.value); // 使用下面定义的 flatFilteredConnections
  }
  return flatList;
});

// 计算属性：当前高亮连接的 ID
const highlightedConnectionId = computed(() => {
  if (highlightedIndex.value >= 0 && highlightedIndex.value < flatVisibleConnections.value.length) {
    return flatVisibleConnections.value[highlightedIndex.value].id;
  }
  return null;
});

// +++ 编辑标签状态（composable 管理）+++
const {
  editingTagId,
  editedTagName,
  tagInputRefs,
  setTagInputRef,
  startEditingTag,
  finishEditingTag,
  cancelEditingTag,
} = useTagEditing({
  tags: () => tags.value,
  addTag: tagsStore.addTag,
  updateTag: tagsStore.updateTag,
  addTagToConnections: connectionsStore.addTagToConnectionsAction,
  getUntaggedConnectionIds: () => {
    const untaggedGroup = filteredAndGroupedConnections.value.find((g) => g.tagId === null);
    return untaggedGroup ? untaggedGroup.connections.map((c) => c.id) : [];
  },
  expandedGroups: () => expandedGroups.value,
  notify: uiNotificationsStore.addNotification,
  t,
});

// 计算属性：过滤并按标签分组连接 (仅在 showConnectionTagsBoolean 为 true 时使用)
const filteredAndGroupedConnections = computed(() => {
  const groups: Record<string, { connections: ConnectionInfo[]; tagId: number | null }> = {}; // 修改：添加 tagId
  const untagged: ConnectionInfo[] = [];
  const tagMap = new Map(tags.value.map((tag) => [tag.id, tag]));
  const lowerSearchTerm = searchTerm.value.toLowerCase();

  // 1. 过滤连接 (New logic: filter by connection name, host, OR tag name)
  const filteredConnections = connections.value.filter((conn) => {
    // Check connection name
    if (conn.name && conn.name.toLowerCase().includes(lowerSearchTerm)) {
      return true;
    }
    // Check connection host
    if (conn.host.toLowerCase().includes(lowerSearchTerm)) {
      return true;
    }
    // Check associated tag names (Always check tags for filtering, regardless of display setting)
    if (conn.tag_ids && conn.tag_ids.length > 0) {
      for (const tagId of conn.tag_ids) {
        const tag = tagMap.get(tagId); // Use the existing tagMap
        if (tag && tag.name.toLowerCase().includes(lowerSearchTerm)) {
          return true; // Match found in tag name
        }
      }
    }
    // No match found
    return false;
  });

  // 2. 分组过滤后的连接
  filteredConnections.forEach((conn) => {
    if (conn.tag_ids && conn.tag_ids.length > 0) {
      let tagged = false;
      conn.tag_ids.forEach((tagId) => {
        const tag = tagMap.get(tagId);
        if (tag) {
          const groupName = tag.name;
          if (!groups[groupName]) {
            groups[groupName] = { connections: [], tagId: tag.id }; // 修改：存储 tagId
          }
          // Avoid duplicates if a connection has multiple tags matching the search
          if (!groups[groupName].connections.some((c) => c.id === conn.id)) {
            groups[groupName].connections.push(conn);
          }
          tagged = true;
        }
      });
      // If none of the tags were found in the tagMap (e.g., stale data), treat as untagged
      if (!tagged && !untagged.some((c) => c.id === conn.id)) {
        untagged.push(conn);
      }
    } else {
      // Ensure untagged connections are not duplicated
      if (!untagged.some((c) => c.id === conn.id)) {
        untagged.push(conn);
      }
    }
  });

  // 3. 排序和格式化输出
  for (const groupName in groups) {
    groups[groupName].connections.sort((a, b) =>
      (a.name || a.host).localeCompare(b.name || b.host),
    );
  }
  untagged.sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));

  const sortedGroupNames = Object.keys(groups).sort();
  // 修改：结果包含 tagId
  const result: { groupName: string; connections: ConnectionInfo[]; tagId: number | null }[] =
    sortedGroupNames.map((name) => ({
      groupName: name,
      connections: groups[name].connections,
      tagId: groups[name].tagId, // 添加 tagId
    }));

  if (untagged.length > 0) {
    const untaggedGroupName = t('workspaceConnectionList.untagged');
    // 未标记的分组没有 tagId
    result.push({ groupName: untaggedGroupName, connections: untagged, tagId: null });
  }

  return result;
});

watch(
  filteredAndGroupedConnections,
  (groups) => {
    for (const group of groups) {
      if (expandedGroups.value[group.groupName] === undefined) {
        expandedGroups.value[group.groupName] = true;
      }
    }
  },
  { immediate: true },
);

// 计算属性，仅过滤，不分组 (用于 showConnectionTagsBoolean 为 false 时)
const flatFilteredConnections = computed(() => {
  const lowerSearchTerm = searchTerm.value.toLowerCase();
  const tagMap = new Map(tags.value.map((tag) => [tag.id, tag.name])); // 创建 tagMap 用于搜索

  const filtered = connections.value.filter((conn) => {
    // Check connection name
    if (conn.name && conn.name.toLowerCase().includes(lowerSearchTerm)) {
      return true;
    }
    // Check connection host
    if (conn.host.toLowerCase().includes(lowerSearchTerm)) {
      return true;
    }
    // Check associated tag names (Always check tags for filtering)
    if (conn.tag_ids && conn.tag_ids.length > 0) {
      for (const tagId of conn.tag_ids) {
        const tagName = tagMap.get(tagId);
        if (tagName && tagName.toLowerCase().includes(lowerSearchTerm)) {
          return true; // Match found in tag name
        }
      }
    }
    // No match found
    return false;
  });

  // Sort the flat list
  return filtered.sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
});

// +++ 虚拟列表配置（用于扁平视图大量连接时的性能优化）+++
const VIRTUAL_LIST_THRESHOLD = 50; // 超过此数量时启用虚拟滚动
const CONNECTION_ITEM_HEIGHT = 36; // 每个连接项的高度（px）

const shouldUseVirtualList = computed(() => {
  return (
    !showConnectionTagsBoolean.value &&
    flatFilteredConnections.value.length > VIRTUAL_LIST_THRESHOLD
  );
});

const {
  list: virtualList,
  containerProps,
  wrapperProps,
} = useVirtualListSetup(flatFilteredConnections, {
  itemHeight: CONNECTION_ITEM_HEIGHT,
  overscan: 10,
});

// +++ 监听分组状态变化并保存到 localStorage +++
watch(
  expandedGroups,
  (newState) => {
    // Only save if tags are shown
    if (showConnectionTagsBoolean.value) {
      try {
        localStorage.setItem(EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify(newState));
      } catch (error: unknown) {
        log.error('Failed to save expanded groups state to localStorage:', error);
      }
    }
  },
  { deep: true },
);

// 监听搜索词变化，重置高亮索引
watch(searchTerm, () => {
  highlightedIndex.value = -1;
});

// 监听分组展开状态变化，重置高亮索引 (这个 watch 保留，用于重置高亮)
watch(
  expandedGroups,
  () => {
    highlightedIndex.value = -1;
  },
  { deep: true },
);

// 监听显示模式变化，重置高亮索引
watch(showConnectionTagsBoolean, () => {
  highlightedIndex.value = -1;
});

// 切换分组展开/折叠
const toggleGroup = (groupName: string) => {
  // 状态现在总是 boolean，直接切换
  expandedGroups.value[groupName] = !expandedGroups.value[groupName];
};

// 处理单击连接 (左键/Enter) - 使用 session store 处理连接请求
const handleConnect = (connectionId: number, event?: MouseEvent | KeyboardEvent) => {
  if (event instanceof MouseEvent && event.button !== 0) {
    log.info(
      `[WkspConnList] DEBUG: handleConnect called with non-left click (button: ${event.button}). Ignoring.`,
    );
    return;
  }

  const connection = connections.value.find((c) => c.id === connectionId);
  if (!connection) {
    log.error(`[WkspConnList] Connection with ID ${connectionId} not found.`);
    return;
  }

  closeContextMenu(); // 关闭右键菜单

  // 统一发出 connect-request 事件，让 sessionStore.handleConnectRequest 处理模态框和会话
  emitWorkspaceEvent('connection:connect', { connectionId });
};

// --- 移除 closeRdpModal 方法 ---
// const closeRdpModal = () => {
//   showRdpModal.value = false;
//   selectedRdpConnection.value = null;
// };

// 显示右键菜单
const showContextMenu = (event: MouseEvent, connection: ConnectionInfo) => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  contextTargetConnection.value = connection;
  connectionMenu.calculateMenuPosition(event, '.context-menu');
  document.addEventListener('click', closeContextMenu, { once: true });
};

// 关闭右键菜单
const closeContextMenu = () => {
  connectionMenu.closeMenu();
  contextTargetConnection.value = null;
  document.removeEventListener('click', closeContextMenu);
};

// 处理右键菜单操作
const handleMenuAction = async (action: 'add' | 'edit' | 'delete' | 'clone') => {
  // 添加 'clone' 类型
  const conn = contextTargetConnection.value;
  closeContextMenu(); // 先关闭菜单

  if (action === 'add') {
    log.info(
      '[WorkspaceConnectionList] handleMenuAction called with action: add. Emitting request-add-connection...',
    );
    // router.push('/connections/add'); // 改为触发事件
    emitWorkspaceEvent('connection:requestAdd');
  } else if (conn) {
    if (action === 'edit') {
      // router.push(`/connections/edit/${conn.id}`); // 改为触发事件
      emitWorkspaceEvent('connection:requestEdit', { connectionInfo: conn }); // 传递整个连接对象
    } else if (action === 'delete') {
      const confirmed = await showConfirmDialog({
        message: t('connections.prompts.confirmDelete', { name: conn.name || conn.host }),
      });
      if (confirmed) {
        connectionsStore.deleteConnection(conn.id);
        // 注意：删除后列表会自动更新，因为 store 是响应式的
      }
    } else if (action === 'clone') {
      // 调用 store 中的 cloneConnection 方法
      // 需要先生成新名称
      const allConnections = connectionsStore.connections;
      let newName = `${conn.name} (1)`;
      let counter = 1;
      const baseName = conn.name;
      const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escapedBaseName} \\((\\d+)\\)$`);

      while (allConnections.some((c) => c.name === newName)) {
        counter++;
        newName = `${baseName} (${counter})`;
      }
      if (counter === 1 && allConnections.some((c) => c.name === baseName)) {
        // 处理原始名称已存在的情况
      }

      connectionsStore.cloneConnection(conn.id, newName).catch((error) => {
        // 可以在这里处理克隆失败的特定 UI 反馈，如果需要的话
        log.error('Cloning failed in component:', error);
      });
    }
  }
};

// 显示标签右键菜单
const showTagContextMenu = (
  event: MouseEvent,
  groupData: (typeof filteredAndGroupedConnections.value)[0],
) => {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  contextTargetTagGroup.value = groupData;
  tagMenu.calculateMenuPosition(event, '.tag-context-menu');
  document.addEventListener('click', closeTagContextMenu, { once: true });
};

// 关闭标签右键菜单
const closeTagContextMenu = () => {
  tagMenu.closeMenu();
  document.removeEventListener('click', closeTagContextMenu);
};

// 处理标签右键菜单操作
// 修改：允许直接传递 groupData，用于新的行内编辑按钮
const handleTagMenuAction = async (
  action: 'connectAll' | 'manageTag' | 'deleteAllConnections',
  directGroupData?: (typeof filteredAndGroupedConnections.value)[0],
) => {
  const group = directGroupData || contextTargetTagGroup.value; // 优先使用直接传递的 groupData
  closeTagContextMenu(); // 先关闭菜单

  if (group && action === 'connectAll') {
    const sshConnections = group.connections.filter((conn) => conn.type === 'SSH');

    if (sshConnections.length > 0) {
      sshConnections.forEach((conn) => {
        emitWorkspaceEvent('connection:connect', { connectionId: conn.id });
      });
      uiNotificationsStore.addNotification({
        message: t('workspaceConnectionList.connectingAllSshInGroup', {
          count: sshConnections.length,
          groupName: group.groupName,
        }),
        type: 'info',
      });
    } else {
      uiNotificationsStore.addNotification({
        message: t('workspaceConnectionList.noSshConnectionsInGroup', {
          groupName: group.groupName,
        }),
        type: 'info',
      });
    }
  } else if (group && action === 'manageTag') {
    if (group.tagId !== null) {
      // 确保不是 "未标记" 分组
      tagToManage.value = {
        id: group.tagId,
        name: group.groupName,
        created_at: tags.value.find((t) => t.id === group.tagId)?.created_at || Date.now() / 1000, // 尝试获取真实时间，否则用当前
        updated_at: tags.value.find((t) => t.id === group.tagId)?.updated_at || Date.now() / 1000,
      };
      showManageTagModal.value = true;
    } else {
      uiNotificationsStore.addNotification({
        message: t('workspaceConnectionList.manageTags.cannotManageUntagged'), // 需要添加这个翻译
        type: 'warning',
      });
    }
  } else if (group && action === 'deleteAllConnections') {
    // 确保是已标记的组
    if (group.tagId === null) {
      uiNotificationsStore.addNotification({
        message: t('workspaceConnectionList.cannotDeleteFromUntagged'),
        type: 'warning',
      });
      return;
    }
    // 确保组内有连接
    if (group.connections.length === 0) {
      uiNotificationsStore.addNotification({
        message: t('workspaceConnectionList.noConnectionsToDeleteInGroup', {
          groupName: group.groupName,
        }),
        type: 'info',
      });
      return;
    }

    const confirmed = await showConfirmDialog({
      message: t('workspaceConnectionList.confirmDeleteAllConnectionsInGroup', {
        count: group.connections.length,
        groupName: group.groupName,
      }),
    });
    if (confirmed) {
      const connectionIdsToDelete = group.connections.map((conn) => conn.id);

      const deletePromises = connectionIdsToDelete.map((connId) =>
        connectionsStore.deleteConnection(connId).catch((err) => {
          log.error(
            `[WkspConnList] Failed to delete connection ${connId} in group ${group.groupName}:`,
            err,
          );
          return Promise.reject({ connId, error: err });
        }),
      );

      Promise.allSettled(deletePromises).then((results) => {
        const successfulDeletes = results.filter((result) => result.status === 'fulfilled').length;
        const failedDeletes = results.filter((result) => result.status === 'rejected').length;

        if (successfulDeletes > 0) {
          uiNotificationsStore.addNotification({
            message: t('workspaceConnectionList.allConnectionsInGroupDeletedSuccess', {
              count: successfulDeletes,
              groupName: group.groupName,
            }),
            type: 'success',
          });
        }
        if (failedDeletes > 0) {
          uiNotificationsStore.addNotification({
            message: t('workspaceConnectionList.someConnectionsInGroupDeleteFailed', {
              count: failedDeletes,
              groupName: group.groupName,
            }),
            type: 'error',
          });
        }
      });
    }
  }
};

const handleManageTagModalSaved = () => {
  connectionsStore.fetchConnections(); // 刷新连接列表
  tagsStore.fetchTags(); // 刷新标签列表，以防标签名称等有变动（虽然此模态框不直接改名）
};

// 处理失焦事件，清除高亮
const handleBlur = () => {
  // 稍微延迟一下重置，以防是点击列表项导致的失焦
  // 如果用户点击了列表项，handleConnect 会先触发
  setTimeout(() => {
    // 检查此时是否仍然没有焦点在输入框上（避免误清除）
    if (document.activeElement !== searchInputRef.value) {
      highlightedIndex.value = -1;
    }
  }, 150); // 150ms 延迟可能更稳妥
};

// 获取数据的 onMounted 调用已移至新的 onMounted 逻辑中

// +++ 注册/注销自定义聚焦动作 +++
let unregisterFocusAction: (() => void) | null = null; // 用于存储注销函数

onMounted(() => {
  // 调用新的 registerFocusAction 并存储返回的注销函数
  // focusSearchInput 返回 boolean，符合 () => boolean | Promise<boolean | undefined> 类型
  unregisterFocusAction = focusSwitcherStore.registerFocusAction(
    'connectionListSearch',
    focusSearchInput,
  );
  connectionsStore.fetchConnections(); // 移到 onMounted
  tagsStore.fetchTags(); // 移到 onMounted
  // Load initial expanded state after fetching tags/connections
  expandedGroups.value = loadInitialExpandedGroups();
});

onBeforeUnmount(() => {
  // 调用存储的注销函数
  if (unregisterFocusAction) {
    unregisterFocusAction();
    log.info(`[WkspConnList] Unregistered focus action on unmount.`);
  }
  unregisterFocusAction = null;
});

// 处理中键点击（在新标签页打开） - 功能已移除

// 暴露聚焦搜索框的方法
const focusSearchInput = (): boolean => {
  if (searchInputRef.value) {
    searchInputRef.value.focus();
    return true; // 聚焦成功
  }
  return false; // 聚焦失败
};
defineExpose({ focusSearchInput });

// --- 键盘导航和确认 ---

const handleKeyDown = (event: KeyboardEvent) => {
  const list = flatVisibleConnections.value; // Always navigate the potentially flat list
  if (!list.length) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault(); // 阻止光标移动
      highlightedIndex.value = (highlightedIndex.value + 1) % list.length;
      scrollToHighlighted();
      break;
    case 'ArrowUp':
      event.preventDefault(); // 阻止光标移动
      highlightedIndex.value = (highlightedIndex.value - 1 + list.length) % list.length;
      scrollToHighlighted();
      break;
    case 'Enter':
      event.preventDefault(); // 阻止可能的表单提交
      if (highlightedConnectionId.value !== null) {
        handleConnect(highlightedConnectionId.value);
      }
      break;
  }
};

// 滚动到高亮项
const scrollToHighlighted = async () => {
  await nextTick(); // 等待 DOM 更新
  if (!listAreaRef.value || highlightedConnectionId.value === null) return;

  // Query selector needs to work for both grouped and flat lists
  const highlightedElement = listAreaRef.value.querySelector(
    `li[data-conn-id="${highlightedConnectionId.value}"]`,
  );
  if (highlightedElement) {
    highlightedElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
};

// 标签编辑逻辑已提取至 useTagEditing composable
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-background text-foreground">
    <!-- ... Loading/Error states ... -->
    <div
      v-if="(connectionsLoading || tagsLoading) && connections.length === 0 && tags.length === 0"
      class="flex items-center justify-center h-full text-text-secondary"
    >
      <i class="fas fa-spinner fa-spin mr-2"></i> {{ t('common.loading') }}
    </div>
    <div
      v-else-if="connectionsError || (tagsError && tags.length === 0)"
      class="flex items-center justify-center h-full text-error px-4 text-center"
    >
      <i class="fas fa-exclamation-triangle mr-2"></i> {{ connectionsError || tagsError }}
    </div>

    <!-- Main Content Area -->
    <div v-else class="flex flex-col h-full">
      <!-- Search and Add Bar -->
      <div class="flex p-2 border-b border-border/50">
        <!-- Reduced padding p-3 to p-2 -->
        <input
          type="text"
          v-model="searchTerm"
          :placeholder="t('workspaceConnectionList.searchPlaceholder')"
          ref="searchInputRef"
          class="flex-grow min-w-0 px-4 py-1.5 border border-border/50 rounded-lg bg-input text-foreground text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out"
          data-focus-id="connectionListSearch"
          @keydown="handleKeyDown"
          @blur="handleBlur"
        />
        <button
          class="ml-2 w-8 h-8 bg-primary text-white border-none rounded-lg text-sm font-semibold cursor-pointer shadow-md transition-colors duration-200 ease-in-out hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-70 flex-shrink-0 flex items-center justify-center"
          @click="handleMenuAction('add')"
          :title="t('connections.addConnection')"
        >
          <i class="fas fa-plus text-white"></i>
        </button>
      </div>

      <!-- Connection List Area -->
      <div class="flex-grow overflow-y-auto p-2" ref="listAreaRef">
        <!-- No Results / No Connections State -->
        <!-- 修改 v-if 条件，考虑两种模式，并且仅在有搜索词时显示 "No Results" -->
        <div
          v-if="
            ((showConnectionTagsBoolean && filteredAndGroupedConnections.length === 0) ||
              (!showConnectionTagsBoolean && flatFilteredConnections.length === 0)) &&
            connections.length > 0 &&
            searchTerm
          "
          class="p-6 text-center text-text-secondary"
        >
          <i class="fas fa-search text-xl mb-2"></i>
          <p>{{ t('workspaceConnectionList.noResults') }} "{{ searchTerm }}"</p>
        </div>
        <div v-else-if="connections.length === 0" class="p-6 text-center text-text-secondary">
          <i class="fas fa-plug text-xl mb-2"></i>
          <p>{{ t('connections.noConnections') }}</p>
          <button
            class="mt-4 px-4 py-2 bg-primary text-white border-none rounded-lg text-sm font-semibold cursor-pointer shadow-md transition-colors duration-200 ease-in-out hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
            @click="handleMenuAction('add')"
          >
            {{ t('connections.addFirstConnection') }}
          </button>
        </div>

        <!-- Groups and Connections (Conditional Rendering) -->
        <div v-else>
          <!-- Grouped View -->
          <div v-if="showConnectionTagsBoolean">
            <div
              v-for="groupData in filteredAndGroupedConnections"
              :key="groupData.groupName"
              class="mb-1 last:mb-0"
            >
              <!-- Group Header -->
              <div
                class="group px-3 py-2 font-semibold flex items-center text-foreground rounded-md hover:bg-header/80 transition-colors duration-150"
                :class="{
                  'cursor-pointer':
                    editingTagId !== (groupData.tagId === null ? 'untagged' : groupData.tagId),
                }"
                @click="
                  editingTagId !== (groupData.tagId === null ? 'untagged' : groupData.tagId)
                    ? toggleGroup(groupData.groupName)
                    : null
                "
                @contextmenu.prevent="showTagContextMenu($event, groupData)"
              >
                <i
                  :class="[
                    'fas',
                    expandedGroups[groupData.groupName] ? 'fa-chevron-down' : 'fa-chevron-right',
                    'mr-2 w-4 text-center text-text-secondary group-hover:text-foreground transition-transform duration-200 ease-in-out',
                    { 'transform rotate-0': !expandedGroups[groupData.groupName] },
                  ]"
                  @click.stop="toggleGroup(groupData.groupName)"
                  class="cursor-pointer flex-shrink-0"
                ></i>
                <!-- 编辑状态 -->
                <input
                  v-if="editingTagId === (groupData.tagId === null ? 'untagged' : groupData.tagId)"
                  :key="
                    groupData.tagId === null ? 'untagged-input' : `tag-input-${groupData.tagId}`
                  "
                  :ref="
                    (el) =>
                      setTagInputRef(el, groupData.tagId === null ? 'untagged' : groupData.tagId)
                  "
                  type="text"
                  v-model="editedTagName"
                  class="text-sm bg-input border border-primary rounded px-1 py-0 w-full"
                  @blur="finishEditingTag"
                  @keydown.enter.prevent="finishEditingTag"
                  @keydown.esc.prevent="cancelEditingTag"
                  @click.stop
                />
                <!-- 显示状态 -->
                <span
                  v-else
                  class="text-sm inline-block overflow-hidden text-ellipsis whitespace-nowrap"
                  :class="{ 'cursor-pointer hover:underline': true }"
                  :title="t('workspaceConnectionList.clickToEditTag')"
                  @click.stop="startEditingTag(groupData.tagId, groupData.groupName)"
                >
                  {{ groupData.groupName }}
                </span>
                <!-- 占位符，占据剩余空间 -->
                <div class="flex-grow min-w-0"></div>
                <!-- 标签栏右侧的编辑按钮 -->
                <button
                  v-if="
                    groupData.tagId !== null &&
                    editingTagId !== (groupData.tagId === null ? 'untagged' : groupData.tagId)
                  "
                  @click.stop="handleTagMenuAction('manageTag', groupData)"
                  class="ml-2 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded text-text-secondary hover:text-primary hover:bg-black/10 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 focus:outline-none"
                  :title="t('workspaceConnectionList.manageTags.menuItem')"
                >
                  <i class="fas fa-edit fa-xs"></i>
                </button>
              </div>
              <!-- Connection Items List -->
              <ul v-show="expandedGroups[groupData.groupName]" class="list-none p-0 m-0 pl-3">
                <ConnectionItem
                  v-for="conn in groupData.connections"
                  :key="conn.id"
                  :connection="conn"
                  :highlighted="conn.id === highlightedConnectionId"
                  @connect="(id) => handleConnect(id)"
                  @contextmenu="(e, c) => showContextMenu(e, c)"
                />
              </ul>
            </div>
          </div>
          <!-- Flat View -->
          <!-- 虚拟滚动模式（连接数 > 50 时启用）-->
          <div v-else-if="shouldUseVirtualList" v-bind="containerProps" class="h-full">
            <ul v-bind="wrapperProps" class="list-none p-0 m-0">
              <ConnectionItem
                v-for="{ data: conn } in virtualList"
                :key="conn.id"
                :connection="conn"
                :highlighted="conn.id === highlightedConnectionId"
                :is-virtual="true"
                :style="{ height: `${CONNECTION_ITEM_HEIGHT}px` }"
                @connect="(id) => handleConnect(id)"
                @contextmenu="(e, c) => showContextMenu(e, c)"
              />
            </ul>
          </div>
          <!-- 普通模式（连接数 <= 50）-->
          <ul v-else class="list-none p-0 m-0">
            <ConnectionItem
              v-for="conn in flatFilteredConnections"
              :key="conn.id"
              :connection="conn"
              :highlighted="conn.id === highlightedConnectionId"
              @connect="(id) => handleConnect(id)"
              @contextmenu="(e, c) => showContextMenu(e, c)"
            />
          </ul>
        </div>
      </div>
    </div>

    <!-- 连接右键菜单 -->
    <ConnectionContextMenu
      v-model:visible="connectionMenu.visible.value"
      :position="connectionMenu.position.value"
      :target-connection="contextTargetConnection"
      @action="handleMenuAction"
    />

    <!-- 标签右键菜单 -->
    <TagGroupContextMenu
      v-model:visible="tagMenu.visible.value"
      :position="tagMenu.position.value"
      :target-group="contextTargetTagGroup"
      @action="(action) => handleTagMenuAction(action)"
    />

    <teleport to="body">
      <ManageTagConnectionsModal
        :tag-info="tagToManage"
        v-model:visible="showManageTagModal"
        @saved="handleManageTagModalSaved"
      />
    </teleport>
  </div>
</template>
