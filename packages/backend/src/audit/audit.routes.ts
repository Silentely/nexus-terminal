import { Router } from 'express';
import { AuditController } from './audit.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();
const auditController = new AuditController();

router.use(isAuthenticated);

// GET /api/v1/audit-logs - 获取审计日志列表
router.get('/', auditController.getAuditLogs);

// GET /api/v1/audit-logs/count - 获取审计日志总数
router.get('/count', auditController.getLogCount);

// DELETE /api/v1/audit-logs - 删除所有审计日志
router.delete('/', auditController.deleteAllLogs);

export default router;
