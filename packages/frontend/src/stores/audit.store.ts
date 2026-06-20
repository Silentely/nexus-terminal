import { defineStore } from 'pinia';
import { ref } from 'vue';
import axios from 'axios';
import apiClient from '../utils/apiClient'; // 使用统一的 apiClient
import { AuditLogEntry, AuditLogApiResponse, AuditLogActionType } from '../types/server.types';
import { extractErrorMessage } from '../utils/errorExtractor';
import { log } from '@/utils/log';

export const useAuditLogStore = defineStore('auditLog', () => {
  const logs = ref<AuditLogEntry[]>([]);
  const totalLogs = ref(0);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const currentPage = ref(1);
  const logsPerPage = ref(50); // Default page size

  // fetchLogs 现在接受一个选项对象作为参数，并增加了缓存逻辑
  const fetchLogs = async (
    options: {
      page?: number;
      limit?: number;
      searchTerm?: string;
      actionType?: AuditLogActionType | '';
      sortOrder?: 'asc' | 'desc';
      // 新增一个标志，明确指示是否为仪表盘调用，以启用缓存
      isDashboardRequest?: boolean;
    } = {},
  ) => {
    const {
      page = 1,
      limit = logsPerPage.value,
      searchTerm,
      actionType,
      sortOrder,
      isDashboardRequest = false, // 默认为 false
    } = options;

    const cacheKey = 'dashboardAuditLogsCache';
    error.value = null; // 重置错误

    // --- 缓存逻辑 (仅当 isDashboardRequest 为 true 时触发) ---
    if (isDashboardRequest) {
      try {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          log.info('[AuditLogStore] Loading dashboard logs from cache.');
          // 仪表盘只关心日志列表，不关心 totalLogs 或 currentPage
          logs.value = JSON.parse(cachedData);
          isLoading.value = false; // 先显示缓存
        } else {
          isLoading.value = true; // 无缓存，初始加载
        }
      } catch (loadError: unknown) {
        log.error('[AuditLogStore] Failed to load or parse dashboard logs cache:', loadError);
        localStorage.removeItem(cacheKey);
        isLoading.value = true; // 缓存无效，需要加载
      }
    } else {
      // 非仪表盘请求（如完整日志页），总是显示加载状态
      isLoading.value = true;
      currentPage.value = page; // 更新分页状态
    }

    // --- API 请求逻辑 ---
    isLoading.value = true; // 标记正在获取（或后台获取）
    const offset = (page - 1) * limit;
    try {
      const params: Record<string, string | number> = {
        limit,
        offset,
        ...(searchTerm && { search: searchTerm }),
        ...(actionType && { action_type: actionType }),
        ...(sortOrder && { sort_order: sortOrder }),
      };

      log.info(
        `[AuditLogStore] Fetching logs from server (isDashboard: ${isDashboardRequest}). Params:`,
        params,
      );
      const response = await apiClient.get<AuditLogApiResponse>('/audit-logs', { params });
      const freshLogs = response.data.logs;
      const freshTotal = response.data.total;

      // --- 更新状态和缓存 ---
      if (isDashboardRequest) {
        const freshLogsString = JSON.stringify(freshLogs);
        const currentLogsString = JSON.stringify(logs.value);

        if (currentLogsString !== freshLogsString) {
          log.info('[AuditLogStore] Dashboard logs data changed, updating state and cache.');
          logs.value = freshLogs;
          localStorage.setItem(cacheKey, freshLogsString); // 更新缓存
        } else {
          log.info('[AuditLogStore] Dashboard logs data is up-to-date.');
        }
        // 仪表盘请求不更新 totalLogs 或 currentPage
      } else {
        // 非仪表盘请求，直接更新日志和总数
        log.info('[AuditLogStore] Updating logs for full view.');
        logs.value = freshLogs;
        totalLogs.value = freshTotal;
      }
      error.value = null; // 清除错误
    } catch (err: unknown) {
      const statusCode = axios.isAxiosError(err) ? err.response?.status : undefined;
      const isUpstreamUnavailable = statusCode === 502 || statusCode === 503 || statusCode === 504;
      if (isDashboardRequest && isUpstreamUnavailable) {
        log.warn(
          `[AuditLogStore] Dashboard logs fetch skipped due to upstream unavailable (${statusCode}), using cache if present.`,
        );
        error.value = null;
      } else {
        log.error('[AuditLogStore] Error fetching audit logs:', err);
        error.value = extractErrorMessage(err, '获取审计日志失败');
      }
      // 如果是仪表盘请求失败，保留缓存数据；否则清空
      if (!isDashboardRequest) {
        logs.value = [];
        totalLogs.value = 0;
      }
    } finally {
      isLoading.value = false; // 加载完成
    }
  };

  // Function to change page size and refetch (非仪表盘场景)
  const setLogsPerPage = (size: number) => {
    logsPerPage.value = size;
    fetchLogs({ page: 1 }); // 重置到第一页，使用默认 limit
  };

  return {
    logs,
    totalLogs,
    isLoading,
    error,
    currentPage,
    logsPerPage,
    fetchLogs,
    setLogsPerPage,
  };
});
