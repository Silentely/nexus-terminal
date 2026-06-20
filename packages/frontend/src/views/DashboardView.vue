<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { formatDistanceToNow } from 'date-fns';
import { zhCN, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useDashboardStore } from '../stores/dashboard.store';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import { useAuditLogStore } from '../stores/audit.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useAuthStore } from '../stores/auth.store';
import { useSessionStore } from '../stores/session.store';

import SessionDurationChart from '../components/dashboard/SessionDurationChart.vue';
import SystemResourcesHistoryChart from '../components/dashboard/SystemResourcesHistoryChart.vue';
import { log } from '@/utils/log';

defineOptions({
  name: 'EnhancedDashboard',
});

const { t, locale } = useI18n();
const dashboardStore = useDashboardStore();
const connectionsStore = useConnectionsStore();
const auditLogStore = useAuditLogStore();
const uiNotifications = useUiNotificationsStore();
const authStore = useAuthStore();
const sessionStore = useSessionStore();

const {
  stats,
  assetHealth,
  timeline,
  storage,
  systemResources,
  systemResourcesHistory,
  timeRange,
  isLoading,
} = storeToRefs(dashboardStore);
const { connections } = storeToRefs(connectionsStore);
const { isInitCompleted, isAuthenticated } = storeToRefs(authStore);

// State
const showAddEditConnectionForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const autoRefresh = ref(true);
const refreshInterval = ref(30000);
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const hasInitializedDashboardData = ref(false);
const isInitializingDashboardData = ref(false);

// 统计卡片图标配置
const statIconConfig = {
  activeSessions: { icon: 'fa-terminal', color: 'blue' },
  connections: { icon: 'fa-plug', color: 'green' },
  avgDuration: { icon: 'fa-clock', color: 'yellow' },
  loginFailures: { icon: 'fa-exclamation-circle', color: 'red' },
  commandBlocks: { icon: 'fa-ban', color: 'red' },
  alerts: { icon: 'fa-bell', color: 'orange' },
} as const;

// 连接类型颜色映射（使用语义 token 确保 dark mode 一致性）
const CONNECTION_TYPE_STYLES = {
  SSH: { border: 'hover:border-l-primary', badge: 'text-primary border-primary/20' },
  RDP: {
    border: 'hover:border-l-text-secondary',
    badge: 'text-text-secondary border-text-secondary/20',
  },
  VNC: { border: 'hover:border-l-error', badge: 'text-error border-error/20' },
} as const;

const getConnectionTypeStyle = (type: string) =>
  CONNECTION_TYPE_STYLES[type as keyof typeof CONNECTION_TYPE_STYLES] ?? {
    border: '',
    badge: 'text-text-secondary border-text-secondary/20',
  };

// Computed 缓存优化列表渲染
const recentTimeline = computed(() => timeline.value?.slice(0, 10) || []);
const recentConnections = computed(() => {
  if (!connections.value?.length) return [];
  return [...connections.value]
    .sort((a, b) => {
      const timeA = a.last_connected_at ?? 0;
      const timeB = b.last_connected_at ?? 0;
      return timeB - timeA;
    })
    .slice(0, 10);
});

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const dateTimeRange = ref<[Date, Date]>([startOfToday(), new Date()]);

const toSecondsRange = (range: [Date, Date]) => ({
  start: Math.floor(range[0].getTime() / 1000),
  end: Math.floor(range[1].getTime() / 1000),
});

const rangeShortcuts = computed(() => [
  {
    text: t('dashboard.timeRange.shortcuts.last1h'),
    value: () => [new Date(Date.now() - 60 * 60 * 1000), new Date()],
  },
  {
    text: t('dashboard.timeRange.shortcuts.last24h'),
    value: () => [new Date(Date.now() - 24 * 60 * 60 * 1000), new Date()],
  },
  {
    text: t('dashboard.timeRange.shortcuts.today'),
    value: () => [startOfToday(), new Date()],
  },
  {
    text: t('dashboard.timeRange.shortcuts.last7d'),
    value: () => [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date()],
  },
]);

const dateFnsLocales: Record<string, Locale> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  en: enUS,
  zh: zhCN,
};

const formatRelativeTime = (timestampInSeconds: number | null | undefined): string => {
  if (!timestampInSeconds) return '-';
  try {
    const timestampInMs = timestampInSeconds * 1000;
    const date = new Date(timestampInMs);
    const langPart = locale.value.split('-')[0];
    const targetLocale = dateFnsLocales[locale.value] || dateFnsLocales[langPart] || enUS;
    return formatDistanceToNow(date, { addSuffix: true, locale: targetLocale });
  } catch {
    return String(timestampInSeconds);
  }
};

const formatBytes = (bytes: number): string => dashboardStore.formatBytes(bytes);

const getAssetStatusType = (status: string): 'success' | 'danger' | 'info' => {
  switch (status) {
    case 'online':
      return 'success';
    case 'offline':
      return 'danger';
    default:
      return 'info';
  }
};

const getActionIcon = (actionType: string): string => dashboardStore.getActionIcon(actionType);

const handleRefresh = async () => {
  try {
    await dashboardStore.fetchAllData(timeRange.value);
  } catch (error: unknown) {
    log.error('[Dashboard] 刷新失败:', error);
    uiNotifications.showError(t('dashboard.errors.refreshFailed') || '刷新数据失败，请稍后重试');
  }
};

const handleTimeRangeChange = async () => {
  try {
    const range = toSecondsRange(dateTimeRange.value);
    dashboardStore.setTimeRange(range);
    await dashboardStore.fetchAllData(range);
  } catch (error: unknown) {
    log.error('[Dashboard] 时间范围变更失败:', error);
    uiNotifications.showError(
      t('dashboard.errors.timeRangeFailed') || '时间范围变更失败，请稍后重试',
    );
  }
};

const startAutoRefresh = () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (autoRefresh.value) {
    refreshTimer = setInterval(() => {
      dashboardStore.fetchAllData(timeRange.value);
    }, refreshInterval.value);
  }
};

const stopAutoRefresh = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

watch(autoRefresh, () => {
  startAutoRefresh();
});

watch(refreshInterval, () => {
  startAutoRefresh();
});

const initializeDashboardDataIfReady = async () => {
  if (!isInitCompleted.value || !isAuthenticated.value || hasInitializedDashboardData.value) {
    return;
  }
  if (isInitializingDashboardData.value) {
    return;
  }
  isInitializingDashboardData.value = true;
  try {
    const initialRange = toSecondsRange(dateTimeRange.value);
    dashboardStore.setTimeRange(initialRange);
    await Promise.all([
      dashboardStore.fetchAllData(initialRange),
      connectionsStore.fetchConnections(),
      auditLogStore.fetchLogs({
        page: 1,
        limit: 10,
        sortOrder: 'desc',
        isDashboardRequest: true,
      }),
    ]);
    hasInitializedDashboardData.value = true;
    startAutoRefresh();
  } finally {
    isInitializingDashboardData.value = false;
  }
};

onMounted(async () => {
  try {
    await initializeDashboardDataIfReady();
    if (!hasInitializedDashboardData.value) {
      log.info('[Dashboard] 等待认证初始化完成后再加载数据。');
    }
  } catch (error: unknown) {
    log.error('[Dashboard] 初始化失败:', error);
    uiNotifications.showError(
      t('dashboard.errors.initFailed') || '仪表盘初始化失败，请刷新页面重试',
    );
  }
});

onUnmounted(() => {
  stopAutoRefresh();
});

watch(
  [isInitCompleted, isAuthenticated],
  async () => {
    try {
      await initializeDashboardDataIfReady();
    } catch (error: unknown) {
      log.error('[Dashboard] 认证完成后初始化失败:', error);
    }
  },
  { immediate: true },
);

const openAddConnectionForm = () => {
  connectionToEdit.value = null;
  showAddEditConnectionForm.value = true;
};

const handleFormClose = () => {
  showAddEditConnectionForm.value = false;
  connectionToEdit.value = null;
};

const handleConnectRecent = async (conn: ConnectionInfo) => {
  try {
    await sessionStore.handleConnectRequest(conn);
  } catch (error: unknown) {
    log.error('[Dashboard] 连接失败:', error);
    uiNotifications.showError(t('dashboard.errors.connectFailed') || '连接失败，请稍后重试');
  }
};

const handleConnectionModified = async () => {
  try {
    showAddEditConnectionForm.value = false;
    connectionToEdit.value = null;
    await connectionsStore.fetchConnections();
  } catch (error: unknown) {
    log.error('[Dashboard] 连接列表更新失败:', error);
    uiNotifications.showError(
      t('dashboard.errors.connectionsFailed') || '连接列表更新失败，请稍后重试',
    );
  }
};

const getProgressColor = (percent: number): string => {
  if (percent < 50) return 'var(--el-color-success)';
  if (percent < 80) return 'var(--el-color-warning)';
  return 'var(--el-color-danger)';
};

const getLatencyColorClass = (latency: number): string => {
  if (latency < 100) return 'text-success';
  if (latency < 300) return 'text-warning';
  return 'text-error';
};

const formatDuration = (seconds: number | null | undefined): string => {
  if (!seconds || seconds <= 0) return '-';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const restMins = mins % 60;
  return `${hrs}h ${restMins}m`;
};
</script>

<template>
  <div class="dashboard p-4 md:p-6 min-h-full bg-background text-foreground animate-fade-in">
    <!-- Header -->
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
      <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
        {{ t('dashboard.title') }}
      </h1>
      <div
        class="flex items-center gap-4 flex-wrap bg-surface/80 p-2 rounded-xl border border-border shadow-sm w-full md:w-auto"
      >
        <div class="flex items-center gap-2 flex-1 md:flex-none justify-between md:justify-start">
          <span class="text-xs font-medium text-muted uppercase tracking-wider ml-2">{{
            t('dashboard.timeRange.label')
          }}</span>
          <el-date-picker
            v-model="dateTimeRange"
            type="datetimerange"
            :shortcuts="rangeShortcuts"
            :range-separator="t('dashboard.timeRange.to')"
            :start-placeholder="t('dashboard.timeRange.start')"
            :end-placeholder="t('dashboard.timeRange.end')"
            format="YYYY-MM-DD HH:mm"
            :clearable="false"
            @change="handleTimeRangeChange"
            class="w-full md:w-[320px] min-w-0"
            popper-class="dashboard-date-picker-popper"
          />
        </div>

        <div class="hidden md:block w-px h-6 bg-border mx-1"></div>

        <div class="flex items-center gap-3 px-2 w-full md:w-auto justify-end md:justify-start">
          <div class="flex items-center gap-2">
            <el-switch
              v-model="autoRefresh"
              size="small"
              style="--el-switch-on-color: var(--color-primary)"
            />
            <span class="text-xs font-medium text-muted whitespace-nowrap">{{
              t('dashboard.autoRefresh')
            }}</span>
          </div>

          <el-select
            v-model="refreshInterval"
            class="w-[100px]"
            size="small"
            :disabled="!autoRefresh"
          >
            <el-option :value="15000" label="15s" />
            <el-option :value="30000" label="30s" />
            <el-option :value="60000" label="1m" />
            <el-option :value="300000" label="5m" />
          </el-select>

          <el-button
            @click="handleRefresh"
            :loading="isLoading"
            circle
            size="small"
            class="!bg-primary/10 !border-primary/20 !text-primary hover:!bg-primary hover:!text-white transition-colors transition-transform duration-300 hover:scale-110"
          >
            <i class="fas fa-sync-alt"></i>
          </el-button>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
      <!-- Active Sessions -->
      <div class="stat-card group">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-sm font-medium text-muted mb-1">
              {{ t('dashboard.stats.activeSessions') }}
            </p>
            <h3 class="text-3xl font-bold text-foreground">{{ stats?.sessions?.active || 0 }}</h3>
          </div>
          <div
            class="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-button-text transition-colors transition-transform duration-300 group-hover:scale-105"
          >
            <i class="fas fa-terminal text-xl !text-current"></i>
          </div>
        </div>
      </div>

      <!-- Total Connections -->
      <div class="stat-card group">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-sm font-medium text-muted mb-1">
              {{ t('dashboard.stats.connections') }}
            </p>
            <h3 class="text-3xl font-bold text-foreground">
              {{ stats?.sessions?.todayConnections || 0 }}
            </h3>
          </div>
          <div
            class="p-3 rounded-lg bg-success/10 text-success group-hover:bg-success group-hover:text-success-text transition-colors transition-transform duration-300 group-hover:scale-105"
          >
            <i class="fas fa-plug text-xl !text-current"></i>
          </div>
        </div>
      </div>

      <!-- Avg Duration -->
      <div class="stat-card group sm:col-span-2 lg:col-span-1">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-sm font-medium text-muted mb-1">
              {{ t('dashboard.stats.avgDuration') }}
            </p>
            <h3 class="text-3xl font-bold text-foreground">
              {{ formatDuration(stats?.sessions?.avgDuration) }}
            </h3>
          </div>
          <div
            class="p-3 rounded-lg bg-warning/10 text-warning group-hover:bg-warning group-hover:text-warning-text transition-colors transition-transform duration-300 group-hover:scale-105"
          >
            <i class="fas fa-clock text-xl !text-current"></i>
          </div>
        </div>
      </div>
    </div>

    <!-- Security Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8">
      <div
        class="stat-card group border-l-4 border-l-error/50 hover:border-l-error transition-colors duration-200"
      >
        <div class="flex justify-between items-center">
          <div>
            <p class="text-sm font-medium text-muted">{{ t('dashboard.stats.loginFailures') }}</p>
            <h3 class="text-2xl font-bold text-foreground mt-1">
              {{ stats?.security?.loginFailures || 0 }}
            </h3>
          </div>
          <i
            class="fas fa-exclamation-circle text-error/80 text-2xl group-hover:scale-110 group-hover:text-error transition-colors transition-transform duration-300 !text-current"
          ></i>
        </div>
      </div>
      <div
        class="stat-card group border-l-4 border-l-warning/50 hover:border-l-warning transition-colors duration-200"
      >
        <div class="flex justify-between items-center">
          <div>
            <p class="text-sm font-medium text-muted">{{ t('dashboard.stats.commandBlocks') }}</p>
            <h3 class="text-2xl font-bold text-foreground mt-1">
              {{ stats?.security?.commandBlocks || 0 }}
            </h3>
          </div>
          <i
            class="fas fa-ban text-warning/80 text-2xl group-hover:scale-110 group-hover:text-warning transition-colors transition-transform duration-300 !text-current"
          ></i>
        </div>
      </div>
      <div
        class="stat-card group border-l-4 border-l-warning/50 hover:border-l-warning transition-colors duration-200"
      >
        <div class="flex justify-between items-center">
          <div>
            <p class="text-sm font-medium text-muted">{{ t('dashboard.stats.alerts') }}</p>
            <h3 class="text-2xl font-bold text-foreground mt-1">
              {{ stats?.security?.alerts || 0 }}
            </h3>
          </div>
          <i
            class="fas fa-bell text-warning/80 text-2xl group-hover:scale-110 group-hover:text-warning transition-colors transition-transform duration-300 !text-current"
          ></i>
        </div>
      </div>
    </div>

    <!-- Health & Recent Connections Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-8">
      <!-- Asset Health -->
      <div class="content-card border-t-2 border-t-success/30">
        <div class="card-header border-b border-border/50 bg-surface/30">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-md bg-error/10 text-error">
              <i class="fas fa-heartbeat"></i>
            </div>
            <h3 class="font-semibold text-lg">{{ t('dashboard.assetHealth') }}</h3>
          </div>
          <div v-if="assetHealth" class="flex gap-2">
            <span
              class="px-2 py-0.5 rounded text-xs bg-success/10 text-success border border-success/20"
              >{{ t('dashboard.healthy') }}: {{ assetHealth.healthy }}</span
            >
            <span class="px-2 py-0.5 rounded text-xs bg-error/10 text-error border border-error/20"
              >{{ t('dashboard.unreachable') }}: {{ assetHealth.unreachable }}</span
            >
          </div>
        </div>
        <div v-if="assetHealth" class="p-0">
          <div class="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
            <div
              v-for="asset in assetHealth.assets"
              :key="asset.id"
              class="flex items-center justify-between p-3 mb-1 rounded-lg hover:bg-surface/50 transition-colors border border-transparent hover:border-border/50"
            >
              <div class="flex items-center gap-3">
                <div class="relative flex h-2 w-2">
                  <span
                    v-if="asset.status === 'online'"
                    class="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"
                  ></span>
                  <span
                    class="relative inline-flex rounded-full h-2 w-2"
                    :class="asset.status === 'online' ? 'bg-success' : 'bg-error'"
                  ></span>
                </div>
                <span class="font-medium text-sm">{{ asset.name }}</span>
              </div>
              <span
                v-if="asset.latency"
                class="text-xs font-mono font-medium"
                :class="getLatencyColorClass(asset.latency)"
                >{{ asset.latency }}ms</span
              >
            </div>
          </div>
        </div>
        <div v-else class="p-6">
          <el-skeleton :rows="4" animated />
        </div>
      </div>

      <!-- Recent Connections -->
      <div class="content-card border-t-2 border-t-primary/30">
        <div class="card-header border-b border-border/50 bg-surface/30">
          <div class="flex justify-between items-center w-full">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-md bg-success/10 text-success">
                <i class="fas fa-network-wired"></i>
              </div>
              <h3 class="font-semibold text-lg">{{ t('dashboard.recentConnections') }}</h3>
            </div>
            <el-button
              type="primary"
              link
              @click="openAddConnectionForm"
              class="!text-primary hover:!text-primary/80 transition-transform active:scale-95"
            >
              <i class="fas fa-plus mr-1"></i> {{ t('dashboard.addConnection') }}
            </el-button>
          </div>
        </div>
        <div
          v-if="recentConnections.length > 0"
          class="max-h-[300px] overflow-y-auto custom-scrollbar p-2"
        >
          <div
            v-for="conn in recentConnections"
            :key="conn.id"
            class="group relative flex items-center justify-between p-3 mb-1 rounded-lg hover:bg-surface/50 border-l-2 border-transparent transition-colors transition-transform duration-200 cursor-pointer active:scale-[0.98] active:bg-surface/70"
            :class="getConnectionTypeStyle(conn.type).border"
            @click="handleConnectRecent(conn)"
          >
            <div class="flex items-center gap-4">
              <div
                class="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-muted group-hover:text-primary group-hover:bg-primary/10 transition-colors duration-200 border border-border/50 shadow-sm"
              >
                <i
                  class="fas"
                  :class="
                    conn.type === 'SSH'
                      ? 'fa-terminal'
                      : conn.type === 'RDP'
                        ? 'fa-desktop'
                        : conn.type === 'VNC'
                          ? 'fa-eye'
                          : 'fa-network-wired'
                  "
                ></i>
              </div>
              <div class="truncate max-w-[120px] sm:max-w-none">
                <div class="font-medium text-foreground text-sm truncate">
                  {{ conn.name || conn.host }}
                </div>
                <div class="text-xs text-muted font-mono truncate">
                  {{ conn.username }}@{{ conn.host }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight bg-surface border border-border shadow-sm uppercase"
                :class="getConnectionTypeStyle(conn.type).badge"
                >{{ conn.type }}</span
              >
              <i
                class="fas fa-chevron-right text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity"
              ></i>
            </div>
          </div>
        </div>
        <div v-else class="p-8 text-center text-muted">
          {{ t('dashboard.noConnections') }}
        </div>
      </div>
    </div>

    <!-- Charts & Resources Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-8">
      <!-- Session Duration Chart -->
      <div class="content-card">
        <div class="card-header">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-md bg-primary/10 text-primary">
              <i class="fas fa-chart-bar"></i>
            </div>
            <h3 class="font-semibold text-lg">{{ t('dashboard.stats.sessionDuration') }}</h3>
          </div>
        </div>
        <div v-if="stats?.sessions?.durationDistribution" class="p-4 md:p-6 h-[300px]">
          <div class="w-full h-full bg-surface/20 rounded-xl border border-border/30 p-4">
            <SessionDurationChart :distribution="stats.sessions.durationDistribution" />
          </div>
        </div>
        <div v-else class="p-6 h-[300px] flex items-center justify-center">
          <el-skeleton :rows="3" animated />
        </div>
      </div>

      <!-- System Resources -->
      <div class="content-card">
        <div class="card-header">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-md bg-primary/10 text-primary">
              <i class="fas fa-server"></i>
            </div>
            <h3 class="font-semibold text-lg">{{ t('dashboard.stats.systemResources') }}</h3>
          </div>
        </div>
        <div v-if="systemResources" class="p-4 md:p-6 space-y-6">
          <!-- Resource Bars -->
          <div class="space-y-4">
            <div class="resource-item">
              <div class="flex justify-between text-sm mb-1.5 px-1">
                <span class="text-muted font-medium">CPU</span>
                <span class="font-mono font-bold">{{ systemResources.cpuPercent }}%</span>
              </div>
              <div
                class="h-2.5 bg-surface rounded-full overflow-hidden border border-border/30 shadow-inner relative"
              >
                <div
                  class="h-full rounded-full transition-[width] duration-1000 ease-out"
                  :style="{
                    width: `${systemResources.cpuPercent}%`,
                    backgroundColor: getProgressColor(systemResources.cpuPercent),
                  }"
                ></div>
              </div>
            </div>
            <div class="resource-item">
              <div class="flex justify-between text-sm mb-1.5 px-1">
                <span class="text-muted font-medium">{{ t('dashboard.memory') }}</span>
                <span class="font-mono font-bold"
                  >{{ formatBytes(systemResources.memUsed) }} ({{
                    systemResources.memPercent
                  }}%)</span
                >
              </div>
              <div
                class="h-2.5 bg-surface rounded-full overflow-hidden border border-border/30 shadow-inner relative"
              >
                <div
                  class="h-full rounded-full transition-[width] duration-1000 ease-out"
                  :style="{
                    width: `${systemResources.memPercent}%`,
                    backgroundColor: getProgressColor(systemResources.memPercent),
                  }"
                ></div>
              </div>
            </div>
            <div class="resource-item">
              <div class="flex justify-between text-sm mb-1.5 px-1">
                <span class="text-muted font-medium">{{ t('dashboard.disk') }}</span>
                <span class="font-mono font-bold"
                  >{{ formatBytes(systemResources.diskUsed) }} ({{
                    systemResources.diskPercent
                  }}%)</span
                >
              </div>
              <div
                class="h-2.5 bg-surface rounded-full overflow-hidden border border-border/30 shadow-inner relative"
              >
                <div
                  class="h-full rounded-full transition-[width] duration-1000 ease-out"
                  :style="{
                    width: `${systemResources.diskPercent}%`,
                    backgroundColor: getProgressColor(systemResources.diskPercent),
                  }"
                ></div>
              </div>
            </div>
          </div>

          <!-- History Chart -->
          <div
            v-if="systemResourcesHistory.length > 1"
            class="h-[150px] mt-4 pt-4 border-t border-border/50 bg-surface/20 rounded-xl p-4"
          >
            <SystemResourcesHistoryChart :history="systemResourcesHistory" />
          </div>
        </div>
        <div v-else class="p-6">
          <el-skeleton :rows="3" animated />
        </div>
      </div>
    </div>

    <!-- Add Connection Modal -->
    <AddConnectionForm
      v-if="showAddEditConnectionForm"
      :connectionToEdit="connectionToEdit"
      @close="handleFormClose"
      @connection-added="handleConnectionModified"
      @connection-updated="handleConnectionModified"
    />
  </div>
</template>

<style scoped>
/* Dashboard 卡片阴影与颜色变量 */
.dashboard-scope {
  --card-bg: rgba(255, 255, 255, 0.06);
  --card-border: var(--border-color);
  --card-hover-bg: rgba(255, 255, 255, 0.06);
  --shadow-sm: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  --shadow-hover: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  --card-header-bg: rgba(255, 255, 255, 0.01);
  --glass-gradient: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0,
    rgba(255, 255, 255, 0.2) 50%,
    rgba(255, 255, 255, 0) 100%
  );
}

.bg-background {
  background-color: var(--app-bg-color);
}
.text-foreground {
  color: var(--text-color);
}
.text-muted {
  color: var(--text-color-secondary);
}
.bg-surface {
  background-color: var(--header-bg-color);
}
.border-border {
  border-color: var(--border-color);
}

.stat-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border, var(--border-color));
  border-radius: 1.25rem;
  padding: 1.5rem;
  transition:
    transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
  opacity: 0;
  transition: opacity 0.4s;
  z-index: 1;
}

.stat-card:hover {
  transform: translateY(-6px);
  box-shadow: var(--shadow-lg);
  border-color: var(--link-active-color);
  background: var(--card-hover-bg);
}

.stat-card:hover::before {
  opacity: 0.6;
}

.content-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border, var(--border-color));
  border-radius: 1.25rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  transition:
    border-color 0.3s ease,
    box-shadow 0.3s ease;
  box-shadow: var(--shadow-md);
}

.content-card:hover {
  border-color: rgba(var(--input-focus-glow-rgb, 14, 165, 233), 0.4);
  box-shadow: var(--shadow-hover);
}

.card-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--card-header-bg);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.resource-progress-flow {
  position: relative;
}

.resource-progress-flow::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  background-image: var(--glass-gradient);
  background-size: 40px 100%;
  background-repeat: no-repeat;
  animation: flow 2s infinite linear;
}

@keyframes flow {
  from {
    background-position: -40px 0;
  }
  to {
    background-position: 100% 0;
  }
}

.animate-fade-in {
  animation: fadeIn 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(15px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: var(--border-color);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: var(--text-color-secondary);
}

/* Dark mode specific adjustments for card backgrounds if variables aren't defined */
.dark .stat-card,
.dark .content-card {
  --card-bg: rgba(15, 23, 42, 0.4);
  --card-border: rgba(255, 255, 255, 0.08);
}

.dark .stat-card:hover {
  --card-hover-bg: rgba(15, 23, 42, 0.6);
}

@media (max-width: 640px) {
  .dashboard-date-picker-popper {
    width: 90vw !important;
    left: 5vw !important;
  }
}
</style>
