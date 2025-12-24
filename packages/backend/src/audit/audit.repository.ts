import { Database } from 'sqlite3';
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { AuditLogEntry, AuditLogActionType } from '../types/audit.types';
import { settingsService } from '../settings/settings.service';
import { ErrorFactory } from '../utils/AppError';

type DbAuditLogRow = AuditLogEntry;

export class AuditLogRepository {
  /**
   * 添加一条审计日志记录。
   * @param actionType 操作类型。
   * @param details 可选的详细信息（对象或字符串）。
   */
  async addLog(
    actionType: AuditLogActionType,
    details?: Record<string, any> | string | null
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    let detailsString: string | null = null;

    if (details) {
      try {
        detailsString = typeof details === 'string' ? details : JSON.stringify(details);
      } catch (error: any) {
        console.error(`[审计日志] 序列化操作 ${actionType} 的详情失败:`, error.message);
        detailsString = JSON.stringify({
          error: 'Failed to stringify details',
          originalDetails: String(details),
        }); // Ensure originalDetails is stringifiable
      }
    }

    const sql = 'INSERT INTO audit_logs (timestamp, action_type, details) VALUES (?, ?, ?)';
    const params = [timestamp, actionType, detailsString];

    try {
      const db = await getDbInstance();
      await runDb(db, sql, params);

      // --- 添加日志清理逻辑 ---
      await this.cleanupOldLogs(db);
      // --- 清理逻辑结束 ---
    } catch (err: any) {
      console.error(`[审计日志] 添加操作 ${actionType} 的日志条目时出错: ${err.message}`);
      // 决定日志记录失败是应该抛出错误还是仅记录日志
    }
  }

  /**
   * 清理旧的审计日志，保持最多 MAX_LOG_ENTRIES 条记录。
   * 现在从设置中读取最大条数配置。
   * @param db - 数据库实例。
   */
  private async cleanupOldLogs(db: Database): Promise<void> {
    // 从设置中获取最大日志条数
    const MAX_LOG_ENTRIES = await settingsService.getAuditLogMaxEntries();
    const countSql = 'SELECT COUNT(*) as total FROM audit_logs';
    const deleteSql = `
            DELETE FROM audit_logs
            WHERE id IN (
                SELECT id
                FROM audit_logs
                ORDER BY timestamp ASC
                LIMIT ?
            )
        `; // 假设有自增的 id 列，并且 timestamp 能准确反映顺序

    try {
      const countRow = await getDbRow<{ total: number }>(db, countSql);
      const total = countRow?.total ?? 0;

      if (total > MAX_LOG_ENTRIES) {
        const logsToDelete = total - MAX_LOG_ENTRIES;
        console.log(
          `[审计日志] 日志数量 (${total}) 超过限制 (${MAX_LOG_ENTRIES})。正在删除 ${logsToDelete} 条最旧的记录。`
        );
        await runDb(db, deleteSql, [logsToDelete]);
      }
    } catch (err: any) {
      console.error(`[审计日志] 日志清理过程中出错: ${err.message}`);
      // 清理失败不应阻止主日志记录流程，仅记录错误。
    }
  }

  /**
   * 删除所有审计日志记录
   * @returns 删除的记录数
   */
  async deleteAllLogs(): Promise<number> {
    const sql = 'DELETE FROM audit_logs';
    try {
      const db = await getDbInstance();
      const result = await runDb(db, sql, []);
      console.log(`[审计日志] 已删除所有审计日志，共 ${result.changes} 条记录。`);
      return result.changes;
    } catch (err: any) {
      console.error(`[审计日志] 删除所有日志时出错: ${err.message}`);
      throw ErrorFactory.databaseError('删除审计日志失败', `删除审计日志失败: ${err.message}`);
    }
  }

  /**
   * 获取审计日志总数
   * @returns 审计日志总数
   */
  async getLogCount(): Promise<number> {
    const sql = 'SELECT COUNT(*) as total FROM audit_logs';
    try {
      const db = await getDbInstance();
      const countRow = await getDbRow<{ total: number }>(db, sql);
      return countRow?.total ?? 0;
    } catch (err: any) {
      console.error(`[审计日志] 获取日志总数时出错: ${err.message}`);
      throw ErrorFactory.databaseError(
        '获取审计日志总数失败',
        `获取审计日志总数失败: ${err.message}`
      );
    }
  }

  /**
   * 获取审计日志列表（支持分页和基本过滤）。
   * @param limit 每页数量。
   * @param offset 偏移量。
   * @param actionType 可选的操作类型过滤。
   * @param startDate 可选的开始时间戳（秒）。
   * @param endDate 可选的结束时间戳（秒）。
   * @param searchTerm 可选的搜索关键词（模糊匹配 details）。
   */
  async getLogs(
    limit: number = 50,
    offset: number = 0,
    actionType?: AuditLogActionType,
    startDate?: number,
    endDate?: number,
    searchTerm?: string // 添加 searchTerm 参数
  ): Promise<{ logs: AuditLogEntry[]; total: number }> {
    let baseSql = 'SELECT * FROM audit_logs';
    let countSql = 'SELECT COUNT(*) as total FROM audit_logs';
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];
    const countParams: (string | number)[] = [];

    if (actionType) {
      whereClauses.push('action_type = ?');
      params.push(actionType);
      countParams.push(actionType);
    }
    // 添加 searchTerm 的过滤逻辑
    if (searchTerm) {
      // 搜索 details 字段，使用 LIKE 进行模糊匹配
      whereClauses.push('details LIKE ?');
      const searchTermLike = `%${searchTerm}%`;
      params.push(searchTermLike);
      countParams.push(searchTermLike);
    }

    if (whereClauses.length > 0) {
      const whereSql = ` WHERE ${whereClauses.join(' AND ')}`;
      baseSql += whereSql;
      countSql += whereSql;
    }

    baseSql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
      const db = await getDbInstance();
      const countRow = await getDbRow<{ total: number }>(db, countSql, countParams);
      const total = countRow?.total ?? 0;

      const logs = await allDb<DbAuditLogRow>(db, baseSql, params);

      return { logs, total };
    } catch (err: any) {
      console.error(`获取审计日志时出错:`, err.message);
      throw ErrorFactory.databaseError('获取审计日志失败', `获取审计日志时出错: ${err.message}`);
    }
  }
}
