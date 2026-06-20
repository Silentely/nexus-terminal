/**
 * AI 审计分析路由
 */

import { Router, Request, Response, NextFunction } from 'express';
import { AiAuditController } from './ai-audit.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();
const controller = new AiAuditController();

// 所有路由都需要认证
router.use(isAuthenticated);

// 审计报告
router.post('/reports', (req: Request, res: Response, next: NextFunction) =>
  controller.createReport(req, res, next),
);
router.get('/reports', (req: Request, res: Response, next: NextFunction) =>
  controller.getReports(req, res, next),
);
router.get('/reports/:id', (req: Request, res: Response, next: NextFunction) =>
  controller.getReportById(req, res, next),
);
router.delete('/reports/:id', (req: Request, res: Response, next: NextFunction) =>
  controller.deleteReport(req, res, next),
);

// 异常检测
router.get('/anomalies', (req: Request, res: Response, next: NextFunction) =>
  controller.getAnomalies(req, res, next),
);
router.get('/anomalies/stats', (req: Request, res: Response, next: NextFunction) =>
  controller.getAnomalyStats(req, res, next),
);
router.patch('/anomalies/:id/acknowledge', (req: Request, res: Response, next: NextFunction) =>
  controller.acknowledgeAnomaly(req, res, next),
);

export { router as aiAuditRoutes };
