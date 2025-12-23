<template>
  <div
    v-if="visible"
    class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4"
    @click.self="handleCancel"
  >
    <div
      class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col"
    >
      <!-- Header -->
      <div class="flex justify-between items-center pb-4 mb-4 border-b border-border flex-shrink-0">
        <h3 class="text-xl font-semibold">
          {{ t('sendFilesModal.title') }}
        </h3>
        <button
          @click="handleCancel"
          class="text-text-secondary hover:text-foreground transition-colors"
          aria-label="Close modal"
        >
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-grow overflow-y-auto pr-1 space-y-4">
        <!-- Top Section: Search, Target Path, Transfer Method -->
        <div class="space-y-4">
          <input
            type="text"
            :placeholder="t('sendFilesModal.searchConnectionsPlaceholder')"
            v-model="searchTerm"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm"
          />
          <div class="flex flex-col sm:flex-row gap-4">
            <div class="form-group flex-1">
              <label for="targetPath" class="block text-sm font-medium text-text-secondary mb-1">{{
                t('sendFilesModal.targetPathLabel')
              }}</label>
              <input
                type="text"
                id="targetPath"
                v-model="targetPath"
                :placeholder="t('sendFilesModal.targetPathPlaceholder')"
                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm"
              />
            </div>
            <div class="form-group sm:w-48">
              <label
                for="transferMethod"
                class="block text-sm font-medium text-text-secondary mb-1"
                >{{ t('sendFilesModal.transferMethodLabel') }}</label
              >
              <select
                id="transferMethod"
                v-model="transferMethod"
                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
                style="
                  background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
                  background-position: right 0.75rem center;
                  background-size: 16px 12px;
                "
              >
                <option value="auto">{{ t('sendFilesModal.transferMethodAuto') }}</option>
                <option value="rsync">rsync</option>
                <option value="scp">scp</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Connections Section -->
        <div
          class="border border-border rounded-md p-4 space-y-4 max-h-72 overflow-y-auto bg-header/30"
        >
          <div
            v-if="isLoadingConnections || isLoadingTags"
            class="flex items-center justify-center h-24 text-text-secondary"
          >
            <i class="fas fa-spinner fa-spin mr-2"></i> {{ t('sendFilesModal.loadingConnections') }}
          </div>
          <div
            v-else-if="filteredGroupedConnections.length === 0 && !searchTerm"
            class="flex flex-col items-center justify-center h-24 text-text-secondary"
          >
            <i class="fas fa-folder-open text-2xl mb-2"></i>
            <p>{{ t('sendFilesModal.noConnections') }}</p>
          </div>
          <div
            v-else-if="filteredGroupedConnections.length === 0 && searchTerm"
            class="flex flex-col items-center justify-center h-24 text-text-secondary"
          >
            <i class="fas fa-search text-2xl mb-2"></i>
            <p>{{ t('sendFilesModal.noConnectionsFound') }}</p>
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="group in filteredGroupedConnections"
              :key="getGroupId(group)"
              class="tag-group"
            >
              <div
                class="flex items-center py-1.5 cursor-pointer group"
                @click="toggleTagGroupExpansion(group)"
              >
                <input
                  type="checkbox"
                  :id="'tag-cb-' + getGroupId(group)"
                  :checked="isTagGroupSelected(group)"
                  :indeterminate="isTagGroupIndeterminate(group)"
                  @change="toggleTagGroupSelection(group)"
                  @click.stop
                  class="mr-1.5 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                />
                <i
                  :class="[
                    'fas',
                    (expandedTagGroups[getGroupId(group)] ?? true)
                      ? 'fa-chevron-down'
                      : 'fa-chevron-right',
                    'mr-2 w-3 text-center text-text-secondary/80 group-hover:text-text-secondary transition-transform duration-150 ease-in-out',
                  ]"
                  style="font-size: 0.75rem"
                ></i>
                <label
                  :for="'tag-cb-' + getGroupId(group)"
                  class="font-semibold text-foreground select-none cursor-pointer text-sm"
                  @click.stop
                >
                  {{ group.tag ? group.tag.name : t('sendFilesModal.untaggedConnections') }} ({{
                    group.connections.length
                  }})
                </label>
              </div>
              <ul v-show="expandedTagGroups[getGroupId(group)] ?? true" class="pl-7 space-y-0.5">
                <li
                  v-for="connection in group.connections"
                  :key="connection.id"
                  class="flex items-center p-2.5 rounded-md hover:bg-primary/10 cursor-pointer transition-colors duration-150"
                  :class="{ 'bg-primary/20': selectedConnectionIds.includes(connection.id) }"
                  @click="toggleIndividualConnectionSelection(connection.id)"
                >
                  <input
                    type="checkbox"
                    :id="'conn-' + connection.id"
                    :value="connection.id"
                    v-model="selectedConnectionIds"
                    class="mr-3 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0"
                    @click.stop
                  />
                  <i
                    :class="
                      getConnectionIconClass(connection.type) +
                      ' mr-2.5 w-4 text-center text-text-secondary'
                    "
                  ></i>
                  <span class="text-sm truncate flex-grow" :title="connection.name">{{
                    connection.name
                  }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Items to Send Summary -->
        <div class="p-3 border border-border rounded-md bg-muted/30 space-y-1">
          <h3 class="text-sm font-semibold text-foreground">
            {{ t('sendFilesModal.itemsToSendTitle') }}
          </h3>
          <ul
            v-if="itemsToSend && itemsToSend.length > 0"
            class="max-h-24 overflow-y-auto space-y-0.5"
          >
            <li
              v-for="item in itemsToSend"
              :key="item.path"
              class="text-xs text-text-secondary truncate"
              :title="item.path"
            >
              {{ item.name }}
            </li>
          </ul>
          <p v-else class="text-xs text-text-secondary italic">
            {{ t('sendFilesModal.noItemsSelected') }}
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div
        class="flex justify-end items-center pt-4 mt-auto border-t border-border flex-shrink-0 space-x-3"
      >
        <button
          @click="handleCancel"
          class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 transition-colors duration-150 ease-in-out"
        >
          {{ t('sendFilesModal.cancelButton') }}
        </button>
        <button
          @click="handleSend"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 ease-in-out"
          :disabled="selectedConnectionIds.length === 0 || !targetPath.trim()"
        >
          {{ t('sendFilesModal.sendButton') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import { useTagsStore, type TagInfo } from '../stores/tags.store';
import apiClient from '../utils/apiClient';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents'; // +++ 导入事件发射器 +++

interface ItemToSend {
  name: string;
  path: string;
  type: 'file' | 'directory'; // Type is now mandatory
}

interface SourceItem {
  // As per backend InitiateTransferPayload
  name: string;
  path: string;
  type: 'file' | 'directory';
}

interface GroupedConnection {
  tag: TagInfo | null;
  connections: ConnectionInfo[];
}

const props = defineProps<{
  visible: boolean;
  itemsToSend: ItemToSend[];
  sourceConnectionId: number | null; // +++ 新增 sourceConnectionId prop +++
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  // 'send' emit might become obsolete or change if all logic moves to API call
}>();

const { t } = useI18n();
const connectionsStore = useConnectionsStore();
const tagsStore = useTagsStore();
const uiNotificationsStore = useUiNotificationsStore();
const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器实例 +++

const searchTerm = ref('');
const targetPath = ref('');
const transferMethod = ref<'auto' | 'rsync' | 'scp'>('auto');
const selectedConnectionIds = ref<number[]>([]);

const isLoadingConnections = ref(false);
const isLoadingTags = ref(false);

const expandedTagGroups = ref<Record<string, boolean>>({});

const getGroupId = (group: GroupedConnection): string => {
  return group.tag ? String(group.tag.id) : 'untagged';
};

const toggleTagGroupExpansion = (group: GroupedConnection) => {
  const groupId = getGroupId(group);
  expandedTagGroups.value[groupId] = !(expandedTagGroups.value[groupId] ?? true);
};

// Simulate data for itemsToSend for development if not provided
const itemsToSendInternal = computed<ItemToSend[]>(() => {
  if (props.itemsToSend && props.itemsToSend.length > 0) {
    return props.itemsToSend;
  }
  return [
    { name: 'file1.txt', path: '/local/file1.txt', type: 'file' },
    { name: 'folderA', path: '/local/folderA', type: 'directory' },
    { name: 'another-item.zip', path: '/local/another-item.zip', type: 'file' },
  ];
});

onMounted(async () => {
  isLoadingConnections.value = true;
  isLoadingTags.value = true;
  try {
    if (connectionsStore.connections.length === 0) {
      await connectionsStore.fetchConnections();
    }
    if (tagsStore.tags.length === 0) {
      await tagsStore.fetchTags();
    }
  } catch (error) {
    console.error(t('sendFilesModal.errorFetchingData'), error);
    // Optionally, show a user-facing error message
  } finally {
    isLoadingConnections.value = false;
    isLoadingTags.value = false;
  }
});

const allConnections = computed(() => connectionsStore.connections);
const allTags = computed(() => tagsStore.tags);

const groupedConnections = computed<GroupedConnection[]>(() => {
  const groups: Record<string, GroupedConnection> = {};
  const untaggedConnections: ConnectionInfo[] = [];

  allConnections.value.forEach((conn) => {
    if (conn.type?.toLowerCase() !== 'ssh') {
      // 首先过滤掉非 SSH 连接
      return;
    }
    const connTagIds = conn.tag_ids || [];
    if (connTagIds.length === 0) {
      untaggedConnections.push(conn);
    } else {
      connTagIds.forEach((tagId: number) => {
        const tag = allTags.value.find((t) => t.id === tagId);
        if (tag) {
          if (!groups[tag.id]) {
            groups[tag.id] = { tag, connections: [] };
          }
          // Avoid adding duplicate connections to the same group
          if (!groups[tag.id].connections.some((c) => c.id === conn.id)) {
            groups[tag.id].connections.push(conn);
          }
        } else {
          if (!untaggedConnections.some((c) => c.id === conn.id)) {
            untaggedConnections.push(conn);
          }
        }
      });
    }
  });

  const sortedGroups = Object.values(groups).sort((a, b) => a.tag!.name.localeCompare(b.tag!.name));

  if (untaggedConnections.length > 0) {
    return [...sortedGroups, { tag: null, connections: untaggedConnections }];
  }
  return sortedGroups;
});

const filteredGroupedConnections = computed<GroupedConnection[]>(() => {
  const baseGroups = groupedConnections.value;

  if (!searchTerm.value.trim()) {
    // If no search term, filter out groups that initially have no connections.
    return baseGroups.filter((group) => group.connections.length > 0);
  }

  const lowerSearchTerm = searchTerm.value.toLowerCase();

  const result = baseGroups
    .map((group) => {
      const groupDisplayName = group.tag ? group.tag.name : t('sendFilesModal.untaggedConnections');
      const isTagMatch = groupDisplayName.toLowerCase().includes(lowerSearchTerm);

      const connsMatchingSearchByName = group.connections.filter(
        (conn) => conn.name.toLowerCase().includes(lowerSearchTerm)
        // conn.type filtering is already handled in groupedConnections
      );

      if (isTagMatch) {
        // Tag name matches. Show all connections of this group.
        return { ...group, connections: group.connections };
      } else if (connsMatchingSearchByName.length > 0) {
        // Tag name doesn't match, but some connection names do. Show only those connections.
        return { ...group, connections: connsMatchingSearchByName };
      }

      return null; // Group doesn't match by tag name and has no connections matching by name
    })
    .filter((group) => group !== null && group.connections.length > 0) as GroupedConnection[];

  return result;
});

const isTagGroupSelected = (group: GroupedConnection): boolean => {
  if (group.connections.length === 0) return false;
  return group.connections.every((conn) => selectedConnectionIds.value.includes(conn.id));
};

const isTagGroupIndeterminate = (group: GroupedConnection): boolean => {
  if (group.connections.length === 0) return false;
  const selectedCount = group.connections.filter((conn) =>
    selectedConnectionIds.value.includes(conn.id)
  ).length;
  return selectedCount > 0 && selectedCount < group.connections.length;
};

const toggleTagGroupSelection = (group: GroupedConnection) => {
  const groupConnectionIds = group.connections.map((conn) => conn.id);
  if (isTagGroupSelected(group)) {
    // Deselect all
    selectedConnectionIds.value = selectedConnectionIds.value.filter(
      (id) => !groupConnectionIds.includes(id)
    );
  } else {
    // Select all (or add to selection if partially selected)
    groupConnectionIds.forEach((id) => {
      if (!selectedConnectionIds.value.includes(id)) {
        selectedConnectionIds.value.push(id);
      }
    });
  }
};

watch(
  () => props.visible,
  (newValue) => {
    if (newValue) {
      if (connectionsStore.connections.length === 0) {
        connectionsStore
          .fetchConnections()
          .catch((error) => console.error(t('sendFilesModal.errorFetchingConnections'), error));
      }
      if (tagsStore.tags.length === 0) {
        tagsStore
          .fetchTags()
          .catch((error) => console.error(t('sendFilesModal.errorFetchingTags'), error));
      }
    }
  }
);

const handleSend = async () => {
  if (selectedConnectionIds.value.length === 0 || !targetPath.value.trim()) {
    uiNotificationsStore.showError(t('sendFilesModal.validationError')); // Assuming you add this key
    return;
  }

  const sourceItems: SourceItem[] = itemsToSendInternal.value;

  const payload = {
    sourceConnectionId: props.sourceConnectionId, // +++ 添加 sourceConnectionId 到 payload +++
    connectionIds: [...selectedConnectionIds.value], // 这些是目标服务器IDs
    sourceItems,
    remoteTargetPath: targetPath.value.trim(),
    transferMethod: transferMethod.value,
  };

  // 验证 sourceConnectionId 是否存在
  if (payload.sourceConnectionId === null || payload.sourceConnectionId === undefined) {
    console.error('Source Connection ID is missing in SendFilesModal payload:', payload);
    uiNotificationsStore.showError(
      t(
        'sendFilesModal.errorSourceConnectionMissing',
        'Source server information is missing. Cannot initiate transfer.'
      )
    );
    return;
  }

  try {
    const response = await apiClient.post('/transfers/send', payload);
    // Assuming the backend returns something like { taskId: "some-id" } on success
    if (response.data && response.data.taskId) {
      uiNotificationsStore.showSuccess(
        t('sendFilesModal.transferInitiated', { taskId: response.data.taskId })
      );
    } else {
      uiNotificationsStore.showSuccess(t('sendFilesModal.transferInitiatedGeneric'));
    }
    emitWorkspaceEvent('ui:openTransferProgressModal'); // +++ 触发打开传输进度模态框的事件 +++
    emit('update:visible', false);
  } catch (error: any) {
    console.error('Failed to initiate transfer:', error);
    const errorMessage =
      error.response?.data?.message || error.message || t('sendFilesModal.transferFailedError');
    uiNotificationsStore.showError(errorMessage);
    // Do not close modal on error
  }
};

const handleCancel = () => {
  emit('update:visible', false);
};

const toggleIndividualConnectionSelection = (connectionId: number) => {
  const index = selectedConnectionIds.value.indexOf(connectionId);
  if (index > -1) {
    selectedConnectionIds.value.splice(index, 1);
  } else {
    selectedConnectionIds.value.push(connectionId);
  }
};

const getConnectionIconClass = (connectionType?: string): string => {
  const type = connectionType?.toLowerCase();
  switch (type) {
    case 'rdp':
      return 'fas fa-desktop';
    case 'vnc':
      return 'fas fa-plug';
    case 'ssh':
      return 'fas fa-server';
    case 'telnet':
      return 'fas fa-keyboard';
    case 'local':
      return 'fas fa-laptop';
    case 'serial':
      return 'fas fa-microchip';
    case 'docker':
      return 'fab fa-docker';
    default:
      return 'fas fa-server';
  }
};
</script>
