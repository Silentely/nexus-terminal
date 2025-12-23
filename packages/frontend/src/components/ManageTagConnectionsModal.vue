<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import { useTagsStore, type TagInfo } from '../stores/tags.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useConfirmDialog } from '../composables/useConfirmDialog';

interface Props {
  tagInfo: TagInfo | null; // 传递整个 TagInfo 对象
  visible: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits(['update:visible', 'saved', 'tag-deleted']);

const { t } = useI18n();
const connectionsStore = useConnectionsStore();
const tagsStore = useTagsStore(); // 如果需要更新标签信息或调用标签相关的 actions
const uiNotificationsStore = useUiNotificationsStore();
const { showConfirmDialog } = useConfirmDialog();

const { connections: allConnections, isLoading: connectionsLoading } =
  storeToRefs(connectionsStore);

const modalSearchTerm = ref('');
// 使用 Set 来存储选中的连接 ID，方便添加和删除
const selectedConnectionIds = ref<Set<number>>(new Set());
const internalVisible = ref(props.visible);

// 监听 props.visible 变化来更新 internalVisible
watch(
  () => props.visible,
  (newVisibleValue) => {
    internalVisible.value = newVisibleValue;
    if (!newVisibleValue) {
      // 关闭时重置搜索词
      modalSearchTerm.value = '';
    }
  }
);

// 监听 internalVisible 变化来 emit update:visible
watch(internalVisible, (newVal) => {
  if (newVal !== props.visible) {
    // 避免无限循环
    emit('update:visible', newVal);
  }
});

// 当模态框变为可见或 tagInfo 变化时，初始化选中的连接
watch(
  () => [internalVisible.value, props.tagInfo],
  ([isVisible, currentTagInfoUntyped]) => {
    const currentTagInfo = currentTagInfoUntyped as TagInfo | null; // 明确类型
    if (
      isVisible &&
      currentTagInfo &&
      typeof currentTagInfo === 'object' &&
      currentTagInfo !== null &&
      'id' in currentTagInfo
    ) {
      selectedConnectionIds.value.clear();
      allConnections.value.forEach((conn) => {
        if (conn.tag_ids?.includes(currentTagInfo.id)) {
          selectedConnectionIds.value.add(conn.id);
        }
      });
    }
  },
  { immediate: true, deep: true }
);

const filteredConnectionsInModal = computed(() => {
  if (!modalSearchTerm.value) {
    return allConnections.value
      .slice()
      .sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
  }
  const lowerSearchTerm = modalSearchTerm.value.toLowerCase();
  return allConnections.value
    .filter(
      (conn) =>
        (conn.name && conn.name.toLowerCase().includes(lowerSearchTerm)) ||
        conn.host.toLowerCase().includes(lowerSearchTerm)
    )
    .sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
});

const isConnectionSelected = (connectionId: number): boolean => {
  return selectedConnectionIds.value.has(connectionId);
};

const toggleConnectionSelection = (connectionId: number) => {
  if (selectedConnectionIds.value.has(connectionId)) {
    selectedConnectionIds.value.delete(connectionId);
  } else {
    selectedConnectionIds.value.add(connectionId);
  }
};

const handleSelectAll = () => {
  filteredConnectionsInModal.value.forEach((conn) => selectedConnectionIds.value.add(conn.id));
};

const handleDeselectAll = () => {
  filteredConnectionsInModal.value.forEach((conn) => selectedConnectionIds.value.delete(conn.id));
};

const handleInvertSelection = () => {
  filteredConnectionsInModal.value.forEach((conn) => {
    if (selectedConnectionIds.value.has(conn.id)) {
      selectedConnectionIds.value.delete(conn.id);
    } else {
      selectedConnectionIds.value.add(conn.id);
    }
  });
};

const handleSave = async () => {
  if (!props.tagInfo) return;

  const currentTagId = props.tagInfo.id;
  const newConnectionIdArray = Array.from(selectedConnectionIds.value);

  // 调用 store action 更新标签的连接
  // 假设 tagsStore 有一个 updateTagConnections action
  const success = await tagsStore.updateTagConnections(currentTagId, newConnectionIdArray);

  if (success) {
    uiNotificationsStore.addNotification({
      message: t('workspaceConnectionList.manageTags.saveSuccess'),
      type: 'success',
    });
    emit('saved'); // 通知父组件保存成功，可能需要刷新列表
    emit('update:visible', false);
  } else {
    uiNotificationsStore.addNotification({
      message: t('workspaceConnectionList.manageTags.saveFailed'),
      type: 'error',
    });
  }
};

const handleCancel = () => {
  emit('update:visible', false);
};

const handleDeleteTag = async () => {
  if (!props.tagInfo) return;

  const tagName = props.tagInfo.name;
  const confirmed = await showConfirmDialog({
    message: t('tags.prompts.confirmDelete', { name: tagName }),
  });
  if (confirmed) {
    const success = await tagsStore.deleteTag(props.tagInfo.id);
    if (success) {
      uiNotificationsStore.addNotification({
        message: t('tags.deleteSuccess', { name: tagName }),
        type: 'success',
      }); // 需要新的翻译键
      emit('tag-deleted'); // 通知父组件标签已删除
      emit('update:visible', false); // 关闭模态框
    } else {
      uiNotificationsStore.addNotification({
        message: t('tags.deleteFailed', {
          name: tagName,
          error: tagsStore.error || 'Unknown error',
        }),
        type: 'error',
      }); // 需要新的翻译键
    }
  }
};

onMounted(() => {
  if (connectionsStore.connections.length === 0) {
    connectionsStore.fetchConnections();
  }
});
</script>

<template>
  <div
    v-if="internalVisible"
    class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4"
    @click.self="handleCancel"
  >
    <div
      class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col"
    >
      <!-- Header -->
      <h3 class="text-xl font-semibold text-center mb-6 flex-shrink-0">
        {{ t('workspaceConnectionList.manageTags.title') }} - {{ props.tagInfo?.name }}
      </h3>

      <!-- Controls & List Container -->
      <div class="flex-grow overflow-y-hidden flex flex-col">
        <!-- Controls -->
        <div class="p-4 border-b border-border/50 flex items-center gap-2 flex-shrink-0">
          <input
            type="text"
            v-model="modalSearchTerm"
            :placeholder="t('workspaceConnectionList.manageTags.searchPlaceholder')"
            class="flex-grow min-w-0 px-3 py-2 border border-border rounded-md shadow-sm bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm"
          />
          <button
            @click="handleSelectAll"
            class="px-4 py-2 text-sm bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none transition duration-150 ease-in-out"
          >
            {{ t('workspaceConnectionList.manageTags.selectAll') }}
          </button>
          <button
            @click="handleDeselectAll"
            class="px-4 py-2 text-sm bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none transition duration-150 ease-in-out"
          >
            {{ t('workspaceConnectionList.manageTags.deselectAll') }}
          </button>
          <button
            @click="handleInvertSelection"
            class="px-4 py-2 text-sm bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none transition duration-150 ease-in-out"
          >
            {{ t('workspaceConnectionList.manageTags.invertSelection') }}
          </button>
        </div>

        <!-- Connection List -->
        <div class="flex-grow overflow-y-auto p-4 pr-2">
          <!-- Removed space-y-2 from here -->
          <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
            <!-- New wrapper div -->
            <div
              v-if="connectionsLoading"
              class="flex items-center justify-center h-full text-text-secondary"
            >
              <i class="fas fa-spinner fa-spin mr-2"></i> {{ t('common.loading') }}
            </div>
            <ul v-else-if="filteredConnectionsInModal.length > 0" class="space-y-1">
              <li
                v-for="conn in filteredConnectionsInModal"
                :key="conn.id"
                class="flex items-center p-2.5 rounded-md hover:bg-primary/10 cursor-pointer transition-colors duration-150"
                :class="{ 'bg-primary/20': isConnectionSelected(conn.id) }"
                @click="toggleConnectionSelection(conn.id)"
              >
                <input
                  type="checkbox"
                  :checked="isConnectionSelected(conn.id)"
                  class="mr-3 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0"
                  @change.stop="toggleConnectionSelection(conn.id)"
                  @click.stop
                />
                <i
                  :class="[
                    'fas',
                    conn.type === 'RDP'
                      ? 'fa-desktop'
                      : conn.type === 'VNC'
                        ? 'fa-plug'
                        : 'fa-server',
                    'mr-2.5 w-4 text-center text-text-secondary',
                  ]"
                ></i>
                <span class="text-sm truncate flex-grow" :title="conn.name || conn.host">
                  {{ conn.name || conn.host }}
                </span>
                <span class="text-xs text-text-tertiary ml-2">({{ conn.type }})</span>
              </li>
            </ul>
            <div
              v-else
              class="flex flex-col items-center justify-center h-full text-text-secondary p-6"
            >
              <i class="fas fa-search text-2xl mb-3"></i>
              <p>{{ t('workspaceConnectionList.manageTags.noConnectionsFound') }}</p>
            </div>
          </div>
          <!-- End of new wrapper div -->
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end items-center pt-5 mt-auto flex-shrink-0 space-x-3">
        <button
          @click="handleDeleteTag"
          class="px-4 py-2 bg-transparent text-error border border-error/70 rounded-md shadow-sm hover:bg-error/10 hover:text-error-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error transition duration-150 ease-in-out"
        >
          {{ t('common.delete') }}
        </button>
        <button
          @click="handleCancel"
          class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          @click="handleSave"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
        >
          {{ t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
