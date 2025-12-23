<script setup lang="ts">
import { ref, watch, computed, PropType, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionInfo } from '../stores/connections.store';
import { useConnectionsStore } from '../stores/connections.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useProxiesStore } from '../stores/proxies.store';
import { useTagsStore, type TagInfo } from '../stores/tags.store';
import { useSshKeysStore, type SshKeyBasicInfo } from '../stores/sshKeys.store';
import TagInput from './TagInput.vue';

interface BatchUpdateData {
  port?: number | string | null;
  username?: string | null;
  password?: string | null;
  ssh_key_id?: number | null;
  proxy_id?: number | null;
  tag_ids?: number[];
  notes?: string | null;
}

const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
  connectionIds: {
    type: Array as PropType<number[]>,
    required: true,
  },
});

const emit = defineEmits(['update:visible', 'saved']);

const { t } = useI18n();
const connectionsStore = useConnectionsStore();
const uiNotificationsStore = useUiNotificationsStore();
const proxiesStore = useProxiesStore();
const tagsStore = useTagsStore();
const sshKeysStore = useSshKeysStore();

const internalVisible = ref(props.visible);
const isLoading = ref(false);
const formData = ref<BatchUpdateData>({});

const enablePortEdit = ref(false);
const enableAuthEdit = ref(false);
const enableAdvancedEdit = ref(false);
// Removed enableNotesEdit, notes editability is tied to enableAdvancedEdit

const availableTags = computed(() => tagsStore.tags as TagInfo[]);
const availableProxies = computed(() => proxiesStore.proxies);
const availableSshKeys = computed(() => sshKeysStore.sshKeys as SshKeyBasicInfo[]);

watch(
  () => props.visible,
  (newVal) => {
    internalVisible.value = newVal;
    if (newVal) {
      formData.value = {
        port: undefined,
        username: undefined,
        password: undefined,
        ssh_key_id: undefined,
        proxy_id: undefined,
        tag_ids: undefined,
        notes: undefined, // Keep notes initialization
      };
      enablePortEdit.value = false;
      enableAuthEdit.value = false;
      enableAdvancedEdit.value = false;
      // Removed enableNotesEdit initialization

      if (availableProxies.value.length === 0 && !proxiesStore.isLoading) {
        proxiesStore.fetchProxies();
      }
      if (availableTags.value.length === 0 && !tagsStore.isLoading) {
        tagsStore.fetchTags();
      }
      if (availableSshKeys.value.length === 0 && !sshKeysStore.isLoading) {
        sshKeysStore.fetchSshKeys();
      }
    }
  }
);

watch(internalVisible, (newVal) => {
  if (newVal !== props.visible) {
    emit('update:visible', newVal);
  }
});

const handleSave = async () => {
  if (!props.connectionIds || props.connectionIds.length === 0) {
    uiNotificationsStore.addNotification({
      message: t('connections.batchEdit.noConnectionsToUpdate', '没有选中的连接可供更新'),
      type: 'warning',
    });
    return;
  }

  const updatesToApply: Partial<ConnectionInfo> = {};

  if (enablePortEdit.value && formData.value.port !== undefined) {
    if (formData.value.port === null || String(formData.value.port).trim() === '') {
      updatesToApply.port = undefined;
    } else {
      const parsedPort = parseInt(String(formData.value.port), 10);
      if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
        updatesToApply.port = parsedPort;
      } else {
        updatesToApply.port = undefined;
      }
    }
  }

  if (enableAuthEdit.value) {
    if (formData.value.username !== undefined) {
      updatesToApply.username =
        formData.value.username === null ? undefined : formData.value.username;
    }
    if (formData.value.password !== undefined) {
      (updatesToApply as any).password = formData.value.password;
    }
    if (formData.value.ssh_key_id !== undefined) {
      updatesToApply.ssh_key_id = formData.value.ssh_key_id;
    }
  }

  if (enableAdvancedEdit.value) {
    if (formData.value.proxy_id !== undefined) {
      updatesToApply.proxy_id = formData.value.proxy_id;
    }
    if (formData.value.tag_ids !== undefined) {
      updatesToApply.tag_ids = formData.value.tag_ids;
    }
    // Notes are part of "Advanced Options". If advanced is enabled, and notes have a value (even empty string), apply it.
    if (formData.value.notes !== undefined) {
      updatesToApply.notes = formData.value.notes === null ? '' : formData.value.notes; // Send empty string to clear, or the new notes.
    }
  }

  if (Object.keys(updatesToApply).length === 0) {
    uiNotificationsStore.addNotification({
      message: t('connections.batchEdit.noChanges', '未检测到任何更改'),
      type: 'info',
    });
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  try {
    let successCount = 0;
    for (const id of props.connectionIds) {
      const success = await connectionsStore.updateConnection(id, updatesToApply as ConnectionInfo);
      if (success) successCount++;
    }

    if (successCount > 0) {
      uiNotificationsStore.addNotification({
        message: t('common.updateSuccess', { count: successCount }),
        type: 'success',
      });
      emit('saved');
    }
    emit('update:visible', false);
  } catch (error: any) {
    console.error('Batch update error:', error);
    uiNotificationsStore.addNotification({ message: error.message, type: 'error' });
  } finally {
    isLoading.value = false;
  }
};

const handleCancel = () => {
  emit('update:visible', false);
};

const handleCreateTag = async (name: string) => {
  const newTag = await tagsStore.addTag(name);
  if (newTag) {
    uiNotificationsStore.addNotification({
      message: t('tags.createSuccess', { name }),
      type: 'success',
    });
  } else {
    uiNotificationsStore.addNotification({
      message: t('tags.createFailed', { name, error: tagsStore.error || 'Unknown error' }),
      type: 'error',
    });
  }
};

const handleDeleteTag = async (tagId: number) => {
  const success = await tagsStore.deleteTag(tagId);
  if (success) {
    const deletedTagName =
      availableTags.value.find((tag) => tag.id === tagId)?.name || String(tagId);
    uiNotificationsStore.addNotification({
      message: t('tags.deleteSuccessWithName', { name: deletedTagName }),
      type: 'success',
    });
    if (formData.value.tag_ids) {
      formData.value.tag_ids = formData.value.tag_ids.filter((id) => id !== tagId);
    }
  } else {
    const deletedTagName =
      availableTags.value.find((tag) => tag.id === tagId)?.name || String(tagId);
    uiNotificationsStore.addNotification({
      message: t('tags.deleteFailedWithName', {
        name: deletedTagName,
        error: tagsStore.error || 'Unknown error',
      }),
      type: 'error',
    });
  }
};

onMounted(() => {
  if (props.visible) {
    if (availableProxies.value.length === 0 && !proxiesStore.isLoading) {
      proxiesStore.fetchProxies();
    }
    if (availableTags.value.length === 0 && !tagsStore.isLoading) {
      tagsStore.fetchTags();
    }
    if (availableSshKeys.value.length === 0 && !sshKeysStore.isLoading) {
      sshKeysStore.fetchSshKeys();
    }
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="internalVisible"
      class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4"
      @click.self="handleCancel"
    >
      <div
        class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-xl max-h-[90vh] flex flex-col"
      >
        <h3 class="text-xl font-semibold text-center mb-6 flex-shrink-0">
          {{ t('connections.batchEdit.title', '批量编辑连接') }} ({{ props.connectionIds.length }}
          {{ t('connections.batchEdit.selectedItems', '项') }})
        </h3>

        <form @submit.prevent="handleSave" class="flex-grow overflow-y-auto pr-2 space-y-4">
          <!-- Port Section -->
          <div class="p-4 border border-border rounded-md bg-card">
            <div class="flex justify-between items-center mb-2">
              <h4 class="text-base font-semibold">{{ t('connections.table.port', '端口') }}</h4>
              <input
                type="checkbox"
                v-model="enablePortEdit"
                class="form-checkbox h-5 w-5 text-primary rounded border-gray-300 focus:ring-primary"
              />
            </div>
            <div v-if="enablePortEdit">
              <input
                type="text"
                id="batch-port"
                v-model="formData.port"
                class="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm"
              />
            </div>
          </div>

          <!-- Auth Section -->
          <div class="p-4 border border-border rounded-md bg-card">
            <div class="flex justify-between items-center mb-2">
              <h4 class="text-base font-semibold">
                {{ t('connections.form.sectionAuth', '认证信息') }}
              </h4>
              <input
                type="checkbox"
                v-model="enableAuthEdit"
                class="form-checkbox h-5 w-5 text-primary rounded border-gray-300 focus:ring-primary"
              />
            </div>
            <div v-if="enableAuthEdit" class="space-y-3">
              <div>
                <label for="batch-username" class="block text-sm font-medium text-text-secondary">{{
                  t('connections.form.username', '用户名')
                }}</label>
                <input
                  type="text"
                  id="batch-username"
                  v-model="formData.username"
                  class="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm"
                />
              </div>
              <div>
                <label for="batch-password" class="block text-sm font-medium text-text-secondary">{{
                  t('connections.form.authMethodPassword', '密码')
                }}</label>
                <input
                  type="password"
                  id="batch-password"
                  v-model="formData.password"
                  class="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm"
                />
              </div>
              <div>
                <label for="batch-ssh-key" class="block text-sm font-medium text-text-secondary">{{
                  t('connections.form.authMethodKey', 'SSH 密钥')
                }}</label>
                <select
                  id="batch-ssh-key"
                  v-model="formData.ssh_key_id"
                  class="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm"
                  :disabled="sshKeysStore.isLoading"
                >
                  <option :value="undefined">
                    {{ t('connections.batchEdit.noChange', '-- 不更改 --') }}
                  </option>
                  <option :value="null">{{ t('connections.form.noSshKey', '无密钥') }}</option>
                  <option v-if="sshKeysStore.isLoading" disabled>
                    {{ t('common.loading', '加载中...') }}
                  </option>
                  <option v-for="key in availableSshKeys" :key="key.id" :value="key.id">
                    {{ key.name }}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <!-- Advanced Section (Now includes Notes) -->
          <div class="p-4 border border-border rounded-md bg-card">
            <div class="flex justify-between items-center mb-2">
              <h4 class="text-base font-semibold">
                {{ t('connections.form.sectionAdvanced', '高级选项') }}
              </h4>
              <input
                type="checkbox"
                v-model="enableAdvancedEdit"
                class="form-checkbox h-5 w-5 text-primary rounded border-gray-300 focus:ring-primary"
              />
            </div>
            <div v-if="enableAdvancedEdit" class="space-y-3">
              <div>
                <label for="batch-proxy" class="block text-sm font-medium text-text-secondary">{{
                  t('connections.form.proxy', '代理')
                }}</label>
                <select
                  id="batch-proxy"
                  v-model="formData.proxy_id"
                  class="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm"
                >
                  <option :value="undefined">
                    {{ t('connections.batchEdit.noChange', '-- 不更改 --') }}
                  </option>
                  <option :value="null">{{ t('connections.form.noProxy', '无代理') }}</option>
                  <option v-for="proxy in availableProxies" :key="proxy.id" :value="proxy.id">
                    {{ proxy.name }} ({{ proxy.type }})
                  </option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-text-secondary">{{
                  t('connections.table.tags', '标签')
                }}</label>
                <TagInput
                  :modelValue="formData.tag_ids || []"
                  @update:modelValue="(val) => (formData.tag_ids = val)"
                  :availableTags="availableTags"
                  @create-tag="handleCreateTag"
                  @delete-tag="handleDeleteTag"
                  :allow-create="true"
                  :allow-delete="true"
                  class="mt-1"
                />
              </div>
              <!-- Notes section moved here, no separate enable checkbox for notes itself -->
              <div class="pt-2">
                <label for="batch-notes" class="block text-sm font-medium text-text-secondary">{{
                  t('connections.form.notes', '备注')
                }}</label>
                <textarea
                  id="batch-notes"
                  v-model="formData.notes"
                  rows="3"
                  class="mt-1 block w-full px-3 py-2 border border-border rounded-md shadow-sm bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm"
                ></textarea>
              </div>
            </div>
          </div>
        </form>

        <div class="flex justify-end items-center pt-5 mt-auto flex-shrink-0 space-x-3">
          <button
            type="button"
            @click="handleCancel"
            class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
            :disabled="isLoading"
          >
            {{ t('common.cancel', '取消') }}
          </button>
          <button
            type="submit"
            @click="handleSave"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
            :disabled="isLoading || (!enablePortEdit && !enableAuthEdit && !enableAdvancedEdit)"
          >
            <!-- Removed enableNotesEdit from disabled condition -->
            <i v-if="isLoading" class="fas fa-spinner fa-spin mr-2"></i>
            {{ t('common.save', '保存') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
