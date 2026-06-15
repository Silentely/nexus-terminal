<template>
  <div class="p-4 border border-border rounded-lg bg-background">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <!-- 左侧：状态信息 -->
      <div class="flex items-center gap-3 flex-wrap">
        <!-- 状态徽章 -->
        <span
          class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
          :class="statusBadgeClass"
        >
          {{ statusText }}
        </span>

        <!-- 余额与有效期 -->
        <span v-if="authStatus.hasUserKey" class="text-sm text-muted-foreground">
          余额：<span class="font-semibold text-foreground">{{ balanceText }}</span> Pollen
          <span v-if="authStatus.expiry" class="ml-2">
            有效期：<span class="text-foreground">{{ expiryText }}</span>
          </span>
        </span>
      </div>

      <!-- 右侧：操作按钮 -->
      <div class="flex items-center gap-2">
        <button
          v-if="!authStatus.hasUserKey"
          type="button"
          @click="$emit('authorize')"
          class="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
        >
          授权使用我的 Pollen
        </button>

        <template v-else>
          <button
            type="button"
            @click="handleRefreshBalance"
            :disabled="refreshing"
            class="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-header/50 transition-colors cursor-pointer disabled:opacity-50"
          >
            {{ refreshing ? '刷新中...' : '刷新余额' }}
          </button>
          <button
            type="button"
            @click="handleRevoke"
            :disabled="revoking"
            class="px-3 py-1.5 text-sm rounded-md border border-error text-error hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
          >
            {{ revoking ? '撤销中...' : '撤销授权' }}
          </button>
        </template>
      </div>
    </div>

    <!-- User Key 显示（部分遮蔽） -->
    <div
      v-if="authStatus.hasUserKey && authStatus.userKey"
      class="mt-3 text-xs text-muted-foreground"
    >
      User Key：<code class="px-1.5 py-0.5 rounded bg-header/50 font-mono">{{
        authStatus.userKey
      }}</code>
    </div>

    <!-- 错误消息 -->
    <div v-if="errorMessage" class="mt-2 text-sm text-error">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { usePollinationsStore } from '@/stores/pollinations.store';
import type { AuthStatus } from '@/types/pollinations.types';

const props = defineProps<{
  authStatus: AuthStatus;
}>();

defineEmits<{
  authorize: [];
}>();

const store = usePollinationsStore();
const refreshing = ref(false);
const revoking = ref(false);
const errorMessage = ref<string | null>(null);

// 状态文本
const statusText = computed(() => {
  if (!props.authStatus.hasUserKey) return '未授权';
  if (!props.authStatus.enabled) return '已授权（未启用）';
  return '已授权';
});

// 状态徽章样式
const statusBadgeClass = computed(() => {
  if (!props.authStatus.hasUserKey) {
    return 'bg-muted text-muted-foreground';
  }
  if (!props.authStatus.enabled) {
    return 'bg-warning/20 text-warning';
  }
  return 'bg-success/20 text-success';
});

// 余额文本
const balanceText = computed(() => {
  return props.authStatus.balance !== null ? String(props.authStatus.balance) : '--';
});

// 有效期文本（expiry 为秒数，转换为天数提示）
const expiryText = computed(() => {
  if (!props.authStatus.expiry) return '--';
  const days = Math.ceil(props.authStatus.expiry / 86400);
  return `${days} 天`;
});

// 刷新余额
async function handleRefreshBalance(): Promise<void> {
  refreshing.value = true;
  errorMessage.value = null;
  try {
    await store.refreshBalance();
  } catch {
    errorMessage.value = store.error;
  } finally {
    refreshing.value = false;
  }
}

// 撤销授权
async function handleRevoke(): Promise<void> {
  revoking.value = true;
  errorMessage.value = null;
  try {
    await store.revokeAuth();
  } catch {
    errorMessage.value = store.error;
  } finally {
    revoking.value = false;
  }
}
</script>
