<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useProxiesStore, ProxyInfo } from '../stores/proxies.store';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { useAlertDialog } from '../composables/useAlertDialog';
import { formatDateTime } from '../utils/dateFormat';

const { t, locale } = useI18n();
const proxiesStore = useProxiesStore();
const { showConfirmDialog } = useConfirmDialog();
const { showAlertDialog } = useAlertDialog();
const { proxies, isLoading, error } = storeToRefs(proxiesStore);

// 定义组件发出的事件
const emit = defineEmits(['edit-proxy']);

// 处理删除代理的方法
const handleDelete = async (proxy: ProxyInfo) => {
  const confirmMessage = t('proxies.prompts.confirmDelete', { name: proxy.name });
  const confirmed = await showConfirmDialog({
    message: confirmMessage,
  });
  if (confirmed) {
    const success = await proxiesStore.deleteProxy(proxy.id);
    if (!success) {
      showAlertDialog({
        title: t('common.error'),
        message: t('proxies.errors.deleteFailed', {
          error: proxiesStore.error || t('common.unknownError'),
        }),
      });
    }
  }
};

// 辅助函数：格式化时间戳（统一走 utils/dateFormat 公共工具；0/空值显示占位符）
const formatTimestamp = (timestamp: number | null): string =>
  timestamp ? formatDateTime(timestamp, { locale: locale.value, fallback: '-' }) : '-';
</script>

<template>
  <div class="mt-4">
    <!-- Container with top margin -->
    <!-- Loading state (Only show if loading AND no proxies are displayed yet) -->
    <LoadingState v-if="isLoading && proxies.length === 0" :text="t('proxies.loading')" />
    <ErrorBanner v-else-if="error" class="mb-4" :message="t('proxies.error', { error })" />
    <EmptyState v-else-if="proxies.length === 0" :text="t('proxies.noProxies')" icon="fa-server" />

    <!-- Proxy List using Card Layout -->
    <div v-else class="grid gap-4 mt-4">
      <div
        v-for="proxy in proxies"
        :key="proxy.id"
        class="bg-background border border-border rounded-lg p-4 flex justify-between items-start gap-4 shadow-sm hover:shadow-md transition-shadow duration-200"
      >
        <!-- Proxy item card -->
        <div class="flex-grow space-y-1">
          <!-- Details section -->
          <strong class="block font-semibold text-base text-foreground">{{ proxy.name }}</strong>
          <div class="flex items-center space-x-2">
            <!-- Type Badge -->
            <span
              class="px-2 py-0.5 rounded-full text-xs font-semibold bg-header border border-border text-text-secondary uppercase tracking-wider"
            >
              {{ proxy.type }}
            </span>
          </div>
          <div class="text-sm text-text-secondary">
            <!-- Host & Port -->
            <i class="fas fa-server mr-1 text-xs opacity-70"></i> {{ proxy.host }}:{{ proxy.port }}
          </div>
          <div v-if="proxy.username" class="text-sm text-text-secondary">
            <!-- Username (optional) -->
            <i class="fas fa-user mr-1 text-xs opacity-70"></i> {{ proxy.username }}
          </div>
          <div class="text-xs text-text-secondary pt-1">
            <!-- Updated At -->
            <i class="fas fa-clock mr-1 opacity-70"></i> {{ formatTimestamp(proxy.updated_at) }}
          </div>
        </div>
        <div class="flex items-center flex-shrink-0 space-x-3 pt-1">
          <!-- Actions section -->
          <button
            @click="emit('edit-proxy', proxy)"
            class="text-link hover:text-link-hover text-sm font-medium hover:underline"
          >
            <!-- Edit button (link style) -->
            <i class="fas fa-pencil-alt mr-1 text-xs"></i>{{ t('proxies.actions.edit') }}
          </button>
          <button
            @click="handleDelete(proxy)"
            class="text-error hover:text-error/80 text-sm font-medium hover:underline"
          >
            <!-- Delete button (error color) -->
            <i class="fas fa-trash-alt mr-1 text-xs"></i>{{ t('proxies.actions.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Remove all scoped styles as they are now handled by Tailwind utility classes */
</style>
