/**
 * 批量作业 Controller 层
 * 处理 HTTP 请求和响应
 * P1-6: 重构使用标准化错误处理
 */

import { Request, Response, NextFunction } from 'express';
import * as BatchService from './batch.service';
import { BatchExecPayload } from './batch.types';
import { ErrorFactory } from '../utils/AppError';

/**
 * 获取当前用户 ID
 */
function getUserId(req: Request): number {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    throw ErrorFactory.unauthorized('用户未登录');
  }
  return userId;
}

/**
 * 执行批量命令
 * POST /api/v1/batch
 */
export const execBatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { command, connectionIds, concurrencyLimit, timeoutSeconds, env, workdir, sudo } =
      req.body;

    // 参数验证
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      throw ErrorFactory.validationError('命令不能为空');
    }

    if (!Array.isArray(connectionIds) || connectionIds.length === 0) {
      throw ErrorFactory.validationError('connectionIds 必须是非空数组');
    }

    if (!connectionIds.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
      throw ErrorFactory.validationError('connectionIds 中的每个元素必须是正整数');
    }

    if (
      concurrencyLimit !== undefined &&
      (typeof concurrencyLimit !== 'number' || concurrencyLimit < 1 || concurrencyLimit > 50)
    ) {
      throw ErrorFactory.validationError('concurrencyLimit 必须是 1-50 之间的数字');
    }

    if (
      timeoutSeconds !== undefined &&
      (typeof timeoutSeconds !== 'number' || timeoutSeconds < 1 || timeoutSeconds > 3600)
    ) {
      throw ErrorFactory.validationError('timeoutSeconds 必须是 1-3600 之间的数字');
    }

    if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env))) {
      throw ErrorFactory.validationError('env 必须是对象');
    }

    if (workdir !== undefined && typeof workdir !== 'string') {
      throw ErrorFactory.validationError('workdir 必须是字符串');
    }

    if (sudo !== undefined && typeof sudo !== 'boolean') {
      throw ErrorFactory.validationError('sudo 必须是布尔值');
    }

    const payload: BatchExecPayload = {
      command: command.trim(),
      connectionIds,
      concurrencyLimit,
      timeoutSeconds,
      env,
      workdir,
      sudo,
    };

    const task = await BatchService.execCommandBatch(payload, userId);

    res.status(201).json({
      success: true,
      taskId: task.taskId,
      message: `批量任务已创建，包含 ${task.totalSubTasks} 个子任务`,
      task,
    });
  } catch (error) {
    next(error); // 传递给全局错误处理中间件
  }
};

/**
 * 获取任务状态
 * GET /api/v1/batch/:taskId
 */
export const getTaskStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { taskId } = req.params;

    if (!taskId || typeof taskId !== 'string') {
      throw ErrorFactory.validationError('无效的任务 ID');
    }

    const task = await BatchService.getTaskStatus(taskId);

    if (!task) {
      throw ErrorFactory.notFound('任务不存在');
    }

    // 验证任务所有权
    if (task.userId !== userId && String(task.userId) !== String(userId)) {
      throw ErrorFactory.forbidden('无权访问此任务');
    }

    res.status(200).json({ success: true, task });
  } catch (error) {
    next(error);
  }
};

/**
 * 获取用户的任务列表
 * GET /api/v1/batch
 */
export const getTaskList = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getUserId(req);

    const limit = parseInt(req.query.limit as string, 10) || 20;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    // 限制范围
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    const tasks = await BatchService.getTasksByUser(userId, safeLimit, safeOffset);
    res.status(200).json({ success: true, tasks, limit: safeLimit, offset: safeOffset });
  } catch (error) {
    next(error);
  }
};

/**
 * 取消任务
 * POST /api/v1/batch/:taskId/cancel
 */
export const cancelTask = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { taskId } = req.params;
    const { reason } = req.body;

    if (!taskId || typeof taskId !== 'string') {
      throw ErrorFactory.validationError('无效的任务 ID');
    }

    // 先验证任务所有权
    const task = await BatchService.getTaskStatus(taskId);
    if (!task) {
      throw ErrorFactory.notFound('任务不存在');
    }

    if (task.userId !== userId && String(task.userId) !== String(userId)) {
      throw ErrorFactory.forbidden('无权取消此任务');
    }

    const success = await BatchService.cancelTask(taskId, reason || '用户取消');

    if (success) {
      res.status(200).json({ success: true, taskId, message: '任务已取消' });
    } else {
      throw ErrorFactory.badRequest('无法取消任务（可能已完成或已取消）');
    }
  } catch (error) {
    next(error);
  }
};

/**
 * 删除任务
 * DELETE /api/v1/batch/:taskId
 */
export const deleteTask = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { taskId } = req.params;

    if (!taskId || typeof taskId !== 'string') {
      throw ErrorFactory.validationError('无效的任务 ID');
    }

    const success = await BatchService.deleteTask(taskId, userId);

    if (success) {
      res.status(200).json({ success: true, message: '任务已删除' });
    } else {
      throw ErrorFactory.notFound('任务不存在或无权删除');
    }
  } catch (error) {
    next(error);
  }
};
