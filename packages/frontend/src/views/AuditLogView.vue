<template>
  <div class="p-4 bg-background text-foreground h-full flex flex-col">
    <!-- Full height flex container -->
    <div class="max-w-7xl mx-auto w-full flex flex-col h-full">
      <h1
        class="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-border flex-shrink-0"
      >
        {{ $t('auditLog.title') }}
      </h1>

      <!-- Filtering Controls -->
      <div
        class="flex flex-wrap items-center gap-4 mb-4 p-4 border border-border rounded-lg bg-header/50 flex-shrink-0"
      >
        <div class="flex-grow min-w-[200px]">
          <label for="search-term" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('common.search')
          }}</label>
          <input
            type="text"
            id="search-term"
            v-model="searchTerm"
            :placeholder="$t('auditLog.searchPlaceholder')"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm"
          />
        </div>
        <div class="flex-grow min-w-[200px]">
          <label for="action-type" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('auditLog.table.actionType')
          }}</label>
          <select
            id="action-type"
            v-model="selectedActionType"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8 text-sm"
            style="
              background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'%2f%3e%3c/svg%3e&quot;);
              background-position: right 0.75rem center;
              background-size: 16px 12px;
            "
          >
            <option value="">{{ $t('common.all') }}</option>
            <option v-for="type in allActionTypes" :key="type" :value="type">
              {{ translateActionType(type) }}
            </option>
          </select>
        </div>
        <div class="self-end">
          <button
            @click="applyFilters"
            class="px-4 py-2 bg-button text-button-text rounded hover:bg-button-hover text-sm font-medium"
          >
            {{ $t('common.filter') }}
          </button>
        </div>
      </div>

      <!-- Error state -->
      <div
        v-if="store.error"
        class="p-4 mb-4 border-l-4 border-error bg-error/10 text-error rounded flex-shrink-0"
      >
        {{ store.error }}
      </div>

      <!-- Loading state -->
      <div
        v-else-if="store.isLoading && logs.length === 0"
        class="p-4 text-center text-text-secondary italic flex-shrink-0"
      >
        {{ $t('common.loading') }}
      </div>

      <!-- No logs state -->
      <div
        v-else-if="!store.isLoading && !store.error && logs.length === 0"
        class="p-4 mb-4 border-l-4 border-blue-400 bg-blue-100 text-blue-700 rounded flex-shrink-0"
      >
        {{ $t('auditLog.noLogs') }}
      </div>

      <!-- Virtual List -->
      <div
        v-else-if="!store.isLoading && !store.error && logs.length > 0"
        class="flex-grow flex flex-col min-h-0 border border-border rounded-lg bg-background"
      >
        <!-- Header Row -->
        <div
          class="flex bg-header border-b border-border text-sm font-medium text-text-secondary py-3 px-4 flex-shrink-0"
        >
          <div class="w-1/6 min-w-[150px]">{{ $t('auditLog.table.timestamp') }}</div>
          <div class="w-1/6 min-w-[150px]">{{ $t('auditLog.table.actionType') }}</div>
          <div class="w-4/6 flex-grow">{{ $t('auditLog.table.details') }}</div>
        </div>

        <!-- List Container -->
        <div v-bind="containerProps" class="flex-grow overflow-auto custom-scrollbar">
          <div v-bind="wrapperProps">
            <div
              v-for="{ data: log, index } in list"
              :key="log.id"
              class="flex border-b border-border hover:bg-header/50 text-sm py-4 px-4 items-start"
              :style="{ minHeight: '60px' }"
            >
              <div class="w-1/6 min-w-[150px] pr-4 break-words">
                {{ formatTimestamp(log.timestamp) }}
              </div>
              <div class="w-1/6 min-w-[150px] pr-4 break-words">
                {{ translateActionType(log.action_type) }}
              </div>
              <div class="w-4/6 flex-grow min-w-0">
                <pre
                  v-if="log.details"
                  class="whitespace-pre-wrap break-all bg-header/50 p-2 border border-border/50 rounded text-xs font-mono max-h-40 overflow-y-auto"
                  >{{ formatDetails(log.details) }}</pre
                >
                <span v-else class="text-text-secondary">-</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination Info Footer -->
        <div
          class="text-right text-text-secondary text-sm p-4 border-t border-border flex-shrink-0 bg-header/20"
        >
          {{ $t('auditLog.paginationInfo', { currentPage, totalPages, totalLogs }) }}
          <!-- Simple Pagination Controls (if needed, or rely on infinite scroll in future) -->
          <div class="inline-flex ml-4 gap-2">
            <button
              @click="changePage(currentPage - 1)"
              :disabled="currentPage === 1"
              class="px-2 py-1 border border-border rounded disabled:opacity-50 hover:bg-header"
            >
              &lt;
            </button>
            <button
              @click="changePage(currentPage + 1)"
              :disabled="currentPage === totalPages"
              class="px-2 py-1 border border-border rounded disabled:opacity-50 hover:bg-header"
            >
              &gt;
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAuditLogStore } from '../stores/audit.store';
import { AuditLogEntry, AuditLogActionType } from '../types/server.types';
import { useI18n } from 'vue-i18n';
import { useVirtualList } from '@vueuse/core';

const store = useAuditLogStore();
const { t } = useI18n();

// --- Filtering State ---
const searchTerm = ref('');
const selectedActionType = ref<AuditLogActionType | ''>('');

const allActionTypes: AuditLogActionType[] = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'PASSWORD_CHANGED',
  '2FA_ENABLED',
  '2FA_DISABLED',
  'CONNECTION_CREATED',
  'CONNECTION_UPDATED',
  'CONNECTION_DELETED',
  'PROXY_CREATED',
  'PROXY_UPDATED',
  'PROXY_DELETED',
  'TAG_CREATED',
  'TAG_UPDATED',
  'TAG_DELETED',
  'SETTINGS_UPDATED',
  'IP_WHITELIST_UPDATED',
  'NOTIFICATION_SETTING_CREATED',
  'NOTIFICATION_SETTING_UPDATED',
  'NOTIFICATION_SETTING_DELETED',
  'SSH_CONNECT_SUCCESS',
  'SSH_CONNECT_FAILURE',
  'SSH_SHELL_FAILURE',
  'DATABASE_MIGRATION',
  'ADMIN_SETUP_COMPLETE',
];

const logs = computed(() => store.logs);
const totalLogs = computed(() => store.totalLogs);
const currentPage = computed(() => store.currentPage);
const logsPerPage = computed(() => store.logsPerPage);
const totalPages = computed(() => Math.ceil(totalLogs.value / logsPerPage.value));

// --- Virtual List ---
// Use estimated item height since details can expand
const { list, containerProps, wrapperProps } = useVirtualList(logs, {
  itemHeight: 100, // Estimate 100px per row
  overscan: 10,
});

const applyFilters = () => {
  store.fetchLogs({
    page: 1,
    searchTerm: searchTerm.value || undefined,
    actionType: selectedActionType.value || undefined,
  });
};

onMounted(() => {
  store.fetchLogs();
});

const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp * 1000).toLocaleString();
};

const translateActionType = (actionType: AuditLogActionType): string => {
  const key = `auditLog.actions.${actionType}`;
  const translated = t(key);
  return translated === key ? actionType : translated;
};

const formatDetails = (details: AuditLogEntry['details']): string => {
  if (!details) return '';
  if (typeof details === 'object' && details !== null) {
    if ('raw' in details && details.parseError) {
      return `[Parse Error] Raw: ${details.raw}`;
    }
    return JSON.stringify(details, null, 2);
  }
  return String(details);
};

const changePage = (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    store.fetchLogs({
      page: page,
      searchTerm: searchTerm.value || undefined,
      actionType: selectedActionType.value || undefined,
    });
  }
};
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: var(--border-color);
  border-radius: 4px;
}
</style>
