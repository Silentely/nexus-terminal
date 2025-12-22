import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';

export interface DashboardTimeRange {
    start: number; // unix seconds
    end: number; // unix seconds
}

export interface DashboardStats {
    sessions: {
        active: number;
        todayConnections: number;
        avgDuration: number; // seconds
        durationDistribution: Record<string, number>;
    };
    security: {
        loginFailures: number;
        commandBlocks: number;
        alerts: number;
    };
    range?: DashboardTimeRange;
    timestamp: number;
}

export interface AssetInfo {
    id: number;
    name: string;
    host: string;
    port: number;
    status: 'online' | 'offline' | 'unknown';
    latency?: number;
    lastCheck: number;
}

export interface AssetHealth {
    total: number;
    healthy: number;
    unreachable: number;
    assets: AssetInfo[];
}

export interface TimelineEvent {
    id: number;
    timestamp: number;
    actionType: string;
    actionLabel: string; // 后端返回的本地化标签
    details?: string;
}

export interface StorageStats {
    recordingsSize: number;
    databaseSize: number;
    uploadsSize: number;
    totalSize: number;
    formatted: {
        recordings: string;
        database: string;
        uploads: string;
        total: string;
    };
}

export interface SystemResources {
    cpuPercent: number;
    memPercent: number;
    memUsed: number;
    memTotal: number;
    diskPercent: number;
    diskUsed: number;
    diskTotal: number;
    loadAvg: number[];
    timestamp: number;
    formatted: {
        memUsed: string;
        memTotal: string;
        diskUsed: string;
        diskTotal: string;
    };
}

export interface SystemResourcesHistoryPoint {
    timestamp: number;
    cpuPercent: number;
    memPercent: number;
    diskPercent: number;
}

interface DashboardState {
    stats: DashboardStats | null;
    assetHealth: AssetHealth | null;
    timeline: TimelineEvent[];
    storage: StorageStats | null;
    systemResources: SystemResources | null;
    systemResourcesHistory: SystemResourcesHistoryPoint[];
    timeRange: DashboardTimeRange | null;
    isLoading: boolean;
    error: string | null;
    lastUpdate: number | null;
}

export const useDashboardStore = defineStore('dashboard', () => {
    const state = ref<DashboardState>({
        stats: null,
        assetHealth: null,
        timeline: [],
        storage: null,
        systemResources: null,
        systemResourcesHistory: [],
        timeRange: null,
        isLoading: false,
        error: null,
        lastUpdate: null
    });

    const setTimeRange = (range: DashboardTimeRange | null) => {
        state.value.timeRange = range;
    };

    const getEffectiveTimeRange = (range?: DashboardTimeRange | null): DashboardTimeRange | null => {
        return range ?? state.value.timeRange;
    };

    const fetchStats = async (range?: DashboardTimeRange | null) => {
        state.value.isLoading = true;
        state.value.error = null;

        try {
            const effectiveRange = getEffectiveTimeRange(range);
            const params = new URLSearchParams();
            if (effectiveRange) {
                params.set('start', String(effectiveRange.start));
                params.set('end', String(effectiveRange.end));
            }
            const suffix = params.toString() ? `?${params.toString()}` : '';
            const response = await apiClient.get<DashboardStats>(`/dashboard/stats${suffix}`);
            state.value.stats = response.data;
            state.value.lastUpdate = Date.now();
        } catch (err: any) {
            console.error('获取仪表盘统计失败:', err);
            state.value.error = err.response?.data?.message || '获取仪表盘统计失败';
        } finally {
            state.value.isLoading = false;
        }
    };

    const fetchAssetHealth = async () => {
        try {
            const response = await apiClient.get<AssetHealth>('/dashboard/assets');
            state.value.assetHealth = response.data;
        } catch (err: any) {
            console.error('获取资产健康状态失败:', err);
        }
    };

    const fetchTimeline = async (limit: number = 20, range?: DashboardTimeRange | null) => {
        try {
            const effectiveRange = getEffectiveTimeRange(range);
            const params = new URLSearchParams();
            params.set('limit', String(Math.min(limit, 200)));
            if (effectiveRange) {
                params.set('start', String(effectiveRange.start));
                params.set('end', String(effectiveRange.end));
            }
            const response = await apiClient.get<{ events: TimelineEvent[] }>(
                `/dashboard/timeline?${params.toString()}`
            );
            state.value.timeline = response.data.events;
        } catch (err: any) {
            console.error('获取活动时间线失败:', err);
        }
    };

    const fetchStorage = async () => {
        try {
            const response = await apiClient.get<StorageStats>('/dashboard/storage');
            state.value.storage = response.data;
        } catch (err: any) {
            console.error('获取存储统计失败:', err);
        }
    };

    const pushSystemResourcesHistory = (resources: SystemResources) => {
        const nextPoint: SystemResourcesHistoryPoint = {
            timestamp: resources.timestamp,
            cpuPercent: resources.cpuPercent,
            memPercent: resources.memPercent,
            diskPercent: resources.diskPercent,
        };
        const next = [...state.value.systemResourcesHistory, nextPoint].slice(-60);
        state.value.systemResourcesHistory = next;
    };

    const fetchSystemResources = async () => {
        try {
            const response = await apiClient.get<SystemResources>('/dashboard/system');
            state.value.systemResources = response.data;
            pushSystemResourcesHistory(response.data);
        } catch (err: any) {
            console.error('获取系统资源失败:', err);
        }
    };

    const fetchAllData = async (range?: DashboardTimeRange | null) => {
        state.value.isLoading = true;
        await Promise.all([
            fetchStats(range),
            fetchAssetHealth(),
            fetchTimeline(20, range),
            fetchStorage(),
            fetchSystemResources(),
        ]);
        state.value.isLoading = false;
    };

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const getActionIcon = (actionType: string): string => {
        const icons: Record<string, string> = {
            'connection_connected': 'fa-plug',
            'connection_disconnected': 'fa-unlink',
            'session_suspended': 'fa-pause-circle',
            'auth_login_success': 'fa-check-circle',
            'auth_login_failed': 'fa-exclamation-circle',
            'command_executed': 'fa-terminal',
            'command_blocked': 'fa-ban',
            'file_upload': 'fa-upload',
            'file_download': 'fa-download',
            'alert_security': 'fa-shield-alt',
            'alert_error': 'fa-exclamation-triangle'
        };
        return icons[actionType] || 'fa-circle';
    };

    return {
        state: readonly(state),
        stats: computed(() => state.value.stats),
        assetHealth: computed(() => state.value.assetHealth),
        timeline: computed(() => state.value.timeline),
        storage: computed(() => state.value.storage),
        systemResources: computed(() => state.value.systemResources),
        systemResourcesHistory: computed(() => state.value.systemResourcesHistory),
        timeRange: computed(() => state.value.timeRange),
        isLoading: computed(() => state.value.isLoading),
        error: computed(() => state.value.error),
        lastUpdate: computed(() => state.value.lastUpdate),
        setTimeRange,
        fetchStats,
        fetchAssetHealth,
        fetchTimeline,
        fetchStorage,
        fetchSystemResources,
        fetchAllData,
        formatBytes,
        getActionIcon
    };
});
