<template>
  <div class="p-4 md:p-6 min-h-full bg-background text-foreground animate-fade-in">
    <!-- Header -->
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-lg bg-primary/10 text-primary">
          <i class="fas fa-shield-alt text-xl !text-current"></i>
        </div>
        <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          {{ t('aiAudit.title', 'AI 安全审计') }}
        </h1>
      </div>
      <el-button
        type="primary"
        :loading="isCreating"
        :disabled="isCreating"
        @click="handleCreateReport"
        class="!bg-primary !border-primary hover:!bg-primary/90 !transition-colors !duration-300"
      >
        <template v-if="!isCreating" #icon>
          <i class="fas fa-plus"></i>
        </template>
        {{ t('aiAudit.createReport', '生成报告') }}
      </el-button>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
      <!-- 报告总数 -->
      <div class="stat-card group">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-sm font-medium text-muted mb-1">
              {{ t('aiAudit.totalReports', '报告总数') }}
            </p>
            <h3 class="text-3xl font-bold text-foreground font-mono">{{ totalReports }}</h3>
          </div>
          <div
            class="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-button-text transition-colors transition-transform duration-300 group-hover:scale-105"
          >
            <i class="fas fa-file-alt text-xl !text-current"></i>
          </div>
        </div>
      </div>

      <!-- 异常总数 -->
      <div class="stat-card group">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-sm font-medium text-muted mb-1">
              {{ t('aiAudit.totalAnomalies', '异常总数') }}
            </p>
            <h3 class="text-3xl font-bold text-foreground font-mono">{{ totalAnomalies }}</h3>
          </div>
          <div
            class="p-3 rounded-lg bg-warning/10 text-warning group-hover:bg-warning group-hover:text-warning-text transition-colors transition-transform duration-300 group-hover:scale-105"
          >
            <i class="fas fa-exclamation-triangle text-xl !text-current"></i>
          </div>
        </div>
      </div>

      <!-- 高危异常 -->
      <div class="stat-card group">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-sm font-medium text-muted mb-1">
              {{ t('aiAudit.criticalAnomalies', '高危异常') }}
            </p>
            <h3 class="text-3xl font-bold text-foreground font-mono">{{ criticalCount }}</h3>
          </div>
          <div
            class="p-3 rounded-lg bg-error/10 text-error group-hover:bg-error group-hover:text-error-text transition-colors transition-transform duration-300 group-hover:scale-105"
          >
            <i class="fas fa-radiation text-xl !text-current"></i>
          </div>
        </div>
      </div>

      <!-- 近24h异常 -->
      <div class="stat-card group">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-sm font-medium text-muted mb-1">
              {{ t('aiAudit.recentAnomalies', '近24h异常') }}
            </p>
            <h3 class="text-3xl font-bold text-foreground font-mono">{{ recentAnomalyCount }}</h3>
          </div>
          <div
            class="p-3 rounded-lg bg-info/10 text-info group-hover:bg-info group-hover:text-info-text transition-colors transition-transform duration-300 group-hover:scale-105"
          >
            <i class="fas fa-clock text-xl !text-current"></i>
          </div>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div
      v-if="auditStore.error"
      class="mb-6 p-4 border-l-4 border-error bg-error/10 text-error rounded-lg flex items-center gap-3"
    >
      <i class="fas fa-exclamation-circle"></i>
      <span>{{ auditStore.error }}</span>
    </div>

    <!-- Main Content Card -->
    <div class="content-card">
      <!-- Card Header with Tabs -->
      <div class="card-header border-b border-border/50 bg-surface/30">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-md bg-primary/10 text-primary">
            <i class="fas fa-clipboard-list"></i>
          </div>
          <h3 class="font-semibold text-lg">{{ t('aiAudit.analysisResults', '分析结果') }}</h3>
        </div>
        <div class="flex gap-1 bg-surface/50 p-1 rounded-lg border border-border/50">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            @click="activeTab = tab.key"
            :class="[
              'px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
              activeTab === tab.key
                ? 'bg-primary text-button-text shadow-sm'
                : 'text-muted hover:text-foreground hover:bg-surface',
            ]"
          >
            <i :class="['mr-2', tab.icon]"></i>
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- Content Area -->
      <div class="flex-grow overflow-y-auto p-4 sm:p-6 custom-scrollbar">
        <!-- Reports Tab -->
        <div v-if="activeTab === 'reports'">
          <!-- Loading State -->
          <div v-if="isLoading" class="space-y-4">
            <el-skeleton :rows="3" animated v-for="i in 3" :key="i" class="mb-4" />
          </div>

          <!-- Empty State -->
          <div
            v-else-if="reports.length === 0"
            class="flex flex-col items-center justify-center py-16 text-center"
          >
            <div class="p-4 rounded-full bg-surface mb-4 border border-border/50">
              <i class="fas fa-file-alt text-4xl text-muted"></i>
            </div>
            <p class="text-muted text-sm">{{ t('aiAudit.noReports', '暂无审计报告') }}</p>
            <p class="text-muted text-xs mt-1">
              {{ t('aiAudit.noReportsHint', '点击上方按钮生成第一份审计报告') }}
            </p>
          </div>

          <!-- Report List -->
          <div v-else class="space-y-3">
            <div
              v-for="report in reports"
              :key="report.id"
              class="group relative p-4 rounded-xl bg-surface/30 border border-border/50 hover:border-primary/30 hover:bg-surface/50 transition-all duration-200 cursor-pointer"
              @click="viewReport(report)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span :class="getReportTypeBadgeClass(report.report_type)">
                    {{ getReportTypeLabel(report.report_type) }}
                  </span>
                  <span class="text-sm text-muted font-mono">
                    {{ formatDate(report.created_at) }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <span :class="getStatusBadgeClass(getReportStatus(report))">
                    {{ getStatusStatusLabel(getReportStatus(report)) }}
                  </span>
                  <button
                    @click.stop="handleDeleteReport(report.id)"
                    class="text-text-secondary hover:text-error opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    :title="t('common.delete', '删除')"
                  >
                    <i class="fas fa-trash-alt text-xs"></i>
                  </button>
                  <i
                    class="fas fa-chevron-right text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                  ></i>
                </div>
              </div>
              <div class="mt-2 text-sm text-muted">
                {{ t('aiAudit.timeRange', '时间范围') }}:
                <span class="font-mono"
                  >{{ formatDate(report.time_range_start) }} -
                  {{ formatDate(report.time_range_end) }}</span
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Anomalies Tab -->
        <div v-if="activeTab === 'anomalies'">
          <!-- Loading State -->
          <div v-if="isLoading" class="space-y-4">
            <el-skeleton :rows="2" animated v-for="i in 3" :key="i" class="mb-4" />
          </div>

          <!-- Empty State -->
          <div
            v-else-if="anomalies.length === 0"
            class="flex flex-col items-center justify-center py-16 text-center"
          >
            <div class="p-4 rounded-full bg-surface mb-4 border border-border/50">
              <i class="fas fa-check-circle text-4xl text-success"></i>
            </div>
            <p class="text-muted text-sm">{{ t('aiAudit.noAnomalies', '暂无异常检测') }}</p>
            <p class="text-muted text-xs mt-1">
              {{ t('aiAudit.noAnomaliesHint', '系统运行正常，未检测到异常行为') }}
            </p>
          </div>

          <!-- Anomaly List -->
          <div v-else class="space-y-3">
            <div
              v-for="anomaly in anomalies"
              :key="anomaly.id"
              class="p-4 rounded-xl bg-surface/30 border border-border/50 hover:bg-surface/50 transition-all duration-200"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span :class="getSeverityBadgeClass(anomaly.severity)">
                    {{ anomaly.severity.toUpperCase() }}
                  </span>
                  <span class="font-medium text-foreground">{{ anomaly.title }}</span>
                </div>
                <button
                  v-if="!anomaly.acknowledged"
                  class="px-3 py-1 text-xs font-medium rounded-lg bg-surface border border-border hover:border-primary/30 hover:text-primary transition-colors"
                  @click.stop="handleAcknowledge(anomaly.id)"
                >
                  <i class="fas fa-check mr-1"></i>
                  {{ t('aiAudit.acknowledge', '确认') }}
                </button>
                <span
                  v-else
                  class="px-3 py-1 text-xs font-medium rounded-lg bg-success/10 text-success border border-success/20"
                >
                  <i class="fas fa-check-double mr-1"></i>
                  {{ t('aiAudit.acknowledged', '已确认') }}
                </span>
              </div>
              <p class="mt-2 text-sm text-muted">{{ anomaly.description }}</p>
              <div class="mt-2 text-xs text-muted font-mono">
                <i class="fas fa-clock mr-1"></i>
                {{ formatDate(anomaly.detected_at) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Report Detail Modal -->
    <div
      v-if="selectedReport"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="closeReportDetail"
    >
      <div
        class="bg-background rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
      >
        <div class="flex items-center justify-between p-4 border-b border-border">
          <div class="flex items-center gap-3">
            <span :class="getReportTypeBadgeClass(selectedReport.report_type)">
              {{ getReportTypeLabel(selectedReport.report_type) }}
            </span>
            <span class="text-sm text-muted font-mono">
              {{ formatDate(selectedReport.created_at) }}
            </span>
          </div>
          <button @click="closeReportDetail" class="text-text-secondary hover:text-foreground">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="p-4 overflow-y-auto max-h-[60vh]">
          <div class="space-y-4">
            <div>
              <h4 class="text-sm font-medium text-text-secondary mb-1">
                {{ t('aiAudit.timeRange', '时间范围') }}
              </h4>
              <p class="font-mono text-sm">
                {{ formatDate(selectedReport.time_range_start) }} -
                {{ formatDate(selectedReport.time_range_end) }}
              </p>
            </div>
            <div v-if="selectedReport.summary">
              <h4 class="text-sm font-medium text-text-secondary mb-1">
                {{ t('aiAudit.summary', '分析摘要') }}
              </h4>
              <div class="p-3 bg-surface/50 rounded-lg text-sm">
                <template v-if="parsedSummary">
                  <div class="grid grid-cols-3 gap-4 mb-3">
                    <div>
                      <span class="text-text-secondary text-xs">数据覆盖度</span>
                      <div
                        class="text-lg font-bold"
                        :class="
                          parsedSummary.overallScore >= 80
                            ? 'text-success'
                            : parsedSummary.overallScore >= 50
                              ? 'text-warning'
                              : 'text-error'
                        "
                      >
                        {{ parsedSummary.overallScore }}%
                      </div>
                    </div>
                    <div>
                      <span class="text-text-secondary text-xs">检出异常</span>
                      <div class="text-lg font-bold">{{ parsedSummary.anomalyCount }}</div>
                    </div>
                    <div>
                      <span class="text-text-secondary text-xs">命令总数</span>
                      <div class="text-lg font-bold">
                        {{ parsedSummary.dataSummary?.totalCommands || 0 }}
                      </div>
                    </div>
                  </div>
                  <div
                    v-if="parsedSummary.dataSummary"
                    class="grid grid-cols-2 gap-3 pt-2 border-t border-border/50 text-xs text-text-secondary"
                  >
                    <span>登录次数: {{ parsedSummary.dataSummary.totalLogins || 0 }}</span>
                    <span>失败登录: {{ parsedSummary.dataSummary.failedLogins || 0 }}</span>
                    <span>连接次数: {{ parsedSummary.dataSummary.totalConnections || 0 }}</span>
                    <span>独立 IP: {{ parsedSummary.dataSummary.uniqueIps || 0 }}</span>
                  </div>
                </template>
                <template v-else>
                  {{ selectedReport.summary }}
                </template>
              </div>
            </div>
            <div v-if="parsedAnomalies && parsedAnomalies.length > 0">
              <h4 class="text-sm font-medium text-text-secondary mb-1">
                {{ t('aiAudit.anomalies', '异常检测') }}
              </h4>
              <div class="space-y-2">
                <div
                  v-for="(anomaly, idx) in parsedAnomalies"
                  :key="idx"
                  class="p-2 bg-surface/50 rounded-lg text-sm"
                >
                  <span :class="getSeverityBadgeClass(anomaly.severity)">{{
                    anomaly.severity
                  }}</span>
                  <span class="ml-2 font-medium">{{ anomaly.title }}</span>
                  <p class="text-text-secondary text-xs mt-1">{{ anomaly.description }}</p>
                </div>
              </div>
            </div>
            <div v-if="selectedReport.ai_analysis">
              <h4 class="text-sm font-medium text-text-secondary mb-1">
                {{ t('aiAudit.aiAnalysis', 'AI 分析') }}
              </h4>
              <div v-if="parsedAiAnalysis" class="p-3 bg-surface/50 rounded-lg text-sm space-y-3">
                <!-- AI 安全评分 -->
                <div v-if="parsedAiAnalysis.overallScore != null" class="flex items-center gap-2">
                  <span class="text-text-secondary text-xs">AI 安全评分</span>
                  <span
                    class="text-base font-bold"
                    :class="
                      parsedAiAnalysis.overallScore >= 80
                        ? 'text-success'
                        : parsedAiAnalysis.overallScore >= 50
                          ? 'text-warning'
                          : 'text-error'
                    "
                  >
                    {{ parsedAiAnalysis.overallScore }}/100
                  </span>
                </div>
                <!-- 关键发现 -->
                <div v-if="parsedAiAnalysis.keyFindings?.length">
                  <div class="text-xs font-medium text-text-secondary mb-1">关键发现</div>
                  <div class="space-y-1.5">
                    <div
                      v-for="(finding, idx) in parsedAiAnalysis.keyFindings"
                      :key="idx"
                      class="flex items-start gap-2"
                    >
                      <span
                        class="mt-0.5 shrink-0 inline-block w-1.5 h-1.5 rounded-full"
                        :class="
                          finding.severity === 'high'
                            ? 'bg-error'
                            : finding.severity === 'medium'
                              ? 'bg-warning'
                              : 'bg-success'
                        "
                      ></span>
                      <div>
                        <span class="font-medium">{{ finding.title }}</span>
                        <span class="text-text-secondary ml-1">—</span>
                        <span class="text-text-secondary">{{ finding.description }}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- 建议 -->
                <div v-if="parsedAiAnalysis.recommendations?.length">
                  <div class="text-xs font-medium text-text-secondary mb-1">改进建议</div>
                  <ol class="list-decimal list-inside space-y-0.5 text-text-secondary text-xs">
                    <li v-for="(rec, idx) in parsedAiAnalysis.recommendations" :key="idx">
                      {{ rec }}
                    </li>
                  </ol>
                </div>
                <!-- 合规检查 -->
                <div v-if="parsedAiAnalysis.complianceChecks?.length">
                  <div class="text-xs font-medium text-text-secondary mb-1">合规检查</div>
                  <div class="flex flex-wrap gap-2">
                    <span
                      v-for="(check, idx) in parsedAiAnalysis.complianceChecks"
                      :key="idx"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                      :class="
                        check.status === 'pass'
                          ? 'bg-success/10 text-success'
                          : check.status === 'fail'
                            ? 'bg-error/10 text-error'
                            : 'bg-warning/10 text-warning'
                      "
                    >
                      <i
                        :class="
                          check.status === 'pass'
                            ? 'fas fa-check-circle'
                            : check.status === 'fail'
                              ? 'fas fa-times-circle'
                              : 'fas fa-exclamation-circle'
                        "
                      ></i>
                      {{ check.item }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="p-3 bg-surface/50 rounded-lg text-sm whitespace-pre-wrap">
                {{ selectedReport.ai_analysis }}
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 p-4 border-t border-border">
          <button
            @click="handleDeleteReport(selectedReport.id)"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-error hover:bg-error/10 rounded-lg transition-colors"
          >
            <i class="fas fa-trash-alt"></i>{{ t('common.delete', '删除') }}
          </button>
          <button
            @click="closeReportDetail"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-foreground bg-surface hover:bg-surface/80 rounded-lg transition-colors"
          >
            <i class="fas fa-times"></i>{{ t('common.close', '关闭') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAiAuditStore } from '../stores/ai-audit.store';
import type { AuditReport, ReportType, ReportStatus } from '../types/ai-audit.types';
import apiClient from '../utils/apiClient';

const { t } = useI18n();
const auditStore = useAiAuditStore();

// 状态
const activeTab = ref<'reports' | 'anomalies'>('reports');
const isCreating = ref(false);

// 计算属性
const reports = computed(() => auditStore.reports);
const anomalies = computed(() => auditStore.anomalies);
const totalReports = computed(() => auditStore.totalReports);
const totalAnomalies = computed(() => auditStore.totalAnomalies);
const isLoading = computed(() => auditStore.isLoading);

const criticalCount = computed(() => {
  const stats = auditStore.anomalyStats;
  if (stats) {
    return (stats.bySeverity?.critical || 0) + (stats.bySeverity?.high || 0);
  }
  return anomalies.value.filter((a) => a.severity === 'critical' || a.severity === 'high').length;
});
const recentAnomalyCount = computed(() => {
  const stats = auditStore.anomalyStats;
  if (stats) {
    return stats.recentCount || 0;
  }
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
  return anomalies.value.filter((a) => a.detected_at >= oneDayAgo).length;
});

// 标签页配置
const tabs = [
  { key: 'reports' as const, label: t('aiAudit.reports', '报告'), icon: 'fas fa-file-alt' },
  {
    key: 'anomalies' as const,
    label: t('aiAudit.anomalies', '异常'),
    icon: 'fas fa-exclamation-triangle',
  },
];

// 工具函数
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function getReportTypeLabel(type: ReportType): string {
  const labels: Record<ReportType, string> = {
    command_analysis: t('aiAudit.type.command', '命令分析'),
    login_analysis: t('aiAudit.type.login', '登录分析'),
    full_audit: t('aiAudit.type.full', '全面审计'),
  };
  return labels[type] || type;
}

function getReportTypeBadgeClass(type: ReportType): string {
  const classes: Record<ReportType, string> = {
    command_analysis:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-primary/10 text-primary border border-primary/20',
    login_analysis:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-success/10 text-success border border-success/20',
    full_audit:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-info/10 text-info border border-info/20',
  };
  return classes[type] || '';
}

function getReportStatus(report: AuditReport): ReportStatus {
  return report.status || 'pending';
}

function getStatusBadgeClass(status: ReportStatus): string {
  const classes: Record<ReportStatus, string> = {
    pending:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-warning/10 text-warning border border-warning/20',
    in_progress:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-primary/10 text-primary border border-primary/20',
    completed:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-success/10 text-success border border-success/20',
    failed:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-error/10 text-error border border-error/20',
  };
  return classes[status] || '';
}

function getStatusStatusLabel(status: ReportStatus): string {
  const labels: Record<ReportStatus, string> = {
    pending: t('aiAudit.status.pending', '待处理'),
    in_progress: t('aiAudit.status.inProgress', '进行中'),
    completed: t('aiAudit.status.completed', '已完成'),
    failed: t('aiAudit.status.failed', '失败'),
  };
  return labels[status] || status;
}

function getSeverityBadgeClass(severity: string): string {
  const classes: Record<string, string> = {
    critical:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-error/10 text-error border border-error/20',
    high: 'px-2.5 py-1 text-xs font-medium rounded-lg bg-warning/10 text-warning border border-warning/20',
    medium:
      'px-2.5 py-1 text-xs font-medium rounded-lg bg-warning/10 text-warning border border-warning/20',
    low: 'px-2.5 py-1 text-xs font-medium rounded-lg bg-primary/10 text-primary border border-primary/20',
    info: 'px-2.5 py-1 text-xs font-medium rounded-lg bg-surface text-muted border border-border/50',
  };
  return classes[severity] || '';
}

// 操作
async function handleCreateReport() {
  isCreating.value = true;
  const now = Math.floor(Date.now() / 1000);
  const oneWeekAgo = now - 7 * 86400;

  const success = await auditStore.createReport('full_audit', oneWeekAgo, now);
  if (success) {
    await auditStore.fetchReports();
    await auditStore.fetchAnomalies();
  }
  isCreating.value = false;
}

const selectedReport = ref<AuditReport | null>(null);

function viewReport(report: AuditReport) {
  selectedReport.value = report;
}

function closeReportDetail() {
  selectedReport.value = null;
}

async function handleDeleteReport(reportId: number) {
  try {
    await apiClient.delete(`/ai-audit/reports/${reportId}`);
    await auditStore.fetchReports();
    await auditStore.fetchAnomalyStats();
    if (selectedReport.value?.id === reportId) {
      selectedReport.value = null;
    }
  } catch (err) {
    console.error('删除报告失败:', err);
  }
}

async function handleAcknowledge(anomalyId: number) {
  await auditStore.acknowledgeAnomaly(anomalyId);
}

// 计算属性：解析 JSON 字符串
const parsedSummary = computed(() => {
  if (!selectedReport.value?.summary) return null;
  try {
    return JSON.parse(selectedReport.value.summary);
  } catch {
    return null;
  }
});

const parsedAnomalies = computed(() => {
  if (!selectedReport.value?.anomalies_json) return [];
  try {
    const parsed = JSON.parse(selectedReport.value.anomalies_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
});

interface AiAnalysis {
  overallScore?: number;
  keyFindings?: Array<{ title: string; description: string; severity: string }>;
  recommendations?: string[];
  complianceChecks?: Array<{ item: string; status: string }>;
}

const parsedAiAnalysis = computed<AiAnalysis | null>(() => {
  if (!selectedReport.value?.ai_analysis) return null;
  try {
    const parsed = JSON.parse(selectedReport.value.ai_analysis);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
});

// 轮询报告状态
let pollingTimer: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  pollingTimer = setInterval(async () => {
    const hasPending = auditStore.reports.some(
      (r) => r.status === 'pending' || r.status === 'in_progress',
    );
    if (hasPending) {
      await auditStore.fetchReports();
    } else {
      stopPolling();
    }
  }, 3000);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// 生命周期
onMounted(async () => {
  await Promise.all([
    auditStore.fetchReports(),
    auditStore.fetchAnomalies(),
    auditStore.fetchAnomalyStats(),
  ]);
  startPolling();
});

// 清理轮询
import { onUnmounted } from 'vue';
onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
/* 统计卡片样式（与 DashboardView 一致） */
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

/* 内容卡片样式 */
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

/* 卡片头部样式 */
.card-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--card-header-bg);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

/* 页面入场动画 */
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

/* 自定义滚动条 */
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

/* Dark mode 适配 */
.dark .stat-card,
.dark .content-card {
  --card-bg: rgba(15, 23, 42, 0.4);
  --card-border: rgba(255, 255, 255, 0.08);
}

.dark .stat-card:hover {
  --card-hover-bg: rgba(15, 23, 42, 0.6);
}
</style>
