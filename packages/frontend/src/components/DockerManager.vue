<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session.store';
import { storeToRefs } from 'pinia';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents';

const { t } = useI18n();
const sessionStore = useSessionStore();
const { activeSession } = storeToRefs(sessionStore); // Get reactive active session
const emitWorkspaceEvent = useWorkspaceEventEmitter();

// --- Get Docker Manager Instance from Active Session ---
const dockerManager = computed(() => activeSession.value?.dockerManager);

// --- Computed properties based on Docker Manager state ---
const containers = computed(() => dockerManager.value?.containers.value ?? []);
const isLoading = computed(() => dockerManager.value?.isLoading.value ?? false);
const error = computed(() => dockerManager.value?.error.value ?? null);
const isDockerAvailable = computed(() => dockerManager.value?.isDockerAvailable.value ?? false); // Default to false if no manager
const expandedContainerIds = computed(
  () => dockerManager.value?.expandedContainerIds.value ?? new Set<string>(),
);

// --- Computed properties for UI state (independent of dockerManager) ---
const currentSessionId = computed(() => activeSession.value?.sessionId);
const sshConnectionStatus = computed(
  () => activeSession.value?.wsManager.connectionStatus.value ?? 'disconnected',
);

// --- Methods delegated to Docker Manager ---
const sendDockerCommand = (
  containerId: string,
  command: 'start' | 'stop' | 'restart' | 'remove',
) => {
  dockerManager.value?.sendDockerCommand(containerId, command);
};

const toggleExpand = (containerId: string) => {
  dockerManager.value?.toggleExpand(containerId);
};

const enterContainer = (containerId: string) => {
  if (activeSession.value?.sessionId) {
    const command = `docker exec -it ${containerId} sh\n`; // \n for auto-execution
    emitWorkspaceEvent('terminal:sendCommand', {
      command,
      sessionId: activeSession.value.sessionId,
    });
  }
};

const viewContainerLogs = (containerId: string) => {
  if (activeSession.value?.sessionId) {
    const command = `docker logs --tail 1000 -f ${containerId}\n`; // \n for auto-execution
    emitWorkspaceEvent('terminal:sendCommand', {
      command,
      sessionId: activeSession.value.sessionId,
    });
  }
};

// --- Removed internal state, methods (setupWsListeners, clearWsListeners, requestDockerStatus), watcher, and lifecycle hooks (onMounted, onUnmounted) ---
</script>

<template>
  <div class="docker-manager flex flex-col h-full overflow-hidden bg-background text-foreground">
    <!-- Case 1: No active session -->
    <div
      v-if="!currentSessionId"
      class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary p-4"
    >
      <i class="fas fa-plug text-4xl mb-3"></i>
      <p class="mt-2 mb-1 font-medium">{{ t('dockerManager.error.noActiveSession') }}</p>
      <small class="text-xs max-w-[80%] text-text-disabled">{{
        t('dockerManager.error.connectFirst')
      }}</small>
    </div>
    <!-- Case 2: Active session, SSH connecting -->
    <div
      v-else-if="sshConnectionStatus === 'connecting'"
      class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary p-4"
    >
      <i class="fas fa-spinner fa-spin text-4xl mb-3"></i>
      <p class="mt-2 mb-1 font-medium">{{ t('dockerManager.waitingForSsh') }}</p>
      <small class="text-xs max-w-[80%] text-text-disabled">{{
        activeSession?.wsManager.statusMessage.value || '...'
      }}</small>
    </div>
    <!-- Case 3: Active session, SSH disconnected -->
    <div
      v-else-if="sshConnectionStatus === 'disconnected'"
      class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary p-4"
    >
      <i class="fas fa-unlink text-4xl mb-3"></i>
      <p class="mt-2 mb-1 font-medium">{{ t('dockerManager.error.sshDisconnected') }}</p>
      <small class="text-xs max-w-[80%] text-text-disabled">{{
        activeSession?.wsManager.statusMessage.value || '...'
      }}</small>
    </div>
    <!-- Case 4: Active session, SSH error -->
    <div
      v-else-if="sshConnectionStatus === 'error'"
      class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary p-4"
    >
      <i class="fas fa-exclamation-circle text-3xl text-error mb-2"></i>
      <p class="mt-2 mb-1 font-medium">{{ t('dockerManager.error.sshError') }}</p>
      <small class="text-xs max-w-[80%]">{{
        activeSession?.wsManager.statusMessage.value || 'Unknown SSH error'
      }}</small>
    </div>
    <!-- Case 5: Active session, SSH connected, Docker loading -->
    <div
      v-else-if="isLoading && containers.length === 0"
      class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary p-4"
    >
      <!-- Use computed isLoading -->
      <i class="fas fa-spinner fa-spin text-4xl mb-3"></i> {{ t('dockerManager.loading') }}
    </div>
    <!-- Case 6: Active session, SSH connected, Docker unavailable -->
    <div
      v-else-if="!isDockerAvailable"
      class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary p-4"
    >
      <!-- Use computed isDockerAvailable -->
      <i class="fab fa-docker text-4xl mb-3"></i>
      <p class="mt-2 mb-1 font-medium">{{ t('dockerManager.notAvailable') }}</p>
      <small class="text-xs max-w-[80%] text-text-disabled">{{
        t('dockerManager.installHintRemote')
      }}</small>
    </div>
    <!-- Case 7: Active session, SSH connected, Fetch error -->
    <div
      v-else-if="error"
      class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary p-4"
    >
      <!-- Use computed error -->
      <i class="fas fa-exclamation-triangle text-3xl text-error mb-2"></i>
      <p class="mt-2 mb-1 font-medium">{{ t('dockerManager.error.fetchFailed') }}</p>
      <small class="text-xs max-w-[80%]">{{ error }}</small>
      <!-- Use computed error -->
    </div>
    <!-- Case 8: Active session, SSH connected, Docker available, show list -->
    <div v-else class="docker-content-area flex-grow overflow-auto">
      <!-- This 'else' covers the 'connected and available' case -->
      <div
        v-if="containers.length === 0 && !isLoading"
        class="flex flex-col justify-center items-center text-center flex-grow text-text-secondary h-full"
      >
        <!-- Use computed containers and isLoading -->
        {{ t('dockerManager.noContainers') }}
      </div>
      <table v-else class="w-full border-collapse text-sm">
        <!-- Use computed containers -->
        <thead class="responsive-thead">
          <!-- Use class for CSS control -->
          <tr class="bg-header">
            <th class="w-8 px-2 py-2 border-b border-border"></th>
            <!-- Expand Col -->
            <th
              class="px-3 py-2 border-b border-border text-left font-medium text-text-secondary uppercase tracking-wider"
            >
              {{ t('dockerManager.header.name') }}
            </th>
            <th
              class="px-3 py-2 border-b border-border text-left font-medium text-text-secondary uppercase tracking-wider"
            >
              {{ t('dockerManager.header.status') }}
            </th>
            <th
              class="px-3 py-2 border-b border-border text-left font-medium text-text-secondary uppercase tracking-wider"
            >
              {{ t('dockerManager.header.ports') }}
            </th>
            <th
              class="px-3 py-2 border-b border-border text-left font-medium text-text-secondary uppercase tracking-wider"
            >
              {{ t('dockerManager.header.actions') }}
            </th>
          </tr>
        </thead>
        <!-- Use template v-for to render pairs of rows -->
        <tbody class="responsive-tbody">
          <!-- Use class for CSS control -->
          <template v-for="container in containers" :key="container.id">
            <!-- Use computed containers -->
            <!-- Main Row / Card Container -->
            <tr
              class="responsive-tr mb-4 border border-border rounded p-3 bg-background shadow-sm relative hover:bg-header/30 transition-colors duration-150"
              :class="{ expanded: expandedContainerIds.has(container.id) }"
            >
              <!-- Use computed expandedContainerIds -->
              <!-- Expand Button Cell (Desktop only) -->
              <td
                class="responsive-td-expand w-8 px-2 py-2 border-b border-border text-center align-middle"
              >
                <button
                  @click="toggleExpand(container.id)"
                  class="text-text-secondary hover:text-foreground transition-colors duration-150 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-xs"
                  :title="
                    expandedContainerIds.has(container.id)
                      ? t('common.collapse')
                      : t('common.expand')
                  "
                  :aria-label="
                    expandedContainerIds.has(container.id)
                      ? t('common.collapse')
                      : t('common.expand')
                  "
                >
                  <!-- Use computed expandedContainerIds -->
                  <i
                    :class="[
                      'fas',
                      expandedContainerIds.has(container.id)
                        ? 'fa-chevron-down'
                        : 'fa-chevron-right',
                    ]"
                  ></i>
                  <!-- Use computed expandedContainerIds -->
                </button>
              </td>
              <!-- Name Cell -->
              <td
                class="responsive-td px-3 py-2 border-b border-border align-middle text-right"
                :data-label="t('dockerManager.header.name')"
              >
                <div class="flex flex-col items-end gap-0.5">
                  <span
                    class="font-medium text-sm truncate max-w-[180px]"
                    :title="container.Names?.join(', ')"
                    >{{ container.Names?.join(', ') || 'N/A' }}</span
                  >
                  <span
                    class="text-xs text-text-secondary truncate max-w-[180px]"
                    :title="container.Image"
                    >{{ container.Image }}</span
                  >
                </div>
              </td>
              <!-- Status Cell -->
              <td
                class="responsive-td px-3 py-2 border-b border-border align-middle text-right"
                :data-label="t('dockerManager.header.status')"
              >
                <span
                  :class="[
                    'px-2 py-0.5 rounded-full text-xs font-medium text-white whitespace-nowrap',
                    container.State === 'running'
                      ? 'bg-success text-success-text'
                      : container.State === 'exited'
                        ? 'bg-error text-error-text'
                        : container.State === 'paused'
                          ? 'bg-warning text-warning-text'
                          : container.State === 'restarting'
                            ? 'bg-primary text-white'
                            : 'bg-text-secondary text-white',
                  ]"
                >
                  {{ container.Status }}
                </span>
              </td>
              <!-- Ports Cell -->
              <td
                class="responsive-td px-3 py-2 border-b border-border align-middle text-right break-all"
                :data-label="t('dockerManager.header.ports')"
              >
                <span
                  class="text-xs text-text-secondary"
                  :title="
                    container.Ports?.map(
                      (p) =>
                        `${p.IP ? p.IP + ':' : ''}${p.PublicPort ? p.PublicPort + '->' : ''}${p.PrivatePort}/${p.Type}`,
                    ).join(', ')
                  "
                >
                  {{
                    container.Ports?.map(
                      (p) =>
                        `${p.IP ? p.IP + ':' : ''}${p.PublicPort ? p.PublicPort + '->' : ''}${p.PrivatePort}/${p.Type}`,
                    ).join(', ') || 'N/A'
                  }}
                </span>
              </td>
              <!-- Actions Cell -->
              <td
                class="responsive-td px-3 py-2 border-b border-border align-middle text-right"
                :data-label="t('dockerManager.header.actions')"
              >
                <div
                  class="responsive-actions-container grid grid-cols-3 gap-1 justify-items-center pt-2"
                >
                  <button
                    @click="sendDockerCommand(container.id, 'start')"
                    :aria-label="t('dockerManager.action.start')"
                    class="docker-action-btn text-text-secondary hover:text-success disabled:text-text-disabled disabled:cursor-not-allowed transition-colors duration-150 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-base"
                    :data-tooltip="t('dockerManager.action.start')"
                    :disabled="container.State === 'running'"
                  >
                    <i class="fas fa-play"></i>
                  </button>
                  <button
                    @click="sendDockerCommand(container.id, 'stop')"
                    :aria-label="t('dockerManager.action.stop')"
                    class="docker-action-btn text-text-secondary hover:text-warning disabled:text-text-disabled disabled:cursor-not-allowed transition-colors duration-150 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-base"
                    :data-tooltip="t('dockerManager.action.stop')"
                    :disabled="container.State !== 'running'"
                  >
                    <i class="fas fa-stop"></i>
                  </button>
                  <button
                    @click="sendDockerCommand(container.id, 'restart')"
                    :aria-label="t('dockerManager.action.restart')"
                    class="docker-action-btn text-text-secondary hover:text-primary disabled:text-text-disabled disabled:cursor-not-allowed transition-colors duration-150 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-base"
                    :data-tooltip="t('dockerManager.action.restart')"
                    :disabled="container.State !== 'running'"
                  >
                    <i class="fas fa-sync-alt"></i>
                  </button>
                  <button
                    @click="sendDockerCommand(container.id, 'remove')"
                    :aria-label="t('dockerManager.action.remove')"
                    class="docker-action-btn text-text-secondary hover:text-error disabled:text-text-disabled disabled:cursor-not-allowed transition-colors duration-150 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-base"
                    :data-tooltip="t('dockerManager.action.remove')"
                  >
                    <i class="fas fa-trash-alt"></i>
                  </button>
                  <button
                    @click="enterContainer(container.id)"
                    :aria-label="t('dockerManager.action.enter')"
                    class="docker-action-btn text-text-secondary hover:text-primary transition-colors duration-150 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-base"
                    :data-tooltip="t('dockerManager.action.enter')"
                  >
                    <i class="fas fa-terminal"></i>
                  </button>
                  <button
                    @click="viewContainerLogs(container.id)"
                    :aria-label="t('dockerManager.action.logs')"
                    class="docker-action-btn text-text-secondary hover:text-text-secondary transition-colors duration-150 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-base"
                    :data-tooltip="t('dockerManager.action.logs')"
                  >
                    <i class="fas fa-file-alt"></i>
                  </button>
                </div>
              </td>

              <!-- Card Expansion Cell (Mobile only) -->
              <td class="responsive-td-card-expand w-full p-0 border-t border-border mt-3">
                <!-- Card Footer Button (Show when NOT expanded) -->
                <div v-if="!expandedContainerIds.has(container.id)">
                  <!-- Use computed expandedContainerIds -->
                  <button
                    @click="toggleExpand(container.id)"
                    class="flex items-center justify-center w-full h-10 text-text-secondary hover:text-foreground hover:bg-header/50 transition-colors duration-150 text-sm rounded-b"
                  >
                    <i class="fas fa-chevron-down mr-1.5"></i> {{ t('common.expand') }}
                  </button>
                </div>
                <!-- Card Expansion Content (Show when expanded) -->
                <div v-if="expandedContainerIds.has(container.id)" class="bg-header/30 rounded-b">
                  <!-- Use computed expandedContainerIds -->
                  <div class="p-4">
                    <!-- Stats Container -->
                    <dl
                      v-if="container.stats"
                      class="grid grid-cols-[max-content_auto] gap-x-4 gap-y-2 text-xs"
                    >
                      <dt class="font-medium text-text-secondary">
                        {{ t('dockerManager.stats.cpu') }}
                      </dt>
                      <dd class="font-mono">{{ container.stats.CPUPerc ?? 'N/A' }}</dd>
                      <dt class="font-medium text-text-secondary">
                        {{ t('dockerManager.stats.memory') }}
                      </dt>
                      <dd class="font-mono">
                        {{ container.stats.MemUsage ?? 'N/A' }} ({{
                          container.stats.MemPerc ?? 'N/A'
                        }})
                      </dd>
                      <dt class="font-medium text-text-secondary">
                        {{ t('dockerManager.stats.netIO') }}
                      </dt>
                      <dd class="font-mono">{{ container.stats.NetIO ?? 'N/A' }}</dd>
                      <dt class="font-medium text-text-secondary">
                        {{ t('dockerManager.stats.blockIO') }}
                      </dt>
                      <dd class="font-mono">{{ container.stats.BlockIO ?? 'N/A' }}</dd>
                      <dt class="font-medium text-text-secondary">
                        {{ t('dockerManager.stats.pids') }}
                      </dt>
                      <dd class="font-mono">{{ container.stats.PIDs ?? 'N/A' }}</dd>
                    </dl>
                    <div v-else class="text-center text-text-secondary italic text-xs py-2">
                      {{ t('dockerManager.stats.noData') }}
                    </div>
                  </div>
                  <!-- Collapse Button for Card View -->
                  <button
                    @click="toggleExpand(container.id)"
                    class="flex items-center justify-center w-full h-10 text-text-secondary hover:text-foreground hover:bg-header/50 transition-colors duration-150 text-sm border-t border-border rounded-b"
                  >
                    <i class="fas fa-chevron-up mr-1.5"></i> {{ t('common.collapse') }}
                  </button>
                </div>
              </td>
            </tr>

            <!-- Desktop Expansion Row (Hidden on mobile) -->
            <tr v-if="expandedContainerIds.has(container.id)" class="responsive-expansion-row">
              <!-- Use computed expandedContainerIds -->
              <td :colspan="6" class="p-0 border-b border-border">
                <div class="bg-header/30 p-4">
                  <!-- Stats Container -->
                  <dl
                    v-if="container.stats"
                    class="grid grid-cols-[max-content_auto] gap-x-4 gap-y-2 text-xs"
                  >
                    <dt class="font-medium text-text-secondary">
                      {{ t('dockerManager.stats.cpu') }}
                    </dt>
                    <dd class="font-mono">{{ container.stats.CPUPerc ?? 'N/A' }}</dd>
                    <dt class="font-medium text-text-secondary">
                      {{ t('dockerManager.stats.memory') }}
                    </dt>
                    <dd class="font-mono">
                      {{ container.stats.MemUsage ?? 'N/A' }} ({{
                        container.stats.MemPerc ?? 'N/A'
                      }})
                    </dd>
                    <dt class="font-medium text-text-secondary">
                      {{ t('dockerManager.stats.netIO') }}
                    </dt>
                    <dd class="font-mono">{{ container.stats.NetIO ?? 'N/A' }}</dd>
                    <dt class="font-medium text-text-secondary">
                      {{ t('dockerManager.stats.blockIO') }}
                    </dt>
                    <dd class="font-mono">{{ container.stats.BlockIO ?? 'N/A' }}</dd>
                    <dt class="font-medium text-text-secondary">
                      {{ t('dockerManager.stats.pids') }}
                    </dt>
                    <dd class="font-mono">{{ container.stats.PIDs ?? 'N/A' }}</dd>
                  </dl>
                  <div v-else class="text-center text-text-secondary italic text-xs py-2">
                    {{ t('dockerManager.stats.noData') }}
                  </div>
                </div>
              </td>
            </tr>
            <!-- Removed original separate card-footer-row and expansion-card-row -->
          </template>
          <!-- End v-for template -->
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* Define the component root as a size container */
.docker-manager {
  container-type: inline-size; /* Define as a size container */
  container-name: docker-manager-pane; /* Optional: give it a name */
}

/* --- Responsive Table Styles using Container Query --- */

/* Default styles (Table view) - Applied via classes in template */
.responsive-thead {
  display: table-header-group;
}
.responsive-tbody {
  display: table-row-group;
}
.responsive-tr {
  display: table-row;
}
.responsive-td {
  display: table-cell;
  vertical-align: middle;
} /* Added vertical-align */
.responsive-td-expand {
  display: table-cell;
  vertical-align: middle;
} /* Desktop expand button cell */
.responsive-td-card-expand {
  display: none;
} /* Hide card expansion cell */
.responsive-expansion-row {
  display: table-row;
} /* Desktop expansion row */
.responsive-actions-container {
  justify-items: start;
} /* Align actions left in table */

/* Styles for Card View when container is narrow */
@container docker-manager-pane (max-width: 600px) {
  /* Use container query, adjust breakpoint if needed */
  /* +++ Add padding to content area in card view +++ */
  .docker-content-area {
    padding: 1rem; /* Equivalent to p-4 */
  }
  /* +++ End padding rule +++ */

  .responsive-thead.responsive-thead {
    /* Increased specificity */
    display: none; /* Hide table header */
  }

  .responsive-tbody.responsive-tbody {
    /* Increased specificity */
    display: block; /* Make body behave like block */
  }

  .responsive-tr.responsive-tr {
    /* Increased specificity */
    display: block; /* Make rows behave like blocks/cards */
    /* Tailwind classes in template handle margin, border, padding, bg, shadow */
  }

  .responsive-td.responsive-td {
    /* Increased specificity */
    display: block; /* Stack cells vertically */
    text-align: right; /* Align cell content to the right */
    padding-left: 50%; /* Make space for the label */
    position: relative; /* Needed for pseudo-element positioning */
    /* Tailwind classes in template handle padding-top/bottom */
    border-bottom: 1px dashed var(--border-color-light); /* Add separator */
  }
  /* Remove border from last visible cell in card view (which is now the actions cell) */
  /* Specificity already high enough with td context */
  .responsive-tr td.responsive-td:last-of-type {
    border-bottom: none;
  }
  /* Also remove border from the hidden card expansion cell if it were visible */
  .responsive-tr td.responsive-td-card-expand {
    border-bottom: none;
  }

  .responsive-td.responsive-td::before {
    /* Increased specificity */
    content: attr(data-label); /* Display the label */
    position: absolute;
    left: 0.75rem; /* Corresponds to p-3 left padding in template */
    width: calc(50% - 1.5rem); /* Calculate label width based on p-3 */
    padding-right: 10px;
    white-space: nowrap;
    text-align: left; /* Align label text to the left */
    font-weight: 600; /* Tailwind font-bold */
    color: var(--text-color-secondary); /* Tailwind text-text-secondary */
  }

  /* Hide desktop expand button cell in card view */
  .responsive-td-expand.responsive-td-expand {
    /* Increased specificity */
    display: none; /* Removed !important */
  }

  /* Show card expansion cell in card view */
  .responsive-td-card-expand.responsive-td-card-expand {
    /* Increased specificity */
    display: block;
    /* Tailwind classes in template handle width, padding, border, margin */
  }
  .responsive-td-card-expand.responsive-td-card-expand::before {
    /* Increased specificity */
    display: none; /* No label for this cell */
  }

  /* Align actions center in card view */
  .responsive-actions-container.responsive-actions-container {
    /* Increased specificity */
    justify-items: center;
    /* Tailwind pt-2 in template handles top padding */
  }
  /* Remove label for actions cell in card view */
  /* Specificity already high enough with attribute selector */
  .responsive-td[data-label*='Actions']::before {
    content: ''; /* Override label */
    display: none; /* Hide label space */
  }
  .responsive-td[data-label*='Actions'] {
    padding-left: 0.75rem; /* Reset padding-left for actions cell */
    /* border-bottom: none; /* Already handled by last-of-type */
  }

  /* Hide the table-specific expansion row in card view */
  .responsive-expansion-row.responsive-expansion-row {
    /* Increased specificity */
    display: none; /* Removed !important */
  }
}
/* --- End Responsive Table Styles --- */

/* Minimal styles needed - Tailwind handles most */

/* Docker 操作按钮 CSS Tooltip */
.docker-action-btn {
  position: relative;
}
.docker-action-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--header-bg-color, #1e293b);
  color: var(--text-color, #e2e8f0);
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 50;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.docker-action-btn:hover::after {
  opacity: 1;
}
</style>
