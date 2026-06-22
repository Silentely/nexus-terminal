<template>
  <div class="flex flex-col h-full bg-background p-4">
    <h2 class="text-lg font-semibold mb-4 text-foreground flex items-center justify-between">
      <span>{{ t('batchOps.title', 'Batch Execution') }}</span>
      <div v-if="batchStore.currentTask" class="text-sm font-normal">
        <span class="text-text-secondary mr-2">{{ t('batchOps.progress', 'Progress') }}:</span>
        <span class="text-primary">{{ batchStore.overallProgress }}%</span>
      </div>
    </h2>

    <!-- Connection Selection -->
    <div class="flex-grow overflow-hidden flex flex-col border border-border rounded-lg mb-4">
      <div
        class="bg-header px-4 py-2 border-b border-border font-medium text-sm flex justify-between items-center"
      >
        <span
          >{{ t('batchOps.selectServers', 'Select Servers') }} ({{ selectedIds.length }}/{{
            connections.length
          }})</span
        >
        <div class="flex gap-2">
          <button @click="selectAll" class="text-xs text-primary hover:underline">
            {{ t('common.selectAll') }}
          </button>
          <button @click="deselectAll" class="text-xs text-text-secondary hover:underline">
            {{ t('common.deselectAll') }}
          </button>
        </div>
      </div>
      <div class="overflow-y-auto p-2 custom-scrollbar flex-grow">
        <div
          v-for="conn in connections"
          :key="conn.id"
          class="flex items-center px-3 py-2 hover:bg-header/50 rounded cursor-pointer"
          @click="toggleSelection(conn.id)"
        >
          <input
            type="checkbox"
            :checked="selectedIds.includes(conn.id)"
            class="mr-3"
            @click.stop="toggleSelection(conn.id)"
          />
          <div class="flex flex-col flex-grow min-w-0">
            <span class="text-sm font-medium text-foreground truncate">{{ conn.name }}</span>
            <span class="text-xs text-text-secondary truncate">{{ conn.host }}</span>
          </div>
          <div class="ml-2 flex-shrink-0">
            <StatusBadge :status="getConnectionStatus(conn.id)" />
          </div>
        </div>
        <div v-if="connections.length === 0" class="text-center text-text-secondary text-sm py-8">
          {{ t('batchOps.noConnections', 'No SSH connections available') }}
        </div>
      </div>
    </div>

    <!-- Command Input -->
    <div class="flex-shrink-0">
      <label class="block text-sm font-medium text-text-secondary mb-1">{{
        t('batchOps.commandLabel', 'Command to execute')
      }}</label>
      <div class="flex gap-2">
        <input
          v-model="command"
          type="text"
          class="flex-grow px-3 py-2 bg-input border border-border rounded text-foreground focus:border-primary focus:outline-none"
          :placeholder="t('batchOps.commandPlaceholder', 'e.g. apt-get update')"
          :disabled="batchStore.isExecuting"
          @keydown.enter="executeBatch"
        />
        <button
          v-if="!batchStore.isExecuting"
          @click="executeBatch"
          :disabled="selectedIds.length === 0 || !command.trim()"
          class="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <i class="fas fa-play"></i>
          {{ t('batchOps.execute', 'Broadcast') }}
        </button>
        <button
          v-else
          @click="cancelExecution"
          class="px-4 py-2 bg-error text-error-text rounded hover:bg-error/80 flex items-center gap-2"
        >
          <i class="fas fa-stop"></i>
          {{ t('batchOps.cancel', 'Cancel') }}
        </button>
      </div>
      <!-- Options -->
      <div class="mt-2 flex items-center gap-4 text-xs text-text-secondary">
        <label class="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" v-model="useSudo" class="w-3 h-3" />
          {{ t('batchOps.sudo', 'Run as sudo') }}
        </label>
        <label class="flex items-center gap-1">
          <span>{{ t('batchOps.concurrency', 'Concurrency') }}:</span>
          <input
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
    >
      <span><i class="fas fa-exclamation-circle mr-1"></i>{{ batchStore.error }}</span>
      <button @click="batchStore.clearError()" class="hover:underline">
        {{ t('common.dismiss', 'Dismiss') }}
      </button>
    </div>

    <!-- Results Panel -->
    <div v-if="batchStore.currentTask" class="mt-4 border border-border rounded-lg overflow-hidden">
      <div
        class="bg-header px-4 py-2 border-b border-border font-medium text-sm flex items-center justify-between"
      >
        <span>{{ t('batchOps.results', 'Execution Results') }}</span>
        <span :class="statusClass">{{ statusText }}</span>
      </div>

      <!-- Progress Bar -->
      <div class="h-1 bg-border">
        <div
          class="h-full bg-primary transition-[width] duration-300"
          :style="{ width: batchStore.overallProgress + '%' }"
        ></div>
      </div>

      <!-- Sub-tasks -->
      <div class="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-border">
        <div
          v-for="subTask in batchStore.currentTask.subTasks"
          :key="subTask.subTaskId"
          class="px-4 py-2 flex items-center gap-3 text-sm"
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
            @click="showOutput(subTask)"
            class="text-xs text-primary hover:underline flex-shrink-0"
          >
            {{ t('batchOps.viewOutput', 'View') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Output Modal (L4: Escape 键关闭 + L7: 复制按钮) -->
    <div
      v-if="selectedOutput"
      ref="outputModalRef"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      tabindex="-1"
      @click.self="selectedOutput = null"
      @keydown.escape="selectedOutput = null"
    >
      <div
        class="bg-background border border-border rounded-lg shadow-xl w-[80%] max-w-2xl max-h-[80vh] flex flex-col"
      >
        <div class="px-4 py-3 border-b border-border flex items-center justify-between">
          <span class="font-medium"
            >{{ selectedOutput.connectionName }} - {{ t('batchOps.output', 'Output') }}</span
          >
          <div class="flex items-center gap-2">
            <button
              @click="copyOutput"
              class="text-xs text-text-secondary hover:text-foreground px-2 py-1 rounded hover:bg-header"
              :title="t('batchOps.copyOutput', 'Copy to clipboard')"
            >
              <i class="fas fa-copy mr-1"></i>{{ t('common.copy', 'Copy') }}
            </button>
            <button
              @click="selectedOutput = null"
              class="text-text-secondary hover:text-foreground"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
        <div class="flex-grow overflow-auto p-4">
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
import type { BatchSubTask, BatchSubTaskStatus } from '../../types/batch.types';
import { log } from '@/utils/log';

const { t } = useI18n();
const connectionsStore = useConnectionsStore();
const batchStore = useBatchStore();

// 只显示 SSH 类型的连接
const connections = computed(() => connectionsStore.connections.filter((c) => c.type === 'SSH'));
const selectedIds = ref<number[]>([]);
const command = ref('');
const useSudo = ref(false);
const concurrencyLimit = ref(5);
const selectedOutput = ref<BatchSubTask | null>(null);
const outputModalRef = ref<HTMLDivElement | null>(null);

// H4: 轮询仅作为 WS 降级方案
let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollingActive = false;

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
  if (selectedIds.value.length === 0 || !command.value.trim() || batchStore.isExecuting) return;

  // L6: sudo 确认对话框
  if (useSudo.value) {
    const confirmed = window.confirm(
      t('batchOps.sudoConfirm', 'Warning: Running with sudo privileges. Continue?'),
    );
    if (!confirmed) return;
  }

  const taskId = await batchStore.executeBatch({
    command: command.value.trim(),
    connectionIds: selectedIds.value,
    concurrencyLimit: concurrencyLimit.value,
    sudo: useSudo.value,
  });

  if (taskId) {
    // L5: 记录命令历史
    try {
      const { useCommandHistoryStore } = await import('../../stores/commandHistory.store');
      const historyStore = useCommandHistoryStore();
      if (historyStore.addCommand) {
        historyStore.addCommand(command.value.trim());
      }
    } catch {
      // 命令历史模块不可用时静默忽略
    }

    // H4: 启动降级轮询
    startPolling(taskId);
  }
};

// 取消执行
const cancelExecution = async () => {
  if (batchStore.currentTask) {
    await batchStore.cancelTask(batchStore.currentTask.taskId);
  }
};

// 查看输出（L5: 快照输出内容，避免 WS 更新导致内容变化）
const showOutput = (subTask: BatchSubTask) => {
  selectedOutput.value = { ...subTask };
  nextTick(() => {
    outputModalRef.value?.focus();
  });
};

// L7: 复制输出到剪贴板
const copyOutput = async () => {
  if (!selectedOutput.value?.output) return;
  try {
    await navigator.clipboard.writeText(selectedOutput.value.output);
  } catch {
    // 降级方案：选中文本
    log.warn('[BatchStore] 剪贴板 API 不可用');
  }
};

// H4: 轮询作为 WS 降级方案
const startPolling = (taskId: string) => {
  stopPolling();
  pollingActive = true;
  pollInterval = setInterval(async () => {
    // 若已收到 WS 事件，停止轮询（WS 是更及时的数据源）
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
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
};

// H4: 监听 WS 活动 — 收到首个 WS 事件后立即停止轮询，轮询仅作为 WS 降级方案
watch(
  () => batchStore.wsEventReceived,
  (received) => {
    if (received) stopPolling();
  },
);

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
  if (connectionsStore.connections.length === 0) {
    connectionsStore.fetchConnections();
  }
});

// 组件卸载时清理
onUnmounted(() => {
  stopPolling();
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
        h('i', { class: `fas ${c.icon} mr-1` }),
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
      return h('i', { class: `fas ${c.icon} ${c.class}` });
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
</style>
