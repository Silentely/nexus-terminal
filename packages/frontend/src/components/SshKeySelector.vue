<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSshKeysStore } from '../stores/sshKeys.store';
import SshKeyManagementModal from './SshKeyManagementModal.vue';

const props = defineProps<{
  modelValue: number | null;
}>();

const emit = defineEmits(['update:modelValue']); // Removed 'use-direct-input' event

const { t } = useI18n();
const sshKeysStore = useSshKeysStore();

const keys = computed(() => sshKeysStore.sshKeys);
const isLoading = computed(() => sshKeysStore.isLoading);
const isManagementModalVisible = ref(false);

// Internal state for the selected key ID
const selectedKeyId = ref<number | null>(props.modelValue); // Removed string type

// Watch for external changes to modelValue
watch(
  () => props.modelValue,
  (newVal) => {
    selectedKeyId.value = newVal;
  }
);

// Watch for internal changes and emit update or switch mode
watch(selectedKeyId, (newVal) => {
  // Removed 'direct_input' check
  if (typeof newVal === 'number') {
    emit('update:modelValue', newVal); // Emit the selected key ID
  } else {
    emit('update:modelValue', null); // Handle clearing selection (when newVal is null)
  }
});

// Watch for changes in the keys list itself
watch(
  keys,
  (newKeys) => {
    // If a key ID is selected (from props/v-model)
    if (selectedKeyId.value !== null) {
      // Check if that ID still exists in the newly loaded/updated list
      const keyExists = newKeys.some((key) => key.id === selectedKeyId.value);
      if (!keyExists) {
        // If the selected key ID is no longer valid (e.g., deleted), reset the selection
        console.warn(
          `[SshKeySelector] Selected key ID ${selectedKeyId.value} not found in updated list. Resetting.`
        );
        selectedKeyId.value = null; // This will trigger the watcher above to emit update:modelValue
      }
      // If the key *does* exist, the v-model binding on <select> should handle selecting it automatically when options render.
    }
  },
  { immediate: false }
); // Don't run immediately, only when keys actually change

const openManagementModal = () => {
  isManagementModalVisible.value = true;
  // Refresh keys list when modal opens, in case keys were added/deleted elsewhere
  sshKeysStore.fetchSshKeys();
};

const closeManagementModal = () => {
  isManagementModalVisible.value = false;
  // Refresh keys list after modal closes
  sshKeysStore.fetchSshKeys();
};
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center space-x-3">
      <select
        id="ssh-key-select"
        v-model="selectedKeyId"
        :disabled="isLoading"
        class="flex-grow px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
        style="
          background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
          background-position: right 0.75rem center;
          background-size: 16px 12px;
        "
      >
        <option :value="null">{{ t('sshKeys.selector.selectPlaceholder') }}</option>
        <option v-for="key in keys" :key="key.id" :value="key.id">
          {{ key.name }}
        </option>
        <!-- Removed direct input option -->
      </select>
      <button
        type="button"
        @click="openManagementModal"
        :disabled="isLoading"
        class="px-3 py-2 border border-border rounded-md text-sm font-medium text-text-secondary bg-background hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        :title="t('sshKeys.selector.manageKeysTitle')"
      >
        <i class="fas fa-cog"></i>
      </button>
    </div>
    <div v-if="isLoading" class="text-xs text-text-secondary">
      {{ t('sshKeys.selector.loadingKeys') }}
    </div>
    <div v-if="sshKeysStore.error" class="text-xs text-error">
      {{ t('sshKeys.selector.errorLoading', { error: sshKeysStore.error }) }}
    </div>

    <!-- Key Management Modal -->
    <SshKeyManagementModal v-if="isManagementModalVisible" @close="closeManagementModal" />
  </div>
</template>
