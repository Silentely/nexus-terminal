<template>
  <div class="batch-ops flex flex-col h-full bg-background p-4" aria-labelledby="batch-ops-title">
    <h2
      id="batch-ops-title"
      class="text-lg font-semibold mb-4 text-foreground flex items-center justify-between"
    >
      <span>{{ t('batchOps.title', 'Batch Execution') }}</span>
      <div
        v-if="batchStore.currentTask"
        class="text-sm font-normal"
        role="status"
        aria-live="polite"
      >
        <span class="text-text-secondary mr-2">{{ t('batchOps.progress', 'Progress') }}:</span>
        <span class="text-primary">{{ batchStore.overallProgress }}%</span>
      </div>
    </h2>

    <!-- Connection Selection -->
    <div class="flex-grow overflow-hidden flex flex-col border border-border rounded-lg mb-4">
      <div
        class="bg-header px-4 py-2 border-b border-border font-medium text-sm flex justify-between items-center"
      >
        <span id="batch-server-selection-label">
          {{ t('batchOps.selectServers', 'Select Servers') }} ({{ selectedIds.length }}/{{
            connections.length
          }})
        </span>
        <div class="flex gap-2">
          <button type="button" @click="selectAll" class="text-xs text-primary hover:underline">
            {{ t('common.selectAll') }}
          </button>
          <button
            type="button"
            @click="deselectAll"
            class="text-xs text-text-secondary hover:underline"
          >
            {{ t('common.deselectAll') }}
          </button>
        </div>
      </div>
      <div
        class="overflow-y-auto p-2 custom-scrollbar flex-grow"
        role="group"
        aria-labelledby="batch-server-selection-label"
      >
        <label
          v-for="conn in connections"
          :key="conn.id"
          class="flex items-center px-3 py-2 hover:bg-header/50 rounded cursor-pointer focus-within:ring-2 focus-within:ring-primary"
        >
          <input
            type="checkbox"
            :checked="selectedIds.includes(conn.id)"
            class="mr-3"
            :aria-label="`${conn.name} ${conn.host}`"
            @change="toggleSelection(conn.id)"
          />
          <div class="flex flex-col flex-grow min-w-0">
            <span class="text-sm font-medium text-foreground truncate">{{ conn.name }}</span>
            <span class="text-xs text-text-secondary truncate">{{ conn.host }}</span>
          </div>
          <div class="ml-2 flex-shrink-0">
            <StatusBadge :status="getConnectionStatus(conn.id)" />
          </div>
        </label>
        <div
          v-if="connections.length === 0"
          class="text-center text-text-secondary text-sm py-8"
          role="status"
        >
          {{ t('batchOps.noConnections', 'No SSH connections available') }}
        </div>
      </div>
    </div>

    <!-- Command Input -->
    <div class="flex-shrink-0">
      <label
        id="batch-command-label"
        for="batch-command"
        class="block text-sm font-medium text-text-secondary mb-1"
        >{{ t('batchOps.commandLabel', 'Command to execute') }}</label
      >
      <div class="flex gap-2">
        <input
          id="batch-command"
          v-model="command"
          type="text"
          class="flex-grow px-3 py-2 bg-input border border-border rounded text-foreground focus:border-primary focus:outline-none"
          :placeholder="t('batchOps.commandPlaceholder', 'e.g. apt-get update')"
          :disabled="batchStore.isExecuting"
          aria-labelledby="batch-command-label"
          @keydown.enter.prevent="executeBatch"
        />
        <button
          v-if="!batchStore.isExecuting"
          type="button"
          @click="executeBatch"
          :disabled="selectedIds.length === 0 || !command.trim() || isConfirmingExecute"
          :aria-label="t('batchOps.execute', 'Execute on all')"
          class="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <i class="fas fa-play"></i>
          {{ t('batchOps.execute', 'Broadcast') }}
        </button>
        <button
          v-else
          type="button"
          @click="cancelExecution"
          :disabled="isConfirmingCancel"
          :aria-label="t('batchOps.cancel', 'Cancel')"
          class="px-4 py-2 bg-error text-error-text rounded hover:bg-error/80 flex items-center gap-2"
        >
          <i class="fas fa-stop"></i>
          {{ t('batchOps.cancel', 'Cancel') }}
        </button>
      </div>
      <!-- Options -->
      <div class="mt-2 flex items-center gap-4 text-xs text-text-secondary">
        <label for="batch-sudo" class="flex items-center gap-1 cursor-pointer">
          <input id="batch-sudo" type="checkbox" v-model="useSudo" class="w-3 h-3" />
          {{ t('batchOps.sudo', 'Run as sudo') }}
        </label>
        <label for="batch-concurrency" class="flex items-center gap-1">
          <span>{{ t('batchOps.concurrency', 'Concurrency') }}:</span>
          <input
            id="batch-concurrency"
            type="number"
            v-model.number="concurrencyLimit"
            min="1"
            max="50"
            class="w-12 px-1 py-0.5 bg-input border border-border rounded text-foreground text-center"
          />
        </label>
      </div>
    </div>

    <!-- Error Message -->
    <div
      v-if="batchStore.error"
      class="mt-3 p-2 bg-error/10 border border-error/30 rounded text-error text-xs flex items-center justify-between"
      role="alert"
    >
      <span><i class="fas fa-exclamation-circle mr-1"></i>{{ batchStore.error }}</span>
      <button type="button" @click="batchStore.clearError()" class="hover:underline">
        {{ t('common.dismiss', 'Dismiss') }}
      </button>
    </div>

    <!-- Results Panel -->
    <section
      v-if="batchStore.currentTask"
      class="mt-4 border border-border rounded-lg overflow-hidden"
      role="region"
      aria-labelledby="batch-results-title"
      aria-live="polite"
    >
      <div
        class="bg-header px-4 py-2 border-b border-border font-medium text-sm flex items-center justify-between"
      >
        <span id="batch-results-title">{{ t('batchOps.results', 'Execution Results') }}</span>
        <span :class="statusClass" role="status">{{ statusText }}</span>
      </div>

      <!-- Progress Bar -->
      <div class="h-1 bg-border">
        <div
          class="h-full bg-primary transition-[width] duration-300"
          :style="{ width: batchStore.overallProgress + '%' }"
          role="progressbar"
          :aria-label="t('batchOps.progress', 'Progress')"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="batchStore.overallProgress"
        ></div>
      </div>

      <!-- Sub-tasks -->
      <div
        class="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-border"
        role="list"
        :aria-label="t('batchOps.results', 'Execution Results')"
      >
        <div
          v-for="subTask in batchStore.currentTask.subTasks"
          :key="subTask.subTaskId"
          class="px-4 py-2 flex items-center gap-3 text-sm"
          role="listitem"
        >
          <StatusIcon :status="subTask.status" />
          <div class="flex-grow min-w-0">
            <div class="font-medium truncate">
              {{ subTask.connectionName || `Connection #${subTask.connectionId}` }}
            </div>
            <div v-if="subTask.message" class="text-xs text-text-secondary truncate">
              {{ subTask.message }}
            </div>
          </div>
          <div class="flex-shrink-0 text-xs">
            <span
              v-if="subTask.exitCode !== undefined"
              :class="subTask.exitCode === 0 ? 'text-success' : 'text-error'"
            >
              Exit: {{ subTask.exitCode }}
            </span>
            <span v-else-if="subTask.status === 'running'" class="text-primary">
              {{ subTask.progress }}%
            </span>
          </div>
          <button
            v-if="subTask.output"
            type="button"
            @click="showOutput(subTask)"
            :aria-label="t('batchOps.viewOutput', 'View output')"
            class="text-xs text-primary hover:underline flex-shrink-0"
          >
            {{ t('batchOps.viewOutput', 'View') }}
          </button>
        </div>
      </div>
    </section>

    <!-- Output Modal (L4: Escape 键关闭 + L7: 复制按钮) -->
    <div
      v-if="selectedOutput"
      ref="outputModalRef"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-output-title"
      aria-describedby="batch-output-content"
      tabindex="-1"
      @click.self="selectedOutput = null"
      @keydown.escape="selectedOutput = null"
    >
      <div
        class="bg-background border border-border rounded-lg shadow-xl w-[80%] max-w-2xl max-h-[80vh] flex flex-col"
      >
        <div class="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 id="batch-output-title" class="font-medium">
            {{ selectedOutput.connectionName }} - {{ t('batchOps.output', 'Output') }}
          </h3>
          <div class="flex items-center gap-2">
            <button
              type="button"
              @click="copyOutput"
              class="text-xs text-text-secondary hover:text-foreground px-2 py-1 rounded hover:bg-header"
              :title="t('batchOps.copyOutput', 'Copy to clipboard')"
            >
              <i class="fas fa-copy mr-1" aria-hidden="true"></i
              >{{ copyFeedback ? t('batchOps.copied', 'Copied') : t('common.copy', 'Copy') }}
            </button>
            <button
              type="button"
              @click="selectedOutput = null"
              :aria-label="t('batchOps.closeOutput', 'Close output')"
              class="text-text-secondary hover:text-foreground"
            >
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div id="batch-output-content" class="flex-grow overflow-auto p-4">
          <pre class="font-mono text-xs text-text-secondary whitespace-pre-wrap">{{
            selectedOutput.output || t('batchOps.noOutput', 'No output')
          }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConnectionsStore } from '../../stores/connections.store';
import { useBatchStore } from '../../stores/batch.store';
import { useSessionStore } from '../../stores/session.store';
import type { BatchSubTask, BatchSubTaskStatus } from '../../types/batch.types';
import { log } from '@/utils/log';
import { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import { useConfirmDialog } from '../../composables/useConfirmDialog';

const { t } = useI18n();
const connectionsStore = useConnectionsStore();
const batchStore = useBatchStore();
const sessionStore = useSessionStore();
const uiNotificationsStore = useUiNotificationsStore();
const { showConfirmDialog } = useConfirmDialog();

// 只显示 SSH 类型的连接
const connections = computed(() => connectionsStore.connections.filter((c) => c.type === 'SSH'));
const selectedIds = ref<number[]>([]);
const command = ref('');
const useSudo = ref(false);
const concurrencyLimit = ref(5);
const selectedOutput = ref<BatchSubTask | null>(null);
const outputModalRef = ref<HTMLDivElement | null>(null);
const copyFeedback = ref(false);
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
const isConfirmingExecute = ref(false);
const isConfirmingCancel = ref(false);

const BATCH_WS_EVENT_TYPES = [
  'batch:started',
  'batch:subtask:update',
  'batch:overall',
  'batch:completed',
  'batch:failed',
  'batch:cancelled',
  'batch:log',
] as const;
let unregisterBatchWsHandlers: Array<() => void> = [];

const toggleSelection = (id: number) => {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((i) => i !== id);
  } else {
    selectedIds.value.push(id);
  }
};

const selectAll = () => {
  selectedIds.value = connections.value.map((c) => c.id);
};

const deselectAll = () => {
  selectedIds.value = [];
};

// H5: getConnectionStatus 使用 taskId 嵌套键
const getConnectionStatus = (connectionId: number): BatchSubTaskStatus | null => {
  return batchStore.getConnectionStatus(connectionId);
};

// 状态文本
const statusText = computed(() => {
  const task = batchStore.currentTask;
  if (!task) return '';

  const statusMap: Record<string, string> = {
    queued: t('batchOps.status.queued', 'Queued'),
    'in-progress': t('batchOps.status.inProgress', 'In Progress'),
    'partially-completed': t('batchOps.status.partiallyCompleted', 'Partially Completed'),
    completed: t('batchOps.status.completed', 'Completed'),
    failed: t('batchOps.status.failed', 'Failed'),
    cancelled: t('batchOps.status.cancelled', 'Cancelled'),
  };
  return statusMap[task.status] || task.status;
});

// 状态样式
const statusClass = computed(() => {
  const task = batchStore.currentTask;
  if (!task) return '';

  const classMap: Record<string, string> = {
    queued: 'text-text-secondary',
    'in-progress': 'text-primary',
    'partially-completed': 'text-warning',
    completed: 'text-success',
    failed: 'text-error',
    cancelled: 'text-text-secondary',
  };
  return classMap[task.status] || '';
});

// L6: sudo 执行确认
const executeBatch = async () => {
  if (
    selectedIds.value.length === 0 ||
    !command.value.trim() ||
    batchStore.isExecuting ||
    isConfirmingExecute.value
  ) {
    return;
  }

  isConfirmingExecute.value = true;
  try {
    // L6: sudo 确认对话框
    if (useSudo.value) {
      const confirmed = await showConfirmDialog({
        title: t('batchOps.sudoConfirmTitle', 'Confirm privileged execution'),
        message: t('batchOps.sudoConfirm', 'Warning: Running with sudo privileges. Continue?'),
        confirmText: t('common.confirm', 'Confirm'),
        cancelText: t('common.cancel', 'Cancel'),
      });
      if (!confirmed) return;
    }

    const taskId = await batchStore.executeBatch({
      command: command.value.trim(),
      connectionIds: selectedIds.value,
      concurrencyLimit: concurrencyLimit.value,
      sudo: useSudo.value,
    });

    if (taskId) {
      // L5: 记录命令历史（异步执行，不阻塞降级轮询启动；模块不可用时静默忽略）
      void import('../../stores/commandHistory.store')
        .then(({ useCommandHistoryStore }) => {
          const historyStore = useCommandHistoryStore();
          historyStore.addCommand?.(command.value.trim());
        })
        .catch(() => {
          // 命令历史模块不可用时静默忽略
        });

      // H4: 启动降级轮询
      startPolling(taskId);
    }
  } finally {
    isConfirmingExecute.value = false;
  }
};

// 取消执行
const cancelExecution = async () => {
  const taskId = batchStore.currentTask?.taskId;
  if (!taskId || isConfirmingCancel.value) return;

  isConfirmingCancel.value = true;
  try {
    const confirmed = await showConfirmDialog({
      title: t('batchOps.cancelTitle', 'Cancel batch execution?'),
      message: t('batchOps.cancelConfirm', 'Running connections will be interrupted.'),
      confirmText: t('batchOps.cancel', 'Cancel'),
      cancelText: t('common.dismiss', 'Keep running'),
    });
    if (!confirmed) return;
    await batchStore.cancelTask(taskId);
  } finally {
    isConfirmingCancel.value = false;
  }
};

// 查看输出（L5: 快照输出内容，避免 WS 更新导致内容变化）
const showOutput = (subTask: BatchSubTask) => {
  selectedOutput.value = { ...subTask };
  copyFeedback.value = false;
  nextTick(() => {
    outputModalRef.value?.focus();
  });
};

// L7: 复制输出到剪贴板
const copyOutput = async () => {
  if (!selectedOutput.value?.output) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(selectedOutput.value.output);
    copyFeedback.value = true;
    uiNotificationsStore.showSuccess(t('batchOps.copySuccess', 'Output copied to clipboard'));
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => {
      copyFeedback.value = false;
      copyFeedbackTimer = null;
    }, 2000);
  } catch {
    log.warn('[MultiServerExec] 剪贴板 API 不可用');
    uiNotificationsStore.showError(t('batchOps.copyFailed', 'Failed to copy output'));
  }
};

// H4: 轮询作为 WS 降级方案
let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollingActive = false;
let pollTaskId: string | null = null;

// 页面隐藏时暂停降级轮询，恢复可见且任务仍在执行中时继续，避免后台标签页空转浪费资源
const handleVisibilityChange = () => {
  if (document.hidden) {
    stopPolling();
    return;
  }
  const task = batchStore.currentTask;
  // 隐藏期间 stopPolling 会清空 pollTaskId，此处从 currentTask 兜底取回任务 ID
  const taskId = pollTaskId || task?.taskId || null;
  if (taskId && task && (task.status === 'in-progress' || task.status === 'queued')) {
    startPolling(taskId);
  }
};

const startPolling = (taskId: string) => {
  stopPolling();
  pollingActive = true;
  pollTaskId = taskId;
  pollInterval = setInterval(async () => {
    // 轮询持续到 REST 明确返回终态，避免非终态 WS 事件丢失后 UI 永远停在执行中。
    if (!pollingActive) {
      stopPolling();
      return;
    }
    const task = await batchStore.fetchTaskStatus(taskId);
    if (task && ['completed', 'failed', 'cancelled', 'partially-completed'].includes(task.status)) {
      stopPolling();
    }
  }, 2000); // 降级轮询间隔放宽到 2s
};

const stopPolling = () => {
  pollingActive = false;
  pollTaskId = null;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
};

// 批量事件来自当前活动 SSH 会话；切换会话或卸载组件时注销旧处理器，避免重复消费。
const unregisterBatchMessageHandlers = () => {
  unregisterBatchWsHandlers.forEach((unsubscribe) => unsubscribe());
  unregisterBatchWsHandlers = [];
};

const registerBatchMessageHandlers = () => {
  unregisterBatchMessageHandlers();
  const activeSession = sessionStore.activeSession;
  if (!activeSession) return;

  unregisterBatchWsHandlers = BATCH_WS_EVENT_TYPES.map((type) =>
    activeSession.wsManager.onMessage(type, (payload) => {
      batchStore.handleBatchWsEvent(type, payload);
    }),
  );
};

watch(() => sessionStore.activeSessionId, registerBatchMessageHandlers, { immediate: true });

// 任务终态时也停止轮询（兜底）
watch(
  () => batchStore.currentTask?.status,
  (status) => {
    if (status && status !== 'in-progress' && status !== 'queued') {
      stopPolling();
    }
  },
);

// 组件挂载时获取连接列表
onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  if (connectionsStore.connections.length === 0) {
    connectionsStore.fetchConnections();
  }
});

// 组件卸载时清理
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  stopPolling();
  unregisterBatchMessageHandlers();
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
});
</script>

<!-- L2: 共享配置 map，消除 StatusBadge/StatusIcon 重复定义 -->
<script lang="ts">
import { defineComponent, h } from 'vue';

// 统一状态配置（图标 + 颜色 + 可选文本）
const STATUS_CONFIG: Record<string, { icon: string; class: string; text?: string }> = {
  queued: { icon: 'fa-clock', class: 'text-text-secondary', text: 'Queued' },
  connecting: { icon: 'fa-spinner fa-spin', class: 'text-warning', text: 'Connecting' },
  running: { icon: 'fa-spinner fa-spin', class: 'text-primary', text: 'Running' },
  completed: { icon: 'fa-check-circle', class: 'text-success', text: 'Done' },
  failed: { icon: 'fa-times-circle', class: 'text-error', text: 'Failed' },
  cancelled: { icon: 'fa-ban', class: 'text-text-secondary', text: 'Cancelled' },
};

const StatusBadge = defineComponent({
  name: 'StatusBadge',
  props: {
    status: { type: String as () => BatchSubTaskStatus | null, default: null },
  },
  setup(props) {
    return () => {
      if (!props.status) return null;
      const c = STATUS_CONFIG[props.status];
      if (!c) return null;
      return h('span', { class: `text-xs ${c.class}` }, [
        h('i', { class: `fas ${c.icon} mr-1`, 'aria-hidden': 'true' }),
        c.text || '',
      ]);
    };
  },
});

const StatusIcon = defineComponent({
  name: 'StatusIcon',
  props: {
    status: { type: String as () => BatchSubTaskStatus, required: true },
  },
  setup(props) {
    return () => {
      const c = STATUS_CONFIG[props.status] || {
        icon: 'fa-question',
        class: 'text-text-secondary',
      };
      return h('i', { class: `fas ${c.icon} ${c.class}`, 'aria-hidden': 'true' });
    };
  },
});

export { StatusBadge, StatusIcon };
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.batch-ops :focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .batch-ops *,
  .batch-ops *::before,
  .batch-ops *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
