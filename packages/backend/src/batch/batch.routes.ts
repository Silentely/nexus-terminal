/**
 * 批量作业路由定义
 */

import { Router } from 'express';
import * as BatchController from './batch.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();

// 所有路由都需要认证
router.use(isAuthenticated);

// POST /api/v1/batch - 执行批量命令
router.post('/', BatchController.execBatch);

// GET /api/v1/batch - 获取用户的任务列表
router.get('/', BatchController.getTaskList);

// GET /api/v1/batch/:taskId - 获取指定任务状态
router.get('/:taskId', BatchController.getTaskStatus);

// POST /api/v1/batch/:taskId/cancel - 取消任务
router.post('/:taskId/cancel', BatchController.cancelTask);

// DELETE /api/v1/batch/:taskId - 删除任务
router.delete('/:taskId', BatchController.deleteTask);

export default router;
