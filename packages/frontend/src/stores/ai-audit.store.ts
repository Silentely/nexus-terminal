/**
 * AI 审计分析 Store
 * 管理审计报告、异常检测和统计
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import type {
  AuditReport,
  AuditAnomaly,
  AnomalyStats,
  ReportType,
  GetReportsResponse,
  GetAnomaliesResponse,
} from '../types/ai-audit.types';

export const useAiAuditStore = defineStore('aiAudit', () => {
  // === State ===
  const reports = ref<AuditReport[]>([]);
  const currentReport = ref<AuditReport | null>(null);
  const anomalies = ref<AuditAnomaly[]>([]);
  const anomalyStats = ref<AnomalyStats | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const totalReports = ref(0);
  const totalAnomalies = ref(0);

  // === Getters ===
  const recentReports = computed(() => reports.value.slice(0, 10));
  const criticalAnomalies = computed(() =>
    anomalies.value.filter((a) => a.severity === 'critical' || a.severity === 'high'),
  );
  const unacknowledgedAnomalies = computed(() => anomalies.value.filter((a) => !a.acknowledged));

  // === Actions ===

  /**
   * 创建审计报告
   */
  async function createReport(
    reportType: ReportType,
    timeRangeStart: number,
    timeRangeEnd: number,
  ): Promise<boolean> {
    isLoading.value = true;
    error.value = null;

    try {
      await apiClient.post('/ai-audit/reports', {
        reportType,
        timeRangeStart,
        timeRangeEnd,
      });
      return true;
    } catch (err) {
      error.value = extractErrorMessage(err, '请求失败');
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取报告列表
   */
  async function fetchReports(params?: {
    page?: number;
    pageSize?: number;
    reportType?: ReportType;
  }): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<GetReportsResponse>('/ai-audit/reports', {
        params,
      });
      reports.value = response.data.reports;
      totalReports.value = response.data.total;
    } catch (err) {
      error.value = extractErrorMessage(err, '请求失败');
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取报告详情
   */
  async function fetchReportById(reportId: number): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<AuditReport>(`/ai-audit/reports/${reportId}`);
      currentReport.value = response.data;
    } catch (err) {
      error.value = extractErrorMessage(err, '请求失败');
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取异常列表
   */
  async function fetchAnomalies(params?: {
    page?: number;
    pageSize?: number;
    severity?: string;
    acknowledged?: boolean;
  }): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<GetAnomaliesResponse>('/ai-audit/anomalies', { params });
      anomalies.value = response.data.anomalies;
      totalAnomalies.value = response.data.total;
    } catch (err) {
      error.value = extractErrorMessage(err, '请求失败');
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取异常统计
   */
  async function fetchAnomalyStats(): Promise<void> {
    try {
      const response = await apiClient.get<AnomalyStats>('/ai-audit/anomalies/stats');
      anomalyStats.value = response.data;
    } catch (err) {
      error.value = extractErrorMessage(err, '请求失败');
    }
  }

  /**
   * 确认异常
   */
  async function acknowledgeAnomaly(anomalyId: number): Promise<boolean> {
    try {
      await apiClient.patch(`/ai-audit/anomalies/${anomalyId}/acknowledge`);
      // 更新本地状态
      const anomaly = anomalies.value.find((a) => a.id === anomalyId);
      if (anomaly) {
        anomaly.acknowledged = true;
      }
      return true;
    } catch (err) {
      error.value = extractErrorMessage(err, '请求失败');
      return false;
    }
  }

  /**
   * 清空状态
   */
  function clearState() {
    reports.value = [];
    currentReport.value = null;
    anomalies.value = [];
    anomalyStats.value = null;
    totalReports.value = 0;
    totalAnomalies.value = 0;
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    reports,
    currentReport,
    anomalies,
    anomalyStats,
    isLoading,
    error,
    totalReports,
    totalAnomalies,
    // Getters
    recentReports,
    criticalAnomalies,
    unacknowledgedAnomalies,
    // Actions
    createReport,
    fetchReports,
    fetchReportById,
    fetchAnomalies,
    fetchAnomalyStats,
    acknowledgeAnomaly,
    clearState,
  };
});
