import { Request, Response, NextFunction } from 'express';
import { TransfersService } from './transfers.service';
import { InitiateTransferPayload } from './transfers.types';

export class TransfersController {
  private transfersService: TransfersService;

  constructor() {
    this.transfersService = new TransfersService();
    // 绑定 'this' 上下文
    this.initiateTransfer = this.initiateTransfer.bind(this);
    this.getAllStatuses = this.getAllStatuses.bind(this);
    this.getTaskStatus = this.getTaskStatus.bind(this);
    this.cancelTransfer = this.cancelTransfer.bind(this); // +++ 绑定新方法 +++
  }

  public async initiateTransfer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // @ts-ignore // session可能没有强类型定义，或者userId是可选的
      const userId = req.session?.userId;
      if (!userId) {
        // 此检查是为了双重保险，理论上isAuthenticated中间件会阻止未认证的请求
        res.status(401).json({ message: '用户未认证或会话无效。' });
        return;
      }

      const payload = req.body as InitiateTransferPayload;
      // TODO: 添加payload验证逻辑
      if (
        !payload ||
        !payload.connectionIds ||
        !payload.sourceItems ||
        !payload.remoteTargetPath ||
        !payload.transferMethod
      ) {
        res.status(400).json({
          message:
            'Invalid payload. Required fields: connectionIds, sourceItems, remoteTargetPath, transferMethod.',
        });
        return;
      }
      if (!Array.isArray(payload.connectionIds) || payload.connectionIds.length === 0) {
        res.status(400).json({ message: 'connectionIds must be a non-empty array.' });
        return;
      }
      if (!Array.isArray(payload.sourceItems) || payload.sourceItems.length === 0) {
        res.status(400).json({ message: 'sourceItems must be a non-empty array.' });
        return;
      }
      // 更多详细验证可以后续添加

      const task = await this.transfersService.initiateNewTransfer(payload, userId);
      res.status(202).json(task); // 202 Accepted 表示请求已接受处理，但尚未完成
    } catch (error) {
      console.error('[TransfersController] Error initiating transfer:', error);
      res.status(500).json({
        message: 'Failed to initiate transfer.',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async getAllStatuses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // @ts-ignore
      const userId = req.session?.userId;
      if (!userId) {
        res.status(401).json({ message: '用户未认证或会话无效。' });
        return;
      }
      const tasks = await this.transfersService.getAllTransferTasks(userId);
      res.status(200).json(tasks);
    } catch (error) {
      console.error('[TransfersController] Error getting all transfer statuses:', error);
      res.status(500).json({
        message: 'Failed to retrieve transfer statuses.',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async getTaskStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // @ts-ignore
      const userId = req.session?.userId;
      if (!userId) {
        res.status(401).json({ message: '用户未认证或会话无效。' });
        return;
      }

      const { taskId } = req.params;
      if (!taskId) {
        res.status(400).json({ message: 'Task ID is required.' });
        return;
      }
      const task = await this.transfersService.getTransferTaskDetails(taskId, userId);
      if (task) {
        res.status(200).json(task);
      } else {
        // 服务层现在会根据userId过滤，所以404可能是任务不存在，或用户无权访问
        res.status(404).json({
          message: `Transfer task with ID ${taskId} not found or not accessible by this user.`,
        });
      }
    } catch (error) {
      console.error(
        `[TransfersController] Error getting status for task ${req.params.taskId}:`,
        error
      );
      res.status(500).json({
        message: 'Failed to retrieve task status.',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async cancelTransfer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // @ts-ignore
      const userId = req.session?.userId;
      if (!userId) {
        res.status(401).json({ message: '用户未认证或会话无效。' });
        return;
      }

      const { taskId } = req.params;
      if (!taskId) {
        res.status(400).json({ message: 'Task ID is required for cancellation.' });
        return;
      }

      const success = await this.transfersService.cancelTransferTask(taskId, userId);
      if (success) {
        res.status(200).json({ message: `Transfer task ${taskId} cancellation initiated.` });
      } else {
        // 可能任务不存在，或不属于该用户，或无法取消
        res.status(404).json({
          message: `Failed to initiate cancellation for task ${taskId}. It may not exist, not be accessible, or already be in a final state.`,
        });
      }
    } catch (error) {
      console.error(`[TransfersController] Error cancelling task ${req.params.taskId}:`, error);
      res.status(500).json({
        message: 'Failed to cancel task.',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
