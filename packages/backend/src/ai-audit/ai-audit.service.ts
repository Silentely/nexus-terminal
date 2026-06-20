/**
 * AI 审计分析服务
 * 核心业务逻辑：数据采集、规则检测、报告生成
 */

import { logger } from '../utils/logger';
import { AiAuditRepository } from './ai-audit.repository';
import { runDetectionRules } from './rules/anomaly-rules';
import { getPromptBuilder } from './prompts/audit-prompts';
import { getAISettings } from '../ai-ops/nl2cmd.service';
import type { AIProviderConfig } from '../ai-ops/nl2cmd.types';
import type {
  ReportType,
  AnomalyRuleId,
  AnomalySeverity,
  CreateReportRequest,
  CreateReportResponse,
  GetReportsQuery,
  GetAnomaliesQuery,
  AnomalyStats,
  AuditDataSummary,
} from './ai-audit.types';
import { safeHttpPost } from '../utils/ssrf-guard';

export class AiAuditService {
  private repository: AiAuditRepository;

  constructor() {
    this.repository = new AiAuditRepository();
  }

  /**
   * 创建审计报告
   */
  async createReport(userId: number, request: CreateReportRequest): Promise<CreateReportResponse> {
    const { reportType, timeRangeStart, timeRangeEnd } = request;

    // 创建报告记录
    const reportId = await this.repository.createReport({
      userId,
      reportType,
      timeRangeStart,
      timeRangeEnd,
    });

    logger.info({ reportId, reportType, userId }, '审计报告已创建');

    // 异步执行分析（不阻塞响应）
    this.runAnalysis(reportId, userId, reportType, timeRangeStart, timeRangeEnd).catch((err) => {
      logger.error({ reportId, error: err }, '审计分析执行失败');
    });

    return {
      success: true,
      report: {
        id: reportId,
        status: 'pending',
        reportType,
      },
    };
  }

  /**
   * 执行审计分析
   */
  private async runAnalysis(
    reportId: number,
    userId: number,
    reportType: ReportType,
    timeRangeStart: number,
    timeRangeEnd: number,
  ): Promise<void> {
    try {
      // 更新状态为进行中
      await this.repository.updateReportStatus(reportId, 'in_progress');

      // 采集数据
      const dataSummary = await this.repository.getDataSummary(timeRangeStart, timeRangeEnd);

      // 运行规则检测
      const loginEvents = await this.getLoginEvents(timeRangeStart, timeRangeEnd);
      const commands = await this.getCommands(timeRangeStart, timeRangeEnd);
      const connectionEvents = await this.getConnectionEvents(timeRangeStart, timeRangeEnd);

      const detectionResults = await runDetectionRules({
        loginEvents,
        commands,
        connectionEvents,
        timeRangeStart,
        timeRangeEnd,
      });

      // 收集所有检测到的异常
      const allAnomalies = detectionResults.filter((r) => r.detected).flatMap((r) => r.anomalies);

      // 创建异常记录
      if (allAnomalies.length > 0) {
        await this.repository.createAnomalies(
          allAnomalies.map((a) => ({
            reportId,
            ruleId: a.rule_id as AnomalyRuleId,
            severity: a.severity as AnomalySeverity,
            title: a.title,
            description: a.description,
            evidenceJson: a.evidence_json || undefined,
          })),
        );
      }

      // 构建登录数据摘要（用于全量审计）
      const loginSummaryForAI: AuditDataSummary = {
        timeRange: { start: timeRangeStart, end: timeRangeEnd },
        totalCommands: 0,
        totalLogins: dataSummary.totalLogins,
        failedLogins: dataSummary.failedLogins,
        totalConnections: dataSummary.totalConnections,
        uniqueIps: dataSummary.uniqueIps,
        commandFrequency: {},
        loginByHour: dataSummary.loginByHour,
        topCommands: [],
      };

      // 尝试调用外部 AI 进行深度分析
      let aiAnalysis: string | undefined;
      try {
        aiAnalysis = await this.callExternalAI(reportType, dataSummary, loginSummaryForAI);
      } catch (aiErr) {
        logger.warn({ reportId, error: aiErr }, '外部 AI 分析失败，使用本地分析');
      }

      // 生成摘要
      const summary = JSON.stringify({
        overallScore: this.calculateRiskScore(allAnomalies),
        anomalyCount: allAnomalies.length,
        dataSummary: {
          totalCommands: dataSummary.totalCommands,
          totalLogins: dataSummary.totalLogins,
          failedLogins: dataSummary.failedLogins,
        },
      });

      // 更新报告状态为完成
      await this.repository.updateReportStatus(
        reportId,
        'completed',
        summary,
        JSON.stringify(allAnomalies),
        aiAnalysis,
      );

      logger.info({ reportId, anomalyCount: allAnomalies.length }, '审计分析完成');
    } catch (err) {
      logger.error({ reportId, error: err }, '审计分析失败');
      await this.repository.updateReportStatus(reportId, 'failed');
    }
  }

  /**
   * 调用外部 AI 进行深度分析
   */
  private async callExternalAI(
    reportType: ReportType,
    dataSummary: AuditDataSummary,
    loginSummary?: AuditDataSummary,
  ): Promise<string> {
    const settings = await getAISettings();
    if (!settings || !settings.enabled) {
      throw new Error('AI 功能未启用');
    }

    const config: AIProviderConfig = {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      openaiEndpoint: settings.openaiEndpoint,
    };

    // 构建 Prompt
    const promptBuilder = getPromptBuilder(reportType);
    const prompt = promptBuilder(dataSummary, loginSummary);

    // 调用 AI Provider
    const response = await this.callAIProvider(config, prompt);

    return response;
  }

  /**
   * 调用 AI Provider
   */
  private async callAIProvider(config: AIProviderConfig, prompt: string): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // 移除末尾斜杠避免双斜杠 URL
    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    if (config.provider === 'claude') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';

      const response = await safeHttpPost(
        `${baseUrl}/v1/messages`,
        {
          model: config.model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        },
        { headers, timeout: 30000 },
        'AI-Audit',
      );

      return response.data.content?.[0]?.text || 'AI 分析完成';
    } else {
      // OpenAI 兼容
      headers['Authorization'] = `Bearer ${config.apiKey}`;

      const endpoint = config.openaiEndpoint?.startsWith('/')
        ? config.openaiEndpoint
        : `/${config.openaiEndpoint || 'v1/chat/completions'}`;
      const response = await safeHttpPost(
        `${baseUrl}${endpoint}`,
        {
          model: config.model,
          messages: [
            { role: 'system', content: '你是一名资深安全审计专家。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        },
        { headers, timeout: 30000 },
        'AI-Audit',
      );

      return response.data.choices?.[0]?.message?.content || 'AI 分析完成';
    }
  }

  /**
   * 计算风险评分（0-100，越高越安全）
   */
  private calculateRiskScore(anomalies: Array<{ severity: string }>): number {
    let score = 100;
    for (const anomaly of anomalies) {
      switch (anomaly.severity) {
        case 'critical':
          score -= 20;
          break;
        case 'high':
          score -= 10;
          break;
        case 'medium':
          score -= 5;
          break;
        case 'low':
          score -= 2;
          break;
      }
    }
    return Math.max(0, Math.min(100, score));
  }

  /**
   * 获取登录事件（按用户过滤）
   */
  private async getLoginEvents(
    timeRangeStart: number,
    timeRangeEnd: number,
    userId?: number,
  ): Promise<Array<{ ip: string; success: boolean; timestamp: number }>> {
    const { getDbInstance, allDb } = await import('../database/connection.js');
    const db = await getDbInstance();

    let query = `SELECT action_type, details, timestamp FROM audit_logs
       WHERE action_type IN ('LOGIN_SUCCESS', 'LOGIN_FAILURE')
       AND timestamp >= ? AND timestamp <= ?`;
    const params: unknown[] = [timeRangeStart, timeRangeEnd];

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    const rows = await allDb<{ action_type: string; details: string; timestamp: number }>(
      db,
      query,
      params,
    );

    return rows.map((row) => {
      let ip = '';
      try {
        const details = JSON.parse(row.details || '{}');
        ip = details.clientIp || details.ip || '';
      } catch (err: unknown) {
        logger.debug({ err }, '操作失败，已忽略');
        // 忽略解析错误
      }
      return {
        ip,
        success: row.action_type === 'LOGIN_SUCCESS',
        timestamp: row.timestamp,
      };
    });
  }

  /**
   * 获取命令列表（单用户场景无需过滤）
   */
  private async getCommands(
    timeRangeStart: number,
    timeRangeEnd: number,
  ): Promise<Array<{ command: string; timestamp: number }>> {
    const { getDbInstance, allDb } = await import('../database/connection.js');
    const db = await getDbInstance();

    return allDb<{ command: string; timestamp: number }>(
      db,
      `SELECT command, timestamp FROM command_history
       WHERE timestamp >= ? AND timestamp <= ?`,
      [timeRangeStart, timeRangeEnd],
    );
  }

  /**
   * 获取连接事件（按用户过滤）
   */
  private async getConnectionEvents(
    timeRangeStart: number,
    timeRangeEnd: number,
    userId?: number,
  ): Promise<Array<{ type: string; timestamp: number }>> {
    const { getDbInstance, allDb } = await import('../database/connection.js');
    const db = await getDbInstance();

    let query = `SELECT action_type, timestamp FROM audit_logs
       WHERE action_type IN ('SSH_CONNECT_SUCCESS', 'SSH_CONNECT_FAILURE', 'SSH_DISCONNECT')
       AND timestamp >= ? AND timestamp <= ?`;
    const params: unknown[] = [timeRangeStart, timeRangeEnd];

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    const rows = await allDb<{ action_type: string; timestamp: number }>(db, query, params);

    return rows.map((row) => ({
      type: row.action_type,
      timestamp: row.timestamp,
    }));
  }

  /**
   * 获取报告列表
   */
  async getReports(userId: number, query: GetReportsQuery) {
    return this.repository.getReports({
      userId,
      page: query.page,
      pageSize: query.pageSize,
      reportType: query.reportType,
    });
  }

  /**
   * 获取报告详情
   */
  async getReportById(reportId: number) {
    return this.repository.getReportById(reportId);
  }

  /**
   * 获取异常列表
   */
  async getAnomalies(query: GetAnomaliesQuery) {
    return this.repository.getAnomalies({
      page: query.page,
      pageSize: query.pageSize,
      severity: query.severity,
      acknowledged: query.acknowledged,
    });
  }

  /**
   * 删除审计报告
   */
  async deleteReport(reportId: number, userId: number): Promise<boolean> {
    return this.repository.deleteReport(reportId, userId);
  }

  /**
   * 获取异常统计（按用户过滤）
   */
  async getAnomalyStats(userId: number): Promise<AnomalyStats> {
    const stats = await this.repository.getAnomalyStats(userId);
    return {
      total: stats.total,
      bySeverity: stats.bySeverity as Record<string, number>,
      byRule: {}, // 可扩展
      recentCount: stats.recentCount,
    };
  }

  /**
   * 确认异常
   */
  async acknowledgeAnomaly(anomalyId: number): Promise<void> {
    await this.repository.acknowledgeAnomaly(anomalyId);
  }
}
