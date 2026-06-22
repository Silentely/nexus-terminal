/**
 * AI 审计分析控制器
 * 处理 HTTP 请求
 */

import { Request, Response, NextFunction } from 'express';
import { AiAuditService } from './ai-audit.service';
import { ErrorFactory } from '../utils/AppError';
import type { GetReportsQuery, GetAnomaliesQuery } from './ai-audit.types';

// 扩展 Request 类型以包含 session.userId
type SessionWithUserId = Request['session'] & { userId?: number };

export class AiAuditController {
  private service: AiAuditService;

  constructor() {
    this.service = new AiAuditService();
  }

  /**
   * 从请求中获取用户 ID
   */
  private getUserId(req: Request): number {
    const userId = (req.session as SessionWithUserId | undefined)?.userId;
    if (!userId) {
      throw ErrorFactory.unauthorized('未授权');
    }
    return userId;
  }

  /**
   * 创建审计报告
   * POST /api/v1/ai-audit/reports
   */
  async createReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);

      const { reportType, timeRangeStart, timeRangeEnd } = req.body;

      const validReportTypes = ['command_analysis', 'login_analysis', 'full_audit'];
      if (
        !reportType ||
        !validReportTypes.includes(reportType) ||
        timeRangeStart == null ||
        timeRangeEnd == null ||
        !Number.isFinite(Number(timeRangeStart)) ||
        !Number.isFinite(Number(timeRangeEnd))
      ) {
        throw ErrorFactory.badRequest('缺少必要参数或参数无效');
      }

      const result = await this.service.createReport(userId, {
        reportType,
        timeRangeStart,
        timeRangeEnd,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 获取报告列表
   * GET /api/v1/ai-audit/reports
   */
  async getReports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);

      const query: GetReportsQuery = {
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        reportType: req.query.reportType as GetReportsQuery['reportType'],
      };

      const result = await this.service.getReports(userId, query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 获取报告详情
   * GET /api/v1/ai-audit/reports/:id
   */
  async getReportById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const reportId = Number(req.params.id);
      if (!reportId) {
        throw ErrorFactory.badRequest('无效的报告 ID');
      }

      const report = await this.service.getReportById(reportId);
      if (!report) {
        throw ErrorFactory.notFound('报告不存在');
      }

      res.json(report);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 获取异常列表
   * GET /api/v1/ai-audit/anomalies
   */
  async getAnomalies(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let acknowledged: boolean | undefined;
      if (req.query.acknowledged === 'true') {
        acknowledged = true;
      } else if (req.query.acknowledged === 'false') {
        acknowledged = false;
      }

      const query: GetAnomaliesQuery = {
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        severity: req.query.severity as GetAnomaliesQuery['severity'],
        acknowledged,
      };

      const result = await this.service.getAnomalies(query);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 获取异常统计（按用户过滤）
   * GET /api/v1/ai-audit/anomalies/stats
   */
  async getAnomalyStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);

      const stats = await this.service.getAnomalyStats(userId);
      res.json(stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 确认异常
   * PATCH /api/v1/ai-audit/anomalies/:id/acknowledge
   */
  async acknowledgeAnomaly(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const anomalyId = Number(req.params.id);
      if (!anomalyId) {
        throw ErrorFactory.badRequest('无效的异常 ID');
      }

      await this.service.acknowledgeAnomaly(anomalyId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 删除审计报告
   * DELETE /api/v1/ai-audit/reports/:id
   */
  async deleteReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);

      const reportId = Number(req.params.id);
      if (!reportId) {
        throw ErrorFactory.badRequest('无效的报告 ID');
      }

      const success = await this.service.deleteReport(reportId, userId);
      if (!success) {
        throw ErrorFactory.notFound('报告不存在');
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
}
