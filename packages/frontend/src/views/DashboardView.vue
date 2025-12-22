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
    <div class="dashboard p-6 min-h-full bg-background text-foreground animate-fade-in">
        <!-- Header -->
        <div class="flex justify-between items-center mb-8 flex-wrap gap-4">
            <h1 class="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">{{ t('dashboard.title') }}</h1>
            <div class="flex items-center gap-4 flex-wrap bg-surface/50 backdrop-blur-md p-2 rounded-xl border border-border shadow-sm">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-medium text-muted uppercase tracking-wider ml-2">{{ t('dashboard.timeRange.label') }}</span>
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
                        class="!w-[320px] !bg-transparent !border-none !shadow-none"
                        popper-class="dashboard-date-picker-popper"
                    />
                </div>
                
                <div class="w-px h-6 bg-border mx-1"></div>

                <div class="flex items-center gap-3 px-2">
                    <div class="flex items-center gap-2">
                        <el-switch 
                            v-model="autoRefresh" 
                            size="small"
                            style="--el-switch-on-color: var(--color-primary);"
                        />
                        <span class="text-xs font-medium text-muted">{{ t('dashboard.autoRefresh') }}</span>
                    </div>
                    
                    <el-select v-model="refreshInterval" class="!w-[80px]" size="small" :disabled="!autoRefresh">
                        <el-option :value="15000" label="15s" />
                        <el-option :value="30000" label="30s" />
                        <el-option :value="60000" label="1m" />
                        <el-option :value="300000" label="5m" />
                    </el-select>
                    
                    <el-button @click="handleRefresh" :loading="isLoading" circle size="small" class="!bg-primary/10 !border-primary/20 !text-primary hover:!bg-primary hover:!text-white transition-colors">
                        <i class="fas fa-sync-alt"></i>
                    </el-button>
                </div>
            </div>
        </div>

        <!-- Stats Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <!-- Active Sessions -->
            <div class="stat-card group">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-sm font-medium text-muted mb-1">{{ t('dashboard.stats.activeSessions') }}</p>
                        <h3 class="text-3xl font-bold text-foreground">{{ stats?.sessions?.active || 0 }}</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-blue-500/10 text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-colors duration-300">
                        <i class="fas fa-terminal text-xl !text-current"></i>
                    </div>
                </div>
            </div>

            <!-- Total Connections -->
            <div class="stat-card group">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-sm font-medium text-muted mb-1">{{ t('dashboard.stats.connections') }}</p>
                        <h3 class="text-3xl font-bold text-foreground">{{ stats?.sessions?.todayConnections || 0 }}</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300">
                        <i class="fas fa-plug text-xl !text-current"></i>
                    </div>
                </div>
            </div>

            <!-- Avg Duration -->
            <div class="stat-card group">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-sm font-medium text-muted mb-1">{{ t('dashboard.stats.avgDuration') }}</p>
                        <h3 class="text-3xl font-bold text-foreground">{{ formatDuration(stats?.sessions?.avgDuration) }}</h3>
                    </div>
                    <div class="p-3 rounded-lg bg-amber-500/10 text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-colors duration-300">
                        <i class="fas fa-clock text-xl !text-current"></i>
                    </div>
                </div>
            </div>
        </div>

        <!-- Security Stats Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
             <div class="stat-card group border-l-4 border-l-red-500/50">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-sm font-medium text-muted">{{ t('dashboard.stats.loginFailures') }}</p>
                        <h3 class="text-2xl font-bold text-foreground mt-1">{{ stats?.security?.loginFailures || 0 }}</h3>
                    </div>
                    <i class="fas fa-exclamation-circle text-red-500/80 text-2xl group-hover:scale-110 transition-transform !text-current"></i>
                </div>
            </div>
             <div class="stat-card group border-l-4 border-l-orange-500/50">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-sm font-medium text-muted">{{ t('dashboard.stats.commandBlocks') }}</p>
                        <h3 class="text-2xl font-bold text-foreground mt-1">{{ stats?.security?.commandBlocks || 0 }}</h3>
                    </div>
                    <i class="fas fa-ban text-orange-500/80 text-2xl group-hover:scale-110 transition-transform !text-current"></i>
                </div>
            </div>
             <div class="stat-card group border-l-4 border-l-yellow-500/50">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-sm font-medium text-muted">{{ t('dashboard.stats.alerts') }}</p>
                        <h3 class="text-2xl font-bold text-foreground mt-1">{{ stats?.security?.alerts || 0 }}</h3>
                    </div>
                    <i class="fas fa-bell text-yellow-500/80 text-2xl group-hover:scale-110 transition-transform !text-current"></i>
                </div>
            </div>
        </div>

        <!-- Charts & Resources Row -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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
                <div v-if="stats?.sessions?.durationDistribution" class="p-6 h-[300px]">
                    <SessionDurationChart :distribution="stats.sessions.durationDistribution" />
                </div>
                <div v-else class="p-6 h-[300px] flex items-center justify-center">
                   <el-skeleton :rows="3" animated />
                </div>
            </div>

            <!-- System Resources -->
            <div class="content-card">
                <div class="card-header">
                    <div class="flex items-center gap-3">
                         <div class="p-2 rounded-md bg-purple-500/10 text-purple-500">
                            <i class="fas fa-server"></i>
                        </div>
                        <h3 class="font-semibold text-lg">{{ t('dashboard.stats.systemResources') }}</h3>
                    </div>
                </div>
                <div v-if="systemResources" class="p-6 space-y-6">
                    <!-- Resource Bars -->
                    <div class="space-y-4">
                        <div class="resource-item">
                            <div class="flex justify-between text-sm mb-1">
                                <span class="text-muted">CPU</span>
                                <span class="font-mono font-medium">{{ systemResources.cpuPercent }}%</span>
                            </div>
                            <div class="h-2 bg-surface rounded-full overflow-hidden">
                                <div class="h-full rounded-full transition-all duration-500" 
                                     :style="{ width: `${systemResources.cpuPercent}%`, backgroundColor: getProgressColor(systemResources.cpuPercent) }"></div>
                            </div>
                        </div>
                        <div class="resource-item">
                            <div class="flex justify-between text-sm mb-1">
                                <span class="text-muted">{{ t('dashboard.memory') }}</span>
                                <span class="font-mono font-medium">{{ formatBytes(systemResources.memUsed) }}</span>
                            </div>
                            <div class="h-2 bg-surface rounded-full overflow-hidden">
                                <div class="h-full rounded-full transition-all duration-500" 
                                     :style="{ width: `${systemResources.memPercent}%`, backgroundColor: getProgressColor(systemResources.memPercent) }"></div>
                            </div>
                        </div>
                        <div class="resource-item">
                            <div class="flex justify-between text-sm mb-1">
                                <span class="text-muted">{{ t('dashboard.disk') }}</span>
                                <span class="font-mono font-medium">{{ formatBytes(systemResources.diskUsed) }}</span>
                            </div>
                            <div class="h-2 bg-surface rounded-full overflow-hidden">
                                <div class="h-full rounded-full transition-all duration-500" 
                                     :style="{ width: `${systemResources.diskPercent}%`, backgroundColor: getProgressColor(systemResources.diskPercent) }"></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- History Chart -->
                    <div v-if="systemResourcesHistory.length > 1" class="h-[150px] mt-4 pt-4 border-t border-border/50">
                        <SystemResourcesHistoryChart :history="systemResourcesHistory" />
                    </div>
                </div>
                <div v-else class="p-6">
                    <el-skeleton :rows="3" animated />
                </div>
            </div>
        </div>

        <!-- Bottom Row: Health & Storage -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
             <!-- Asset Health -->
            <div class="content-card">
                 <div class="card-header border-b border-border/50 bg-surface/30">
                    <div class="flex items-center gap-3">
                         <div class="p-2 rounded-md bg-red-500/10 text-red-500">
                            <i class="fas fa-heartbeat"></i>
                        </div>
                        <h3 class="font-semibold text-lg">{{ t('dashboard.assetHealth') }}</h3>
                    </div>
                    <div v-if="assetHealth" class="flex gap-2">
                        <span class="px-2 py-0.5 rounded text-xs bg-green-500/10 text-green-500 border border-green-500/20">{{ t('dashboard.healthy') }}: {{ assetHealth.healthy }}</span>
                        <span class="px-2 py-0.5 rounded text-xs bg-red-500/10 text-red-500 border border-red-500/20">{{ t('dashboard.unreachable') }}: {{ assetHealth.unreachable }}</span>
                    </div>
                </div>
                <div v-if="assetHealth" class="p-0">
                    <div class="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
                         <div v-for="asset in assetHealth.assets" :key="asset.id" 
                              class="flex items-center justify-between p-3 mb-1 rounded-lg hover:bg-surface/50 transition-colors">
                            <div class="flex items-center gap-3">
                                <div class="w-2 h-2 rounded-full" :class="asset.status === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'"></div>
                                <span class="font-medium">{{ asset.name }}</span>
                            </div>
                            <span v-if="asset.latency" class="text-xs font-mono text-muted">{{ asset.latency }}ms</span>
                         </div>
                    </div>
                </div>
                 <div v-else class="p-6">
                    <el-skeleton :rows="4" animated />
                </div>
            </div>

            <!-- Recent Connections -->
            <div class="content-card">
                 <div class="card-header border-b border-border/50 bg-surface/30">
                    <div class="flex justify-between items-center w-full">
                        <div class="flex items-center gap-3">
                            <div class="p-2 rounded-md bg-green-500/10 text-green-500">
                                <i class="fas fa-network-wired"></i>
                            </div>
                            <h3 class="font-semibold text-lg">{{ t('dashboard.recentConnections') }}</h3>
                        </div>
                        <el-button type="primary" link @click="openAddConnectionForm" class="!text-primary hover:!text-primary/80">
                            <i class="fas fa-plus mr-1"></i> {{ t('dashboard.addConnection') }}
                        </el-button>
                    </div>
                </div>
                <div v-if="recentConnections.length > 0" class="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
                     <div v-for="conn in recentConnections" :key="conn.id"
                          class="group flex items-center justify-between p-3 mb-1 rounded-lg hover:bg-surface/50 border border-transparent hover:border-border/50 transition-all">
                        <div class="flex items-center gap-4">
                            <div class="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-muted group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                                <i class="fas" :class="conn.type === 'SSH' ? 'fa-terminal' : conn.type === 'RDP' ? 'fa-desktop' : 'fa-network-wired'"></i>
                            </div>
                            <div>
                                <div class="font-medium text-foreground">{{ conn.name || conn.host }}</div>
                                <div class="text-xs text-muted font-mono">{{ conn.username }}@{{ conn.host }}:{{ conn.port }}</div>
                            </div>
                        </div>
                        <span class="px-2 py-1 rounded text-xs font-medium bg-surface border border-border" :class="conn.type === 'SSH' ? 'text-orange-400' : 'text-blue-400'">{{ conn.type }}</span>
                     </div>
                </div>
                <div v-else class="p-8 text-center text-muted">
                    {{ t('dashboard.noConnections') }}
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
.bg-background { background-color: var(--app-bg-color); }
.text-foreground { color: var(--text-color); }
.text-muted { color: var(--text-color-secondary); }
.bg-surface { background-color: var(--header-bg-color); }
.border-border { border-color: var(--border-color); }

.stat-card {
    background: var(--card-bg, rgba(255, 255, 255, 0.03));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--card-border, var(--border-color));
    border-radius: 1.25rem;
    padding: 1.5rem;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    position: relative;
    overflow: hidden;
}

.stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    opacity: 0;
    transition: opacity 0.3s;
}

.stat-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.25);
    border-color: var(--link-active-color);
    background: var(--card-hover-bg, rgba(255, 255, 255, 0.05));
}

.stat-card:hover::before {
    opacity: 1;
}

.content-card {
    background: var(--card-bg, rgba(255, 255, 255, 0.03));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--card-border, var(--border-color));
    border-radius: 1.25rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
    transition: border-color 0.3s ease;
}

.content-card:hover {
    border-color: rgba(var(--input-focus-glow-rgb, 14, 165, 233), 0.3);
}

.card-header {
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.01);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.animate-fade-in {
    animation: fadeIn 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
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
:deep(.dark) .stat-card,
:deep(.dark) .content-card {
    --card-bg: rgba(30, 41, 59, 0.5);
    --card-border: rgba(255, 255, 255, 0.08);
}

:deep(.dark) .stat-card:hover {
    --card-hover-bg: rgba(30, 41, 59, 0.7);
}
</style>
