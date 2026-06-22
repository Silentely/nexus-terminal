<script setup lang="ts">
import { computed, watch, type Ref, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import TagInput from './TagInput.vue';
import type { ProxyInfo } from '../stores/proxies.store';
import type { TagInfo } from '../stores/tags.store';
import type { ConnectionInfo } from '../stores/connections.store';

// Define Props
const props = defineProps({
  formData: {
    type: Object as PropType<{
      id?: number;
      type: 'SSH' | 'RDP' | 'VNC' | 'Telnet';
      proxy_id: number | null;
      jump_chain: Array<number | null> | null;
      proxy_type?: 'proxy' | 'jump' | null;
      tag_ids: number[];
      notes: string;
      force_keyboard_interactive: boolean;
    }>,
    required: true,
  },
  proxies: { type: Array as PropType<ProxyInfo[]>, required: true },
  connections: { type: Array as PropType<ConnectionInfo[]>, required: true },
  tags: { type: Array as PropType<TagInfo[]>, required: true },
  isProxyLoading: { type: Boolean, required: true },
  proxyStoreError: { type: String as PropType<string | null>, required: false, default: null },
  isTagLoading: { type: Boolean, required: true },
  tagStoreError: { type: String as PropType<string | null>, required: false, default: null },
  advancedConnectionMode: { type: String as PropType<'proxy' | 'jump'>, required: true },
  addJumpHost: { type: Function as PropType<() => void>, required: true },
  removeJumpHost: { type: Function as PropType<(index: number) => void>, required: true },
  isEditMode: { type: Boolean, default: false },
});

// Define Emits
const emit = defineEmits<{
  (e: 'create-tag', tagName: string): void;
  (e: 'delete-tag', tagId: number): void;
  (e: 'update:advancedConnectionMode', mode: 'proxy' | 'jump'): void;
  (
    e: 'patch-form-data',
    patch: Partial<{
      proxy_id: number | null;
      jump_chain: Array<number | null> | null;
      tag_ids: number[];
      notes: string;
      force_keyboard_interactive: boolean;
    }>,
  ): void;
}>();

const { t } = useI18n();

const handleCreateTagEvent = (tagName: string) => {
  emit('create-tag', tagName);
};

const handleDeleteTagEvent = (tagId: number) => {
  emit('delete-tag', tagId);
};

const patchFormData = (
  patch: Partial<{
    proxy_id: number | null;
    jump_chain: Array<number | null> | null;
    tag_ids: number[];
    notes: string;
    force_keyboard_interactive: boolean;
  }>,
) => {
  emit('patch-form-data', patch);
};

const handleProxyIdChange = (value: string) => {
  patchFormData({ proxy_id: value === '' ? null : Number(value) });
};

const handleJumpHostChange = (index: number, value: string) => {
  const nextJumpChain = [...(props.formData.jump_chain ?? [])];
  nextJumpChain[index] = value === '' ? null : Number(value);
  patchFormData({ jump_chain: nextJumpChain });
};

const handleForceKeyboardInteractiveChange = (checked: boolean) => {
  patchFormData({ force_keyboard_interactive: checked });
};

const handleTagIdsUpdate = (tagIds: number[]) => {
  patchFormData({ tag_ids: tagIds });
};

const handleNotesInput = (value: string) => {
  patchFormData({ notes: value });
};

const setConnectionMode = (mode: 'proxy' | 'jump') => {
  if (props.advancedConnectionMode === mode) return; // Access directly
  emit('update:advancedConnectionMode', mode);
};

const getAvailableJumpHostsForIndex = (currentIndex: number): ConnectionInfo[] => {
  return props.connections.filter((conn) => {
    if (conn.type !== 'SSH') return false;
    if (props.isEditMode && props.formData.id === conn.id) return false;
    return !props.formData.jump_chain?.some((jumpHostId, index) => {
      return index !== currentIndex && jumpHostId === conn.id;
    });
  });
};
</script>

<template>
  <!-- Advanced Options Section -->
  <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
    <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">
      {{ t('connections.form.sectionAdvanced', '高级选项') }}
    </h4>

    <!-- Connection Mode Switcher (Only for SSH) -->
    <div v-if="props.formData.type === 'SSH'">
      <label class="block text-sm font-medium text-text-secondary mb-1">{{
        t('connections.form.connectionMode', '连接方式')
      }}</label>
      <div class="flex rounded-md shadow-sm mb-4">
        <button
          type="button"
          @click="setConnectionMode('proxy')"
          :class="[
            'flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary rounded-l-md',
            props.advancedConnectionMode === 'proxy'
              ? 'bg-primary text-white'
              : 'bg-background text-foreground hover:bg-border',
          ]"
        >
          {{ t('connections.form.connectionModeProxy', '代理') }}
        </button>
        <button
          type="button"
          @click="setConnectionMode('jump')"
          :class="[
            'flex-1 px-3 py-2 border-t border-b border-r border-border text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary -ml-px rounded-r-md',
            props.advancedConnectionMode === 'jump'
              ? 'bg-primary text-white'
              : 'bg-background text-foreground hover:bg-border',
          ]"
        >
          {{ t('connections.form.connectionModeJumpHost', '跳板机') }}
        </button>
      </div>
    </div>

    <!-- Proxy Select - Show only for SSH and if 'proxy' mode is selected -->
    <div v-if="props.formData.type === 'SSH' && props.advancedConnectionMode === 'proxy'">
      <label for="conn-proxy" class="block text-sm font-medium text-text-secondary mb-1"
        >{{ t('connections.form.proxy') }} ({{ t('connections.form.optional') }})</label
      >
      <select
        id="conn-proxy"
        :value="props.formData.proxy_id ?? ''"
        @change="handleProxyIdChange(($event.target as HTMLSelectElement).value)"
        class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
        style="
          background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
          background-position: right 0.75rem center;
          background-size: 16px 12px;
        "
      >
        <option :value="null">{{ t('connections.form.noProxy') }}</option>
        <option v-for="proxy in props.proxies" :key="proxy.id" :value="proxy.id">
          {{ proxy.name }} ({{ proxy.type }} - {{ proxy.host }}:{{ proxy.port }})
        </option>
      </select>
      <div v-if="props.isProxyLoading" class="mt-1 text-xs text-text-secondary">
        {{ t('proxies.loading') }}
      </div>
      <div v-if="props.proxyStoreError" class="mt-1 text-xs text-error">
        {{ t('proxies.error', { error: props.proxyStoreError }) }}
      </div>
    </div>

    <!-- Jump Host Configuration - Show only for SSH and if 'jump' mode is selected -->
    <div
      v-if="props.formData.type === 'SSH' && props.advancedConnectionMode === 'jump'"
      class="space-y-3"
    >
      <label class="block text-sm font-medium text-text-secondary mb-1">{{
        t('connections.form.jumpHostsTitle', '跳板机链配置')
      }}</label>
      <div
        v-if="!props.formData.jump_chain || props.formData.jump_chain.length === 0"
        class="text-sm text-muted-foreground italic"
      ></div>
      <template v-if="props.formData.jump_chain">
        <div
          v-for="(jumpHostId, index) in props.formData.jump_chain"
          :key="index"
          class="flex items-center space-x-2 p-2 border border-border rounded-md bg-background/50"
        >
          <span class="text-sm font-medium text-text-secondary whitespace-nowrap"
            >{{ t('connections.form.jumpHostLabel', '跳板机') }} {{ index + 1 }}:</span
          >
          <select
            :value="jumpHostId ?? ''"
            @change="handleJumpHostChange(index, ($event.target as HTMLSelectElement).value)"
            class="flex-grow px-3 py-1.5 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
            style="
              background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
              background-position: right 0.75rem center;
              background-size: 16px 12px;
            "
          >
            <option :value="null">
              {{ t('connections.form.selectJumpHost', '请选择跳板机') }}
            </option>
            <option
              v-for="host in getAvailableJumpHostsForIndex(index)"
              :key="host.id"
              :value="host.id"
            >
              {{ host.name }}
            </option>
          </select>
          <button
            type="button"
            @click="props.removeJumpHost(index)"
            class="p-1.5 text-destructive hover:text-destructive/80 focus:outline-none focus:ring-1 focus:ring-destructive rounded-md"
            :title="t('connections.form.removeJumpHostTitle', '移除此跳板机')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="1.1em"
              height="1.1em"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </template>
      <button
        type="button"
        @click="props.addJumpHost()"
        class="w-full flex items-center justify-center space-x-2 px-3 py-2 border border-dashed border-primary text-primary rounded-md hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>{{ t('connections.form.addJumpHost', '添加跳板机') }}</span>
      </button>
      <div
        v-if="
          props.connections.filter(
            (c) => c.type === 'SSH' && (!props.isEditMode || c.id !== props.formData.id),
          ).length === 0
        "
        class="text-xs text-warning-foreground p-2 bg-warning/20 rounded-md"
      >
        {{
          t(
            'connections.form.noAvailableSshConnectionsForJump',
            '没有可用的SSH连接作为跳板机。请先创建一些SSH连接。',
          )
        }}
      </div>
    </div>

    <!-- Force Keyboard Interactive Authentication (Only for SSH) -->
    <div v-if="props.formData.type === 'SSH'" class="flex items-center justify-between">
      <div class="flex flex-col">
        <label class="block text-sm font-medium text-text-secondary mb-1">{{
          t('connections.form.forceKeyboardInteractive', '强制键盘交互式认证')
        }}</label>
        <span class="text-xs text-text-secondary">{{
          t(
            'connections.form.forceKeyboardInteractiveDesc',
            '强制使用键盘交互式认证。这通常是使用双因素认证(TOTP/2FA) 的服务器所必需的。',
          )
        }}</span>
      </div>
      <label class="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          :checked="props.formData.force_keyboard_interactive"
          @change="
            handleForceKeyboardInteractiveChange(($event.target as HTMLInputElement).checked)
          "
          class="sr-only peer"
        />
        <div
          class="w-11 h-6 bg-border peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:bg-primary"
        ></div>
      </label>
    </div>

    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1"
        >{{ t('connections.form.tags') }} ({{ t('connections.form.optional') }})</label
      >
      <TagInput
        :model-value="props.formData.tag_ids"
        @update:model-value="handleTagIdsUpdate"
        :available-tags="props.tags"
        :allow-create="true"
        :allow-delete="true"
        @create-tag="handleCreateTagEvent"
        @delete-tag="handleDeleteTagEvent"
        :placeholder="t('tags.inputPlaceholder', '添加或选择标签...')"
      />
      <div v-if="props.isTagLoading" class="mt-1 text-xs text-text-secondary">
        {{ t('tags.loading') }}
      </div>
      <div v-if="props.tagStoreError" class="mt-1 text-xs text-error">
        {{ t('tags.error', { error: props.tagStoreError }) }}
      </div>
    </div>

    <!-- Notes Section -->
    <div>
      <label for="conn-notes" class="block text-sm font-medium text-text-secondary mb-1">{{
        t('connections.form.notes', '备注')
      }}</label>
      <textarea
        id="conn-notes"
        :value="props.formData.notes"
        @input="handleNotesInput(($event.target as HTMLTextAreaElement).value)"
        rows="3"
        class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        :placeholder="t('connections.form.notesPlaceholder', '输入连接备注...')"
      ></textarea>
    </div>
  </div>
</template>
