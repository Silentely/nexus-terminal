<template>
  <div
    class="suspended-ssh-sessions-view p-2 flex flex-col h-full"
    style="container-type: inline-size; container-name: suspended-sessions-view-pane"
  >
    <div class="view-header mb-2">
      <div class="relative w-full">
        <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <i class="fas fa-search text-text-secondary"></i>
        </span>
        <input
          type="text"
          v-model="searchTerm"
          :placeholder="$t('suspendedSshSessions.searchPlaceholder')"
          class="w-full pl-10 pr-4 py-1.5 border border-border/50 rounded-lg bg-input text-foreground text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out"
          @input="filterSessions"
        />
      </div>
      <!-- 可选：显示挂起会话总数 -->
      <!-- <div class="text-sm text-gray-500 mt-1">
        当前挂起会话总数: {{ filteredSessions.length }} / {{ allSuspendedSshSessions.length }}
      </div> -->
    </div>

    <div class="session-list-container flex-grow overflow-y-auto">
      <div v-if="isLoading" class="text-center p-4">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p>{{ $t('suspendedSshSessions.loading') }}</p>
      </div>
      <div v-else-if="filteredSessions.length === 0 && !isLoading" class="text-center p-4">
        <p>{{ $t('suspendedSshSessions.noResults') }}</p>
      </div>
      <ul v-else class="list-none p-0 m-0">
        <SuspendedSessionItem
          v-for="session in filteredSessions"
          :key="session.suspendSessionId"
          :session="session"
          :is-editing="editingSuspendSessionId === session.suspendSessionId"
          @start-edit="startEditingName"
          @finish-edit="finishEditingName"
          @cancel-edit="cancelEditingName"
          @resume="resumeSession"
          @remove="removeSession"
          @export-log="exportLog"
        />
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, onDeactivated, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../stores/session.store';
import { useConnectionsStore } from '../stores/connections.store'; // +++ 导入 Connections Store +++
import type { SuspendedSshSession } from '../types/ssh-suspend.types';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents'; // +++ 导入事件发射器 +++
import SuspendedSessionItem from '../components/SuspendedSessionItem.vue';
import { log } from '@/utils/log';

const { t } = useI18n();
const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++
const sessionStore = useSessionStore();
const { suspendedSshSessions: storeSuspendedSshSessions, isLoadingSuspendedSessions: isLoading } =
  storeToRefs(sessionStore);

const searchTerm = ref('');

// +++ 组件级编辑状态（聚焦逻辑已迁移至 SuspendedSessionItem 子组件）+++
const editingSuspendSessionId = ref<string | null>(null);
const currentEditingNameValue = ref<string>('');

// filteredSessions 现在直接基于 storeSuspendedSshSessions
const filteredSessions = computed(() => {
  if (!searchTerm.value.trim()) {
    return storeSuspendedSshSessions.value;
  }
  const lowerSearchTerm = searchTerm.value.toLowerCase();
  return storeSuspendedSshSessions.value.filter(
    (session: SuspendedSshSession) =>
      (session.customSuspendName?.toLowerCase() || '').includes(lowerSearchTerm) ||
      session.connectionName.toLowerCase().includes(lowerSearchTerm),
  );
});

const filterSessions = () => {
  // 计算属性会自动处理过滤
};

const formatDateTime = (isoString?: string) => {
  if (!isoString) return t('time.unknown');
  try {
    return new Date(isoString).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error: unknown) {
    return t('time.invalidDate');
  }
};

const startEditingName = (session: SuspendedSshSession) => {
  // async 不再需要，聚焦由 watcher 处理
  editingSuspendSessionId.value = session.suspendSessionId;
  currentEditingNameValue.value = session.customSuspendName || session.connectionName;
  // 聚焦逻辑已移至 watcher
};

const finishEditingName = (newName?: string) => {
  if (editingSuspendSessionId.value === null) return;

  const sessionId = editingSuspendSessionId.value;
  const trimmedName = (newName || currentEditingNameValue.value).trim();

  const originalSession = storeSuspendedSshSessions.value.find(
    (s) => s.suspendSessionId === sessionId,
  );
  if (!originalSession) {
    editingSuspendSessionId.value = null;
    return;
  }

  editingSuspendSessionId.value = null;

  if (
    trimmedName &&
    trimmedName !== (originalSession.customSuspendName || originalSession.connectionName)
  ) {
    sessionStore.editSshSessionName(sessionId, trimmedName);
  }
};

const cancelEditingName = () => {
  editingSuspendSessionId.value = null;
  // currentEditingNameValue 不需要显式重置，因为它会在下次 startEditingName 时被新值覆盖
};

const resumeSession = async (session: SuspendedSshSession) => {
  // 参数类型改为 SuspendedSshSession
  log.info(
    `[SuspendedSshSessionsView] Attempting to resume session ID: ${session.suspendSessionId}, Name: ${session.customSuspendName || session.connectionName}`,
  );
  // 使用 JSON 序列化/反序列化记录会话快照，脱离响应式系统避免 structuredClone 对 Proxy 抛出异常
  log.info(
    '[SuspendedSshSessionsView] Session details snapshot:',
    JSON.parse(JSON.stringify(session)),
  );

  try {
    // resumeSshSession 返回 Promise<void>，调用完成即表示操作已执行
    await sessionStore.resumeSshSession(session.suspendSessionId);
    log.info('[SuspendedSshSessionsView] Call to sessionStore.resumeSshSession completed.');
  } catch (error: unknown) {
    log.error(
      `[SuspendedSshSessionsView] Error during resumeSession for ${session.suspendSessionId}:`,
      error,
    );
  }
  // 无论成功与否（或者仅在成功时，取决于需求），都可能需要通知模态框关闭
  // 为了简化，这里假设操作已发起，具体成功状态由 store 或后端处理
  emitWorkspaceEvent('suspendedSession:actionCompleted');
};

const removeSession = (session: SuspendedSshSession) => {
  // 参数类型改为 SuspendedSshSession
  if (session.backendSshStatus === 'hanging') {
    sessionStore.terminateAndRemoveSshSession(session.suspendSessionId);
  } else if (session.backendSshStatus === 'disconnected_by_backend') {
    sessionStore.removeSshSessionEntry(session.suspendSessionId);
  }
  emitWorkspaceEvent('suspendedSession:actionCompleted');
};

const exportLog = async (session: SuspendedSshSession) => {
  log.info(
    `[SuspendedSshSessionsView] Attempting to export log for session ID: ${session.suspendSessionId}`,
  );
  await sessionStore.exportSshSessionLog(session.suspendSessionId);
  // 不需要 emitWorkspaceEvent，因为导出日志通常不关闭模态框
};

const BASE_POLL_INTERVAL_MS = 3000;
const MAX_POLL_INTERVAL_MS = 60000;

let fetchTimeoutId: number | undefined;
let isPollingActive = false;
let isFetching = false;
let currentPollIntervalMs = BASE_POLL_INTERVAL_MS;
let connectionsPrefetched = false;

const clearPollingTimer = () => {
  if (fetchTimeoutId) {
    clearTimeout(fetchTimeoutId);
    fetchTimeoutId = undefined;
  }
};

const stopPolling = () => {
  isPollingActive = false;
  clearPollingTimer();
};

const applyBackoff = (result?: { ok: boolean; status?: number }) => {
  if (result?.ok) {
    currentPollIntervalMs = BASE_POLL_INTERVAL_MS;
    return;
  }

  if (result?.status === 429) {
    currentPollIntervalMs = Math.min(currentPollIntervalMs * 2, MAX_POLL_INTERVAL_MS);
    return;
  }

  currentPollIntervalMs = Math.min(Math.max(currentPollIntervalMs, BASE_POLL_INTERVAL_MS), 10000);
};

const scheduleNextPoll = () => {
  clearPollingTimer();
  if (!isPollingActive) return;
  fetchTimeoutId = window.setTimeout(runPollingTick, currentPollIntervalMs);
};

const runPollingTick = async () => {
  if (!isPollingActive || isFetching) return;

  isFetching = true;
  try {
    const result = await sessionStore.fetchSuspendedSshSessions({
      showLoadingIndicator: false,
      notifyOnError: false,
    });
    applyBackoff(result);
  } finally {
    isFetching = false;
    scheduleNextPoll();
  }
};

const ensureConnectionsFetched = async () => {
  if (connectionsPrefetched) return;
  const connectionsStore = useConnectionsStore(); // +++ 获取 Connections Store 实例 +++
  // 确保连接列表已加载或正在加载
  // 通常 store 的 fetch 方法会处理重复调用或自行管理加载状态
  try {
    log.info('[SuspendedSshSessionsView] Ensuring connections are fetched.');
    await connectionsStore.fetchConnections(); // +++ 获取连接列表 +++
    connectionsPrefetched = true;
  } catch (error: unknown) {
    log.error('[SuspendedSshSessionsView] Error fetching connections:', error);
    // 根据需要处理错误，例如显示通知
  }
};

const startPolling = async (options?: { forceInitialLoading?: boolean }) => {
  if (isPollingActive) return;

  isPollingActive = true;
  currentPollIntervalMs = BASE_POLL_INTERVAL_MS;
  await ensureConnectionsFetched();

  // 立即获取一次挂起会话数据 (显示加载指示器)
  const initialResult = await sessionStore.fetchSuspendedSshSessions({
    showLoadingIndicator: options?.forceInitialLoading ?? true,
    notifyOnError: true,
  });
  applyBackoff(initialResult);
  scheduleNextPoll();
};

onMounted(async () => {
  await startPolling({ forceInitialLoading: true });
});

onActivated(async () => {
  if (!isPollingActive) {
    await startPolling({ forceInitialLoading: false });
  }
});

onDeactivated(() => {
  stopPolling();
});

onUnmounted(() => {
  // 组件卸载时清理轮询
  stopPolling();
});
</script>

<style scoped>
.suspended-ssh-sessions-view {
  font-family: var(--font-family-sans-serif);
}

.session-item {
  transition: background-color 0.2s ease-in-out;
}
.session-item:hover {
  background-color: var(--surface-hover); /* PrimeVue hover color */
}

/* 保持与 QuickCommandsView 类似的简洁风格 */
.p-inputtext-sm {
  padding: 0.375rem 0.5rem; /* 调整输入框大小 */
  font-size: 0.875rem;
}

.responsive-button-padding {
  padding-left: 0.75rem; /* px-3 */
  padding-right: 0.75rem; /* px-3 */
}

.action-icon {
  margin-right: 0.375rem; /* mr-1.5 */
}

.button-session-text {
  display: inline;
}

/* Apply styles when the container 'suspended-sessions-view-pane' is narrower than 480px */
@container suspended-sessions-view-pane (max-width: 300px) {
  .button-session-text {
    display: none;
  }

  .action-icon {
    margin-right: 0;
  }

  .responsive-button-padding {
    padding-left: 0.5rem; /* px-2 */
    padding-right: 0.5rem; /* px-2 */
  }

  /* Adjust list item layout for narrow view - Now we want to keep the two-column layout */
  /* .session-item > .flex { */ /* Targeting the main flex container inside session-item */
  /* flex-direction: column; */ /* REMOVED to keep horizontal layout */
  /* align-items: stretch; */ /* REMOVED */
  /* } */

  /* .session-item .session-info { */
  /* margin-right: 0; */ /* REMOVED */
  /* margin-bottom: 0.5rem; */ /* mb-2 */ /* REMOVED */
  /* } */

  .session-item .session-status-actions {
    /* 按钮组总是垂直排列并靠右 */
    /* margin-top: 0.5rem; */ /* This might still be useful if .session-info was above it, but now they are side-by-side */
    align-items: flex-end; /* 按钮组整体靠右 - KEEPING THIS */
  }

  .session-item .session-status-actions .actions {
    /* 按钮组垂直排列，内部元素（按钮）靠右对齐（如果容器宽度大于按钮）或充满（如果按钮宽度100%）*/
    /* For flex-col, align-items controls cross-axis (horizontal), justify-content controls main-axis (vertical) */
    /* We want buttons to be aligned to the end (right) of their vertical container if they are not full width */
    align-items: flex-end; /* This will align buttons to the right if they are not full width */
    /* justify-content: flex-end; */ /* This was for horizontal flex, for vertical, it would push to bottom */
  }

  /* 在窄视图下，确保按钮容器占满宽度，使按钮能正确对齐 */
  /* The nested container query might not be needed or needs simplification */
  @container suspended-sessions-view-pane (max-width: 320px) {
    .session-item .session-info .font-bold.text-lg {
      /* 针对名称和状态标签的容器 */
      flex-wrap: wrap; /* 如果名称和状态标签加起来太长，允许状态标签换行 - This is still good */
    }
    /* .session-item .session-status-actions { */
    /* 保持按钮在右侧 */
    /* align-items: flex-end; */ /* Already set above */
    /* } */
    .session-item .session-status-actions .actions {
      /* width: 100%; */ /* 让按钮容器占满，以便按钮可以靠左或靠右 - May not be needed if align-items: flex-end works */
      /* justify-content: flex-start; */ /* 在极窄情况下，按钮靠左可能更好 - REMOVED, we want them right-aligned or as per their container */
      align-items: flex-end; /* Ensure buttons themselves are right-aligned within their vertical stack */
    }
  }
}
</style>
