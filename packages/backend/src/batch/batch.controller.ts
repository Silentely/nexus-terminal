/**
 * 批量作业 Controller 层
 * 处理 HTTP 请求和响应
 */

import { Request, Response } from 'express';
import * as BatchService from './batch.service';
import { BatchExecPayload } from './batch.types';

/**
 * 获取当前用户 ID
 */
function getUserId(req: Request): number | null {
  return (req.session as any)?.userId ?? null;
}

/**
 * 执行批量命令
 * POST /api/v1/batch
 */
export const execBatch = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const { command, connectionIds, concurrencyLimit, timeoutSeconds, env, workdir, sudo } = req.body;

  // 参数验证
  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    res.status(400).json({ success: false, message: '命令不能为空' });
    return;
  }

  if (!Array.isArray(connectionIds) || connectionIds.length === 0) {
    res.status(400).json({ success: false, message: 'connectionIds 必须是非空数组' });
    return;
  }

  if (!connectionIds.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    res.status(400).json({ success: false, message: 'connectionIds 中的每个元素必须是正整数' });
    return;
  }

  if (
    concurrencyLimit !== undefined &&
    (typeof concurrencyLimit !== 'number' || concurrencyLimit < 1 || concurrencyLimit > 50)
  ) {
    res.status(400).json({ success: false, message: 'concurrencyLimit 必须是 1-50 之间的数字' });
    return;
  }

  if (
    timeoutSeconds !== undefined &&
    (typeof timeoutSeconds !== 'number' || timeoutSeconds < 1 || timeoutSeconds > 3600)
  ) {
    res.status(400).json({ success: false, message: 'timeoutSeconds 必须是 1-3600 之间的数字' });
    return;
  }

  if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env))) {
    res.status(400).json({ success: false, message: 'env 必须是对象' });
    return;
  }

  if (workdir !== undefined && typeof workdir !== 'string') {
    res.status(400).json({ success: false, message: 'workdir 必须是字符串' });
    return;
  }

  if (sudo !== undefined && typeof sudo !== 'boolean') {
    res.status(400).json({ success: false, message: 'sudo 必须是布尔值' });
    return;
  }

  try {
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
  } catch (error: any) {
    console.error('[BatchController] 创建批量任务失败:', error.message);
    res.status(500).json({ success: false, message: error.message || '创建批量任务失败' });
  }
};

/**
 * 获取任务状态
 * GET /api/v1/batch/:taskId
 */
export const getTaskStatus = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const { taskId } = req.params;

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ success: false, message: '无效的任务 ID' });
    return;
  }

  try {
    const task = await BatchService.getTaskStatus(taskId);

    if (!task) {
      res.status(404).json({ success: false, message: '任务不存在' });
      return;
    }

    // 验证任务所有权
    if (task.userId !== userId && String(task.userId) !== String(userId)) {
      res.status(403).json({ success: false, message: '无权访问此任务' });
      return;
    }

    res.status(200).json({ success: true, task });
  } catch (error: any) {
    console.error('[BatchController] 获取任务状态失败:', error.message);
    res.status(500).json({ success: false, message: error.message || '获取任务状态失败' });
  }
};

/**
 * 获取用户的任务列表
 * GET /api/v1/batch
 */
export const getTaskList = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const limit = parseInt(req.query.limit as string, 10) || 20;
  const offset = parseInt(req.query.offset as string, 10) || 0;

  // 限制范围
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);

  try {
    const tasks = await BatchService.getTasksByUser(userId, safeLimit, safeOffset);
    res.status(200).json({ success: true, tasks, limit: safeLimit, offset: safeOffset });
  } catch (error: any) {
    console.error('[BatchController] 获取任务列表失败:', error.message);
    res.status(500).json({ success: false, message: error.message || '获取任务列表失败' });
  }
};

/**
 * 取消任务
 * POST /api/v1/batch/:taskId/cancel
 */
export const cancelTask = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const { taskId } = req.params;
  const { reason } = req.body;

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ success: false, message: '无效的任务 ID' });
    return;
  }

  try {
    // 先验证任务所有权
    const task = await BatchService.getTaskStatus(taskId);
    if (!task) {
      res.status(404).json({ success: false, message: '任务不存在' });
      return;
    }

    if (task.userId !== userId && String(task.userId) !== String(userId)) {
      res.status(403).json({ success: false, message: '无权取消此任务' });
      return;
    }

    const success = await BatchService.cancelTask(taskId, reason || '用户取消');

    if (success) {
      res.status(200).json({ success: true, taskId, message: '任务已取消' });
    } else {
      res.status(400).json({ success: false, message: '无法取消任务（可能已完成或已取消）' });
    }
  } catch (error: any) {
    console.error('[BatchController] 取消任务失败:', error.message);
    res.status(500).json({ success: false, message: error.message || '取消任务失败' });
  }
};

/**
 * 删除任务
 * DELETE /api/v1/batch/:taskId
 */
export const deleteTask = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: '未授权' });
    return;
  }

  const { taskId } = req.params;

  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ success: false, message: '无效的任务 ID' });
    return;
  }

  try {
    const success = await BatchService.deleteTask(taskId, userId);

    if (success) {
      res.status(200).json({ success: true, message: '任务已删除' });
    } else {
      res.status(404).json({ success: false, message: '任务不存在或无权删除' });
    }
  } catch (error: any) {
    console.error('[BatchController] 删除任务失败:', error.message);
    res.status(500).json({ success: false, message: error.message || '删除任务失败' });
  }
};
