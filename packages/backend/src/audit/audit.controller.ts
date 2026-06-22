import { Request, Response, NextFunction } from 'express';
import { AuditLogService } from './audit.service';
import { AuditLogActionType } from '../types/audit.types';
import { logger } from '../utils/logger';

const auditLogService = new AuditLogService();

export class AuditController {
  /**
   * 获取审计日志列表 (GET /api/v1/audit-logs)
   * 支持分页和过滤查询参数: limit, offset, actionType, startDate, endDate
   */
  async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // 解析查询参数
      const limit = parseInt((req.query.limit as string) || '50', 10);
      const offset = parseInt((req.query.offset as string) || '0', 10);
      // 修正：从 req.query 中读取 action_type (snake_case)
      const actionType = req.query.action_type as AuditLogActionType | undefined;
      const startDate = req.query.startDate
        ? parseInt(req.query.startDate as string, 10)
        : undefined;
      const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;
      // 解析 searchTerm 参数
      const searchTerm = req.query.search as string | undefined;

      // 输入验证 (基本)
      if (Number.isNaN(limit) || limit <= 0) {
        res
          .status(400)
          .json({ success: false, error: '无效的 limit 参数', code: 'INVALID_PARAMETER' });
        return;
      }
      if (Number.isNaN(offset) || offset < 0) {
        res
          .status(400)
          .json({ success: false, error: '无效的 offset 参数', code: 'INVALID_PARAMETER' });
        return;
      }
      if (startDate !== undefined && Number.isNaN(startDate)) {
        res
          .status(400)
          .json({ success: false, error: '无效的 startDate 参数', code: 'INVALID_PARAMETER' });
        return;
      }
      if (endDate !== undefined && Number.isNaN(endDate)) {
        res
          .status(400)
          .json({ success: false, error: '无效的 endDate 参数', code: 'INVALID_PARAMETER' });
        return;
      }

      // 将 searchTerm 传递给 service
      const result = await auditLogService.getLogs(
        limit,
        offset,
        actionType,
        startDate,
        endDate,
        searchTerm,
      );

      // 解析 details 字段从 JSON 字符串到对象（如果需要）
      const logsWithParsedDetails = result.logs.map((log) => {
        let parsedDetails: unknown = null;
        if (log.details) {
          try {
            parsedDetails = JSON.parse(log.details);
          } catch (error: unknown) {
            logger.warn(`[Audit Log] Failed to parse details for log ID ${log.id}:`, error);
            parsedDetails = { raw: log.details, parseError: true };
          }
        }
        return { ...log, details: parsedDetails };
      });

      res.status(200).json({
        logs: logsWithParsedDetails,
        total: result.total,
        limit,
        offset,
      });
    } catch (error: unknown) {
      logger.error('获取审计日志时出错:', error);
      next(error); // 传递给全局错误处理中间件
    }
  }

  /**
   * 删除所有审计日志 (DELETE /api/v1/audit-logs)
   */
  async deleteAllLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const deletedCount = await auditLogService.deleteAllLogs();
      res.status(200).json({
        message: '审计日志已全部删除',
        deletedCount,
      });
    } catch (error: unknown) {
      logger.error('删除审计日志时出错:', error);
      next(error); // 传递给全局错误处理中间件
    }
  }

  /**
   * 获取审计日志总数 (GET /api/v1/audit-logs/count)
   */
  async getLogCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const count = await auditLogService.getLogCount();
      res.status(200).json({ count });
    } catch (error: unknown) {
      logger.error('获取审计日志数量时出错:', error);
      next(error); // 传递给全局错误处理中间件
    }
  }
}
