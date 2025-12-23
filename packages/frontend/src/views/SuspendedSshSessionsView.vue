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
        <li
          v-for="session in filteredSessions"
          :key="session.suspendSessionId"
          class="session-item p-3 mb-2 border border-border/70 rounded-md bg-surface-ground"
          :class="{ 'opacity-60': session.backendSshStatus === 'disconnected_by_backend' }"
        >
          <div class="flex justify-between items-center">
            <div class="session-info flex-grow mr-2">
              <div class="font-bold text-lg flex items-center">
                <span
                  v-if="editingSuspendSessionId !== session.suspendSessionId"
                  class="cursor-pointer hover:text-primary"
                  :title="$t('suspendedSshSessions.tooltip.editName')"
                  @click="startEditingName(session)"
                >
                  {{ session.customSuspendName || session.connectionName }}
                </span>
                <input
                  v-else
                  ref="nameInputRef"
                  v-model="currentEditingNameValue"
                  type="text"
                  class="text-lg font-bold w-full px-1 py-0.5 border border-primary rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  @blur="finishEditingName()"
                  @keydown.enter.prevent="finishEditingName()"
                  @keydown.esc.prevent="cancelEditingName()"
                />
                <span
                  :class="[
                    'px-2 py-0.5 text-xs font-semibold rounded-full ml-2 whitespace-nowrap' /* +++ 调整了 padding 和增加了 ml-2, whitespace-nowrap +++ */,
                    session.backendSshStatus === 'hanging'
                      ? 'bg-green-100 text-green-700 dark:bg-green-700 dark:text-green-100'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-700 dark:text-yellow-100',
                  ]"
                >
                  {{
                    session.backendSshStatus === 'hanging'
                      ? $t('suspendedSshSessions.status.hanging')
                      : $t('suspendedSshSessions.status.disconnected')
                  }}
                </span>
              </div>
              <div class="text-sm text-muted-color">
                {{ $t('suspendedSshSessions.label.originalConnection') }}:
                {{ session.connectionName }}
              </div>
              <div class="text-xs text-muted-color mt-1">
                {{ $t('suspendedSshSessions.label.suspendedAt') }}:
                {{ formatDateTime(session.suspendStartTime) }}
              </div>
              <div
                v-if="
                  session.backendSshStatus === 'disconnected_by_backend' &&
                  session.disconnectionTimestamp
                "
                class="text-xs text-orange-500 mt-1"
              >
                {{
                  $t('suspendedSshSessions.disconnectedAt', {
                    time: formatDateTime(session.disconnectionTimestamp),
                  })
                }}
              </div>
            </div>

            <div class="session-status-actions flex flex-col items-end">
              <div class="actions flex flex-col space-y-2 mt-1">
                <button
                  v-if="session.backendSshStatus === 'hanging'"
                  @click="resumeSession(session)"
                  :title="$t('suspendedSshSessions.action.resume')"
                  class="responsive-button-padding py-1.5 text-sm font-medium rounded-md text-button-text bg-button hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-150 inline-flex items-center"
                >
                  <i
                    class="fas fa-play action-icon"
                    style="color: var(--button-text-color, white)"
                  ></i>
                  <!-- Assuming icon color should also match button text -->
                  <span class="button-session-text">{{
                    $t('suspendedSshSessions.action.resume')
                  }}</span>
                </button>
                <button
                  @click="removeSession(session)"
                  :title="$t('suspendedSshSessions.action.remove')"
                  class="responsive-button-padding py-1.5 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-150 inline-flex items-center"
                >
                  <i class="fas fa-trash-alt action-icon" style="color: white"></i>
                  <span class="button-session-text">{{
                    $t('suspendedSshSessions.action.remove')
                  }}</span>
                </button>
                <button
                  v-if="
                    session.backendSshStatus === 'disconnected_by_backend' ||
                    session.backendSshStatus === 'hanging'
                  "
                  @click="exportLog(session)"
                  :title="$t('suspendedSshSessions.action.exportLog')"
                  class="responsive-button-padding py-1.5 text-sm font-medium rounded-md text-button-text bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-150 inline-flex items-center"
                >
                  <i
                    class="fas fa-download action-icon"
                    style="color: var(--button-text-color, white)"
                  ></i>
                  <span class="button-session-text">{{
                    $t('suspendedSshSessions.action.exportLog')
                  }}</span>
                </button>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'; // +++ 导入 nextTick, watch 和 onUnmounted +++
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../stores/session.store';
import { useConnectionsStore } from '../stores/connections.store'; // +++ 导入 Connections Store +++
import type { SuspendedSshSession } from '../types/ssh-suspend.types';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents'; // +++ 导入事件发射器 +++

const { t } = useI18n();
const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++
const sessionStore = useSessionStore();
const { suspendedSshSessions: storeSuspendedSshSessions, isLoadingSuspendedSessions: isLoading } =
  storeToRefs(sessionStore);

const searchTerm = ref('');

// +++ 组件级编辑状态 +++
const editingSuspendSessionId = ref<string | null>(null);
const currentEditingNameValue = ref<string>('');
const nameInputRef = ref<HTMLInputElement | null>(null);

// +++ 监听编辑ID变化以聚焦输入框 +++
watch(editingSuspendSessionId, async (newId) => {
  if (newId !== null) {
    await nextTick(); // 确保DOM已更新，输入框已渲染
    if (nameInputRef.value && typeof nameInputRef.value.focus === 'function') {
      nameInputRef.value.focus();
      // nameInputRef.value.select(); // 可选：如果希望选中所有文本
    } else {
      console.warn(
        '[SuspendedSshSessionsView] Watcher: nameInputRef.value is not a focusable input after nextTick.'
      );
    }
  }
});

// filteredSessions 现在直接基于 storeSuspendedSshSessions
const filteredSessions = computed(() => {
  if (!searchTerm.value.trim()) {
    return storeSuspendedSshSessions.value;
  }
  const lowerSearchTerm = searchTerm.value.toLowerCase();
  return storeSuspendedSshSessions.value.filter(
    (session: SuspendedSshSession) =>
      (session.customSuspendName?.toLowerCase() || '').includes(lowerSearchTerm) ||
      session.connectionName.toLowerCase().includes(lowerSearchTerm)
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
  } catch (e) {
    return t('time.invalidDate');
  }
};

const startEditingName = (session: SuspendedSshSession) => {
  // async 不再需要，聚焦由 watcher 处理
  editingSuspendSessionId.value = session.suspendSessionId;
  currentEditingNameValue.value = session.customSuspendName || session.connectionName;
  // 聚焦逻辑已移至 watcher
};

const finishEditingName = () => {
  if (editingSuspendSessionId.value === null) return;

  const sessionId = editingSuspendSessionId.value;
  const newName = currentEditingNameValue.value.trim();

  const originalSession = storeSuspendedSshSessions.value.find(
    (s) => s.suspendSessionId === sessionId
  );
  if (!originalSession) {
    editingSuspendSessionId.value = null; // 重置状态
    return;
  }

  editingSuspendSessionId.value = null; // 退出编辑模式

  if (
    newName &&
    newName !== (originalSession.customSuspendName || originalSession.connectionName)
  ) {
    sessionStore.editSshSessionName(sessionId, newName);
  }
  // 如果名称未变或为空，则无需操作，因为 currentEditingNameValue 不会持久化
};

const cancelEditingName = () => {
  editingSuspendSessionId.value = null;
  // currentEditingNameValue 不需要显式重置，因为它会在下次 startEditingName 时被新值覆盖
};

const resumeSession = async (session: SuspendedSshSession) => {
  // 参数类型改为 SuspendedSshSession
  console.log(
    `[SuspendedSshSessionsView] Attempting to resume session ID: ${session.suspendSessionId}, Name: ${session.customSuspendName || session.connectionName}`
  );
  // 使用 JSON.parse(JSON.stringify()) 来记录会话对象的一个快照，避免在异步操作后因对象被修改而导致日志不准确
  console.log(
    '[SuspendedSshSessionsView] Session details snapshot:',
    JSON.parse(JSON.stringify(session))
  );

  try {
    // 假设 sessionStore.resumeSshSession 返回一个 Promise。
    // 如果它不返回 Promise (例如，它是一个同步的 action dispatch)，await 仍然是安全的，result 将会是 undefined。
    // 为了获取详细信息（如是否真正恢复、历史日志），sessionStore.resumeSshSession 可能需要被修改以返回一个包含这些信息的对象。
    const result = await sessionStore.resumeSshSession(session.suspendSessionId);

    console.log('[SuspendedSshSessionsView] Call to sessionStore.resumeSshSession completed.');

    // 检查 result 是否是包含期望信息的对象结构
    // @ts-ignore (因为我们不确定 result 的确切类型，并且这是在 Vue 文件中)
    if (
      result &&
      typeof result === 'object' &&
      ('isResumed' in result || 'historicalOutput' in result || 'message' in result)
    ) {
      console.log('[SuspendedSshSessionsView] Result from resumeSshSession:', result);
      // @ts-ignore
      console.log(
        `[SuspendedSshSessionsView] Is session truly resumed (based on backend response)? : ${result.isResumed ? 'Yes, existing session resumed.' : 'No, a new session was likely opened (or status unknown from response).'}`
      );
      // @ts-ignore
      console.log(
        '[SuspendedSshSessionsView] Historical terminal log from backend:',
        result.historicalOutput || 'Not provided or empty.'
      );
      // @ts-ignore
      if (result.message) {
        // @ts-ignore
        console.log('[SuspendedSshSessionsView] Backend message:', result.message);
      }
    } else {
      console.log(
        '[SuspendedSshSessionsView] sessionStore.resumeSshSession did not return the expected detailed information object (e.g., { isResumed: boolean, historicalOutput?: string, message?: string }). The action was dispatched.'
      );
      console.log(
        '[SuspendedSshSessionsView] To get client-side confirmation of session state and historical logs, the sessionStore.resumeSshSession action might need to be updated to return this data.'
      );
      console.log(
        '[SuspendedSshSessionsView] For now, please check browser developer console (network tab for backend responses) or backend logs for details on session restoration and historical log loading.'
      );
      if (result !== undefined) {
        console.log(
          '[SuspendedSshSessionsView] Actual value returned by resumeSshSession (if any):',
          result
        );
      }
    }
  } catch (error) {
    console.error(
      `[SuspendedSshSessionsView] Error during resumeSession for ${session.suspendSessionId}:`,
      error
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
  console.log(
    `[SuspendedSshSessionsView] Attempting to export log for session ID: ${session.suspendSessionId}`
  );
  await sessionStore.exportSshSessionLog(session.suspendSessionId);
  // 不需要 emitWorkspaceEvent，因为导出日志通常不关闭模态框
};

let fetchIntervalId: number | undefined;

onMounted(async () => {
  const connectionsStore = useConnectionsStore(); // +++ 获取 Connections Store 实例 +++
  // 确保连接列表已加载或正在加载
  // 通常 store 的 fetch 方法会处理重复调用或自行管理加载状态
  try {
    console.log('[SuspendedSshSessionsView] Ensuring connections are fetched.');
    await connectionsStore.fetchConnections(); // +++ 获取连接列表 +++
  } catch (error) {
    console.error('[SuspendedSshSessionsView] Error fetching connections:', error);
    // 根据需要处理错误，例如显示通知
  }

  // 立即获取一次挂起会话数据 (显示加载指示器)
  await sessionStore.fetchSuspendedSshSessions();

  // 设置定时器，每3秒获取一次挂起会话数据 (不显示加载指示器)
  fetchIntervalId = window.setInterval(async () => {
    await sessionStore.fetchSuspendedSshSessions({ showLoadingIndicator: false });
  }, 3000);
});

onUnmounted(() => {
  // 组件卸载时清除定时器
  if (fetchIntervalId) {
    clearInterval(fetchIntervalId);
  }
});
</script>

<style scoped>
.suspended-ssh-sessions-view {
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
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
