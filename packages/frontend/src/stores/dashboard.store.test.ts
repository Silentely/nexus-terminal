/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useDashboardStore } from './dashboard.store';
import type {
  DashboardStats,
  AssetHealth,
  TimelineEvent,
  StorageStats,
  SystemResources,
} from './dashboard.store';
import apiClient from '../utils/apiClient';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

// Mock 依赖
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((_err: unknown, fallback: string) => fallback),
}));

describe('dashboard.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // ---- Mock 数据 ----

  const mockStats: DashboardStats = {
    sessions: {
      active: 5,
      todayConnections: 12,
      avgDuration: 3600,
      durationDistribution: { '<1m': 3, '1-30m': 5, '>30m': 4 },
    },
    security: {
      loginFailures: 2,
      commandBlocks: 1,
      alerts: 0,
    },
    timestamp: 1700000000,
  };

  const mockStatsWithRange: DashboardStats = {
    ...mockStats,
    range: { start: 1699900000, end: 1700000000 },
  };

  const mockAssetHealth: AssetHealth = {
    total: 3,
    healthy: 2,
    unreachable: 1,
    assets: [
      {
        id: 1,
        name: '服务器A',
        host: '192.168.1.1',
        port: 22,
        status: 'online',
        latency: 15,
        lastCheck: 1700000000,
      },
      {
        id: 2,
        name: '服务器B',
        host: '192.168.1.2',
        port: 22,
        status: 'online',
        latency: 30,
        lastCheck: 1700000000,
      },
      {
        id: 3,
        name: '服务器C',
        host: '192.168.1.3',
        port: 22,
        status: 'offline',
        lastCheck: 1700000000,
      },
    ],
  };

  const mockTimeline: TimelineEvent[] = [
    {
      id: 1,
      timestamp: 1700000000,
      actionType: 'connection_connected',
      actionLabel: '连接成功',
      details: '连接到服务器A',
    },
    { id: 2, timestamp: 1700000060, actionType: 'auth_login_success', actionLabel: '登录成功' },
    {
      id: 3,
      timestamp: 1700000120,
      actionType: 'command_executed',
      actionLabel: '执行命令',
      details: 'ls -la',
    },
  ];

  const mockStorage: StorageStats = {
    recordingsSize: 1024 * 1024 * 500,
    databaseSize: 1024 * 1024 * 200,
    uploadsSize: 1024 * 1024 * 300,
    totalSize: 1024 * 1024 * 1000,
    formatted: {
      recordings: '500.0 MB',
      database: '200.0 MB',
      uploads: '300.0 MB',
      total: '1000.0 MB',
    },
  };

  const mockSystemResources: SystemResources = {
    cpuPercent: 45.5,
    memPercent: 68.2,
    memUsed: 1024 * 1024 * 1024 * 5,
    memTotal: 1024 * 1024 * 1024 * 8,
    diskPercent: 55.0,
    diskUsed: 1024 * 1024 * 1024 * 100,
    diskTotal: 1024 * 1024 * 1024 * 200,
    loadAvg: [1.5, 2.0, 1.8],
    timestamp: 1700000000,
    formatted: {
      memUsed: '5.0 GB',
      memTotal: '8.0 GB',
      diskUsed: '100.0 GB',
      diskTotal: '200.0 GB',
    },
  };

  // ---- 初始状态测试 ----

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useDashboardStore();

      expect(store.stats).toBeNull();
      expect(store.assetHealth).toBeNull();
      expect(store.timeline).toEqual([]);
      expect(store.storage).toBeNull();
      expect(store.systemResources).toBeNull();
      expect(store.systemResourcesHistory).toEqual([]);
      expect(store.timeRange).toBeNull();
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.lastUpdate).toBeNull();
    });
  });

  // ---- setTimeRange 测试 ----

  describe('setTimeRange', () => {
    it('应设置时间范围', () => {
      const store = useDashboardStore();
      const range = { start: 1699900000, end: 1700000000 };

      store.setTimeRange(range);

      expect(store.timeRange).toEqual(range);
    });

    it('应清除时间范围（设为 null）', () => {
      const store = useDashboardStore();
      store.setTimeRange({ start: 1699900000, end: 1700000000 });

      store.setTimeRange(null);

      expect(store.timeRange).toBeNull();
    });
  });

  // ---- fetchStats 测试 ----

  describe('fetchStats', () => {
    it('应成功获取统计数据', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStats });

      await store.fetchStats();

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/stats');
      expect(store.stats).toEqual(mockStats);
      expect(store.lastUpdate).toBeTypeOf('number');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('应使用传入的时间范围参数', async () => {
      const store = useDashboardStore();
      const range = { start: 1699900000, end: 1700000000 };
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStatsWithRange });

      await store.fetchStats(range);

      expect(apiClient.get).toHaveBeenCalledWith(
        '/dashboard/stats?start=1699900000&end=1700000000',
      );
      expect(store.stats).toEqual(mockStatsWithRange);
    });

    it('应使用 store 中已设置的时间范围（无传入参数时）', async () => {
      const store = useDashboardStore();
      const range = { start: 1699900000, end: 1700000000 };
      store.setTimeRange(range);
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStatsWithRange });

      await store.fetchStats();

      expect(apiClient.get).toHaveBeenCalledWith(
        '/dashboard/stats?start=1699900000&end=1700000000',
      );
    });

    it('应优先使用传入的时间范围而非 store 中的', async () => {
      const store = useDashboardStore();
      store.setTimeRange({ start: 100, end: 200 });
      const overrideRange = { start: 300, end: 400 };
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStats });

      await store.fetchStats(overrideRange);

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/stats?start=300&end=400');
    });

    it('传入 null 时应回退到 store 中的时间范围', async () => {
      const store = useDashboardStore();
      store.setTimeRange({ start: 100, end: 200 });
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStats });

      await store.fetchStats(null);

      // null ?? storeTimeRange → storeTimeRange（nullish coalescing 行为）
      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/stats?start=100&end=200');
    });

    it('获取失败时应设置错误信息', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络错误'));

      await store.fetchStats();

      expect(store.error).toBe('获取仪表盘统计失败');
      expect(store.stats).toBeNull();
      expect(store.isLoading).toBe(false);
    });

    it('请求期间应设置 isLoading 为 true', async () => {
      const store = useDashboardStore();
      let resolveRequest: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolveRequest = resolve;
      });
      vi.mocked(apiClient.get).mockReturnValueOnce(pendingPromise as any);

      const fetchPromise = store.fetchStats();

      // 请求进行中，isLoading 应为 true
      expect(store.isLoading).toBe(true);
      expect(store.error).toBeNull();

      resolveRequest!({ data: mockStats });
      await fetchPromise;

      expect(store.isLoading).toBe(false);
    });
  });

  // ---- fetchAssetHealth 测试 ----

  describe('fetchAssetHealth', () => {
    it('应成功获取资产健康状态', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockAssetHealth });

      await store.fetchAssetHealth();

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/assets');
      expect(store.assetHealth).toEqual(mockAssetHealth);
    });

    it('获取失败时应记录错误到控制台', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('连接超时'));

      await store.fetchAssetHealth();

      expect(mockLog.error).toHaveBeenCalledWith('获取资产健康状态失败:', expect.any(Error));
      expect(store.assetHealth).toBeNull();
    });
  });

  // ---- fetchTimeline 测试 ----

  describe('fetchTimeline', () => {
    it('应使用默认参数获取时间线', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { events: mockTimeline } });

      await store.fetchTimeline();

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/timeline?limit=20');
      expect(store.timeline).toEqual(mockTimeline);
    });

    it('应支持自定义 limit 参数', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { events: mockTimeline } });

      await store.fetchTimeline(50);

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/timeline?limit=50');
    });

    it('应限制 limit 最大值为 200', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { events: mockTimeline } });

      await store.fetchTimeline(500);

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/timeline?limit=200');
    });

    it('应使用传入的时间范围参数', async () => {
      const store = useDashboardStore();
      const range = { start: 1699900000, end: 1700000000 };
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { events: mockTimeline } });

      await store.fetchTimeline(20, range);

      expect(apiClient.get).toHaveBeenCalledWith(
        '/dashboard/timeline?limit=20&start=1699900000&end=1700000000',
      );
    });

    it('应使用 store 中已设置的时间范围（无传入参数时）', async () => {
      const store = useDashboardStore();
      store.setTimeRange({ start: 1699900000, end: 1700000000 });
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { events: mockTimeline } });

      await store.fetchTimeline();

      expect(apiClient.get).toHaveBeenCalledWith(
        '/dashboard/timeline?limit=20&start=1699900000&end=1700000000',
      );
    });

    it('传入 null 时间范围时应回退到 store 中的时间范围', async () => {
      const store = useDashboardStore();
      store.setTimeRange({ start: 100, end: 200 });
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { events: mockTimeline } });

      await store.fetchTimeline(20, null);

      // null ?? storeTimeRange → storeTimeRange（nullish coalescing 行为）
      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/timeline?limit=20&start=100&end=200');
    });

    it('获取失败时应记录错误到控制台', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('请求失败'));

      await store.fetchTimeline();

      expect(mockLog.error).toHaveBeenCalledWith('获取活动时间线失败:', expect.any(Error));
      expect(store.timeline).toEqual([]);
    });
  });

  // ---- fetchStorage 测试 ----

  describe('fetchStorage', () => {
    it('应成功获取存储统计', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStorage });

      await store.fetchStorage();

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/storage');
      expect(store.storage).toEqual(mockStorage);
    });

    it('获取失败时应记录错误到控制台', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('存储查询失败'));

      await store.fetchStorage();

      expect(mockLog.error).toHaveBeenCalledWith('获取存储统计失败:', expect.any(Error));
      expect(store.storage).toBeNull();
    });
  });

  // ---- fetchSystemResources 测试 ----

  describe('fetchSystemResources', () => {
    it('应成功获取系统资源并记录历史', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockSystemResources });

      await store.fetchSystemResources();

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard/system');
      expect(store.systemResources).toEqual(mockSystemResources);
      expect(store.systemResourcesHistory).toHaveLength(1);
      expect(store.systemResourcesHistory[0]).toEqual({
        timestamp: mockSystemResources.timestamp,
        cpuPercent: mockSystemResources.cpuPercent,
        memPercent: mockSystemResources.memPercent,
        diskPercent: mockSystemResources.diskPercent,
      });
    });

    it('应限制历史记录最多保留 60 条', async () => {
      const store = useDashboardStore();

      // 通过重复调用 fetchSystemResources 填充 59 条历史
      for (let i = 0; i < 59; i++) {
        vi.mocked(apiClient.get).mockResolvedValueOnce({
          data: { ...mockSystemResources, timestamp: 1700000000 + i },
        });
        await store.fetchSystemResources();
      }

      expect(store.systemResourcesHistory).toHaveLength(59);

      // 再请求一次，应追加到第 60 条
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockSystemResources });
      await store.fetchSystemResources();

      expect(store.systemResourcesHistory).toHaveLength(60);
      // 最新的一条应追加在末尾
      expect(store.systemResourcesHistory[59]).toEqual({
        timestamp: mockSystemResources.timestamp,
        cpuPercent: mockSystemResources.cpuPercent,
        memPercent: mockSystemResources.memPercent,
        diskPercent: mockSystemResources.diskPercent,
      });
    });

    it('历史记录超过 60 条时应截断旧数据', async () => {
      const store = useDashboardStore();

      // 通过重复调用 fetchSystemResources 填充 60 条历史
      for (let i = 0; i < 60; i++) {
        vi.mocked(apiClient.get).mockResolvedValueOnce({
          data: { ...mockSystemResources, timestamp: 1700000000 + i },
        });
        await store.fetchSystemResources();
      }

      const firstTimestamp = store.state.systemResourcesHistory[0].timestamp;

      // 再请求一次，应裁剪掉最早的一条
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockSystemResources });
      await store.fetchSystemResources();

      expect(store.systemResourcesHistory).toHaveLength(60);
      // 第一条旧记录应被移除
      expect(store.systemResourcesHistory[0].timestamp).not.toBe(firstTimestamp);
    });

    it('获取失败时应记录错误到控制台', async () => {
      const store = useDashboardStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('系统资源获取失败'));

      await store.fetchSystemResources();

      expect(mockLog.error).toHaveBeenCalledWith('获取系统资源失败:', expect.any(Error));
      expect(store.systemResources).toBeNull();
      expect(store.systemResourcesHistory).toEqual([]);
    });
  });

  // ---- fetchAllData 测试 ----

  describe('fetchAllData', () => {
    it('应并行请求所有数据接口', async () => {
      const store = useDashboardStore();

      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: mockStats }) // fetchStats
        .mockResolvedValueOnce({ data: mockAssetHealth }) // fetchAssetHealth
        .mockResolvedValueOnce({ data: { events: mockTimeline } }) // fetchTimeline
        .mockResolvedValueOnce({ data: mockStorage }) // fetchStorage
        .mockResolvedValueOnce({ data: mockSystemResources }); // fetchSystemResources

      await store.fetchAllData();

      expect(apiClient.get).toHaveBeenCalledTimes(5);
      expect(store.stats).toEqual(mockStats);
      expect(store.assetHealth).toEqual(mockAssetHealth);
      expect(store.timeline).toEqual(mockTimeline);
      expect(store.storage).toEqual(mockStorage);
      expect(store.systemResources).toEqual(mockSystemResources);
      expect(store.isLoading).toBe(false);
    });

    it('应支持传入时间范围参数', async () => {
      const store = useDashboardStore();
      const range = { start: 1699900000, end: 1700000000 };

      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: mockStatsWithRange })
        .mockResolvedValueOnce({ data: mockAssetHealth })
        .mockResolvedValueOnce({ data: { events: mockTimeline } })
        .mockResolvedValueOnce({ data: mockStorage })
        .mockResolvedValueOnce({ data: mockSystemResources });

      await store.fetchAllData(range);

      // fetchStats 和 fetchTimeline 应使用时间范围
      expect(apiClient.get).toHaveBeenCalledWith(
        '/dashboard/stats?start=1699900000&end=1700000000',
      );
      expect(apiClient.get).toHaveBeenCalledWith(
        '/dashboard/timeline?limit=20&start=1699900000&end=1700000000',
      );
    });

    it('请求期间 isLoading 应为 true', async () => {
      const store = useDashboardStore();
      let resolveAll: () => void;
      const pendingPromise = new Promise<void>((resolve) => {
        resolveAll = resolve;
      });

      // 让所有请求都返回同一个 pending promise
      vi.mocked(apiClient.get).mockReturnValue(pendingPromise as any);

      const fetchPromise = store.fetchAllData();

      expect(store.isLoading).toBe(true);

      resolveAll!();
      await fetchPromise;

      expect(store.isLoading).toBe(false);
    });

    it('部分请求失败时应不影响其他数据的获取', async () => {
      const store = useDashboardStore();

      vi.mocked(apiClient.get)
        .mockRejectedValueOnce(new Error('stats 失败')) // fetchStats 失败
        .mockResolvedValueOnce({ data: mockAssetHealth }) // fetchAssetHealth 成功
        .mockResolvedValueOnce({ data: { events: mockTimeline } }) // fetchTimeline 成功
        .mockResolvedValueOnce({ data: mockStorage }) // fetchStorage 成功
        .mockResolvedValueOnce({ data: mockSystemResources }); // fetchSystemResources 成功

      await store.fetchAllData();

      expect(store.error).toBe('获取仪表盘统计失败');
      expect(store.assetHealth).toEqual(mockAssetHealth);
      expect(store.timeline).toEqual(mockTimeline);
      expect(store.storage).toEqual(mockStorage);
      expect(store.systemResources).toEqual(mockSystemResources);
    });
  });

  // ---- formatBytes 测试 ----

  describe('formatBytes', () => {
    it('应正确格式化字节数（B）', () => {
      const store = useDashboardStore();
      expect(store.formatBytes(512)).toBe('512 B');
      expect(store.formatBytes(0)).toBe('0 B');
      expect(store.formatBytes(1023)).toBe('1023 B');
    });

    it('应正确格式化千字节（KB）', () => {
      const store = useDashboardStore();
      expect(store.formatBytes(1024)).toBe('1.0 KB');
      expect(store.formatBytes(1024 * 50)).toBe('50.0 KB');
      expect(store.formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    });

    it('应正确格式化兆字节（MB）', () => {
      const store = useDashboardStore();
      expect(store.formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(store.formatBytes(1024 * 1024 * 500)).toBe('500.0 MB');
    });

    it('应正确格式化千兆字节（GB）', () => {
      const store = useDashboardStore();
      expect(store.formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(store.formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
    });
  });

  // ---- getActionIcon 测试 ----

  describe('getActionIcon', () => {
    it('应返回已知动作类型对应的图标', () => {
      const store = useDashboardStore();
      expect(store.getActionIcon('connection_connected')).toBe('fa-plug');
      expect(store.getActionIcon('connection_disconnected')).toBe('fa-unlink');
      expect(store.getActionIcon('session_suspended')).toBe('fa-pause-circle');
      expect(store.getActionIcon('auth_login_success')).toBe('fa-check-circle');
      expect(store.getActionIcon('auth_login_failed')).toBe('fa-exclamation-circle');
      expect(store.getActionIcon('command_executed')).toBe('fa-terminal');
      expect(store.getActionIcon('command_blocked')).toBe('fa-ban');
      expect(store.getActionIcon('file_upload')).toBe('fa-upload');
      expect(store.getActionIcon('file_download')).toBe('fa-download');
      expect(store.getActionIcon('alert_security')).toBe('fa-shield-alt');
      expect(store.getActionIcon('alert_error')).toBe('fa-exclamation-triangle');
    });

    it('应为未知动作类型返回默认图标', () => {
      const store = useDashboardStore();
      expect(store.getActionIcon('unknown_action')).toBe('fa-circle');
      expect(store.getActionIcon('')).toBe('fa-circle');
    });
  });

  // ---- computed getters 测试 ----

  describe('computed getters', () => {
    it('stats getter 应响应 state.stats 的变化', async () => {
      const store = useDashboardStore();
      expect(store.stats).toBeNull();

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStats });
      await store.fetchStats();

      expect(store.stats).toEqual(mockStats);
    });

    it('isLoading getter 应正确反映加载状态', async () => {
      const store = useDashboardStore();
      expect(store.isLoading).toBe(false);

      let resolveRequest: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolveRequest = resolve;
      });
      vi.mocked(apiClient.get).mockReturnValueOnce(pendingPromise as any);

      const fetchPromise = store.fetchStats();
      expect(store.isLoading).toBe(true);

      resolveRequest!({ data: mockStats });
      await fetchPromise;
      expect(store.isLoading).toBe(false);
    });

    it('error getter 应正确反映错误状态', async () => {
      const store = useDashboardStore();
      expect(store.error).toBeNull();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('失败'));
      await store.fetchStats();

      expect(store.error).toBe('获取仪表盘统计失败');
    });

    it('assetHealth getter 应响应数据变化', async () => {
      const store = useDashboardStore();
      expect(store.assetHealth).toBeNull();

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockAssetHealth });
      await store.fetchAssetHealth();

      expect(store.assetHealth).toEqual(mockAssetHealth);
    });

    it('timeline getter 应响应数据变化', async () => {
      const store = useDashboardStore();
      expect(store.timeline).toEqual([]);

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { events: mockTimeline } });
      await store.fetchTimeline();

      expect(store.timeline).toEqual(mockTimeline);
    });

    it('storage getter 应响应数据变化', async () => {
      const store = useDashboardStore();
      expect(store.storage).toBeNull();

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStorage });
      await store.fetchStorage();

      expect(store.storage).toEqual(mockStorage);
    });

    it('systemResources getter 应响应数据变化', async () => {
      const store = useDashboardStore();
      expect(store.systemResources).toBeNull();

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockSystemResources });
      await store.fetchSystemResources();

      expect(store.systemResources).toEqual(mockSystemResources);
    });

    it('systemResourcesHistory getter 应正确返回历史数据', async () => {
      const store = useDashboardStore();
      expect(store.systemResourcesHistory).toEqual([]);

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockSystemResources });
      await store.fetchSystemResources();

      expect(store.systemResourcesHistory).toHaveLength(1);
    });

    it('timeRange getter 应响应 setTimeRange 调用', () => {
      const store = useDashboardStore();
      expect(store.timeRange).toBeNull();

      const range = { start: 100, end: 200 };
      store.setTimeRange(range);

      expect(store.timeRange).toEqual(range);
    });

    it('lastUpdate getter 应在 fetchStats 后更新', async () => {
      const store = useDashboardStore();
      expect(store.lastUpdate).toBeNull();

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockStats });
      await store.fetchStats();

      expect(store.lastUpdate).toBeTypeOf('number');
      expect(store.lastUpdate!).toBeGreaterThan(0);
    });
  });
});
