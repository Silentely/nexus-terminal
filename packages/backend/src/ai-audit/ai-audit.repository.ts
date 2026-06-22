/**
 * AI 审计分析数据访问层
 */

import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { logger } from '../utils/logger';
import type {
  AuditReport,
  AuditAnomaly,
  ReportType,
  ReportStatus,
  AnomalySeverity,
  AnomalyRuleId,
  AuditDataSummary,
} from './ai-audit.types';

export class AiAuditRepository {
  /**
   * 创建审计报告
   */
  async createReport(data: {
    userId: number;
    reportType: ReportType;
    timeRangeStart: number;
    timeRangeEnd: number;
  }): Promise<number> {
    const db = await getDbInstance();
    const result = await runDb(
      db,
      `INSERT INTO audit_reports (user_id, report_type, time_range_start, time_range_end, summary)
       VALUES (?, ?, ?, ?, '{}')`,
      [data.userId, data.reportType, data.timeRangeStart, data.timeRangeEnd],
    );
    return result.lastID;
  }

  /**
   * 更新报告状态
   */
  async updateReportStatus(
    reportId: number,
    status: ReportStatus,
    summary?: string,
    anomaliesJson?: string,
    aiAnalysis?: string,
  ): Promise<void> {
    const db = await getDbInstance();
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status];

    // 只在显式提供时更新 summary
    if (summary !== undefined) {
      updates.push('summary = ?');
      params.push(summary);
    }
    if (anomaliesJson !== undefined) {
      updates.push('anomalies_json = ?');
      params.push(anomaliesJson);
    }
    if (aiAnalysis !== undefined) {
      updates.push('ai_analysis = ?');
      params.push(aiAnalysis);
    }

    params.push(reportId);
    await runDb(db, `UPDATE audit_reports SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  /**
   * 删除审计报告及其关联的异常记录
   */
  async deleteReport(reportId: number, userId: number): Promise<boolean> {
    const db = await getDbInstance();

    // 先检查报告是否存在且属于当前用户
    const report = await getDbRow<{ id: number }>(
      db,
      'SELECT id FROM audit_reports WHERE id = ? AND user_id = ?',
      [reportId, userId],
    );

    if (!report) {
      return false;
    }

    // 使用事务确保原子性：异常记录和报告要么都删除，要么都不删除
    await runDb(db, 'BEGIN TRANSACTION');
    try {
      await runDb(db, 'DELETE FROM audit_anomalies WHERE report_id = ?', [reportId]);
      await runDb(db, 'DELETE FROM audit_reports WHERE id = ? AND user_id = ?', [reportId, userId]);
      await runDb(db, 'COMMIT');
    } catch (err) {
      // 用嵌套 try/catch 保护 rollback，避免 rollback 失败掩盖原始错误
      try {
        await runDb(db, 'ROLLBACK');
      } catch (rollbackErr) {
        logger.error('[AiAudit] deleteReport rollback 失败:', rollbackErr);
      }
      throw err;
    }

    return true;
  }

  /**
   * 获取报告列表
   */
  async getReports(params: {
    userId: number;
    page?: number;
    pageSize?: number;
    reportType?: ReportType;
  }): Promise<{ reports: AuditReport[]; total: number }> {
    const db = await getDbInstance();
    const { userId, page = 1, pageSize = 20, reportType } = params;

    let whereClause = 'WHERE user_id = ?';
    const queryParams: unknown[] = [userId];

    if (reportType) {
      whereClause += ' AND report_type = ?';
      queryParams.push(reportType);
    }

    const totalRow = await getDbRow<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM audit_reports ${whereClause}`,
      queryParams,
    );

    const offset = (page - 1) * pageSize;
    const reports = await allDb<AuditReport>(
      db,
      `SELECT * FROM audit_reports ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...queryParams, pageSize, offset],
    );

    return { reports, total: totalRow?.count || 0 };
  }

  /**
   * 获取报告详情
   */
  async getReportById(reportId: number): Promise<AuditReport | null> {
    const db = await getDbInstance();
    const report = await getDbRow<AuditReport>(db, 'SELECT * FROM audit_reports WHERE id = ?', [
      reportId,
    ]);
    return report || null;
  }

  /**
   * 创建异常记录
   */
  async createAnomaly(data: {
    reportId: number | null;
    ruleId: AnomalyRuleId;
    severity: AnomalySeverity;
    title: string;
    description: string;
    evidenceJson?: string;
  }): Promise<number> {
    const db = await getDbInstance();
    const result = await runDb(
      db,
      `INSERT INTO audit_anomalies (report_id, rule_id, severity, title, description, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.reportId,
        data.ruleId,
        data.severity,
        data.title,
        data.description,
        data.evidenceJson || null,
      ],
    );
    return result.lastID;
  }

  /**
   * 批量创建异常记录（带事务保护）
   */
  async createAnomalies(
    anomalies: Array<{
      reportId: number | null;
      ruleId: AnomalyRuleId;
      severity: AnomalySeverity;
      title: string;
      description: string;
      evidenceJson?: string;
    }>,
  ): Promise<void> {
    const db = await getDbInstance();

    // 使用事务保护批量插入
    await runDb(db, 'BEGIN TRANSACTION');
    try {
      for (const item of anomalies) {
        await runDb(
          db,
          `INSERT INTO audit_anomalies (report_id, rule_id, severity, title, description, evidence_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            item.reportId,
            item.ruleId,
            item.severity,
            item.title,
            item.description,
            item.evidenceJson || null,
          ],
        );
      }
      await runDb(db, 'COMMIT');
    } catch (err) {
      await runDb(db, 'ROLLBACK');
      throw err;
    }
  }

  /**
   * 获取异常列表（按用户过滤）
   */
  async getAnomalies(params: {
    userId?: number;
    page?: number;
    pageSize?: number;
    severity?: AnomalySeverity;
    acknowledged?: boolean;
  }): Promise<{ anomalies: AuditAnomaly[]; total: number }> {
    const db = await getDbInstance();
    const { userId, page = 1, pageSize = 20, severity, acknowledged } = params;

    let whereClause = 'WHERE 1=1';
    const queryParams: unknown[] = [];

    // 按用户过滤（通过关联的报告）
    if (userId) {
      whereClause += ' AND a.report_id IN (SELECT id FROM audit_reports WHERE user_id = ?)';
      queryParams.push(userId);
    }

    if (severity) {
      whereClause += ' AND a.severity = ?';
      queryParams.push(severity);
    }
    if (acknowledged !== undefined) {
      whereClause += ' AND a.acknowledged = ?';
      queryParams.push(acknowledged ? 1 : 0);
    }

    const totalRow = await getDbRow<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM audit_anomalies a ${whereClause}`,
      queryParams,
    );

    const offset = (page - 1) * pageSize;
    const anomalies = await allDb<AuditAnomaly>(
      db,
      `SELECT a.* FROM audit_anomalies a ${whereClause} ORDER BY a.detected_at DESC LIMIT ? OFFSET ?`,
      [...queryParams, pageSize, offset],
    );

    return { anomalies, total: totalRow?.count || 0 };
  }

  /**
   * 获取异常统计（按用户过滤）
   */
  async getAnomalyStats(userId: number): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    recentCount: number;
  }> {
    const db = await getDbInstance();

    const totalRow = await getDbRow<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM audit_anomalies a
       JOIN audit_reports r ON a.report_id = r.id
       WHERE r.user_id = ?`,
      [userId],
    );

    const bySeverityRows = await allDb<{ severity: string; count: number }>(
      db,
      `SELECT a.severity, COUNT(*) as count FROM audit_anomalies a
       JOIN audit_reports r ON a.report_id = r.id
       WHERE r.user_id = ?
       GROUP BY a.severity`,
      [userId],
    );

    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const recentRow = await getDbRow<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM audit_anomalies a
       JOIN audit_reports r ON a.report_id = r.id
       WHERE r.user_id = ? AND a.detected_at >= ?`,
      [userId, oneDayAgo],
    );

    const severityMap: Record<string, number> = {};
    for (const row of bySeverityRows) {
      severityMap[row.severity] = row.count;
    }

    return {
      total: totalRow?.count || 0,
      bySeverity: severityMap,
      recentCount: recentRow?.count || 0,
    };
  }

  /**
   * 确认异常
   */
  async acknowledgeAnomaly(anomalyId: number): Promise<void> {
    const db = await getDbInstance();
    await runDb(db, 'UPDATE audit_anomalies SET acknowledged = 1 WHERE id = ?', [anomalyId]);
  }

  /**
   * 获取审计数据摘要（用于 AI 分析）
   */
  async getDataSummary(timeRangeStart: number, timeRangeEnd: number): Promise<AuditDataSummary> {
    const db = await getDbInstance();

    // 命令统计
    const commandStats = await getDbRow<{ total: number }>(
      db,
      `SELECT COUNT(*) as total FROM command_history
       WHERE timestamp >= ? AND timestamp <= ?`,
      [timeRangeStart, timeRangeEnd],
    );

    // 热门命令
    const topCommands = await allDb<{ command: string; count: number }>(
      db,
      `SELECT command, COUNT(*) as count FROM command_history
       WHERE timestamp >= ? AND timestamp <= ?
       GROUP BY command ORDER BY count DESC LIMIT 10`,
      [timeRangeStart, timeRangeEnd],
    );

    // 登录统计
    const loginStats = await getDbRow<{ total: number; failed: number }>(
      db,
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN action_type = 'LOGIN_FAILURE' THEN 1 ELSE 0 END) as failed
       FROM audit_logs
       WHERE action_type IN ('LOGIN_SUCCESS', 'LOGIN_FAILURE')
       AND timestamp >= ? AND timestamp <= ?`,
      [timeRangeStart, timeRangeEnd],
    );

    // 连接统计
    const connectionStats = await getDbRow<{ total: number }>(
      db,
      `SELECT COUNT(*) as total FROM audit_logs
       WHERE action_type = 'SSH_CONNECT_SUCCESS'
       AND timestamp >= ? AND timestamp <= ?`,
      [timeRangeStart, timeRangeEnd],
    );

    // 唯一 IP 数
    const uniqueIps = await getDbRow<{ count: number }>(
      db,
      `SELECT COUNT(DISTINCT json_extract(details, '$.ip')) as count FROM audit_logs
       WHERE details IS NOT NULL
       AND timestamp >= ? AND timestamp <= ?`,
      [timeRangeStart, timeRangeEnd],
    );

    // 命令频率（按小时）
    const commandFrequency = await allDb<{ command: string; count: number }>(
      db,
      `SELECT command, COUNT(*) as count FROM command_history
       WHERE timestamp >= ? AND timestamp <= ?
       GROUP BY command`,
      [timeRangeStart, timeRangeEnd],
    );

    // 登录时间分布
    const loginByHour = await allDb<{ hour: number; count: number }>(
      db,
      `SELECT (timestamp % 86400) / 3600 as hour, COUNT(*) as count FROM audit_logs
       WHERE action_type IN ('LOGIN_SUCCESS', 'LOGIN_FAILURE')
       AND timestamp >= ? AND timestamp <= ?
       GROUP BY hour`,
      [timeRangeStart, timeRangeEnd],
    );

    const loginByHourMap: Record<number, number> = {};
    for (const row of loginByHour) {
      loginByHourMap[row.hour] = row.count;
    }

    const commandFrequencyMap: Record<string, number> = {};
    for (const row of commandFrequency) {
      commandFrequencyMap[row.command] = row.count;
    }

    return {
      timeRange: { start: timeRangeStart, end: timeRangeEnd },
      totalCommands: commandStats?.total || 0,
      totalLogins: loginStats?.total || 0,
      failedLogins: loginStats?.failed || 0,
      totalConnections: connectionStats?.total || 0,
      uniqueIps: uniqueIps?.count || 0,
      commandFrequency: commandFrequencyMap,
      loginByHour: loginByHourMap,
      topCommands,
    };
  }
}
