<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { formatDistanceToNow } from 'date-fns';
import { zhCN, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useDashboardStore } from '../stores/dashboard.store';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import { useAuditLogStore } from '../stores/audit.store';

defineOptions({
    name: 'EnhancedDashboard'
});

const { t, locale } = useI18n();
const dashboardStore = useDashboardStore();
const connectionsStore = useConnectionsStore();
const auditLogStore = useAuditLogStore();

const { stats, assetHealth, timeline, storage, systemResources, isLoading } = storeToRefs(dashboardStore);
const { connections } = storeToRefs(connectionsStore);

// State
const showAddEditConnectionForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const autoRefresh = ref(true);
const refreshInterval = ref(30000);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

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

// 直接使用后端返回的 actionLabel，不再通过 i18n 拼装
const getActionIcon = (actionType: string): string => dashboardStore.getActionIcon(actionType);

const handleRefresh = () => {
    dashboardStore.fetchAllData();
};

const startAutoRefresh = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (autoRefresh.value) {
        refreshTimer = setInterval(() => {
            dashboardStore.fetchAllData();
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
    await Promise.all([
        dashboardStore.fetchAllData(),
        connectionsStore.fetchConnections(),
        auditLogStore.fetchLogs({ page: 1, limit: 10, sortOrder: 'desc', isDashboardRequest: true })
    ]);
    startAutoRefresh();
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
    showAddEditConnectionForm.value = false;
    connectionToEdit.value = null;
    await connectionsStore.fetchConnections();
};

// Helper functions
const getPercentage = (value: number, total: number): number => {
    if (!total || total === 0) return 0;
    return Math.round((value / total) * 100);
};

const getProgressColor = (percent: number): string => {
    if (percent < 50) return '#67c23a';
    if (percent < 80) return '#e6a23c';
    return '#f56c6c';
};
</script>

<template>
    <div class="dashboard p-6">
        <!-- Header -->
        <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold">{{ t('dashboard.title') }}</h1>
            <div class="flex items-center gap-4">
                <el-select v-model="refreshInterval" style="width: 120px">
                    <el-option :value="15000" :label="t('dashboard.intervals.15s')" />
                    <el-option :value="30000" :label="t('dashboard.intervals.30s')" />
                    <el-option :value="60000" :label="t('dashboard.intervals.1m')" />
                    <el-option :value="300000" :label="t('dashboard.intervals.5m')" />
                </el-select>
                <el-switch v-model="autoRefresh" :active-text="t('dashboard.autoRefresh')" />
                <el-button @click="handleRefresh" :loading="isLoading">
                    <i class="fas fa-sync-alt mr-1"></i>
                    {{ t('dashboard.refresh') }}
                </el-button>
            </div>
        </div>

        <!-- Session & Security Stats -->
        <el-row :gutter="20" class="mb-6">
            <el-col :span="6">
                <el-card shadow="hover" class="stat-card">
                    <el-statistic
                        :title="t('dashboard.stats.activeSessions')"
                        :value="stats?.sessions?.active || 0"
                    >
                        <template #prefix>
                            <i class="fas fa-terminal text-primary"></i>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card shadow="hover" class="stat-card">
                    <el-statistic
                        :title="t('dashboard.stats.todayConnections')"
                        :value="stats?.sessions?.todayConnections || 0"
                    >
                        <template #prefix>
                            <i class="fas fa-plug text-success"></i>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card shadow="hover" class="stat-card">
                    <el-statistic
                        :title="t('dashboard.stats.loginFailures')"
                        :value="stats?.security?.loginFailures || 0"
                    >
                        <template #prefix>
                            <i class="fas fa-exclamation-circle text-danger"></i>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
            <el-col :span="6">
                <el-card shadow="hover" class="stat-card">
                    <el-statistic
                        :title="t('dashboard.stats.alerts')"
                        :value="stats?.security?.alerts || 0"
                    >
                        <template #prefix>
                            <i class="fas fa-bell text-warning"></i>
                        </template>
                    </el-statistic>
                </el-card>
            </el-col>
        </el-row>

        <!-- Session Duration & System Resources -->
        <el-row :gutter="20" class="mb-6">
            <el-col :span="12">
                <el-card shadow="hover">
                    <template #header>
                        <span>{{ t('dashboard.stats.sessionDuration') }}</span>
                    </template>
                    <div v-if="stats?.sessions?.durationDistribution" class="duration-distribution">
                        <div class="distribution-item">
                            <span class="label">&lt; 5min</span>
                            <el-progress
                                :percentage="getPercentage(stats.sessions.durationDistribution.lt5min, stats.sessions.todayConnections)"
                                :stroke-width="8"
                            />
                            <span class="value">{{ stats.sessions.durationDistribution.lt5min }}</span>
                        </div>
                        <div class="distribution-item">
                            <span class="label">5-30min</span>
                            <el-progress
                                :percentage="getPercentage(stats.sessions.durationDistribution['5min-30min'], stats.sessions.todayConnections)"
                                :stroke-width="8"
                            />
                            <span class="value">{{ stats.sessions.durationDistribution['5min-30min'] || 0 }}</span>
                        </div>
                        <div class="distribution-item">
                            <span class="label">30min-1hr</span>
                            <el-progress
                                :percentage="getPercentage(stats.sessions.durationDistribution['30min-1hr'], stats.sessions.todayConnections)"
                                :stroke-width="8"
                            />
                            <span class="value">{{ stats.sessions.durationDistribution['30min-1hr'] || 0 }}</span>
                        </div>
                        <div class="distribution-item">
                            <span class="label">&gt; 1hr</span>
                            <el-progress
                                :percentage="getPercentage(stats.sessions.durationDistribution.gt1hr, stats.sessions.todayConnections)"
                                :stroke-width="8"
                            />
                            <span class="value">{{ stats.sessions.durationDistribution.gt1hr }}</span>
                        </div>
                    </div>
                    <el-skeleton v-else :rows="3" />
                </el-card>
            </el-col>
            <el-col :span="12">
                <el-card shadow="hover">
                    <template #header>
                        <span>{{ t('dashboard.stats.systemResources') }}</span>
                    </template>
                    <div v-if="systemResources" class="system-resources">
                        <div class="resource-item">
                            <span class="label">CPU</span>
                            <el-progress
                                :percentage="systemResources.cpuPercent"
                                :stroke-width="10"
                                :color="getProgressColor(systemResources.cpuPercent)"
                            />
                            <span class="value">{{ systemResources.cpuPercent }}%</span>
                        </div>
                        <div class="resource-item">
                            <span class="label">{{ t('dashboard.memory') }}</span>
                            <el-progress
                                :percentage="systemResources.memPercent"
                                :stroke-width="10"
                                :color="getProgressColor(systemResources.memPercent)"
                            />
                            <span class="value">{{ formatBytes(systemResources.memUsed) }}</span>
                        </div>
                        <div class="resource-item">
                            <span class="label">{{ t('dashboard.disk') }}</span>
                            <el-progress
                                :percentage="systemResources.diskPercent"
                                :stroke-width="10"
                                :color="getProgressColor(systemResources.diskPercent)"
                            />
                            <span class="value">{{ formatBytes(systemResources.diskUsed) }}</span>
                        </div>
                    </div>
                    <el-skeleton v-else :rows="3" />
                </el-card>
            </el-col>
        </el-row>

        <!-- Asset Health & Storage -->
        <el-row :gutter="20" class="mb-6">
            <el-col :span="12">
                <el-card shadow="hover">
                    <template #header>
                        <span>{{ t('dashboard.assetHealth') }}</span>
                    </template>
                    <div v-if="assetHealth" class="asset-health">
                        <div class="health-summary mb-4">
                            <el-tag type="success" size="large">
                                {{ t('dashboard.healthy') }}: {{ assetHealth.healthy }}
                            </el-tag>
                            <el-tag type="danger" size="large">
                                {{ t('dashboard.unreachable') }}: {{ assetHealth.unreachable }}
                            </el-tag>
                            <el-tag type="info" size="large">
                                {{ t('dashboard.total') }}: {{ assetHealth.total }}
                            </el-tag>
                        </div>
                        <div class="asset-list" style="max-height: 200px; overflow-y: auto;">
                            <div
                                v-for="asset in assetHealth.assets.slice(0, 10)"
                                :key="asset.id"
                                class="asset-item flex justify-between items-center py-2"
                            >
                                <span>{{ asset.name }}</span>
                                <el-tag :type="getAssetStatusType(asset.status)" size="small">
                                    {{ asset.status }}
                                    <span v-if="asset.latency">({{ asset.latency }}ms)</span>
                                </el-tag>
                            </div>
                        </div>
                    </div>
                    <el-skeleton v-else :rows="4" />
                </el-card>
            </el-col>
            <el-col :span="12">
                <el-card shadow="hover">
                    <template #header>
                        <span>{{ t('dashboard.storageStats') }}</span>
                    </template>
                    <div v-if="storage" class="storage-stats">
                        <div class="storage-item">
                            <span class="label">{{ t('dashboard.recordings') }}</span>
                            <span class="value">{{ storage.formatted.recordings }}</span>
                        </div>
                        <div class="storage-item">
                            <span class="label">{{ t('dashboard.database') }}</span>
                            <span class="value">{{ storage.formatted.database }}</span>
                        </div>
                        <div class="storage-item">
                            <span class="label">{{ t('dashboard.uploads') }}</span>
                            <span class="value">{{ storage.formatted.uploads }}</span>
                        </div>
                        <el-divider />
                        <div class="storage-item total">
                            <span class="label">{{ t('dashboard.total') }}</span>
                            <span class="value">{{ storage.formatted.total }}</span>
                        </div>
                    </div>
                    <el-skeleton v-else :rows="4" />
                </el-card>
            </el-col>
        </el-row>

        <!-- Activity Timeline & Recent Connections -->
        <el-row :gutter="20">
            <el-col :span="12">
                <el-card shadow="hover">
                    <template #header>
                        <span>{{ t('dashboard.activityTimeline') }}</span>
                    </template>
                    <el-timeline v-if="timeline.length > 0">
                        <el-timeline-item
                            v-for="event in timeline.slice(0, 10)"
                            :key="event.id"
                            :timestamp="formatRelativeTime(event.timestamp)"
                            placement="top"
                        >
                            <div class="timeline-content">
                                <i :class="['fas', getActionIcon(event.actionType), 'mr-2']"></i>
                                <span>{{ event.actionLabel }}</span>
                                <p v-if="event.details" class="text-muted text-sm mt-1">
                                    {{ event.details }}
                                </p>
                            </div>
                        </el-timeline-item>
                    </el-timeline>
                    <div v-else class="text-center text-muted">
                        {{ t('dashboard.noActivity') }}
                    </div>
                </el-card>
            </el-col>
            <el-col :span="12">
                <el-card shadow="hover">
                    <template #header>
                        <span>{{ t('dashboard.recentConnections') }}</span>
                    </template>
                    <div v-if="connections.length > 0" class="connection-list" style="max-height: 300px; overflow-y: auto;">
                        <div
                            v-for="conn in connections.slice(0, 10)"
                            :key="conn.id"
                            class="connection-item p-3 border-b border-gray-200 last:border-0"
                        >
                            <div class="flex justify-between items-center">
                                <div>
                                    <span class="font-medium">{{ conn.name || conn.host }}</span>
                                    <span class="text-muted text-sm ml-2">
                                        {{ conn.username }}@{{ conn.host }}:{{ conn.port }}
                                    </span>
                                </div>
                                <el-tag size="small">{{ conn.type }}</el-tag>
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-center text-muted">
                        {{ t('dashboard.noConnections') }}
                    </div>
                    <div class="mt-4 text-right">
                        <el-button type="primary" @click="openAddConnectionForm">
                            <i class="fas fa-plus mr-1"></i>
                            {{ t('dashboard.addConnection') }}
                        </el-button>
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
.dashboard {
    background-color: var(--el-bg-color-page);
    min-height: 100%;
}

.stat-card {
    height: 100%;
}

.duration-distribution .distribution-item,
.system-resources .resource-item,
.storage-item {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
}

.duration-distribution .distribution-item .label,
.system-resources .resource-item .label,
.storage-item .label {
    width: 80px;
    flex-shrink: 0;
}

.duration-distribution .distribution-item .value,
.system-resources .resource-item .value,
.storage-item .value {
    width: 80px;
    text-align: right;
    flex-shrink: 0;
}

.storage-item.total {
    font-weight: bold;
}

.health-summary {
    display: flex;
    gap: 12px;
}

.asset-item {
    border-bottom: 1px solid var(--el-border-color-lighter);
}

.asset-item:last-child {
    border-bottom: none;
}

.timeline-content {
    display: flex;
    align-items: center;
}

.mr-1 {
    margin-right: 4px;
}

.mr-2 {
    margin-right: 8px;
}

.mt-1 {
    margin-top: 4px;
}

.mt-4 {
    margin-top: 16px;
}

.mb-4 {
    margin-bottom: 16px;
}

.mb-6 {
    margin-bottom: 24px;
}

.text-primary {
    color: var(--el-color-primary);
}

.text-success {
    color: var(--el-color-success);
}

.text-danger {
    color: var(--el-color-danger);
}

.text-warning {
    color: var(--el-color-warning);
}

.text-muted {
    color: var(--el-text-color-secondary);
}

.text-sm {
    font-size: 12px;
}

.font-bold {
    font-weight: bold;
}

.font-medium {
    font-weight: 500;
}

.flex {
    display: flex;
}

.justify-between {
    justify-content: space-between;
}

.items-center {
    align-items: center;
}

.p-3 {
    padding: 12px;
}

.border-b {
    border-bottom: 1px solid var(--el-border-color);
}

.border-gray-200 {
    border-color: var(--el-border-color-lighter);
}

.last\:border-0:last-child {
    border-bottom: none;
}
</style>