import { ref, readonly, watch, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../stores/settings.store';
import type { WebSocketMessage } from '../types/websocket.types';
import { useLayoutStore } from '../stores/layout.store';
import { log } from '@/utils/log';

// --- Interfaces (Copied from DockerManager.vue) ---
interface PortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp' | string;
}

export interface DockerContainer {
  // 导出供其他位置复用
  id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number;
  State: 'created' | 'restarting' | 'running' | 'removing' | 'paused' | 'exited' | 'dead' | string;
  Status: string;
  Ports: PortInfo[];
  Labels: Record<string, string>;
  stats?: DockerStats | null;
}

export interface DockerStats {
  // 导出供其他位置复用
  ID: string;
  Name: string;
  CPUPerc: string;
  MemUsage: string;
  MemPerc: string;
  NetIO: string;
  BlockIO: string;
  PIDs: string;
}

// --- WebSocket Dependencies Interface ---
// 与其他 composable 类似，定义 WebSocket 通信所需依赖
export interface DockerManagerDependencies {
  sendMessage: (message: WebSocketMessage) => void;
  onMessage: (
    type: string,
    handler: (payload: unknown, fullMessage?: WebSocketMessage) => void,
  ) => () => void;
  isConnected: ComputedRef<boolean>;
  // 若 Docker 命令依赖 SSH 就绪，可能需要 isSshReady 等状态
  // 目前假定 WS 已连接即 SSH 就绪，isConnected 足够
}

interface DockerStatusUpdatePayload {
  available: boolean;
  containers?: DockerContainer[];
}

interface DockerStatusErrorPayload {
  message?: string;
}

/** docker:command:error 载荷：命令失败时透传给 UI 反馈 */
interface DockerCommandErrorPayload {
  command?: string;
  containerId?: string;
  message?: string;
}

const asObjectRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const parseDockerStatusUpdatePayload = (payload: unknown): DockerStatusUpdatePayload | null => {
  const record = asObjectRecord(payload);
  if (!record || typeof record.available !== 'boolean') {
    return null;
  }

  const containers = Array.isArray(record.containers)
    ? (record.containers as DockerContainer[])
    : undefined;
  return {
    available: record.available,
    containers,
  };
};

const parseDockerStatusErrorPayload = (payload: unknown): DockerStatusErrorPayload => {
  const record = asObjectRecord(payload);
  if (!record) {
    return {};
  }

  return {
    message: typeof record.message === 'string' ? record.message : undefined,
  };
};

const parseDockerCommandErrorPayload = (payload: unknown): DockerCommandErrorPayload => {
  const record = asObjectRecord(payload);
  if (!record) {
    return {};
  }
  return {
    command: typeof record.command === 'string' ? record.command : undefined,
    containerId: typeof record.containerId === 'string' ? record.containerId : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
};

/**
 * Creates a Docker manager instance for a specific session.
 * @param sessionId The unique identifier for the session.
 * @param wsDeps WebSocket dependencies object.
 * @param i18n The i18n instance (t function).
 * @returns Docker manager instance.
 */
export function createDockerManager(
  sessionId: string,
  wsDeps: DockerManagerDependencies,
  i18n: { t: (key: string, params?: unknown) => string },
) {
  const { sendMessage, onMessage, isConnected } = wsDeps;
  const { t } = i18n; // 使用传入的 i18n 实例

  // --- State ---
  const containers = ref<DockerContainer[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isDockerAvailable = ref(true); // 校验前先假定可用
  const expandedContainerIds = ref<Set<string>>(new Set());
  const initialLoadDone = ref(false);
  /** 最近一次 Docker 容器操作（start/stop/restart/remove）的失败信息，供 UI 反馈 */
  const commandError = ref<string | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let wsUnsubscribeHooks: (() => void)[] = [];

  // --- Settings Store ---
  // 此处也需要读取设置以决定默认展开
  const settingsStore = useSettingsStore();
  const { dockerDefaultExpandBoolean } = storeToRefs(settingsStore);

  // --- Methods ---

  // 清理既有 WebSocket 监听
  const clearWsListeners = () => {
    if (wsUnsubscribeHooks.length > 0) {
      wsUnsubscribeHooks.forEach((unsub) => unsub());
      wsUnsubscribeHooks = [];
    }
  };

  // Request Docker status via WebSocket
  const requestDockerStatus = () => {
    if (!isConnected.value) {
      // 断开时是否重置状态？还是依赖 watch(isConnected)？
      // Let's reset here for immediate feedback if called manually while disconnected.
      containers.value = [];
      isLoading.value = false;
      error.value = t('dockerManager.error.sshDisconnected'); // 使用通用的断开提示
      isDockerAvailable.value = false;
      expandedContainerIds.value.clear();
      initialLoadDone.value = false;
      stopRefreshInterval();
      return;
    }

    isLoading.value = true;
    error.value = null; // 清除之前的错误
    sendMessage({ type: 'docker:get_status', sessionId }); // 如后端路由需要，确保带上 sessionId
  };

  // 启动刷新定时器（考虑后端推送是否可靠）
  // 与其他轮询组件（Dashboard/AiAudit/TransferProgress）保持一致，统一由 stopRefreshInterval 管理生命周期
  const startRefreshInterval = () => {
    if (refreshInterval) return; // 已存在定时器时不重复创建
    refreshInterval = setInterval(requestDockerStatus, 15000); // 每 15 秒检查
  };

  // 停止刷新定时器，避免后台标签页空转浪费资源
  const stopRefreshInterval = () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  };

  // 页面隐藏时暂停轮询，恢复可见后立即刷新并继续，避免后台标签页持续请求接口
  const handleVisibilityChange = () => {
    if (document.hidden) {
      stopRefreshInterval();
      return;
    }
    // 仅当连接建立且 Docker 面板仍在布局中时才恢复轮询
    const layoutStore = useLayoutStore();
    if (isConnected.value && layoutStore.usedPanes.has('dockerManager')) {
      requestDockerStatus(); // 恢复可见时立即刷新一次
      startRefreshInterval();
    }
  };

  // Setup WebSocket listeners
  const setupWsListeners = () => {
    clearWsListeners(); // 先清理既有监听
    if (!isConnected.value) {
      log.warn(`[DockerManager ${sessionId}] Cannot setup listeners, WebSocket not connected.`);
      return;
    }

    const unsubStatus = onMessage('docker:status:update', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return; // 忽略其他会话的消息
      isLoading.value = false;
      const statusPayload = parseDockerStatusUpdatePayload(payload);

      if (statusPayload) {
        isDockerAvailable.value = statusPayload.available;
        if (statusPayload.available && Array.isArray(statusPayload.containers)) {
          containers.value = statusPayload.containers;
          error.value = null;

          // 清理展开状态
          const currentIds = new Set(containers.value.map((c) => c.id));
          const idsToRemove = new Set<string>();
          expandedContainerIds.value.forEach((id) => {
            if (!currentIds.has(id)) idsToRemove.add(id);
          });
          idsToRemove.forEach((id) => expandedContainerIds.value.delete(id));

          // 首次加载时处理默认展开
          if (!initialLoadDone.value && dockerDefaultExpandBoolean.value) {
            containers.value.forEach((container) => {
              if (!expandedContainerIds.value.has(container.id)) {
                expandedContainerIds.value.add(container.id);
              }
            });
            initialLoadDone.value = true;
          }
        } else {
          containers.value = [];
          error.value = null;
          expandedContainerIds.value.clear();
          if (refreshInterval && !statusPayload.available) {
            stopRefreshInterval();
          }
        }
      } else {
        isDockerAvailable.value = false;
        containers.value = [];
        error.value = t('dockerManager.error.invalidResponse');
        expandedContainerIds.value.clear();
        stopRefreshInterval();
      }
    });

    const unsubStatusError = onMessage('docker:status:error', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return;
      log.error(`[DockerManager ${sessionId}] Received docker:status:error`, payload);
      isLoading.value = false;
      const statusErrorPayload = parseDockerStatusErrorPayload(payload);
      error.value = statusErrorPayload.message || t('dockerManager.error.fetchFailed');
      isDockerAvailable.value = false;
      containers.value = [];
      expandedContainerIds.value.clear();
      stopRefreshInterval();
    });

    const unsubCommandError = onMessage('docker:command:error', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return;
      log.error(`[DockerManager ${sessionId}] Received docker:command:error`, payload);
      const commandErrorPayload = parseDockerCommandErrorPayload(payload);
      // 将命令失败信息暴露给 UI 反馈，用户操作容器后能立即感知失败原因
      commandError.value =
        commandErrorPayload.message ||
        t('dockerManager.error.commandFailed', { command: commandErrorPayload.command ?? '' });
    });

    const unsubStatsError = onMessage('docker:stats:error', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return;
      log.error(`[DockerManager ${sessionId}] Received docker:stats:error`, payload);
      const statsErrorPayload = parseDockerStatusErrorPayload(payload);
      error.value = statsErrorPayload.message || t('dockerManager.error.fetchFailed');
    });

    const unsubRequestUpdate = onMessage('request_docker_status_update', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return;
      requestDockerStatus(); // 立即触发一次状态刷新
    });

    wsUnsubscribeHooks.push(
      unsubStatus,
      unsubStatusError,
      unsubCommandError,
      unsubStatsError,
      unsubRequestUpdate,
    );
  };

  // 通过 WebSocket 向指定容器发送命令
  const sendDockerCommand = (
    containerId: string,
    command: 'start' | 'stop' | 'restart' | 'remove',
  ) => {
    if (!isConnected.value) {
      log.warn(`[DockerManager ${sessionId}] Cannot send command, WebSocket not connected.`);
      return;
    }
    if (!isDockerAvailable.value) {
      log.warn(`[DockerManager ${sessionId}] Cannot send command, remote Docker is not available.`);
      return;
    }

    sendMessage({
      type: 'docker:command',
      sessionId, // Include sessionId if needed by backend routing
      payload: { containerId, command },
    });
    // 命令后可选择提前刷新状态
    // setTimeout(requestDockerStatus, 500);
  };

  // 切换容器的展开状态
  const toggleExpand = (containerId: string) => {
    if (expandedContainerIds.value.has(containerId)) {
      expandedContainerIds.value.delete(containerId);
    } else {
      expandedContainerIds.value.add(containerId);
    }
  };

  // --- Lifecycle Management ---

  // 重置状态
  const resetStateAndInterval = () => {
    containers.value = [];
    isLoading.value = false;
    error.value = null;
    isDockerAvailable.value = true; // 校验前先假定可用
    expandedContainerIds.value.clear();
    initialLoadDone.value = false;
    commandError.value = null;

    stopRefreshInterval();
    clearWsListeners();
  };

  // 监听连接变化以管理监听与定时器
  watch(
    isConnected,
    (newIsConnected) => {
      if (newIsConnected) {
        // 只有当Docker管理器在布局中时才设置监听器和定时器
        const layoutStore = useLayoutStore();
        if (layoutStore.usedPanes.has('dockerManager')) {
          // 连接已建立
          setupWsListeners();
          requestDockerStatus(); // 拉取初始状态

          // 启动刷新定时器（考虑后端推送是否可靠）
          startRefreshInterval();
        }
      } else {
        // 连接已断开
        resetStateAndInterval();
        // 设置错误状态以提示断开
        error.value = t('dockerManager.error.sshDisconnected');
        isDockerAvailable.value = false; // 断开时假定不可用
      }
    },
    { immediate: false },
  ); // Don't run immediately, let initial connect trigger it

  // 会话结束时调用的清理函数
  const cleanup = () => {
    // 移除页面可见性监听，避免会话结束后仍被全局事件回调持有
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    resetStateAndInterval(); // 清理监听与定时器
  };

  // --- Initial Setup ---
  // 若创建时已连接，则建立监听并拉取数据。
  // 覆盖管理器在 WS 连接建立后才创建的情况。
  if (isConnected.value) {
    // 只有当Docker管理器在布局中时才设置监听器和定时器
    const layoutStore = useLayoutStore();
    if (layoutStore.usedPanes.has('dockerManager')) {
      setupWsListeners();
      requestDockerStatus();
      startRefreshInterval();
    }
  } else {
    // 设置断开时的初始状态
    error.value = t('dockerManager.error.sshDisconnected');
    isDockerAvailable.value = false;
  }

  // 注册页面可见性监听：后台标签页暂停轮询，恢复后继续
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // --- Exposed Interface ---
  return {
    // Readonly State
    containers: readonly(containers),
    isLoading: readonly(isLoading),
    error: readonly(error),
    isDockerAvailable: readonly(isDockerAvailable),
    expandedContainerIds: readonly(expandedContainerIds), // UI needs this read-only
    commandError: readonly(commandError), // 容器操作失败信息，供 UI 展示反馈

    // Methods
    requestDockerStatus, // 可供 UI 手动刷新按钮使用
    sendDockerCommand,
    toggleExpand, // UI needs this to handle clicks

    // Lifecycle
    cleanup,
  };
}

// 导出返回的管理器实例类型
export type DockerManagerInstance = ReturnType<typeof createDockerManager>;
