<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { formatDistanceToNow } from 'date-fns';
import { zhCN, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useDashboardStore } from '../stores/dashboard.store';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import { useAuditLogStore } from '../stores/audit.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import SessionDurationChart from '../components/dashboard/SessionDurationChart.vue';
import SystemResourcesHistoryChart from '../components/dashboard/SystemResourcesHistoryChart.vue';

defineOptions({
    name: 'EnhancedDashboard'
});

const { t, locale } = useI18n();
const dashboardStore = useDashboardStore();
const connectionsStore = useConnectionsStore();
const auditLogStore = useAuditLogStore();
const uiNotifications = useUiNotificationsStore();

const { stats, assetHealth, timeline, storage, systemResources, systemResourcesHistory, timeRange, isLoading } = storeToRefs(dashboardStore);
const { connections } = storeToRefs(connectionsStore);

// State
const showAddEditConnectionForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const autoRefresh = ref(true);
const refreshInterval = ref(30000);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// 统计卡片图标配置
const statIconConfig = {
    activeSessions: { icon: 'fa-terminal', color: 'blue' },
    connections: { icon: 'fa-plug', color: 'green' },
    avgDuration: { icon: 'fa-clock', color: 'yellow' },
    loginFailures: { icon: 'fa-exclamation-circle', color: 'red' },
    commandBlocks: { icon: 'fa-ban', color: 'red' },
    alerts: { icon: 'fa-bell', color: 'orange' }
} as const;

// Computed 缓存优化列表渲染
const recentTimeline = computed(() => timeline.value?.slice(0, 10) || []);
const recentConnections = computed(() => connections.value?.slice(0, 10) || []);

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
    'en': enUS,
    'zh': zhCN,
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
        case 'online': return 'success';
        case 'offline': return 'danger';
        default: return 'info';
    }
};

const getActionIcon = (actionType: string): string => dashboardStore.getActionIcon(actionType);

const handleRefresh = async () => {
    try {
        await dashboardStore.fetchAllData(timeRange.value);
    } catch (error) {
        console.error('[Dashboard] 刷新失败:', error);
        uiNotifications.showError(t('dashboard.errors.refreshFailed') || '刷新数据失败，请稍后重试');
    }
};

const handleTimeRangeChange = async () => {
    try {
        const range = toSecondsRange(dateTimeRange.value);
        dashboardStore.setTimeRange(range);
        await dashboardStore.fetchAllData(range);
    } catch (error) {
        console.error('[Dashboard] 时间范围变更失败:', error);
        uiNotifications.showError(t('dashboard.errors.timeRangeFailed') || '时间范围变更失败，请稍后重试');
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

onMounted(async () => {
    try {
        const initialRange = toSecondsRange(dateTimeRange.value);
        dashboardStore.setTimeRange(initialRange);
        await Promise.all([
            dashboardStore.fetchAllData(initialRange),
            connectionsStore.fetchConnections(),
            auditLogStore.fetchLogs({ page: 1, limit: 10, sortOrder: 'desc', isDashboardRequest: true })
        ]);
        startAutoRefresh();
    } catch (error) {
        console.error('[Dashboard] 初始化失败:', error);
        uiNotifications.showError(t('dashboard.errors.initFailed') || '仪表盘初始化失败，请刷新页面重试');
    }
});

onUnmounted(() => {
    stopAutoRefresh();
});

const openAddConnectionForm = () => {
    connectionToEdit.value = null;
    showAddEditConnectionForm.value = true;
};

const handleFormClose = () => {
    showAddEditConnectionForm.value = false;
    connectionToEdit.value = null;
};

const handleConnectionModified = async () => {
    try {
        showAddEditConnectionForm.value = false;
        connectionToEdit.value = null;
        await connectionsStore.fetchConnections();
    } catch (error) {
        console.error('[Dashboard] 连接列表更新失败:', error);
        uiNotifications.showError(t('dashboard.errors.connectionsFailed') || '连接列表更新失败，请稍后重试');
    }
};

const getProgressColor = (percent: number): string => {
    if (percent < 50) return '#67c23a';
    if (percent < 80) return '#e6a23c';
    return '#f56c6c';
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
    <div class="dashboard p-4 md:p-6 min-h-full bg-[var(--el-bg-color-page)]">
        <!-- Header -->
        <div class="flex justify-between items-center mb-6 flex-wrap gap-4">
            <h1 class="text-2xl font-bold">{{ t('dashboard.title') }}</h1>
            <div class="flex items-center gap-4 flex-wrap">
                <div class="flex items-center gap-2">
                    <span class="text-sm text-muted">{{ t('dashboard.timeRange.label') }}</span>
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
                        style="width: 320px"
                    />
                </div>
                
                <div class="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 p-1 px-3 rounded-lg border border-gray-100 dark:border-gray-700">
                    <div class="flex items-center gap-2">
                        <el-switch 
                            v-model="autoRefresh" 
                            size="small"
                        />
                        <span class="text-sm text-muted">{{ t('dashboard.autoRefresh') }}</span>
                    </div>
                    
                    <el-select v-model="refreshInterval" style="width: 90px" size="small" :disabled="!autoRefresh">
                        <el-option :value="15000" label="15s" />
                        <el-option :value="30000" label="30s" />
                        <el-option :value="60000" label="1m" />
                        <el-option :value="300000" label="5m" />
                    </el-select>
                    
                    <el-divider direction="vertical" />
                    
                    <el-tooltip :content="t('dashboard.refresh')" placement="top">
                        <el-button @click="handleRefresh" :loading="isLoading" circle size="small" type="primary" plain>
                            <i class="fas fa-sync-alt"></i>
                        </el-button>
                    </el-tooltip>
                </div>
            </div>
        </div>

        <!-- Session Stats -->
        <el-row :gutter="20" class="mb-6">
            <el-col :xs="24" :sm="8" :lg="8" class="mb-4 sm:mb-0">
                <el-card shadow="hover" class="h-full">
                    <el-statistic
                        :title="t('dashboard.stats.activeSessions')"
                        :value="stats?.sessions?.active || 0"
                    >
                        <template #prefix>
                            <div :class="`p-2 rounded-lg bg-${statIconConfig.activeSessions.color}-100 dark:bg-${statIconConfig.activeSessions.color}-900 mr-2`">
                                <i :class="['fas', statIconConfig.activeSessions.icon, `text-${statIconConfig.activeSessions.color}-500`, `dark:text-${statIconConfig.activeSessions.color}-300`]"></i>
                            </div>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
            <el-col :xs="24" :sm="8" :lg="8" class="mb-4 sm:mb-0">
                <el-card shadow="hover" class="h-full">
                    <el-statistic
                        :title="t('dashboard.stats.connections')"
                        :value="stats?.sessions?.todayConnections || 0"
                    >
                        <template #prefix>
                            <div :class="`p-2 rounded-lg bg-${statIconConfig.connections.color}-100 dark:bg-${statIconConfig.connections.color}-900 mr-2`">
                                <i :class="['fas', statIconConfig.connections.icon, `text-${statIconConfig.connections.color}-500`, `dark:text-${statIconConfig.connections.color}-300`]"></i>
                            </div>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
            <el-col :xs="24" :sm="8" :lg="8">
                <el-card shadow="hover" class="h-full">
                    <el-statistic
                        :title="t('dashboard.stats.avgDuration')"
                        :value="stats?.sessions?.avgDuration || 0"
                        :formatter="(v: number) => formatDuration(v)"
                    >
                        <template #prefix>
                            <div :class="`p-2 rounded-lg bg-${statIconConfig.avgDuration.color}-100 dark:bg-${statIconConfig.avgDuration.color}-900 mr-2`">
                                <i :class="['fas', statIconConfig.avgDuration.icon, `text-${statIconConfig.avgDuration.color}-500`, `dark:text-${statIconConfig.avgDuration.color}-300`]"></i>
                            </div>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
        </el-row>

        <!-- Security Stats -->
        <el-row :gutter="20" class="mb-6">
            <el-col :xs="24" :sm="8" :lg="8" class="mb-4 sm:mb-0">
                <el-card shadow="hover" class="h-full">
                    <el-statistic
                        :title="t('dashboard.stats.loginFailures')"
                        :value="stats?.security?.loginFailures || 0"
                    >
                        <template #prefix>
                            <div :class="`p-2 rounded-lg bg-${statIconConfig.loginFailures.color}-100 dark:bg-${statIconConfig.loginFailures.color}-900 mr-2`">
                                <i :class="['fas', statIconConfig.loginFailures.icon, `text-${statIconConfig.loginFailures.color}-500`, `dark:text-${statIconConfig.loginFailures.color}-300`]"></i>
                            </div>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
            <el-col :xs="24" :sm="8" :lg="8" class="mb-4 sm:mb-0">
                <el-card shadow="hover" class="h-full">
                    <el-statistic
                        :title="t('dashboard.stats.commandBlocks')"
                        :value="stats?.security?.commandBlocks || 0"
                    >
                        <template #prefix>
                            <div :class="`p-2 rounded-lg bg-${statIconConfig.commandBlocks.color}-100 dark:bg-${statIconConfig.commandBlocks.color}-900 mr-2`">
                                <i :class="['fas', statIconConfig.commandBlocks.icon, `text-${statIconConfig.commandBlocks.color}-500`, `dark:text-${statIconConfig.commandBlocks.color}-300`]"></i>
                            </div>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
            <el-col :xs="24" :sm="8" :lg="8">
                <el-card shadow="hover" class="h-full">
                    <el-statistic
                        :title="t('dashboard.stats.alerts')"
                        :value="stats?.security?.alerts || 0"
                    >
                        <template #prefix>
                            <div :class="`p-2 rounded-lg bg-${statIconConfig.alerts.color}-100 dark:bg-${statIconConfig.alerts.color}-900 mr-2`">
                                <i :class="['fas', statIconConfig.alerts.icon, `text-${statIconConfig.alerts.color}-500`, `dark:text-${statIconConfig.alerts.color}-300`]"></i>
                            </div>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
        </el-row>

        <!-- Session Duration & System Resources -->
        <el-row :gutter="20" class="mb-6">
            <el-col :xs="24" :lg="12" class="mb-6 lg:mb-0">
                <el-card shadow="hover" class="h-full">
                    <template #header>
                        <div class="flex items-center gap-2 font-medium">
                            <i class="fas fa-chart-bar text-[var(--el-color-primary)]"></i>
                            <span>{{ t('dashboard.stats.sessionDuration') }}</span>
                        </div>
                    </template>
                    <div v-if="stats?.sessions?.durationDistribution" class="h-full">
                        <div class="text-sm text-[var(--el-text-color-secondary)] mb-4 flex items-center gap-2">
                            <span class="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                            {{ t('dashboard.stats.avgDuration') }}：{{ formatDuration(stats.sessions.avgDuration) }}
                        </div>
                        <div class="h-[250px]">
                            <SessionDurationChart :distribution="stats.sessions.durationDistribution" />
                        </div>
                    </div>
                    <el-skeleton v-else :rows="3" animated />
                </el-card>
            </el-col>
            <el-col :xs="24" :lg="12">
                <el-card shadow="hover" class="h-full">
                    <template #header>
                        <div class="flex items-center gap-2 font-medium">
                            <i class="fas fa-server text-[var(--el-color-primary)]"></i>
                            <span>{{ t('dashboard.stats.systemResources') }}</span>
                        </div>
                    </template>
                    <div v-if="systemResources" class="space-y-4">
                        <div class="space-y-3">
                            <div class="flex items-center gap-3">
                                <span class="w-16 text-sm text-[var(--el-text-color-regular)]">CPU</span>
                                <el-progress
                                    :percentage="systemResources.cpuPercent"
                                    :stroke-width="12"
                                    :color="getProgressColor(systemResources.cpuPercent)"
                                    class="flex-1"
                                >
                                    <template #default="{ percentage }">
                                        <span class="text-xs font-medium">{{ percentage }}%</span>
                                    </template>
                                </el-progress>
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="w-16 text-sm text-[var(--el-text-color-regular)]">{{ t('dashboard.memory') }}</span>
                                <el-progress
                                    :percentage="systemResources.memPercent"
                                    :stroke-width="12"
                                    :color="getProgressColor(systemResources.memPercent)"
                                    class="flex-1"
                                >
                                    <template #default="{ percentage }">
                                        <span class="text-xs font-medium">{{ formatBytes(systemResources.memUsed) }} ({{ percentage }}%)</span>
                                    </template>
                                </el-progress>
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="w-16 text-sm text-[var(--el-text-color-regular)]">{{ t('dashboard.disk') }}</span>
                                <el-progress
                                    :percentage="systemResources.diskPercent"
                                    :stroke-width="12"
                                    :color="getProgressColor(systemResources.diskPercent)"
                                    class="flex-1"
                                >
                                    <template #default="{ percentage }">
                                        <span class="text-xs font-medium">{{ formatBytes(systemResources.diskUsed) }} ({{ percentage }}%)</span>
                                    </template>
                                </el-progress>
                            </div>
                        </div>
                        <div v-if="systemResourcesHistory.length > 1" class="h-[180px] mt-6 pt-4 border-t border-[var(--el-border-color-lighter)]">
                            <SystemResourcesHistoryChart :history="systemResourcesHistory" />
                        </div>
                    </div>
                    <el-skeleton v-else :rows="3" animated />
                </el-card>
            </el-col>
        </el-row>

        <!-- Asset Health & Storage -->
        <el-row :gutter="20" class="mb-6">
            <el-col :xs="24" :lg="12" class="mb-6 lg:mb-0">
                <el-card shadow="hover" class="h-full">
                    <template #header>
                        <div class="flex items-center gap-2 font-medium">
                            <i class="fas fa-heartbeat text-[var(--el-color-danger)]"></i>
                            <span>{{ t('dashboard.assetHealth') }}</span>
                        </div>
                    </template>
                    <div v-if="assetHealth">
                        <div class="flex flex-wrap gap-2 mb-4">
                            <el-tag type="success" effect="light" class="text-sm">
                                <i class="fas fa-check-circle mr-1"></i>
                                {{ t('dashboard.healthy') }}: {{ assetHealth.healthy }}
                            </el-tag>
                            <el-tag type="danger" effect="light" class="text-sm">
                                <i class="fas fa-times-circle mr-1"></i>
                                {{ t('dashboard.unreachable') }}: {{ assetHealth.unreachable }}
                            </el-tag>
                            <el-tag type="info" effect="light" class="text-sm">
                                <i class="fas fa-server mr-1"></i>
                                {{ t('dashboard.total') }}: {{ assetHealth.total }}
                            </el-tag>
                        </div>
                        <div class="asset-list" style="max-height: 200px; overflow-y: auto;">
                            <div
                                v-for="asset in assetHealth.assets"
                                :key="asset.id"
                                class="asset-item flex justify-between items-center py-2"
                            >
                                <span>{{ asset.name }}</span>
                                <div class="flex items-center gap-2">
                                    <el-tag :type="getAssetStatusType(asset.status)" size="small" effect="dark">
                                        {{ asset.status }}
                                    </el-tag>
                                    <span v-if="asset.latency" class="text-xs text-[var(--el-text-color-secondary)] w-12 text-right">
                                        {{ asset.latency }}ms
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <el-skeleton v-else :rows="4" animated />
                </el-card>
            </el-col>
            <el-col :xs="24" :lg="12">
                <el-card shadow="hover" class="h-full">
                    <template #header>
                        <div class="flex items-center gap-2 font-medium">
                            <i class="fas fa-hdd text-[var(--el-color-warning)]"></i>
                            <span>{{ t('dashboard.storageStats') }}</span>
                        </div>
                    </template>
                    <div v-if="storage" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="p-4 rounded-lg bg-[var(--el-fill-color-light)]">
                                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">{{ t('dashboard.recordings') }}</div>
                                <div class="text-lg font-bold">{{ storage.formatted.recordings }}</div>
                            </div>
                            <div class="p-4 rounded-lg bg-[var(--el-fill-color-light)]">
                                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">{{ t('dashboard.database') }}</div>
                                <div class="text-lg font-bold">{{ storage.formatted.database }}</div>
                            </div>
                            <div class="p-4 rounded-lg bg-[var(--el-fill-color-light)]">
                                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">{{ t('dashboard.uploads') }}</div>
                                <div class="text-lg font-bold">{{ storage.formatted.uploads }}</div>
                            </div>
                            <div class="p-4 rounded-lg bg-[var(--el-color-primary-light-9)]">
                                <div class="text-xs text-[var(--el-color-primary)] mb-1">{{ t('dashboard.total') }}</div>
                                <div class="text-lg font-bold text-[var(--el-color-primary)]">{{ storage.formatted.total }}</div>
                            </div>
                        </div>
                    </div>
                    <el-skeleton v-else :rows="4" animated />
                </el-card>
            </el-col>
        </el-row>

        <!-- Activity Timeline & Recent Connections -->
        <el-row :gutter="20">
            <el-col :xs="24" :lg="12" class="mb-6 lg:mb-0">
                <el-card shadow="hover" class="h-full">
                    <template #header>
                        <div class="flex items-center gap-2 font-medium">
                            <i class="fas fa-history text-[var(--el-color-info)]"></i>
                            <span>{{ t('dashboard.activityTimeline') }}</span>
                        </div>
                    </template>
                    <div class="max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                        <el-timeline v-if="recentTimeline.length > 0">
                            <el-timeline-item
                                v-for="event in recentTimeline"
                                :key="event.id"
                                :timestamp="formatRelativeTime(event.timestamp)"
                                placement="top"
                                :type="event.actionType === 'login' ? 'primary' : 'info'"
                                :hollow="true"
                            >
                                <div class="card p-2 rounded hover:bg-[var(--el-fill-color-lighter)] transition-colors">
                                    <div class="flex items-center gap-2 font-medium text-sm">
                                        <i :class="['fas', getActionIcon(event.actionType)]" class="text-[var(--el-text-color-secondary)]"></i>
                                        <span>{{ t(event.actionLabel) }}</span>
                                    </div>
                                    <p v-if="event.details" class="text-xs text-[var(--el-text-color-secondary)] mt-1 break-words">
                                        {{ event.details }}
                                    </p>
                                </div>
                            </el-timeline-item>
                        </el-timeline>
                        <div v-else class="text-center text-[var(--el-text-color-secondary)] py-8">
                            {{ t('dashboard.noActivity') }}
                        </div>
                    </div>
                </el-card>
            </el-col>
            <el-col :xs="24" :lg="12">
                <el-card shadow="hover" class="h-full">
                    <template #header>
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-2 font-medium">
                                <i class="fas fa-network-wired text-[var(--el-color-success)]"></i>
                                <span>{{ t('dashboard.recentConnections') }}</span>
                            </div>
                            <el-button type="primary" link @click="openAddConnectionForm">
                                <i class="fas fa-plus mr-1"></i>
                                {{ t('dashboard.addConnection') }}
                            </el-button>
                        </div>
                    </template>
                    <div v-if="recentConnections.length > 0" class="max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                        <div
                            v-for="conn in recentConnections"
                            :key="conn.id"
                            class="p-3 border-b border-[var(--el-border-color-lighter)] last:border-0 hover:bg-[var(--el-fill-color-light)] transition-colors rounded mb-1"
                        >
                            <div class="flex justify-between items-center">
                                <div class="flex items-center gap-3">
                                    <div class="w-8 h-8 rounded-full bg-[var(--el-fill-color)] flex items-center justify-center text-[var(--el-text-color-secondary)]">
                                        <i class="fas" :class="conn.type === 'SSH' ? 'fa-terminal' : conn.type === 'RDP' ? 'fa-desktop' : 'fa-network-wired'"></i>
                                    </div>
                                    <div class="flex flex-col">
                                        <span class="font-medium text-sm">{{ conn.name || conn.host }}</span>
                                        <span class="text-xs text-[var(--el-text-color-secondary)]">
                                            {{ conn.username }}@{{ conn.host }}:{{ conn.port }}
                                        </span>
                                    </div>
                                </div>
                                <el-tag size="small" :type="conn.type === 'SSH' ? 'warning' : 'success'" effect="plain">{{ conn.type }}</el-tag>
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-[var(--el-text-color-secondary)] py-8">
                        {{ t('dashboard.noConnections') }}
                    </div>
                </el-card>
            </el-col>
        </el-row>

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
/* Custom scrollbar for webkit browsers */
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: var(--el-border-color);
    border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: var(--el-text-color-secondary);
}
</style>
