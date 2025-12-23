import { Router } from 'express';
import { TransfersController } from './transfers.controller';
import { isAuthenticated } from '../auth/auth.middleware';

export const transfersRoutes = (): Router => {
  const router = Router();
  const controller = new TransfersController();

  // 应用认证中间件到所有 /transfers 路由
  router.use(isAuthenticated);

  // POST /api/transfers/send - 发起新的文件传输任务
  router.post('/send', controller.initiateTransfer);

  // GET /api/transfers/status - 获取所有活动或近期传输任务的状态
  router.get('/status', controller.getAllStatuses);

  // GET /api/transfers/status/:taskId - 获取特定传输任务的详细状态
  router.get('/status/:taskId', controller.getTaskStatus);

  // POST /api/transfers/cancel/:taskId - 请求取消一个传输任务
  router.post('/cancel/:taskId', controller.cancelTransfer);

  return router;
};
