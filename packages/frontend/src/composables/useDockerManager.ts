import { ref, readonly, watch, computed, type Ref, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../stores/settings.store';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import { useLayoutStore } from '../stores/layout.store';

// --- Interfaces (Copied from DockerManager.vue) ---
interface PortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp' | string;
}

export interface DockerContainer {
  // Exporting for potential use elsewhere
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
  // Exporting for potential use elsewhere
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
// Similar to other composables, defining dependencies for WS communication
export interface DockerManagerDependencies {
  sendMessage: (message: WebSocketMessage) => void;
  onMessage: (
    type: string,
    handler: (payload: any, fullMessage?: WebSocketMessage) => void
  ) => () => void;
  isConnected: ComputedRef<boolean>;
  // We might need isSshReady or similar if Docker commands depend on SSH being fully ready
  // For now, isConnected might suffice, assuming WS connection implies SSH readiness for Docker
}

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
  i18n: { t: (key: string, params?: any) => string }
) {
  const { sendMessage, onMessage, isConnected } = wsDeps;
  const { t } = i18n; // Use the passed i18n instance

  // --- State ---
  const containers = ref<DockerContainer[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isDockerAvailable = ref(true); // Assume available until checked
  const expandedContainerIds = ref<Set<string>>(new Set());
  const initialLoadDone = ref(false);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let wsUnsubscribeHooks: (() => void)[] = [];

  // --- Settings Store ---
  // Settings need to be accessed here as well for default expansion
  const settingsStore = useSettingsStore();
  const { dockerDefaultExpandBoolean } = storeToRefs(settingsStore);

  // --- Methods ---

  // Clear existing WebSocket listeners
  const clearWsListeners = () => {
    if (wsUnsubscribeHooks.length > 0) {
      wsUnsubscribeHooks.forEach((unsub) => unsub());
      wsUnsubscribeHooks = [];
    }
  };

  // Request Docker status via WebSocket
  const requestDockerStatus = () => {
    if (!isConnected.value) {
      // Reset state if disconnected? Or rely on watch(isConnected)?
      // Let's reset here for immediate feedback if called manually while disconnected.
      containers.value = [];
      isLoading.value = false;
      error.value = t('dockerManager.error.sshDisconnected'); // Use a generic disconnected message
      isDockerAvailable.value = false;
      expandedContainerIds.value.clear();
      initialLoadDone.value = false;
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = null;
      return;
    }

    isLoading.value = true;
    error.value = null; // Clear previous error
    sendMessage({ type: 'docker:get_status', sessionId }); // Ensure sessionId is included if needed by backend routing
  };

  // Setup WebSocket listeners
  const setupWsListeners = () => {
    clearWsListeners(); // Clear previous listeners first
    if (!isConnected.value) {
      console.warn(`[DockerManager ${sessionId}] Cannot setup listeners, WebSocket not connected.`);
      return;
    }

    const unsubStatus = onMessage('docker:status:update', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return; // Ignore messages for other sessions
      isLoading.value = false;

      if (payload && typeof payload.available === 'boolean') {
        isDockerAvailable.value = payload.available;
        if (payload.available && Array.isArray(payload.containers)) {
          containers.value = payload.containers as DockerContainer[];
          error.value = null;

          // Clean up expansion state
          const currentIds = new Set(containers.value.map((c) => c.id));
          const idsToRemove = new Set<string>();
          expandedContainerIds.value.forEach((id) => {
            if (!currentIds.has(id)) idsToRemove.add(id);
          });
          idsToRemove.forEach((id) => expandedContainerIds.value.delete(id));

          // Handle default expand on initial load
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
          if (refreshInterval && !payload.available) {
            clearInterval(refreshInterval);
            refreshInterval = null;
          }
        }
      } else {
        isDockerAvailable.value = false;
        containers.value = [];
        error.value = t('dockerManager.error.invalidResponse');
        expandedContainerIds.value.clear();
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = null;
      }
    });

    const unsubStatusError = onMessage('docker:status:error', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return;
      console.error(`[DockerManager ${sessionId}] Received docker:status:error`, payload);
      isLoading.value = false;
      error.value = payload?.message || t('dockerManager.error.fetchFailed');
      isDockerAvailable.value = false;
      containers.value = [];
      expandedContainerIds.value.clear();
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = null;
    });

    const unsubCommandError = onMessage('docker:command:error', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return;
      console.error(`[DockerManager ${sessionId}] Received docker:command:error`, payload);
      // How to notify UI? Maybe set an error ref? Or rely on status update?
      // For now, just log. UI component could show a generic error or use a notification system.
      // Consider adding a transient commandError ref if needed.
    });

    const unsubRequestUpdate = onMessage('request_docker_status_update', (payload, message) => {
      if (message?.sessionId && message.sessionId !== sessionId) return;
      requestDockerStatus(); // Trigger a status refresh immediately
    });

    wsUnsubscribeHooks.push(unsubStatus, unsubStatusError, unsubCommandError, unsubRequestUpdate);
  };

  // Send command for a specific container via WebSocket
  const sendDockerCommand = (
    containerId: string,
    command: 'start' | 'stop' | 'restart' | 'remove'
  ) => {
    if (!isConnected.value) {
      console.warn(`[DockerManager ${sessionId}] Cannot send command, WebSocket not connected.`);
      return;
    }
    if (!isDockerAvailable.value) {
      console.warn(
        `[DockerManager ${sessionId}] Cannot send command, remote Docker is not available.`
      );
      return;
    }

    sendMessage({
      type: 'docker:command',
      sessionId, // Include sessionId if needed by backend routing
      payload: { containerId, command },
    });
    // Optionally trigger a status refresh sooner after a command
    // setTimeout(requestDockerStatus, 500);
  };

  // Toggle expansion state for a container
  const toggleExpand = (containerId: string) => {
    if (expandedContainerIds.value.has(containerId)) {
      expandedContainerIds.value.delete(containerId);
    } else {
      expandedContainerIds.value.add(containerId);
    }
  };

  // --- Lifecycle Management ---

  // Reset state function
  const resetStateAndInterval = () => {
    containers.value = [];
    isLoading.value = false;
    error.value = null;
    isDockerAvailable.value = true; // Assume available until checked
    expandedContainerIds.value.clear();
    initialLoadDone.value = false;

    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    clearWsListeners();
  };

  // Watch for connection changes to manage listeners and interval
  watch(
    isConnected,
    (newIsConnected, oldIsConnected) => {
      if (newIsConnected) {
        // 只有当Docker管理器在布局中时才设置监听器和定时器
        const layoutStore = useLayoutStore();
        if (layoutStore.usedPanes.has('dockerManager')) {
          // Connection established
          setupWsListeners();
          requestDockerStatus(); // Fetch initial status

          // Start refresh interval (consider if backend pushes updates reliably)
          if (!refreshInterval) {
            // Keep a safety interval
            refreshInterval = setInterval(requestDockerStatus, 15000); // Check every 15s
          }
        } else {
        }
      } else {
        // Connection lost
        resetStateAndInterval();
        // Set error state to indicate disconnection
        error.value = t('dockerManager.error.sshDisconnected');
        isDockerAvailable.value = false; // Assume unavailable when disconnected
      }
    },
    { immediate: false }
  ); // Don't run immediately, let initial connect trigger it

  // Cleanup function to be called when the session ends
  const cleanup = () => {
    resetStateAndInterval(); // Clears listeners and interval
  };

  // --- Initial Setup ---
  // If already connected when this manager is created, set up listeners and fetch data.
  // This handles cases where the manager is created after the WS connection is live.
  if (isConnected.value) {
    // 只有当Docker管理器在布局中时才设置监听器和定时器
    const layoutStore = useLayoutStore();
    if (layoutStore.usedPanes.has('dockerManager')) {
      setupWsListeners();
      requestDockerStatus();
      if (!refreshInterval) {
        refreshInterval = setInterval(requestDockerStatus, 15000);
      }
    } else {
    }
  } else {
    // Set initial state for disconnected status
    error.value = t('dockerManager.error.sshDisconnected');
    isDockerAvailable.value = false;
  }

  // --- Exposed Interface ---
  return {
    // Readonly State
    containers: readonly(containers),
    isLoading: readonly(isLoading),
    error: readonly(error),
    isDockerAvailable: readonly(isDockerAvailable),
    expandedContainerIds: readonly(expandedContainerIds), // UI needs this read-only

    // Methods
    requestDockerStatus, // Might be useful for manual refresh button in UI
    sendDockerCommand,
    toggleExpand, // UI needs this to handle clicks

    // Lifecycle
    cleanup,
  };
}

// Export the type of the returned manager instance
export type DockerManagerInstance = ReturnType<typeof createDockerManager>;
